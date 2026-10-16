// E2E smoke test entry, loaded by the VSCode extension host via --extensionTestsPath.
// Two modes (see mode.txt written by run.mjs):
//   full     — camelPath points at a real Camel build; diagnostics/format/vizGIR
//              are expected to work through camel-ls (or the Node fallback server).
//   fallback — camelPath is bogus; the extension must degrade to the bundled Node
//              language server (CLI features only).
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

        if (mode === 'memory') {
            await require('./memory.cjs').run(vscode, workspaceFolder)
            return
        }

        if (mode === 'pipeline') {
            await require('./pipeline.cjs').run(vscode, workspaceFolder)
            return
        }

        if (mode === 'native-debug') {
            await require('./native-debug.cjs').run(vscode, workspaceFolder)
            return
        }

        if (mode === 'experience') {
            await require('./experience.cjs').run(vscode, workspaceFolder)
            return
        }

        if (mode === 'gir') {
            await require('./gir.cjs').run(vscode, workspaceFolder)
            return
        }

        if (mode === 'fallback') {
            // The fallback must not advertise the old demo hover or JS/TS completion.
            const fib = await openDoc('fib.cml')
            await vscode.commands.executeCommand('camel.restartServer')
            const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', fib.uri, new vscode.Position(0, 0))
            assert(!hovers?.length, 'fallback advertised a fake hover')
            console.log('FALLBACK_CAPABILITIES_OK')
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

        if (mode === 'lsp') {
            const uri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, 'semantic-inc.cml'))
            const source = 'module err_function_part\n\nfunc inc(x: int): int { return x + 1 }\n\nfunc main(): int sync {\n    let fs = [inc]\n    println(fs == fs)\n    return 0\n}\n'
            await vscode.workspace.fs.writeFile(uri, Buffer.from(source))
            const doc = await vscode.workspace.openTextDocument(uri)
            await vscode.window.showTextDocument(doc)
            assert.equal(vscode.workspace.getConfiguration('editor', doc).get('semanticHighlighting.enabled'), true)
            const legend = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokensLegend', uri)
            const tokens = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens', uri)
            assert(legend && tokens, 'semantic tokens not registered in VS Code')
            let line = 0, column = 0
            const functions = []
            for (let i = 0; i < tokens.data.length; i += 5) {
                const [dl, dc, length, type] = tokens.data.slice(i, i + 5)
                column = dl ? dc : column + dc; line += dl
                if (legend.tokenTypes[type] === 'function') functions.push(`${line}:${column}:${length}`)
            }
            assert(functions.includes('2:5:3') && functions.includes('5:14:3'), `inc tokens: ${functions}`)
            const definitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, new vscode.Position(5, 15))
            assert(definitions?.length, 'inc reference has no definition')
            await vscode.commands.executeCommand('camel.restartServer')
            const restarted = await vscode.commands.executeCommand('vscode.executeHoverProvider', uri, new vscode.Position(5, 15))
            assert(restarted?.length, 'server did not resynchronize documents after restart')
            // Opening a library must not require an executable entry point.
            const libUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, 'lib.cml'))
            await vscode.workspace.fs.writeFile(libUri, Buffer.from('module lib\nexport func inc(x: int): int { return x + 1 }\n'))
            const lib = await vscode.workspace.openTextDocument(libUri)
            await vscode.window.showTextDocument(lib)
            await vscode.commands.executeCommand('camel.restartServer')
            // Verify a real error first so that an empty list cannot pass merely because
            // analysis has not started, then fix it while keeping the file without main.
            const replace = async text => {
                const edit = new vscode.WorkspaceEdit()
                edit.replace(libUri, new vscode.Range(lib.positionAt(0), lib.positionAt(lib.getText().length)), text)
                await vscode.workspace.applyEdit(edit)
            }
            await replace('module lib\nlet broken = missing_library_symbol\nexport func inc(x: int): int { return x + 1 }\n')
            for (let i = 0; i < 100 && !vscode.languages.getDiagnostics(libUri).some(d => d.message.includes('missing_library_symbol')); i++) await new Promise(r => setTimeout(r, 100))
            assert(vscode.languages.getDiagnostics(libUri).some(d => d.message.includes('missing_library_symbol')), 'real library errors were hidden')
            assert(!vscode.languages.getDiagnostics(libUri).some(d => String(d.code).toLowerCase() === '0x0300001b'), 'missing-main error leaked')
            await replace('module lib\nexport func inc(x: int): int { return x + 1 }\n')
            for (let i = 0; i < 100 && vscode.languages.getDiagnostics(libUri).length; i++) await new Promise(r => setTimeout(r, 100))
            assert.equal(vscode.languages.getDiagnostics(libUri).length, 0, 'valid library must have no entry diagnostics')
            console.log('LIBRARY_DIAGNOSTICS_OK: no main required, unresolved references still reported')
            console.log('LSP_SEMANTIC_INC_AND_RESTART_OK')
            return
        }

        // GraphIR panel: command must run and open the webview panel.
        await vscode.commands.executeCommand('camel.vizGIR')
        await new Promise((r) => setTimeout(r, 3000))
        const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).map((t) => t.label)
        assert(tabs.some(label => label === 'GraphIR' || label.startsWith('GIR ·')), `GraphIR panel not opened; tabs: ${tabs.join(', ')}`)
        console.log('VIZGIR_OK')

        await require('./native-debug.cjs').run(vscode, workspaceFolder)
    })().then(
        () => callback(null),
        (err) => callback(err instanceof Error ? err : new Error(String(err)))
    )
}

module.exports = { run }
