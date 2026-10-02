// Debug Adapter translating DAP to the camel-db HTTP API.
// camel-db owns execution: this adapter spawns (launch) or connects to (attach)
// the debugger gateway and forwards run/continue/step/restart/terminate, maps
// line breakpoints to GIR node origins via gir-json source spans, and reports
// pause/terminate state polled from the gateway.
import * as vscode from 'vscode'
import * as child_process from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { apiGet, apiPost } from './http'

export interface CamelLaunchArguments {
    request: 'launch' | 'attach'
    program?: string
    debugPort?: number
    camelDbPath?: string
}

interface CamelDbPausedNode {
    nodeId: string
    graphId: string
    origin: number
    ref: number
}

interface CamelDbTask {
    id: string
    port: number
    scriptPath: string
    taskState: string
    paused: boolean
    pauseReason?: { phase?: string; origin?: number; ref?: number; graphId?: string; nodeId?: string }
    pausedNode?: CamelDbPausedNode
}

interface CamelDbState {
    hasFile?: boolean
    serverRunning?: boolean
    targetFile?: string
    tasks?: CamelDbTask[]
}

interface GirSpan {
    file: string
    startLine: number
    startCharacter: number
    endLine: number
    endCharacter: number
}

interface GirNodeJson {
    id: number
    graphId: string
    type: string
    originId?: number
    span?: GirSpan
}

interface GirGraphJson {
    id?: string
    name?: string
    children?: { id: string; name?: string }[]
    nodes?: GirNodeJson[]
}

const DEFAULT_PORT = 8765

function normalizeFile(p: string): string {
    return path.resolve(p).replace(/\\/g, '/').toLowerCase()
}

export class CamelDebugSession implements vscode.DebugAdapter {
    private static nextHandle = 1

    private readonly messageEmitter = new vscode.EventEmitter<vscode.DebugProtocolMessage>()
    readonly onDidSendMessage = this.messageEmitter.event

    private seq = 0
    private port = DEFAULT_PORT
    private camelDb: child_process.ChildProcess | null = null
    private poller: NodeJS.Timeout | null = null
    private wasPaused = false
    private disposed = false
    private program = ''
    private taskId = ''
    private parentLogOffset = 0
    private readonly nodeBreakpointOrigins = new Set<number>()

    // Line-breakpoint bookkeeping: DAP ids we assigned + verification state.
    private nextBreakpointId = 1
    private readonly lineBreakpoints = new Map<
        string,
        { id: number; line: number; verified: boolean; message?: string }[]
    >()
    private girOriginIndex: Map<number, GirNodeJson & { graphName?: string }> | null = null
    private girLineIndex: Map<string, Map<number, number[]>> | null = null
    private girIndexAttempted = false
    private readonly lineBreakpointOrigins = new Set<number>()

    // Debug state.
    private lastPausedGraphId = ''
    private lastPausedOrigin = 0
    private expectStepStop = false
    private runActive = false
    private runTerminated = false

    /** Fired whenever the paused node changes; used to highlight the GIR panel. */
    onDidChangePausedNode: ((origin: number | null) => void) | null = null

    /** Fired when the gir-json span index refreshed (run started/restarted). */
    onDidRefreshGirIndex: (() => void) | null = null

    private queue: Promise<void> = Promise.resolve()

    handleMessage(message: unknown): void {
        const request = message as { seq?: number; command?: string; arguments?: any }
        if (!request?.command) {
            return
        }
        // Serialize dispatch: DAP clients rely on requests taking effect in send
        // order (e.g. setBreakpoints must reach camel-db before a continue).
        this.queue = this.queue
            .then(() => this.dispatch(request))
            .catch((error) => {
                this.respond(request, undefined, false, String(error))
            })
    }

    dispose(): void {
        this.disposed = true
        this.stopPolling()
        this.killCamelDb()
        this.messageEmitter.dispose()
    }

    /** Sync GIR node breakpoints (origins from the GraphIR panel) to camel-db. */
    async setNodeBreakpoints(origins: number[]): Promise<void> {
        this.nodeBreakpointOrigins.clear()
        origins.forEach((o) => this.nodeBreakpointOrigins.add(o))
        await this.pushNodeBreakpoints()
    }

    /** camel-db port + task id of this session (for panel-side HTTP queries). */
    debugTarget(): { port: number; target: string } | null {
        return this.taskId ? { port: this.port, target: this.taskId } : null
    }

