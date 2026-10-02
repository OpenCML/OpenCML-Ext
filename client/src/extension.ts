import * as path from 'path'
import * as fs from 'fs'
import * as child_process from 'child_process'
import * as vscode from 'vscode'
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node'
import { detectToolchain, spawnHint } from './toolchain'
import { CamelDebugAdapterFactory } from './debug/adapter'
import { apiGet } from './debug/http'

let client: LanguageClient
let outputChannel: vscode.OutputChannel | undefined
let debugFactory: CamelDebugAdapterFactory | undefined

function getCamelPath(): string {
    const config = vscode.workspace.getConfiguration('opencmlLanguageServer')
    return config.get<string>('camelPath') || 'camel'
}

function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('Camel')
    }
    return outputChannel
}

// 示例函数，展示如何使用获取到的配置项
function showCamelPath() {
    const softwarePath = getCamelPath()

    if (softwarePath) {
        vscode.window.showInformationMessage(`Camel Path: ${softwarePath}`)
    } else {
        vscode.window.showWarningMessage('Camel Path is not set.')
    }
}

function addWordToSpellChecker(words: string[]) {
    try {
        const config = vscode.workspace.getConfiguration()
        const cSpellWords = (config.get('cSpell.words') as string[]) || []
        console.log(cSpellWords)

        words.forEach((word) => {
            if (!cSpellWords.includes(word)) {
                cSpellWords.push(word)
            }
        })
        config.update('cSpell.words', cSpellWords, vscode.ConfigurationTarget.Workspace)
    } catch (error) {
        console.warn('Failed to update cSpell.words:', error)
    }
}

function execFileAsync(
    command: string,
    args: string[],
    options: child_process.ExecFileOptions = {}
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        child_process.execFile(
            command,
            args,
            { maxBuffer: 16 * 1024 * 1024, timeout: 60000, ...options },
            (error, stdout, stderr) => {
                if (error) {
                    reject(error)
                } else {
                    resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
                }
            }
        )
    })
}

// Run the active file with the Camel CLI and stream output to the Camel channel.
function runCamel() {
    const editor = vscode.window.activeTextEditor
    if (!editor || !['cml', 'psl'].includes(editor.document.languageId)) {
        vscode.window.showInformationMessage('Open a CML file first, then run Camel.')
        return
    }
    const filePath = editor.document.uri.fsPath
    const toolchain = detectToolchain(getCamelPath())
    toolchain.warnings.forEach((w) => vscode.window.showWarningMessage(w))

    const channel = getOutputChannel()
    channel.clear()
    channel.appendLine(`> ${toolchain.camel} ${filePath}`)
    channel.show(true)
    const proc = child_process.spawn(toolchain.camel, [filePath], { cwd: path.dirname(filePath) })
    proc.stdout.on('data', (data) => channel.append(data.toString()))
    proc.stderr.on('data', (data) => channel.append(data.toString()))
    proc.on('error', (error) => {
        vscode.window.showErrorMessage(
            `Failed to start Camel: ${error.message}. ${spawnHint()}`
        )
    })
    proc.on('close', (code) => channel.appendLine(`\n[camel exited with code ${code}]`))
}

// Extract a Graphviz DOT graph from camel stdout (the std::rgir family of passes).
function extractDot(stdout: string): string | null {
    const match = /^\s*(?:strict\s+)?(?:di)?graph\b/m.exec(stdout)
    if (!match) {
        return null
    }
    return stdout.slice(match.index).trim()
}

async function computeGirDot(
    filePath: string,
    pass: string
): Promise<{ dot: string | null; output: string }> {
    const toolchain = detectToolchain(getCamelPath())
    toolchain.warnings.forEach((w) => vscode.window.showWarningMessage(w))
    const { stdout, stderr } = await execFileAsync(toolchain.camel, [filePath, pass], {
        cwd: path.dirname(filePath)
    })
    return { dot: extractDot(stdout), output: stderr ? `${stdout}\n${stderr}` : stdout }
}

