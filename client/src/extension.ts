import { t, setLocale } from './localization'
import * as path from 'path'
import * as fs from 'fs'
import * as child_process from 'child_process'
import { randomUUID } from 'crypto'
import * as vscode from 'vscode'
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
    State,
    vsdiag,
    InlayHintRequest
} from 'vscode-languageclient/node'
import { detectToolchain, spawnHint } from './toolchain'
import { presentDiagnostics, registerDiagnosticAdvice } from './diagnosticAdvice'
import { RuntimeStatus, inspectRuntime } from './runtimeStatus'
import { CamelDebugAdapterFactory } from './debug/adapter'
import { MemoryInspector } from './debug/memory'
import { launchPipeline } from './debug/pipeline'
import { literalThemeColors } from './syntaxColors'
import { mapGirSources } from './girSource'
import { inspectCompatibility, languageFeatures } from './compatibility'

let client: LanguageClient | undefined
setLocale(vscode.env.language)
let languageServerQueue: Promise<void> = Promise.resolve()
let deactivating = false
let outputChannel: vscode.OutputChannel | undefined
let debugFactory: CamelDebugAdapterFactory | undefined
let runtimeStatus: RuntimeStatus
let diagnosticCloseListener: vscode.Disposable | undefined
let sourceWatcher: vscode.FileSystemWatcher | undefined
let serverStateListener: vscode.Disposable | undefined
let runInProgress = false

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