    private async dispatch(request: { seq?: number; command?: string; arguments?: any }): Promise<void> {
        switch (request.command) {
            case 'initialize':
                this.respond(request, {
                    supportsConfigurationDoneRequest: false,
                    supportsEvaluateForHovers: false,
                    supportsStepBack: false,
                    supportsRestartRequest: true,
                    supportsTerminateRequest: true,
                    supportsStepOver: true,
                    supportsStepIn: true,
                    supportsStepOut: false,
                    supportsPauseRequest: false
                })
                return

            case 'launch':
                await this.launch(request.arguments as CamelLaunchArguments, request)
                return

            case 'attach':
                await this.attach(request.arguments as CamelLaunchArguments, request)
                return

            case 'setBreakpoints':
                await this.setLineBreakpoints(request)
                return

            case 'continue':
                await apiPost(this.port, '/api/continue', { target: this.taskId })
                this.respond(request, { allThreadsContinued: true })
                return

            case 'next':
                // Step over: pause at the next node of the graph we are stopped in.
                await apiPost(this.port, '/api/step', {
                    target: this.taskId,
                    graphId: this.lastPausedGraphId
                })
                this.expectStepStop = true
                this.respond(request, {})
                return

            case 'stepIn':
                // Step in: pause at the next node in any graph.
                await apiPost(this.port, '/api/step', { target: this.taskId })
                this.expectStepStop = true
                this.respond(request, {})
                return

            case 'restart':
                await apiPost(this.port, '/api/restart', { target: this.taskId })
                this.wasPaused = false
                this.runActive = true
                this.runTerminated = false
                this.girIndexAttempted = true
                void this.refreshGirIndex()
                this.respond(request, {})
                return

            case 'disconnect':
            case 'terminate':
                await this.cleanupSession()
                this.respond(request, {})
                this.sendEvent('terminated', {})
                return

            case 'threads':
                this.respond(request, { threads: [{ id: 1, name: 'main' }] })
                return

            case 'stackTrace':
                this.respond(request, { stackFrames: [this.currentStackFrame()], totalFrames: 1 })
                return

            case 'scopes':
                this.respond(request, { scopes: [] })
                return

            case 'variables':
                this.respond(request, { variables: [] })
                return

            default:
                this.respond(request, undefined, false, `Unsupported request: ${request.command}`)
        }
    }

    private currentStackFrame() {
        const id = CamelDebugSession.nextHandle++
        const frame: Record<string, unknown> = { id, name: 'main', line: 0, column: 0 }
        const node = this.lastPausedOriginNode()
        if (node?.span) {
            frame.name = node.graphName || node.graphId || 'main'
            // gir-json spans are 0-based LSP-style; DAP is 1-based.
            frame.line = node.span.startLine + 1
            frame.column = node.span.startCharacter + 1
            frame.source = { path: node.span.file, name: node.span.file.split(/[\\/]/).pop() }
        } else if (this.program) {
            frame.source = { path: this.program, name: this.program.split(/[\\/]/).pop() }
        }
        return frame
    }

    private lastPausedOriginNode(): (GirNodeJson & { graphName?: string }) | null {
        if (!this.girOriginIndex || !this.lastPausedOrigin) {
            return null
        }
        return this.girOriginIndex.get(this.lastPausedOrigin) ?? null
    }

    private async setLineBreakpoints(request: { seq?: number; arguments?: any }): Promise<void> {
        const args = request.arguments ?? {}
        const sourcePath: string = args.source?.path ?? this.program
        const requested: { line: number }[] = args.breakpoints ?? []
        const key = normalizeFile(sourcePath)
        const existing = this.lineBreakpoints.get(key) ?? []
        const entries = requested.map((bp) => {
            const known = existing.find((e) => e.line === bp.line)
            const id = known?.id ?? this.nextBreakpointId++
            const verified = this.lineMapsToOrigin(key, bp.line)
            return {
                id,
                line: bp.line,
                verified,
                message: verified
                    ? undefined
                    : 'No GIR node covers this line (yet). Breakpoint activates when a node maps here.'
            }
        })
        this.lineBreakpoints.set(key, entries)
        // Sync origins both ways immediately: upgrades push newly covered origins,
        // removals clear them at the worker. The push must complete before we
        // respond: a client that awaits setBreakpoints and then sends `continue`
        // relies on the worker having the new origin set already.
        await this.reverifyLineBreakpoints()
        this.respond(request, {
            breakpoints: entries.map((e) => ({
                id: e.id,
                verified: e.verified,
                line: e.line,
                message: e.message
            }))
        })
        if (!this.girIndexAttempted) {
            this.girIndexAttempted = true
            await this.refreshGirIndex()
        }
    }

