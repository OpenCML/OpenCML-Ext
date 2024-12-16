import * as path from 'path'
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
    const config = vscode.workspace.getConfiguration()
    const cSpellWords = (config.get('cSpell.words') as string[]) || []
	console.log(cSpellWords)

    words.forEach((word) => {
        if (!cSpellWords.includes(word)) {
            cSpellWords.push(word)
        }
    })
    config.update('cSpell.words', cSpellWords, vscode.ConfigurationTarget.Workspace)
}

function getWebviewContent() {
    return `<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Cat Coding</title>
	</head>
	<body>
		<img src="https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif" width="300" />
		<h1 id="lines-of-code-counter">0</h1>
	
		<script>
			const counter = document.getElementById('lines-of-code-counter');
	
			let count = 0;
			setInterval(() => {
				counter.textContent = count++;
			}, 100);
	
			// Handle the message inside the webview
			window.addEventListener('message', event => {
	
				const message = event.data; // The JSON data our extension sent
	
				switch (message.command) {
					case 'refactor':
						count = Math.ceil(count * 0.5);
						counter.textContent = count;
						break;
				}
			});
		</script>
	</body>
	</html>`
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
                        retainContextWhenHidden: true
                    }
                )

                const onDiskPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'cat.gif')
                const catGifSrc = currPanel.webview.asWebviewUri(onDiskPath)

                currPanel.webview.postMessage({ command: 'refactor' })

                currPanel.webview.html = getWebviewContent()

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
    const serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'))

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