function execFileAsync(
    command: string,
    args: string[],
    options: child_process.ExecFileOptions = {}
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        child_process.execFile(
            command,
            args,
            { maxBuffer: 16 * 1024 * 1024, timeout: vscode.workspace.getConfiguration('opencmlLanguageServer').get<number>('runtime.checkTimeoutMs', 60000), ...options },
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
async function runCamel(program?: string, passes: string[] = []): Promise<number | undefined> {
    if (runInProgress) {
        getOutputChannel().show(true)
        return
    }
    const editor = vscode.window.activeTextEditor
    if (!program && (!editor || editor.document.languageId !== 'cml')) {
        vscode.window.showInformationMessage(t("Open a CML file first, then run Camel."))
        return
    }
    if (!program && editor!.document.uri.scheme !== 'file') {
        void vscode.window.showInformationMessage(t("Save the file as .cml before running Camel."))
        await vscode.commands.executeCommand('workbench.action.files.save')
        return
    }
    const document = program ? await vscode.workspace.openTextDocument(vscode.Uri.file(program)) : editor!.document
    const folder = vscode.workspace.getWorkspaceFolder(document.uri)
    const filePath = document.uri.fsPath
    const channel = getOutputChannel()
    runInProgress = true
    try {
        // Save the current source and other open Camel buffers in its workspace:
        // imported modules must not silently run an older on-disk version.
        const dirty = vscode.workspace.textDocuments.filter(doc => doc.isDirty && doc.uri.scheme === 'file' &&
            doc.languageId === 'cml' && (doc === document || (folder &&
                vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.toString() === folder.uri.toString())))
        for (const doc of dirty) {
            if (!await doc.save() || doc.isDirty) {
                void vscode.window.showErrorMessage(t("Could not save {0}. Run cancelled.", doc.uri.fsPath))
                return
            }
        }
        if (dirty.some(doc => doc.isDirty)) {
            void vscode.window.showWarningMessage(t("Source changed while saving. Please run again."))
            return
        }
        const toolchain = detectToolchain(getCamelPath())
        channel.clear()
        if (dirty.length) channel.appendLine(t("Saved {0} Camel files: {1}", dirty.length, dirty.map(doc => path.basename(doc.uri.fsPath)).join(', ')))
        channel.appendLine(`> ${toolchain.camel} ${filePath}${passes.length ? ' ' + passes.join(' ') : ''}`)
        channel.show(true)
        return await new Promise<number | undefined>(resolve => {
            const proc = child_process.spawn(toolchain.camel, [filePath, ...passes], { cwd: path.dirname(filePath), windowsHide: true })
            proc.stdout.on('data', data => channel.append(data.toString()))
            proc.stderr.on('data', data => channel.append(data.toString()))
            proc.on('error', error => {
                channel.appendLine(t("Failed to start Camel: {0}", error.message))
                void vscode.window.showErrorMessage(t("Failed to start Camel: {0}. {1}", error.message, spawnHint()))
                resolve(undefined)
            })
            proc.on('close', code => {
                channel.appendLine(t("\n[camel exited with code {0}]", code))
                resolve(code ?? undefined)
            })
        })
    } catch (error) {
        channel.appendLine(t("Camel run cancelled: {0}", error))
        void vscode.window.showErrorMessage(t("Run cancelled: {0}", error))
        return
    } finally {
        runInProgress = false
    }
}

// Extract a Graphviz DOT graph from camel stdout (the DOT GIR passes).
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
    const uri = vscode.Uri.file(filePath)
    const doc = await vscode.workspace.openTextDocument(uri)
    await languageServerQueue
    if (pass === 'std::jgir' && runtimeStatus.snapshot.compatibility?.features.structuredGir?.supported === false) throw new Error(t('Structured GIR requires a runtime with std::jgir support.'))
    if (pass === 'std::gir' && client?.initializeResult?.capabilities.experimental?.camelGraphProvider) {
        const result = await client.sendRequest<{ text: string; diagnostics?: string }>('camel/graph', {
            textDocument: { uri: uri.toString() }
        })
        return { dot: mapGirSources(extractDot(result.text), filePath), output: result.diagnostics || '' }
    }
    const toolchain = detectToolchain(getCamelPath())
    // CLI styles and older servers also use the editor buffer, keeping relative imports intact.
    if (runtimeStatus.snapshot.compatibility?.features.cliGir?.supported === false) {
        throw new Error(t('CLI GIR is unavailable: {0}', runtimeStatus.snapshot.compatibility.features.cliGir.reason))
    }
    const scratch = path.join(path.dirname(filePath), `.camel-gir-${randomUUID()}.cml`)
    try {
        await fs.promises.writeFile(scratch, doc.getText())
        const { stdout, stderr } = await execFileAsync(toolchain.camel, ['--color', 'never', scratch, pass], {
            cwd: path.dirname(filePath), windowsHide: true
        })
        if (pass === 'std::jgir') {
            const data = JSON.parse(stdout)
            if (data.format !== 'camel.gir' || data.version !== 1 || !Array.isArray(data.graphs)) throw new Error('Unsupported GIR JSON format')
            return { dot: mapGirSources(stdout, filePath, scratch), output: stderr || '' }
        }
        const output = stdout.split(scratch).join(filePath)
        return { dot: mapGirSources(extractDot(output), filePath, scratch), output: stderr ? `${output}\n${stderr}` : output }
    } catch (error) {
        const failure = error as Error & { stdout?: string; stderr?: string }
        throw new Error([failure.message, failure.stdout, failure.stderr].filter(Boolean).join('\n').split(scratch).join(filePath))
    } finally {
        await fs.promises.unlink(scratch).catch(() => {})
    }
}

interface GirPanelState {
    panel: vscode.WebviewPanel
    fileUri: string | null
    pass: string
    autoRefresh: boolean
    followSource: boolean
    /** nodeKey -> GIR node origin (null when the node has none). */
    breakpoints: Map<string, number | null>
    pendingDot: string | null
    pendingError?: string
    revision: number
    disposed: boolean
    debugSessionId?: string
    debugView?: Record<string, unknown>
}

// Renders the GIR webview panel: toolbar (pass picker / auto refresh / refresh),
// node breakpoints (double-click) which later sync to the Camel debugger.
function registerGirPanel(context: vscode.ExtensionContext): GirPanelState {
    const state: GirPanelState = {
        panel: undefined as unknown as vscode.WebviewPanel,
        fileUri: null,
        pass: 'std::jgir',
        autoRefresh: context.workspaceState.get<boolean>('gir.autoRefresh', vscode.workspace.getConfiguration('opencmlLanguageServer').get('gir.refreshOn', 'onSave') === 'onSave'),
        followSource: context.workspaceState.get<boolean>('gir.followSource', vscode.workspace.getConfiguration('opencmlLanguageServer').get('gir.followActiveEditor', true)),
        breakpoints: new Map<string, number | null>(),
        pendingDot: null,
        revision: 0,
        disposed: false
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
                    state.panel.webview.postMessage({ command: 'literalColors', colors: literalThemeColors() })
                    sendGirPreferences(context, state)
                    if (state.debugView) state.panel.webview.postMessage(state.debugView)
                    state.panel.webview.postMessage({ command: 'followSource', enabled: state.followSource })
                    if (state.pendingDot !== null || state.fileUri) {
                        state.panel.webview.postMessage({
                            command: 'render',
                            dot: state.pendingDot,
                            error: state.pendingError,
                            fileUri: state.fileUri ?? undefined,
                            fileName: state.fileUri ? path.basename(state.fileUri) : undefined,
                            pass: state.pass
                        })
                    }
                    void pushPassGraphs()
                    return
                case 'copyGir':
                    if (typeof message.text === 'string') {
                        void vscode.env.clipboard.writeText(message.text).then(() => state.panel.webview.postMessage({ command: 'girCopied' }))
                    }
                    return
                case 'openGirText':
                    if (typeof message.text === 'string') {
                        void vscode.workspace.openTextDocument({ content: message.text, language: message.text.trimStart().startsWith('{') ? 'json' : 'plaintext' })
                            .then(doc => vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside))
                    }
                    return
                case 'debugMemory':
                    void vscode.commands.executeCommand('camel.showMemory')
                    return
                case 'debugNextPass':
                    void debugFactory?.currentSession()?.customRequest('camel/nextPass').then(undefined, error => vscode.window.showErrorMessage(String(error)))
                    return
                case 'debugContinue':
                    void debugFactory?.currentSession()?.customRequest('continue', { threadId: 1 }).then(undefined, error => vscode.window.showErrorMessage(String(error)))
                    return
                case 'debugCurrentGraph':
                    void renderDebugSession(context, state)
                    return
                case 'debugSource':
                    state.debugSessionId = undefined
                    state.debugView = undefined
                    state.panel.webview.postMessage({ command: 'debugState', state: null })
                    if (state.fileUri) void renderForFile(state, state.fileUri, true)
                    return
                case 'refresh':
                    if (state.debugSessionId) { void renderDebugSession(context, state); return }
                    if (state.fileUri) {
                        renderForFile(state, state.fileUri, true)
                    }
                    return
                case 'passChanged':
                    state.pass = ['std::jgir', 'std::rgir', 'std::agir', 'std::gir'].includes(message.pass) ? message.pass : 'std::jgir'
                    if (state.fileUri) {
                        renderForFile(state, state.fileUri, true)
                    }
                    return
                case 'followSource':
                    state.followSource = !!message.enabled
                    void context.workspaceState.update('gir.followSource', state.followSource)
                    state.panel.webview.postMessage({ command: 'followSource', enabled: state.followSource })
                    if (state.followSource) followActiveSource(vscode.window.activeTextEditor ?? lastCamelEditor)
                    return
                case 'autoRefresh':
                    state.autoRefresh = !!message.enabled
                    void context.workspaceState.update('gir.autoRefresh', state.autoRefresh)
                    return
                case 'browsingChanged':
                    if (['flat', 'hierarchy'].includes(message.value)) void context.workspaceState.update('gir.browsing', message.value)
                    return
                case 'passGraphsList':
                    void pushPassGraphs()
                    return
                case 'passGraph':
                    void pushPassGraph(message.index)
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
                    const line = Number(message.line)
                    const column = Number(message.character)
                    if (!Number.isInteger(line) || line < 0 || !Number.isInteger(column) || column < 0) return
                    const target = path.isAbsolute(file)
                        ? file
                        : state.fileUri
                          ? path.join(path.dirname(state.fileUri), file)
                          : file
                    sourceRevealDepth++
                    void vscode.workspace.openTextDocument(target).then(
                        (doc) =>
                            vscode.window.showTextDocument(doc, {
                                selection: new vscode.Range(line, column, line, column),
                                viewColumn: vscode.window.visibleTextEditors.find(editor => editor.document.uri.fsPath === target)?.viewColumn ?? vscode.ViewColumn.One,
                                preview: true
                            }),
                        () => vscode.window.showWarningMessage(t("Cannot open {0}", target))
                    ).then(() => { sourceRevealDepth-- }, () => { sourceRevealDepth-- })
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
            state.disposed = true
            if (girState === state) girState = null
        },
        null,
        context.subscriptions
    )

    return state
}