    private lineMapsToOrigin(key: string, oneBasedLine: number): boolean {
        if (!this.girLineIndex) {
            return false
        }
        const origins = this.girLineIndex.get(key)?.get(oneBasedLine - 1)
        return !!origins && origins.length > 0
    }

    /** Fetch gir-json for every graph of the current run and build span indexes. */
    private async refreshGirIndex(): Promise<void> {
        try {
            const query = this.taskId ? `?target=${encodeURIComponent(this.taskId)}` : ''
            const root = (await apiGet(this.port, `/api/gir-json${query}`)) as {
                ok?: boolean
                graph?: GirGraphJson
            }
            if (!root.ok || !root.graph) {
                this.girIndexAttempted = false // transient (worker starting); let the poll retry
                return
            }
            // BFS over nested graphs: inner closures (branch arms, sync blocks) live in
            // subgraphs of subgraphs, and their nodes carry source spans too.
            const graphs: GirGraphJson[] = []
            const queue: GirGraphJson[] = [root.graph]
            const seen = new Set<string>()
            while (queue.length > 0) {
                const summary = queue.shift()!
                const id = summary.id ?? ''
                if (id && seen.has(id)) {
                    continue
                }
                if (id) {
                    seen.add(id)
                }
                const full = (await apiGet(
                    this.port,
                    `/api/gir-json${query ? `${query}&` : '?'}graphId=${encodeURIComponent(id)}`
                )) as { ok?: boolean; graph?: GirGraphJson }
                if (!full.ok || !full.graph) {
                    continue
                }
                graphs.push(full.graph)
                for (const child of full.graph.children ?? []) {
                    queue.push(child)
                }
            }
            const byOrigin = new Map<number, GirNodeJson & { graphName?: string }>()
            const byFileLine = new Map<string, Map<number, number[]>>()
            for (const graph of graphs) {
                for (const node of graph.nodes ?? []) {
                    if (!node.span || !node.originId) {
                        continue
                    }
                    byOrigin.set(node.originId, { ...node, graphName: graph.name })
                    const fileKey = normalizeFile(node.span.file)
                    let lines = byFileLine.get(fileKey)
                    if (!lines) {
                        lines = new Map()
                        byFileLine.set(fileKey, lines)
                    }
                    for (let line = node.span.startLine; line <= node.span.endLine; line++) {
                        const origins = lines.get(line)
                        if (origins) {
                            origins.push(node.originId)
                        } else {
                            lines.set(line, [node.originId])
                        }
                    }
                }
            }
            this.girOriginIndex = byOrigin
            this.girLineIndex = byFileLine
            void this.reverifyLineBreakpoints()
            this.onDidRefreshGirIndex?.()
        } catch {
            // gir-json unavailable yet (worker still starting / run not started);
            // the poll loop retries because girIndexAttempted stays false.
            this.girIndexAttempted = false
        }
    }

    /** After the index arrives, upgrade line breakpoints, notify VSCode, and push
     *  the newly covered origins to camel-db so execution actually pauses there. */
    private reverifyLineBreakpoints(): Promise<void> {
        this.lineBreakpointOrigins.clear()
        for (const [key, entries] of this.lineBreakpoints) {
            for (const entry of entries) {
                const verified = this.lineMapsToOrigin(key, entry.line)
                if (verified) {
                    const origins = this.girLineIndex?.get(key)?.get(entry.line - 1) ?? []
                    origins.forEach((o) => this.lineBreakpointOrigins.add(o))
                }
                if (verified === entry.verified) {
                    continue
                }
                entry.verified = verified
                entry.message = verified
                    ? undefined
                    : 'No GIR node covers this line (yet). Breakpoint activates when a node maps here.'
                this.sendEvent('breakpoint', {
                    reason: 'changed',
                    breakpoint: {
                        id: entry.id,
                        verified: entry.verified,
                        line: entry.line,
                        message: entry.message
                    }
                })
            }
        }
        return this.pushNodeBreakpoints()
    }

