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
    const config = vscode.workspace.getConfiguration('opencmlLanguageServer');
    return config.get<string>('camelPath');
}

// 示例函数，展示如何使用获取到的配置项
function showCamelPath() {
    const softwarePath = getCamelPath();

    if (softwarePath) {
        vscode.window.showInformationMessage(`Camel Path: ${softwarePath}`);
    } else {
        vscode.window.showWarningMessage('Camel Path is not set.');
    }
}

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('extension.showCamelPath', () => {
        showCamelPath();
    });

    context.subscriptions.push(disposable);

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
