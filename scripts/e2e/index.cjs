// E2E smoke test entry, loaded by the VSCode extension host via --extensionTestsPath.
// Verifies: extension activates, hover round-trips through LSP, diagnostics come
// back from `camel check`, and formatting comes back from `camel-format`.
const path = require('path')
const assert = require('assert')

function positionToOffset(text, pos) {
    let offset = 0
    for (let i = 0; i < pos.line; i++) {
        offset = text.indexOf('\n', offset) + 1
    }
    return offset + pos.character
}

function editStartEnd(edit) {
    const r = edit.range
    return Array.isArray(r) ? { start: r[0], end: r[1] } : { start: r.start, end: r.end }
}

// Apply vscode.TextEdit-like objects ({range, newText}) to a text, from the end
// of the document backwards so earlier offsets stay valid.
function applyEdits(text, edits) {
    const withRange = edits.map((e) => {
        const { start, end } = editStartEnd(e)
        return { start, end, newText: e.newText }
    })
    const sorted = withRange.sort((a, b) => positionToOffset(text, b.start) - positionToOffset(text, a.start))
    let out = text
    for (const edit of sorted) {
        const start = positionToOffset(out, edit.start)
        const end = positionToOffset(out, edit.end)
        out = out.slice(0, start) + edit.newText + out.slice(end)
    }
    return out
}

function run(testsRoot, callback) {
    ;(async () => {
        const vscode = require('vscode')
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
        assert(workspaceFolder, 'no workspace folder opened')

        const ext = vscode.extensions.getExtension('kogler7.open-cml-extension')
        assert(ext, 'extension kogler7.open-cml-extension not found')
        await ext.activate()
        assert(ext.isActive, 'extension failed to activate')

        const openDoc = async (name) => {
            const doc = await vscode.workspace.openTextDocument(
                vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, name))
            )
            await vscode.window.showTextDocument(doc)
            return doc
        }

        // 1. Hover round-trip through the language server.
        const good = await openDoc('fib.cml')
        await new Promise((r) => setTimeout(r, 3000))
        const hovers = await vscode.commands.executeCommand(
            'vscode.executeHoverProvider',
            good.uri,
            new vscode.Position(0, 0)
        )
        assert(Array.isArray(hovers) && hovers.length > 0, 'no hover returned — language server is not running')
        console.log('HOVER_OK')

        // 2. Diagnostics: err.cml has an unresolved reference; `camel check`
        //    must surface it through the pull-diagnostic pipeline.
        const err = await openDoc('err.cml')
        let diags = []
        for (let i = 0; i < 40; i++) {
            await new Promise((r) => setTimeout(r, 1000))
            diags = vscode.languages.getDiagnostics(err.uri)
            if (diags.length > 0) {
                break
            }
        }
        assert(diags.length > 0, 'no diagnostics for err.cml — camel check pipeline broken')
        const msg = diags.map((d) => `${d.message}`).join('\n')
        assert(msg.includes('undefined_symbol'), `unexpected diagnostics: ${msg}`)
        assert(diags[0].source === 'Camel', `unexpected diagnostic source: ${diags[0].source}`)
        console.log('DIAG_OK:', diags.length, 'diagnostic(s); first at line', diags[0].range.start.line)

        // 3. Formatting: ugly.cml must be reformatted by camel-format.
        const ugly = await openDoc('ugly.cml')
        await new Promise((r) => setTimeout(r, 1000))
        const edits = await vscode.commands.executeCommand(
            'vscode.executeFormatDocumentProvider',
            ugly.uri,
            { tabSize: 4, insertSpaces: true }
        )
        assert(
            Array.isArray(edits) && edits.length > 0 && typeof edits[0].newText === 'string',
            'no format edits returned — camel-format pipeline broken'
        )
        const formatted = applyEdits(ugly.getText(), edits)
        assert(
            formatted.includes('\n    '),
            `formatting looks wrong: ${JSON.stringify(formatted)}`
        )
        console.log('FORMAT_OK')

        // 4. GraphIR panel: command must run and open the webview panel.
        await vscode.commands.executeCommand('camel.vizGIR')
        await new Promise((r) => setTimeout(r, 3000))
        const tabs = vscode.window.tabGroups.all
            .flatMap((g) => g.tabs)
            .map((t) => t.label)
        assert(tabs.includes('GraphIR'), `GraphIR panel not opened; tabs: ${tabs.join(', ')}`)
        console.log('VIZGIR_OK')
    })().then(
        () => callback(null),
        (err) => callback(err instanceof Error ? err : new Error(String(err)))
    )
}

module.exports = { run }