    private async launch(args: CamelLaunchArguments, request: { seq?: number }): Promise<void> {
        const program = args.program
        if (!program || !fs.existsSync(program)) {
            this.respond(request, undefined, false, `launch: program "${program}" does not exist`)
            return
        }
        this.program = program
        this.port = args.debugPort ?? DEFAULT_PORT

        const camelDbPath = args.camelDbPath?.trim()
        if (!camelDbPath) {
            this.respond(request, undefined, false, 'camel-db not found. Set "opencmlLanguageServer.camelDbPath" or fix camelPath.')
            return
        }

        this.camelDb = child_process.spawn(camelDbPath, ['--serve', String(this.port)], {
            cwd: path.dirname(program),
            stdio: ['pipe', 'pipe', 'pipe']
        })
        this.camelDb.stderr?.on('data', () => undefined)
        this.camelDb.stdout?.on('data', () => undefined)
        this.camelDb.on('error', (error) => {
            this.sendEvent('output', {
                category: 'stderr',
                output: `Failed to start camel-db: ${error.message}\n`
            })
        })

        await this.waitForApi()
        const loaded = (await apiPost(this.port, '/api/file', { path: program })) as { taskId?: string }
        this.taskId = loaded.taskId ?? ''
        await this.pushNodeBreakpoints()
        await this.pushAllLineBreakpoints()
        await apiPost(this.port, '/api/run', this.taskId ? { target: this.taskId } : {})
        this.runActive = true
        this.runTerminated = false
        this.respond(request, {})
        this.startPolling()
    }

    private async attach(args: CamelLaunchArguments, request: { seq?: number }): Promise<void> {
        this.port = args.debugPort ?? DEFAULT_PORT
        try {
            await this.waitForApi()
        } catch {
            this.respond(request, undefined, false, `attach: no camel-db answering on 127.0.0.1:${this.port}`)
            return
        }
        const state = (await apiGet(this.port, '/api/state')) as CamelDbState
        this.program = state.targetFile ?? ''
        this.taskId = state.tasks?.[0]?.id ?? ''
        await this.pushNodeBreakpoints()
        await this.pushAllLineBreakpoints()
        this.runActive = state.tasks?.some((t) => t.taskState === 'running' || t.taskState === 'paused') ?? false
        this.respond(request, {})
        this.startPolling()
    }

    private async pushNodeBreakpoints(): Promise<void> {
        const originIds = [...new Set([...this.nodeBreakpointOrigins, ...this.lineBreakpointOrigins])]
        if (originIds.length === 0 && !this.taskId) {
            return
        }
        try {
            await apiPost(this.port, '/api/gir-breakpoints', {
                target: this.taskId,
                originIds
            })
        } catch {
            // camel-db not up yet (breakpoints are re-pushed on demand); ignore
        }
    }

    private async pushAllLineBreakpoints(): Promise<void> {
        if (this.lineBreakpoints.size === 0) {
            return
        }
        this.girIndexAttempted = true
        await this.refreshGirIndex()
        this.reverifyLineBreakpoints()
    }

    private async waitForApi(): Promise<void> {
        const deadline = Date.now() + 10000
        while (Date.now() < deadline) {
            if (this.disposed) {
                throw new Error('disposed')
            }
            try {
                await apiGet(this.port, '/api/state')
                return
            } catch {
                await new Promise((r) => setTimeout(r, 250))
            }
        }
        throw new Error(`camel-db did not start on port ${this.port} within 10s`)
    }

    private startPolling(): void {
        this.stopPolling()
        this.poller = setInterval(() => void this.poll(), 500)
    }

    private stopPolling(): void {
        if (this.poller) {
            clearInterval(this.poller)
            this.poller = null
        }
    }