function sendGirPreferences(context: vscode.ExtensionContext, state: GirPanelState) {
    const config = vscode.workspace.getConfiguration('opencmlLanguageServer')
    void state.panel.webview.postMessage({ command: 'preferences',
        autoRefresh: state.autoRefresh, followSource: state.followSource,
        browsing: context.workspaceState.get('gir.browsing', config.get('gir.defaultView', 'hierarchy')),
        edgeLabels: config.get('gir.edgeLabels', 'onHover'),
        hoverNeighborhood: config.get('gir.hoverNeighborhood', 'both'),
        rememberViewport: config.get('gir.rememberViewport', true)
    })
}

let girState: GirPanelState | null = null
let sourceRevealDepth = 0
let lastCamelEditor: vscode.TextEditor | undefined
function followActiveSource(editor: vscode.TextEditor | undefined) {
    if (!editor || editor.document.languageId !== 'cml' || editor.document.uri.scheme !== 'file') return
    lastCamelEditor = editor
    if (girState?.debugSessionId || sourceRevealDepth || !girState?.followSource || girState.fileUri === editor.document.uri.fsPath) return
    girState.fileUri = editor.document.uri.fsPath
    void renderForFile(girState, girState.fileUri, false)
}

/** Push the panel's origin breakpoints into active debug sessions. */
function syncPanelBreakpoints(state: GirPanelState) {
    const origins = [...state.breakpoints.values()].filter((o): o is number => o !== null && o > 0)
    void debugFactory?.syncNodeBreakpoints(origins)
}