interface GirPanelState {
    panel: vscode.WebviewPanel
    fileUri: string | null
    pass: string
    autoRefresh: boolean
    /** nodeKey -> GIR node origin (null when the node has none). */
    breakpoints: Map<string, number | null>
    pendingDot: string | null
}

// Renders the GIR webview panel: toolbar (pass picker / auto refresh / refresh),
// node breakpoints (double-click) which later sync to the Camel debugger.
function registerGirPanel(context: vscode.ExtensionContext): GirPanelState {
    const state: GirPanelState = {
        panel: undefined as unknown as vscode.WebviewPanel,
        fileUri: null,
        pass: 'std::rgir',
        autoRefresh: true,
        breakpoints: new Map<string, number | null>(),
        pendingDot: null
    }

    state.panel = vscode.window.createWebviewPanel(
        'camel',
        'GraphIR',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'dist'))]
        }
    )

    state.panel.webview.html = getWebviewContent(context, state.panel)

    state.panel.webview.onDidReceiveMessage(
        (message) => {
            switch (message.command) {
                case 'ready':
                    if (state.pendingDot !== null || state.fileUri) {
                        state.panel.webview.postMessage({
                            command: 'render',
                            dot: state.pendingDot,
                            fileUri: state.fileUri ?? undefined,
                            fileName: state.fileUri ? path.basename(state.fileUri) : undefined,
                            pass: state.pass
                        })
                    }
                    void pushPassGraphs()
                    return
                case 'refresh':
                    if (state.fileUri) {
                        renderForFile(state.fileUri, true)
                    }
                    return
                case 'passChanged':
                    state.pass = message.pass || 'std::rgir'
                    if (state.fileUri) {
                        renderForFile(state.fileUri, true)
                    }
                    return
                case 'autoRefresh':
                    state.autoRefresh = !!message.enabled
                    return
                case 'passGraphsList':
                    void pushPassGraphs(message.target)
                    return
                case 'passGraph':
                    void pushPassGraph(message.index, message.target)
                    return
                case 'nodeBreakpoint': {
                    const key = String(message.nodeKey)
                    const origin = typeof message.origin === 'number' ? message.origin : null
                    if (message.enabled) {
                        state.breakpoints.set(key, origin)
                    } else {
                        state.breakpoints.delete(key)
                    }
                    syncPanelBreakpoints(state)
                    return
                }
                case 'revealSource': {
                    const file = String(message.file ?? '')
                    if (!file) {
                        return
                    }
                    const line = Math.max(0, Number(message.line ?? 0))
                    const column = Math.max(0, Number(message.character ?? 0))
                    const target = path.isAbsolute(file)
                        ? file
                        : state.fileUri
                          ? path.join(path.dirname(state.fileUri), file)
                          : file
                    void vscode.workspace.openTextDocument(target).then(
                        (doc) =>
                            vscode.window.showTextDocument(doc, {
                                selection: new vscode.Range(line, column, line, column),
                                preview: true
                            }),
                        () => vscode.window.showWarningMessage(`Cannot open ${target}`)
                    )
                    return
                }
                case 'alert':
                    vscode.window.showErrorMessage(String(message.text))
                    return
            }
        },
        undefined,
        context.subscriptions
    )

    state.panel.onDidDispose(
        () => {
            girState = null
        },
        null,
        context.subscriptions
    )

    return state
}

let girState: GirPanelState | null = null

/** Push the panel's origin breakpoints into active debug sessions. */
function syncPanelBreakpoints(state: GirPanelState) {
    const origins = [...state.breakpoints.values()].filter((o): o is number => o !== null && o > 0)
    void debugFactory?.syncNodeBreakpoints(origins)
}

interface PassGraphEntry {
    index: number
    pass: string | null
}

/** Port camel-db is expected on (individual debug sessions may override it). */
function getDebugPort(): number {
    return vscode.workspace.getConfiguration('opencmlLanguageServer').get<number>('debugPort') ?? 8765
}

/** Resolve which camel-db task the pass-snapshot queries address (panel-provided target wins). */
function resolvePassGraphTarget(explicit?: unknown): { port: number; target: string } | null {
    const sessionTarget = debugFactory?.currentTarget() ?? null
    if (typeof explicit === 'string' && explicit.trim()) {
        return { port: sessionTarget?.port ?? getDebugPort(), target: explicit.trim() }
    }
    return sessionTarget
}