    private async poll(): Promise<void> {
        if (this.disposed) {
            return
        }
        try {
            const state = (await apiGet(this.port, '/api/state')) as CamelDbState
            const tasks = state.tasks ?? []
            const task = tasks.find((t) => (this.taskId ? t.id === this.taskId : true)) ?? tasks[0]
            if (task && !this.taskId) {
                this.taskId = task.id
            }
            const pausedTask = task?.paused ? task : undefined

            // Refresh the gir-json index once a run exists but the index is still missing.
            if (!this.girOriginIndex && this.runActive && !this.girIndexAttempted) {
                this.girIndexAttempted = true
                void this.refreshGirIndex()
            }

            if (pausedTask && !this.wasPaused) {
                this.wasPaused = true
                const pausedNode = pausedTask.pausedNode
                if (pausedNode) {
                    this.lastPausedGraphId = pausedNode.graphId
                    this.lastPausedOrigin = pausedNode.origin
                }
                const origin = pausedNode?.origin ?? 0
                this.onDidChangePausedNode?.(origin > 0 ? origin : null)
                const reason = this.expectStepStop ? 'step' : 'breakpoint'
                this.expectStepStop = false
                this.sendEvent('stopped', {
                    reason,
                    threadId: 1,
                    allThreadsStopped: true,
                    text: pausedTask.pauseReason?.phase ?? (reason === 'step' ? 'step' : 'breakpoint')
                })
            } else if (!pausedTask && this.wasPaused) {
                this.wasPaused = false
                this.lastPausedOrigin = 0
                this.onDidChangePausedNode?.(null)
                this.sendEvent('continued', { threadId: 1, allThreadsContinued: true })
            }

            // Natural termination: the worker reports completed/terminated for a run we started.
            if (task && this.runActive && !this.runTerminated) {
                if (task.taskState === 'completed' || task.taskState === 'terminated' || task.taskState === 'exited') {
                    this.runTerminated = true
                    this.runActive = false
                    this.wasPaused = false
                    this.lastPausedOrigin = 0
                    this.onDidChangePausedNode?.(null)
                    this.sendEvent('terminated', {})
                }
            }

            await this.streamLogs()
        } catch {
            // camel-db unreachable; next poll retries
        }
    }

    private async streamLogs(): Promise<void> {
        try {
            const data = (await apiGet(this.port, `/api/log?offset=${this.parentLogOffset}`)) as {
                lines?: string[]
                nextOffset?: number
            }
            const lines = data.lines ?? []
            if (typeof data.nextOffset === 'number') {
                this.parentLogOffset = data.nextOffset
            }
            for (const line of lines) {
                this.sendEvent('output', { category: 'stdout', output: line })
            }
        } catch {
            // ignore
        }
    }

    private async cleanupSession(): Promise<void> {
        this.stopPolling()
        try {
            await apiPost(this.port, '/api/terminate', { target: this.taskId })
        } catch {
            // ignore
        }
        this.killCamelDb()
    }

    private killCamelDb(): void {
        if (this.camelDb && !this.camelDb.killed) {
            this.camelDb.kill()
        }
        this.camelDb = null
    }

    private respond(request: { seq?: number }, body?: unknown, success = true, message?: string): void {
        this.seq += 1
        const response: Record<string, unknown> = {
            seq: this.seq,
            type: 'response',
            request_seq: request.seq ?? 0,
            command: (request as { command?: string }).command ?? '',
            success
        }
        if (success) {
            response.body = body ?? {}
        } else {
            response.message = message ?? 'failed'
        }
        this.messageEmitter.fire(response as vscode.DebugProtocolMessage)
    }

    private sendEvent(event: string, body: unknown): void {
        this.seq += 1
        this.messageEmitter.fire({ seq: this.seq, type: 'event', event, body } as vscode.DebugProtocolMessage)
    }
}

export class CamelDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    private readonly sessions = new Map<string, CamelDebugSession>()

    /** Fired when any session's paused node changes (for the GIR panel highlight). */
    onDidChangePausedNode: ((origin: number | null) => void) | null = null

    /** Fired when any session refreshes its gir-json index (run started/restarted). */
    onDidRefreshGirIndex: (() => void) | null = null

    constructor(private readonly context: vscode.ExtensionContext) {}

    createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        const adapter = new CamelDebugSession()
        adapter.onDidChangePausedNode = (origin) => this.onDidChangePausedNode?.(origin)
        adapter.onDidRefreshGirIndex = () => this.onDidRefreshGirIndex?.()
        this.sessions.set(session.id, adapter)
        return new vscode.DebugAdapterInlineImplementation(adapter)
    }

    /** camel-db port + task id of the first session that has a task (panel queries). */
    currentTarget(): { port: number; target: string } | null {
        for (const adapter of this.sessions.values()) {
            const target = adapter.debugTarget()
            if (target) {
                return target
            }
        }
        return null
    }

    /** Push GIR node breakpoints (origins from the GraphIR panel) into every active session. */
    async syncNodeBreakpoints(origins: number[]): Promise<void> {
        for (const adapter of this.sessions.values()) {
            await adapter.setNodeBreakpoints(origins)
        }
    }

    disposeSession(session: vscode.DebugSession): void {
        const adapter = this.sessions.get(session.id)
        if (adapter) {
            adapter.dispose()
            this.sessions.delete(session.id)
        }
    }
}