interface PassGraphEntry {
    index: number
    pass: string | null
}

/** Snapshot requests belong to the selected VS Code session, never the first worker. */
let passGraphError: string | undefined
async function fetchPassGraphs(): Promise<PassGraphEntry[]> {
    passGraphError = undefined
    const session = debugFactory?.currentSession()
    if (!session) return []
    try {
        const data = await session.customRequest('camel/passGraphs')
        return Array.isArray(data?.graphs) ? data.graphs : []
    } catch (error) { passGraphError = String(error); return [] }
}

/** Push the per-pass snapshot list to the panel (empty when camel-db has none). */
let snapshotListRevision = 0
async function pushPassGraphs(): Promise<void> {
    const revision = ++snapshotListRevision
    const sessionId = debugFactory?.currentSession()?.id
    const graphs = await fetchPassGraphs()
    if (revision !== snapshotListRevision || sessionId !== debugFactory?.currentSession()?.id) return
    girState?.panel.webview.postMessage({ command: 'passGraphs', graphs, error: passGraphError })
}

/** Read an immutable structured snapshot from the selected native DAP session. */
async function pushPassGraph(index: unknown): Promise<void> {
    const i = Number(index)
    const session = debugFactory?.currentSession()
    if (!session || !Number.isInteger(i)) {
        girState?.panel.webview.postMessage({ command: 'passGraph', index: i, pass: null, dot: null, error: t("no debug target") })
        return
    }
    try {
        const data = await session.customRequest('camel/passGraph', { index: i })
        if (session.id !== debugFactory?.currentSession()?.id) return
        girState?.panel.webview.postMessage({ command: 'passGraph', ...data, dot: data.gir })
    } catch (error) {
        girState?.panel.webview.postMessage({ command: 'passGraph', index: i, pass: null, dot: null, error: String(error) })
    }
}

async function showGirPanel(context: vscode.ExtensionContext) {
    const editor = vscode.window.activeTextEditor ?? lastCamelEditor
    if (!editor || editor.document.languageId !== 'cml' || editor.document.uri.scheme !== 'file') {
        vscode.window.showInformationMessage(t("Open a saved CML file first, then visualize GraphIR."))
        return
    }
    const filePath = editor.document.uri.fsPath

    if (!girState) {
        girState = registerGirPanel(context)
    }
    girState.fileUri = filePath
    girState.panel.reveal(vscode.ViewColumn.Beside, true)
    await renderForFile(girState, filePath, true)
}