/** GET /api/pass-graphs; empty list on old camel-db (404) or any transient failure. */
async function fetchPassGraphs(explicit?: unknown): Promise<PassGraphEntry[]> {
    const t = resolvePassGraphTarget(explicit)
    if (!t) {
        return []
    }
    try {
        const data = (await apiGet(
            t.port,
            `/api/pass-graphs?target=${encodeURIComponent(t.target)}`
        )) as { graphs?: { index?: unknown; pass?: unknown }[] }
        if (!Array.isArray(data?.graphs)) {
            return []
        }
        return data.graphs
            .filter((g) => g && Number.isInteger(g.index))
            .map((g) => ({ index: Number(g.index), pass: typeof g.pass === 'string' ? g.pass : null }))
    } catch {
        return []
    }
}

/** Push the per-pass snapshot list to the panel (empty when camel-db has none). */
async function pushPassGraphs(explicit?: unknown): Promise<void> {
    const graphs = await fetchPassGraphs(explicit)
    girState?.panel.webview.postMessage({ command: 'passGraphs', graphs })
}

/** GET /api/pass-graph and push one snapshot's DOT to the panel. */
async function pushPassGraph(index: unknown, explicit?: unknown): Promise<void> {
    const i = Number(index)
    const t = resolvePassGraphTarget(explicit)
    if (!t || !Number.isInteger(i)) {
        girState?.panel.webview.postMessage({ command: 'passGraph', index: i, pass: null, dot: null, error: 'no debug target' })
        return
    }
    try {
        const data = (await apiGet(
            t.port,
            `/api/pass-graph?target=${encodeURIComponent(t.target)}&index=${i}`
        )) as { index?: unknown; pass?: unknown; dot?: unknown }
        girState?.panel.webview.postMessage({
            command: 'passGraph',
            index: Number.isInteger(data?.index) ? Number(data.index) : i,
            pass: typeof data?.pass === 'string' ? data.pass : null,
            dot: typeof data?.dot === 'string' ? data.dot : null
        })
    } catch (error) {
        girState?.panel.webview.postMessage({ command: 'passGraph', index: i, pass: null, dot: null, error: String(error) })
    }
}

async function showGirPanel(context: vscode.ExtensionContext) {
    const editor = vscode.window.activeTextEditor
    if (!editor || editor.document.languageId !== 'cml') {
        vscode.window.showInformationMessage('Open a CML file first, then visualize GraphIR.')
        return
    }
    const filePath = editor.document.uri.fsPath

    if (!girState) {
        girState = registerGirPanel(context)
    }
    girState.fileUri = filePath
    girState.panel.reveal(editor.viewColumn)
    await renderForFile(girState, filePath, true)
}

async function renderForFile(state: GirPanelState, filePath: string, errorToast: boolean) {
    try {
        const { dot } = await computeGirDot(filePath, state.pass)
        state.pendingDot = dot
        state.panel.webview.postMessage({
            command: 'render',
            dot,
            fileUri: state.fileUri ?? undefined,
            fileName: path.basename(filePath),
            pass: state.pass,
            error: dot ? undefined : 'Camel did not produce a GraphIR for this file.'
        })
    } catch (error) {
        if (errorToast) {
            vscode.window.showErrorMessage(`Failed to run Camel: ${error}. ${spawnHint()}`)
        }
    }
}

function getWebviewContent(context: vscode.ExtensionContext, panel: vscode.WebviewPanel) {
    const htmlPath = path.join(context.extensionPath, 'dist', 'panels', 'graphviz', 'index.html')
    let html = fs.readFileSync(htmlPath, 'utf8')

    // Rewrite relative asset URLs (e.g. ../../assets/graphviz/xxx.js) to webview URIs
    const distDir = path.join(context.extensionPath, 'dist')
    html = html.replace(/(src|href)="(\.\.\/[^"]+)"/g, (_match, attr: string, relPath: string) => {
        const absPath = path.join(distDir, relPath)
        const uri = panel.webview.asWebviewUri(vscode.Uri.file(absPath))
        return `${attr}="${uri}"`
    })

    // Allow the bundled scripts and WebAssembly (graphviz renderer) to run in the webview.
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${panel.webview.cspSource} 'wasm-unsafe-eval'; style-src ${panel.webview.cspSource} 'unsafe-inline'; img-src ${panel.webview.cspSource} data:;">`
    html = html.replace('</head>', `    ${csp}\n</head>`)

    return html
}

