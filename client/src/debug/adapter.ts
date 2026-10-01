// Debug Adapter translating DAP to the camel-db HTTP API.
// camel-db owns execution: this adapter spawns (launch) or connects to (attach)
// the debugger gateway and forwards run/continue/restart/terminate plus pause
// detection and log streaming.
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

interface CamelDbTask {
    id: string
    port: number
    scriptPath: string
    taskState: string
    paused: boolean
    pauseReason?: string
}

interface CamelDbState {
    hasFile?: boolean
    serverRunning?: boolean
    targetFile?: string
    tasks?: CamelDbTask[]
}

const DEFAULT_PORT = 8765

export class CamelDebugSession implements vscode.DebugAdapter {
    private static nextHandle = 1

    private readonly messageEmitter = new vscode.EventEmitter<vscode.DebugProtocolMessage>()
    readonly onDidSendMessage = this.messageEmitter.event

    private seq = 0
    private port = DEFAULT_PORT
    private camelDb: child_process.ChildProcess | null = null
    private poller: NodeJS.Timeout | null = null
    private wasPaused = false
    private hadTasks = false
    private disposed = false
    private program = ''
    private parentLogOffset = 0
    private readonly nodeBreakpointIds = new Set<string>()

    handleMessage(message: unknown): void {
        const request = message as { seq?: number; command?: string; arguments?: any }
        if (!request?.command) {
            return
        }
        void this.dispatch(request).catch((error) => {
            this.respond(request, undefined, false, String(error))
        })
    }

    dispose(): void {
        this.disposed = true
        this.stopPolling()
        this.killCamelDb()
        this.messageEmitter.dispose()
    }

    /** Sync GIR node breakpoints (from the GraphIR panel) to camel-db. */
    async setNodeBreakpoints(nodeIds: string[]): Promise<void> {
        this.nodeBreakpointIds.clear()
        nodeIds.forEach((id) => this.nodeBreakpointIds.add(id))
        await this.pushNodeBreakpoints()
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
                    // camel has no line-level stepping yet (node-level step is a
                    // planned camel-db feature), so keep stepping disabled.
                    supportsStepOver: false,
                    supportsStepIn: false,
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
                // Line breakpoints need source spans on GIR nodes (camel side).
                // Until then, breakpoints are set on GIR nodes from the GraphIR panel.
                this.respond(request, {
                    breakpoints: (request.arguments?.breakpoints ?? []).map(() => ({
                        verified: false,
                        message: 'Line breakpoints need Camel source-span support; use GraphIR node breakpoints (double-click a node) instead.'
                    }))
                })
                return

            case 'continue':
                await apiPost(this.port, '/api/continue')
                this.respond(request, { allThreadsContinued: true })
                return

            case 'restart':
                await apiPost(this.port, '/api/restart')
                this.wasPaused = false
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

            case 'stackTrace': {
                const frame = {
                    id: CamelDebugSession.nextHandle++,
                    name: 'main',
                    line: 0,
                    column: 0,
                    source: this.program ? { path: this.program, name: this.program.split(/[\\/]/).pop() } : undefined
                }
                this.respond(request, { stackFrames: [frame], totalFrames: 1 })
                return
            }

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
        await apiPost(this.port, '/api/file', { path: program })
        await this.pushNodeBreakpoints()
        await apiPost(this.port, '/api/run')
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
        await this.pushNodeBreakpoints()
        this.respond(request, {})
        this.startPolling()
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

    private async pushNodeBreakpoints(): Promise<void> {
        if (this.nodeBreakpointIds.size === 0) {
            return
        }
        try {
            await apiPost(this.port, '/api/gir-breakpoints', { nodeIds: [...this.nodeBreakpointIds] })
        } catch {
            // camel-db not up yet (breakpoints are re-pushed on demand); ignore
        }
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
            const pausedTask = tasks.find((t) => t.paused)

            if (pausedTask && !this.wasPaused) {
                this.wasPaused = true
                const reason = String(pausedTask.pauseReason ?? '')
                this.sendEvent('stopped', {
                    reason: /step/i.test(reason) ? 'step' : 'breakpoint',
                    threadId: 1,
                    allThreadsStopped: true,
                    text: reason
                })
            } else if (!pausedTask && this.wasPaused) {
                this.wasPaused = false
                this.sendEvent('continued', { threadId: 1, allThreadsContinued: true })
            }

            if (tasks.length > 0) {
                this.hadTasks = true
            } else if (this.hadTasks) {
                this.hadTasks = false
                this.sendEvent('terminated', {})
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
            await apiPost(this.port, '/api/terminate')
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

    constructor(private readonly context: vscode.ExtensionContext) {}

    createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        const adapter = new CamelDebugSession()
        this.sessions.set(session.id, adapter)
        return new vscode.DebugAdapterInlineImplementation(adapter)
    }

    /** Push GIR node breakpoints (from the GraphIR panel) into every active session. */
    async syncNodeBreakpoints(nodeIds: string[]): Promise<void> {
        for (const adapter of this.sessions.values()) {
            await adapter.setNodeBreakpoints(nodeIds)
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
