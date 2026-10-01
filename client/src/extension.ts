import * as path from 'path'
import * as fs from 'fs'
import * as vscode from 'vscode'
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node'

let client: LanguageClient

function getCamelPath(): string | undefined {
    const config = vscode.workspace.getConfiguration('opencmlLanguageServer')
    return config.get<string>('camelPath')
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
            vscode.window.showInformationMessage('Running code...')
        })
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('camel.vizGIR', () => {
            const columnToShowIn = vscode.window.activeTextEditor
                ? vscode.window.activeTextEditor.viewColumn
                : undefined

            if (currPanel) {
                currPanel.reveal(columnToShowIn)
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