export function activate(context: vscode.ExtensionContext) {
    addWordToSpellChecker(['opencml', 'opencmlrc', 'typeas'])

    context.subscriptions.push(
        vscode.commands.registerCommand('camel.showPath', () => {
            showCamelPath()
        })
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('camel.run', () => {
            runCamel()
        })
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('camel.vizGIR', async () => {
            await showGirPanel(context)
        })
    )

    // Auto-refresh the GIR panel when its tracked file is saved.
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (!girState || !girState.autoRefresh) {
                return
            }
            if (girState.fileUri && document.uri.fsPath === girState.fileUri) {
                renderForFile(girState, document.uri.fsPath, false)
            }
        })
    )

    // Debugging: bridge VSCode's DAP to the camel-db HTTP API.
    debugFactory = new CamelDebugAdapterFactory(context)
    debugFactory.onDidChangePausedNode = (origin) => {
        girState?.panel.webview.postMessage({ command: 'pausedOrigin', origin })
    }
    debugFactory.onDidRefreshGirIndex = () => {
        void pushPassGraphs()
    }
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory('camel', debugFactory)
    )
    context.subscriptions.push(
        vscode.debug.onDidTerminateDebugSession((session) => {
            debugFactory?.disposeSession(session)
        })
    )
    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('camel', {
            resolveDebugConfiguration(folder, config) {
                if (!config.program) {
                    const editor = vscode.window.activeTextEditor
                    if (editor?.document.languageId === 'cml') {
                        config.program = editor.document.uri.fsPath
                    }
                }
                if (config.debugPort === undefined) {
                    const settings = vscode.workspace.getConfiguration('opencmlLanguageServer', folder?.uri)
                    config.debugPort = settings.get<number>('debugPort') ?? 8765
                }
                if (!config.camelDbPath) {
                    const settings = vscode.workspace.getConfiguration('opencmlLanguageServer', folder?.uri)
                    const configured = settings.get<string>('camelDbPath')?.trim()
                    if (configured) {
                        config.camelDbPath = configured
                    } else {
                        config.camelDbPath = detectToolchain(getCamelPath()).camelDb ?? undefined
                    }
                }
                return config
            }
        })
    )

    // LSP related code
    //
    // Preferred: the standardized Camel language server (camel-ls), spawned directly.
    // Fallback: the bundled Node language server, which shells out to the Camel CLI
    // (used when camel-ls is not locatable next to the configured camel executable).

    const toolchain = detectToolchain(getCamelPath())
    toolchain.warnings.forEach((w) => vscode.window.showWarningMessage(w))

    let serverOptions: ServerOptions
    if (toolchain.camelLs) {
        serverOptions = {
            run: { command: toolchain.camelLs, args: ['--stdio'], transport: TransportKind.stdio },
            debug: {
                command: toolchain.camelLs,
                args: ['--stdio'],
                transport: TransportKind.stdio
            }
        }
    } else {
        const serverModule = context.asAbsolutePath(path.join('dist', 'server', 'server.cjs'))
        serverOptions = {
            run: { module: serverModule, transport: TransportKind.ipc },
            debug: {
                module: serverModule,
                transport: TransportKind.ipc
            }
        }
    }

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for plain text documents
        documentSelector: [
            { scheme: 'file', language: 'cml' },
            { scheme: 'file', language: 'psl' }
        ],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/.opencmlrc')
        }
    }

    // Create the language client and start the client.
    client = new LanguageClient(
        'opencmlLanguageServer',
        'OpenCML Language Server',
        serverOptions,
        clientOptions
    )

    // Start the client. This will also launch the server
    client.start()
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined
    }
    return client.stop()
}
