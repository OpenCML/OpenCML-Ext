// E2E smoke test entry, loaded by the VSCode extension host via --extensionTestsPath.
// Two modes (see mode.txt written by run.mjs):
//   full     — camelPath points at a real Camel build; diagnostics/format/vizGIR
//              are expected to work through camel-ls (or the Node fallback server).
//   fallback — camelPath is bogus; the extension must degrade to the bundled Node
//              language server (hover stub still answers).
const path = require('path')
const fs = require('fs')
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

        const mode = fs.readFileSync(path.join(workspaceFolder.uri.fsPath, 'mode.txt'), 'utf8').trim()
        console.log('E2E_MODE:', mode)

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

        if (mode === 'fallback') {
            // camel-ls is absent and camel is mis-configured: the bundled Node
            // server must still start and answer hovers.
            const fib = await openDoc('fib.cml')
            await new Promise((r) => setTimeout(r, 3000))
            const hovers = await vscode.commands.executeCommand(
                'vscode.executeHoverProvider',
                fib.uri,
                new vscode.Position(0, 0)
            )
            assert(Array.isArray(hovers) && hovers.length > 0, 'no hover from fallback server')
            console.log('FALLBACK_HOVER_OK')
            return
        }

        // full mode below
        const fib = await openDoc('fib.cml')
        await new Promise((r) => setTimeout(r, 2000))
        const hovers = await vscode.commands.executeCommand(
            'vscode.executeHoverProvider',
            fib.uri,
            new vscode.Position(0, 0)
        )
        console.log('HOVER_RESULT_COUNT:', Array.isArray(hovers) ? hovers.length : 'n/a')

        // Diagnostics: err.cml has an unresolved reference; the language server
        // must surface it through the diagnostic pipeline.
        const err = await openDoc('err.cml')
        let diags = []
        for (let i = 0; i < 40; i++) {
            await new Promise((r) => setTimeout(r, 1000))
            diags = vscode.languages.getDiagnostics(err.uri)
            if (diags.length > 0) {
                break
            }
        }
        assert(diags.length > 0, 'no diagnostics for err.cml — diagnostic pipeline broken')
        const msg = diags.map((d) => `${d.message}`).join('\n')
        assert(msg.includes('undefined_symbol'), `unexpected diagnostics: ${msg}`)
        console.log('DIAG_OK:', diags.length, 'diagnostic(s); first at line', diags[0].range.start.line)

        // Formatting: ugly.cml must be reformatted.
        const ugly = await openDoc('ugly.cml')
        await new Promise((r) => setTimeout(r, 1000))
        const edits = await vscode.commands.executeCommand(
            'vscode.executeFormatDocumentProvider',
            ugly.uri,
            { tabSize: 4, insertSpaces: true }
        )
        assert(
            Array.isArray(edits) && edits.length > 0 && typeof edits[0].newText === 'string',
            'no format edits returned — formatting pipeline broken'
        )
        const formatted = applyEdits(ugly.getText(), edits)
        assert(formatted.includes('\n    '), `formatting looks wrong: ${JSON.stringify(formatted)}`)
        console.log('FORMAT_OK')

        // GraphIR panel: command must run and open the webview panel.
        await vscode.commands.executeCommand('camel.vizGIR')
        await new Promise((r) => setTimeout(r, 3000))
        const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).map((t) => t.label)
        assert(tabs.includes('GraphIR'), `GraphIR panel not opened; tabs: ${tabs.join(', ')}`)
        console.log('VIZGIR_OK')

        // Debug: launch camel-db through the DAP bridge, check the session
        // answers threads, then stop it (which must terminate camel-db).
        const started = await vscode.debug.startDebugging(undefined, {
            type: 'camel',
            request: 'launch',
            name: 'E2E Camel Debug',
            program: path.join(workspaceFolder.uri.fsPath, 'fib.cml'),
            debugPort: 18799
        })
        assert(started, 'debug session failed to start')
        await new Promise((r) => setTimeout(r, 5000))
        const session = vscode.debug.activeDebugSession
        assert(session && session.type === 'camel', 'no active camel debug session')
        const threads = await session.customRequest('threads')
        assert(Array.isArray(threads.threads) && threads.threads.length >= 1, 'no threads from debug adapter')
        await vscode.debug.stopDebugging(session)
        await new Promise((r) => setTimeout(r, 1500))
        assert(!vscode.debug.activeDebugSession, 'debug session did not stop')
        console.log('DEBUG_OK')
    })().then(
        () => callback(null),
        (err) => callback(err instanceof Error ? err : new Error(String(err)))
    )
}

module.exports = { run }
