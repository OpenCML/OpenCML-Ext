// E2E smoke test entry, loaded by the VSCode extension host via --extensionTestsPath.
// Verifies: extension activates, server starts, hover round-trips through LSP.
const path = require('path')
const assert = require('assert')

function run(testsRoot, callback) {
    ;(async () => {
        const vscode = require('vscode')

        const ext = vscode.extensions.getExtension('kogler7.open-cml-extension')
        assert(ext, 'extension kogler7.open-cml-extension not found')
        await ext.activate()
        assert(ext.isActive, 'extension failed to activate')

        // Open a .cml document; this also triggers onLanguage:cml activation.
        const docPath = path.join(
            'D:\\Projects\\OpenCML-Ext',
            'test',
            'test',
            'fib.cml'
        )
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(docPath))
        await vscode.window.showTextDocument(doc)

        // Give the language client a moment to fork the server.
        await new Promise((resolve) => setTimeout(resolve, 4000))

        // The server's onHover always returns 'OpenCML'. If the server crashed
        // or never started, this returns empty.
        const hovers = await vscode.commands.executeCommand(
            'vscode.executeHoverProvider',
            doc.uri,
            new vscode.Position(0, 0)
        )
        assert(
            Array.isArray(hovers) && hovers.length > 0,
            'no hover returned — language server is not running'
        )
        const text = hovers.map((h) => h.contents).join(' ')
        console.log('HOVER_OK:', text)
    })().then(
        () => callback(null),
        (err) => callback(err instanceof Error ? err : new Error(String(err)))
    )
}

module.exports = { run }
