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

let client: LanguageClient
let outputChannel: vscode.OutputChannel | undefined
let pendingDot: string | null = null

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

// Extract a Graphviz DOT graph from camel stdout (the std::rgir pass).
function extractDot(stdout: string): string | null {
    const match = /^\s*(?:strict\s+)?(?:di)?graph\b/m.exec(stdout)
    if (!match) {
        return null
    }
    return stdout.slice(match.index).trim()
}

async function computeGirDot(filePath: string): Promise<{ dot: string | null; output: string }> {
    const toolchain = detectToolchain(getCamelPath())
    toolchain.warnings.forEach((w) => vscode.window.showWarningMessage(w))
    const { stdout, stderr } = await execFileAsync(toolchain.camel, [filePath, 'std::rgir'], {
        cwd: path.dirname(filePath)
    })
    return { dot: extractDot(stdout), output: stderr ? `${stdout}\n${stderr}` : stdout }
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
    let currPanel: vscode.WebviewPanel | undefined = undefined

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
            const editor = vscode.window.activeTextEditor
            if (!editor || editor.document.languageId !== 'cml') {
                vscode.window.showInformationMessage('Open a CML file first, then visualize GraphIR.')
                return
            }
            const filePath = editor.document.uri.fsPath

            let dot: string | null = null
            try {
                const result = await computeGirDot(filePath)
                dot = result.dot
                if (!dot) {
                    vscode.window.showWarningMessage(
                        `Camel did not produce a GraphIR. Output:\n${result.output.trim().slice(0, 2000)}`
                    )
                    return
                }
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to run Camel: ${error}. ${spawnHint()}`
                )
                return
            }

            pendingDot = dot
            const columnToShowIn = editor.viewColumn

            if (currPanel) {
                currPanel.reveal(columnToShowIn)
                currPanel.webview.postMessage({ command: 'render', dot: pendingDot })
            } else {
                currPanel = vscode.window.createWebviewPanel(
                    'camel', // Identifies the type of the webview. Used internally
                    'GraphIR', // Title of the panel displayed to the user
                    vscode.ViewColumn.Beside,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true,
                        localResourceRoots: [
                            vscode.Uri.file(path.join(context.extensionPath, 'dist'))
                        ]
                    }
                )

                currPanel.webview.html = getWebviewContent(context, currPanel)

                currPanel.webview.onDidReceiveMessage(
                    (message) => {
                        switch (message.command) {
                            case 'ready':
                                if (pendingDot) {
                                    currPanel?.webview.postMessage({ command: 'render', dot: pendingDot })
                                }
                                return
                            case 'alert':
                                vscode.window.showErrorMessage(message.text)
                                return
                        }
                    },
                    undefined,
                    context.subscriptions
                )

                currPanel.onDidDispose(
                    () => {
                        currPanel = undefined
                        pendingDot = null
                    },
                    null,
                    context.subscriptions
                )
            }
        })
    )

    // LSP related code

    // The server is implemented in node
    const serverModule = context.asAbsolutePath(path.join('dist', 'server', 'server.cjs'))

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc
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