async function renderForFile(state: GirPanelState, filePath: string, errorToast: boolean) {
    if (state.debugSessionId) return
    const revision = ++state.revision
    const pass = state.pass
    state.pendingDot = null
    state.pendingError = undefined
    state.panel.title = `GIR · ${path.basename(filePath)}`
    state.panel.webview.postMessage({ command: 'loading', fileUri: filePath, fileName: path.basename(filePath), pass })
    try {
        const { dot, output } = await computeGirDot(filePath, pass)
        if (state.disposed || revision !== state.revision) return
        state.pendingDot = dot
        state.pendingError = dot ? undefined : output || t("Camel did not produce GIR. Check the source diagnostics.")
        state.panel.webview.postMessage({
            command: 'render', dot, fileUri: filePath, fileName: path.basename(filePath),
            pass, error: state.pendingError
        })
    } catch (error) {
        if (state.disposed || revision !== state.revision) return
        state.pendingError = String(error)
        state.panel.webview.postMessage({ command: 'render', dot: null, fileUri: filePath, fileName: path.basename(filePath), pass, error: state.pendingError })
        if (errorToast) getOutputChannel().appendLine(`GIR generation failed: ${error}`)
    }
}

/** The graph comes from the stopped worker, never a fresh CLI compilation. */
async function renderDebugSession(context: vscode.ExtensionContext, state?: GirPanelState, reveal = true) {
    const session = debugFactory?.currentSession()
    if (!session) return
    state ??= girState ?? (girState = registerGirPanel(context))
    const revision = ++state.revision
    state.debugSessionId = session.id
    state.pendingDot = null
    state.pendingError = undefined
    if (reveal) state.panel.reveal(vscode.ViewColumn.Beside, true)
    state.panel.webview.postMessage({ command: 'loading', fileName: session.name, pass: 'std::jgir' })
    try {
        const result = await session.customRequest('camel/structuredGraph')
        if (state.disposed || revision !== state.revision || session.id !== debugFactory?.currentSession()?.id) return
        state.pendingDot = result.gir
        state.pendingError = undefined
        state.fileUri = session.configuration.program ?? state.fileUri
        state.panel.title = `GIR · ${session.name}`
        state.panel.webview.postMessage({ command: 'render', dot: result.gir, fileName: session.name, pass: 'std::jgir' })
        void pushPassGraphs()
    } catch (error) {
        if (revision !== state.revision || state.disposed) return
        state.pendingError = String(error)
        state.panel.webview.postMessage({ command: 'render', dot: null, error: String(error), fileName: session.name })
    }
}

function getWebviewContent(context: vscode.ExtensionContext, panel: vscode.WebviewPanel, panelName = 'graphviz') {
    const htmlPath = path.join(context.extensionPath, 'dist', 'panels', panelName, 'index.html')
    let html = fs.readFileSync(htmlPath, 'utf8')
    html = html.replace(/<html[^>]*>/, `<html lang="${vscode.env.language.replace(/[^a-zA-Z0-9-]/g, '') || 'en'}">`)

    // Rewrite relative asset URLs (e.g. ../../assets/graphviz/xxx.js) to webview URIs
    const htmlDir = path.dirname(htmlPath)
    html = html.replace(/(src|href)="(\.\.\/[^"]+)"/g, (_match, attr: string, relPath: string) => {
        const absPath = path.resolve(htmlDir, relPath)
        const uri = panel.webview.asWebviewUri(vscode.Uri.file(absPath))
        return `${attr}="${uri}"`
    })

    // Allow the bundled scripts and WebAssembly (graphviz renderer) to run in the webview.
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${panel.webview.cspSource} 'wasm-unsafe-eval'; style-src ${panel.webview.cspSource} 'unsafe-inline'; img-src ${panel.webview.cspSource} data:;">`
    html = html.replace('</head>', `    ${csp}\n</head>`)

    return html
}

export function activate(context: vscode.ExtensionContext) {
    runtimeStatus = new RuntimeStatus()
    context.subscriptions.push(runtimeStatus)
    registerDiagnosticAdvice(context)
    context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(() => {
        girState?.panel.webview.postMessage({ command: 'literalColors', colors: literalThemeColors() })
    }))
    context.subscriptions.push(
        vscode.commands.registerCommand('camel.runPipeline', () => launchPipeline(context, false, runCamel)),
        vscode.commands.registerCommand('camel.inspectPipeline', () => launchPipeline(context, true))
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('camel.showPath', () => {
            return vscode.commands.executeCommand('camel.showRuntimeInfo')
        })
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('camel.run', () => {
            return runCamel()
        })
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('camel.vizGIR', async () => {
            await showGirPanel(context)
        })
    )

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(followActiveSource))
    followActiveSource(vscode.window.activeTextEditor)

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

    // Use Camel's native DAP; observe its events only to synchronize the graph view.
    debugFactory = new CamelDebugAdapterFactory(context)
    const memoryInspector = new MemoryInspector(context, debugFactory, panel => getWebviewContent(context, panel, 'memory'))
    debugFactory.onDidChangePausedNode = (session, origin) => {
        if (session.id !== debugFactory?.currentSession()?.id) return
        girState?.panel.webview.postMessage({ command: 'pausedOrigin', origin })
    }
    debugFactory.onDidRefreshGirIndex = (session) => {
        if (session.id !== debugFactory?.currentSession()?.id) return
        void pushPassGraphs()
    }
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory('camel', debugFactory)
    )
    debugFactory.onDidChangeState = (session, state) => {
        memoryInspector.update(session, state)
        if (session.id !== debugFactory?.currentSession()?.id && session.id !== girState?.debugSessionId) return
        if (state.status !== 'paused' && girState?.debugSessionId === session.id) ++girState.revision
        if (girState) {
            girState.debugView = { command: 'debugState', sessionId: session.id, name: session.name, state }
            if (state.status !== 'paused') girState.panel.webview.postMessage(girState.debugView)
        }
    }
    debugFactory.onDidStop = (session, stopped) => {
        if (session.id !== debugFactory?.currentSession()?.id) return
        void renderDebugSession(context, undefined, !memoryInspector.active).then(() => {
            if (session.id === debugFactory?.currentSession()?.id && girState) {
                girState.debugView = { command: 'debugState', sessionId: session.id, name: session.name, state: stopped }
                girState.panel.webview.postMessage(girState.debugView)
            }
        })
    }
    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('camel', {
            resolveDebugConfiguration(folder, config) {
                if (!config.program) {
                    const editor = vscode.window.activeTextEditor
                    if (editor?.document.languageId === 'cml') {
                        config.program = editor.document.uri.fsPath
                    }
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

    context.subscriptions.push(
        vscode.commands.registerCommand('camel.showRuntimeInfo', async () => {
            await languageServerQueue
            const report = await inspectRuntime(runtimeStatus.snapshot)
            runtimeStatus.set({ ...runtimeStatus.snapshot, compatibility: report.compatibility })
            const channel = getOutputChannel()
            channel.appendLine(`\nCamel Runtime Check\n${JSON.stringify(report, null, 2)}`)
            channel.show(true)
            return report
        }),
        vscode.commands.registerCommand('camel.runtimeMenu', async () => {
            const choice = await vscode.window.showQuickPick([
                { label: t("$(info) Runtime details and health check"), command: 'camel.showRuntimeInfo' },
                { label: t("$(refresh) Restart language server"), command: 'camel.restartServer' },
                { label: t("$(settings-gear) Configure Camel path"), command: 'workbench.action.openSettings' }
            ], { title: t("Camel Runtime"), placeHolder: runtimeStatus.snapshot.toolchain?.camel })
            if (choice) await vscode.commands.executeCommand(choice.command, ...(choice.command === 'workbench.action.openSettings' ? ['opencmlLanguageServer'] : []))
        }),
        vscode.commands.registerCommand('camel.restartServer', () => restartLanguageServer(context)),
        vscode.commands.registerCommand('camel.format', () => vscode.commands.executeCommand('editor.action.formatDocument')),
        vscode.workspace.onDidChangeConfiguration(async event => {
            if (event.affectsConfiguration('editor.tokenColorCustomizations')) {
                girState?.panel.webview.postMessage({ command: 'literalColors', colors: literalThemeColors() })
            }
            const config = vscode.workspace.getConfiguration('opencmlLanguageServer')
            if (event.affectsConfiguration('opencmlLanguageServer.inlayHints') && client?.isRunning()) {
                const feature = client.getFeature(InlayHintRequest.method)
                for (const editor of vscode.window.visibleTextEditors) {
                    if (editor.document.languageId === 'cml') feature.getProvider(editor.document)?.onDidChangeInlayHints.fire()
                }
            }
            if (event.affectsConfiguration('opencmlLanguageServer.gir')) {
                if (event.affectsConfiguration('opencmlLanguageServer.gir.followActiveEditor')) {
                    await context.workspaceState.update('gir.followSource', undefined)
                    if (girState) girState.followSource = config.get('gir.followActiveEditor', true)
                }
                if (event.affectsConfiguration('opencmlLanguageServer.gir.refreshOn')) {
                    await context.workspaceState.update('gir.autoRefresh', undefined)
                    if (girState) girState.autoRefresh = config.get('gir.refreshOn', 'onSave') === 'onSave'
                }
                if (event.affectsConfiguration('opencmlLanguageServer.gir.defaultView')) await context.workspaceState.update('gir.browsing', undefined)
                if (girState) { sendGirPreferences(context, girState); followActiveSource(vscode.window.activeTextEditor ?? lastCamelEditor) }
            }
            if (['camelPath', 'camelLsPath', 'diagnostics', 'maxNumberOfProblems'].some(key =>
                event.affectsConfiguration(`opencmlLanguageServer.${key}`))) {
                void restartLanguageServer(context)
            }
        })
    )
    void restartLanguageServer(context)
}

// Serialize restarts: a settings change during startup must never leave two servers running.
function restartLanguageServer(context: vscode.ExtensionContext): Promise<void> {
    languageServerQueue = languageServerQueue.then(async () => {
        const previous = client
        client = undefined
        serverStateListener?.dispose()
        sourceWatcher?.dispose()
        diagnosticCloseListener?.dispose()
        runtimeStatus.set({ ...runtimeStatus.snapshot, phase: 'starting', error: undefined })
        if (previous) await previous.dispose()
        if (deactivating) return

        const config = vscode.workspace.getConfiguration('opencmlLanguageServer')
        const explicitServer = config.get<string>('camelLsPath') || ''
        const toolchain = detectToolchain(getCamelPath(), explicitServer)
        toolchain.warnings.forEach(w => void vscode.window.showWarningMessage(w))
        runtimeStatus.set({ phase: 'starting', toolchain })
        const compatibility = await inspectCompatibility(toolchain.camel)
        if (deactivating) return
        runtimeStatus.set({ phase: 'starting', toolchain, compatibility })
        for (const warning of compatibility.warnings) getOutputChannel().appendLine(warning)
        if (compatibility.warnings.length) void vscode.window.showWarningMessage(compatibility.warnings.join('\n'))
        if (explicitServer.trim() && !toolchain.camelLs) {
            runtimeStatus.set({ phase: 'failed', toolchain, error: toolchain.warnings.join('\n') })
            return
        }

        const serverModule = context.asAbsolutePath(path.join('dist', 'server', 'server.cjs'))
        const serverOptions: ServerOptions = toolchain.camelLs
            ? { command: toolchain.camelLs, args: ['--stdio'] }
            : { module: serverModule, transport: TransportKind.ipc }
        if (!toolchain.camelLs) {
            getOutputChannel().appendLine(t("camel-ls was not found. Using CLI diagnostics and formatting only. Install camel-ls for completion, navigation, rename and semantic highlighting."))
        } else {
            getOutputChannel().appendLine(`Starting ${toolchain.camelLs} --stdio`)
        }
        sourceWatcher = vscode.workspace.createFileSystemWatcher('**/*.cml')
        const savedReports = new Map<string, vsdiag.DocumentDiagnosticReport>()
        diagnosticCloseListener = vscode.workspace.onDidCloseTextDocument(doc => savedReports.delete(doc.uri.toString()))
        const clientOptions: LanguageClientOptions = {
            diagnosticPullOptions: { onChange: vscode.workspace.getConfiguration('opencmlLanguageServer').get('diagnostics.trigger', 'onChange') === 'onChange', onSave: true },
            initializationOptions: {
                diagnostics: 'pull',
                debounceMs: vscode.workspace.getConfiguration('opencmlLanguageServer').get('diagnostics.debounceMs', 300),
                cliDiagnostics: compatibility.features.cliDiagnostics?.supported !== false,
                cliFormatting: !!toolchain.camelFormat
            },
            documentSelector: [
                { scheme: 'file', language: 'cml' },
                ...(toolchain.camelLs ? [{ scheme: 'untitled', language: 'cml' }] : [])
            ],
            synchronize: { configurationSection: 'opencmlLanguageServer', fileEvents: sourceWatcher },
            middleware: {
                provideInlayHints: async (document, range, token, next) => {
                    const hints = await next(document, range, token)
                    const settings = vscode.workspace.getConfiguration('opencmlLanguageServer', document.uri)
                    return hints?.filter(hint => hint.kind === vscode.InlayHintKind.Type ? settings.get('inlayHints.types', true) : settings.get('inlayHints.parameterNames', true))
                },
                provideCodeActions: async (document, range, context, token, next) => {
                    const actions = await next(document, range, context, token)
                    for (const action of actions ?? []) {
                        const match = /^Replace with '([^']+)'$/.exec(action.title)
                        if (match) action.title = t("Replace with '{0}'", match[1])
                    }
                    return actions
                },
                handleDiagnostics: (uri, diagnostics, next) => next(uri, presentDiagnostics(diagnostics, uri)),
                provideDiagnostics: async (document, previousResultId, token, next) => {
                    const uri = document instanceof vscode.Uri ? document : document.uri
                    const buffer = document instanceof vscode.Uri ? vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString()) : document
                    if (buffer?.isDirty && vscode.workspace.getConfiguration('opencmlLanguageServer').get('diagnostics.trigger') === 'onSave') {
                        return savedReports.get(uri.toString()) ?? { kind: vsdiag.DocumentDiagnosticReportKind.full, items: [] }
                    }
                    // Delay pull requests without delaying didChange or semantic requests.
                    const delay = vscode.workspace.getConfiguration('opencmlLanguageServer').get('diagnostics.debounceMs', 300)
                    if (buffer?.isDirty && delay > 0) await new Promise<void>(resolve => {
                        const timer = setTimeout(() => { subscription.dispose(); resolve() }, delay)
                        const subscription = token.onCancellationRequested(() => { clearTimeout(timer); subscription.dispose(); resolve() })
                    })
                    if (token.isCancellationRequested) return undefined
                    const report = await next(document, previousResultId, token)
                    if (!report) return report
                    if (report.kind === 'full') report.items = presentDiagnostics(report.items, uri)
                    for (const [uri, related] of Object.entries(report.relatedDocuments || {})) {
                        if (related.kind === 'full') related.items = presentDiagnostics(related.items, vscode.Uri.parse(uri))
                    }
                    if (report.kind === 'full') savedReports.set(uri.toString(), report)
                    return report
                }
            }
        }
        const started = new LanguageClient(
            'opencmlLanguageServer', t("Camel Language Server"), serverOptions, clientOptions
        )
        client = started
        serverStateListener = started.onDidChangeState(event => {
            if (client !== started) return
            runtimeStatus.set({
                toolchain,
                compatibility,
                capabilities: started.initializeResult?.capabilities,
                phase: event.newState === State.Running ? (toolchain.camelLs ? 'native' : 'fallback') : event.newState === State.Starting ? 'starting' : 'stopped',
                serverVersion: started.initializeResult?.serverInfo?.version
            })
        })
        try {
            await started.start()
            compatibility.features = { ...compatibility.features, ...languageFeatures(started.initializeResult?.capabilities) }
            const missing = Object.entries(compatibility.features).filter(([, feature]) => feature.supported === false).map(([name]) => name)
            if (missing.length) {
                const warning = t('Unavailable runtime features: {0}. See Runtime Info and Health Check for details.', missing.join(', '))
                compatibility.warnings.push(warning)
                getOutputChannel().appendLine(warning)
                void vscode.window.showWarningMessage(warning)
            }
            runtimeStatus.set({ ...runtimeStatus.snapshot, compatibility, capabilities: started.initializeResult?.capabilities })
        } catch (error) {
            if (client === started) client = undefined
            await started.dispose()
            throw error
        }
    }).catch(error => {
        runtimeStatus.set({ ...runtimeStatus.snapshot, phase: 'failed', error: String(error) })
        getOutputChannel().appendLine(`Language server error: ${error}`)
        void vscode.window.showErrorMessage(t("Camel language server failed: {0}. {1}", error, spawnHint()))
    })
    return languageServerQueue
}

export async function deactivate(): Promise<void> {
    deactivating = true
    serverStateListener?.dispose()
    sourceWatcher?.dispose()
    diagnosticCloseListener?.dispose()
    await languageServerQueue
    const running = client
    client = undefined
    await running?.dispose()
    outputChannel?.dispose()
}
