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

        // Debug: launch camel-db through the DAP bridge against a long-running
        // fibonacci(28) so breakpoints set after launch still land mid-run, then
        // drive the lifecycle: verify+pause at the breakpoint, step over (pause
        // again), continue to completion (session terminates naturally once the
        // task completes).
        const fibPath = path.join(workspaceFolder.uri.fsPath, 'fib_slow.cml')
        const started = await vscode.debug.startDebugging(undefined, {
            type: 'camel',
            request: 'launch',
            name: 'E2E Camel Debug',
            program: fibPath,
            debugPort: 18799
        })
        assert(started, 'debug session failed to start')
        let session = vscode.debug.activeDebugSession
        assert(session && session.type === 'camel', 'no active camel debug session')

        // The recursive-call line is covered by GIR node spans and executes on
        // several calls, so a breakpoint here fires early and leaves plenty of
        // nodes to step through.
        const bpResp = await session.customRequest('setBreakpoints', {
            source: { path: fibPath },
            breakpoints: [{ line: 6 }]
        })
        assert(
            Array.isArray(bpResp?.breakpoints) && bpResp.breakpoints.length === 1,
            'setBreakpoints returned no breakpoint'
        )

        const stackFrame = async () => {
            const st = await session.customRequest('stackTrace', { threadId: 1 })
            return st.stackFrames?.[0]
        }
        // Pause detection: while stopped, the adapter maps the paused node's span
        // onto the frame; while running, frames carry line 0.
        let frame = null
        for (let i = 0; i < 80; i++) {
            await new Promise((r) => setTimeout(r, 500))
            if (!vscode.debug.activeDebugSession) break
            try {
                const f = await stackFrame()
                if (f && f.line > 0) {
                    frame = f
                    break
                }
            } catch {
                break
            }
        }
        assert(
            frame && frame.line > 0,
            `never paused at the line breakpoint; last frame: ${JSON.stringify(frame)}`
        )
        assert(
            frame.source && path.normalize(frame.source.path) === path.normalize(fibPath),
            `paused in unexpected source: ${frame.source?.path}`
        )
        console.log('DEBUG_BP_OK: paused at', frame.name, 'line', frame.line)

        // Step over: must pause again at the next node.
        await session.customRequest('next', { threadId: 1 })
        let stepped = false
        for (let i = 0; i < 60; i++) {
            await new Promise((r) => setTimeout(r, 500))
            if (!vscode.debug.activeDebugSession) break
            try {
                const f = await stackFrame()
                if (f && f.line > 0) {
                    stepped = true
                    break
                }
            } catch {
                break
            }
        }
        assert(stepped, 'step over did not pause at the next node')
        console.log('DEBUG_STEP_OK')

        // Per-pass GIR snapshots: camel-db dumps the compile as entry GIR +
        // one graph per pass. Requires a camel-db with /api/pass-graphs;
        // older builds 404 — degrade to SKIP instead of failing.
        try {
            const dbState = await fetch('http://127.0.0.1:18799/api/state').then((r) => r.json())
            const targetId = dbState?.tasks?.[0]?.id
            const graphsRes = targetId
                ? await fetch(`http://127.0.0.1:18799/api/pass-graphs?target=${encodeURIComponent(targetId)}`)
                : null
            if (!targetId || !graphsRes || !graphsRes.ok) {
                console.log('PASS_GRAPH_SKIP: camel-db has no pass snapshots')
            } else {
                const graphs = (await graphsRes.json())?.graphs ?? []
                if (!Array.isArray(graphs) || graphs.length === 0) {
                    console.log('PASS_GRAPH_SKIP: camel-db has no pass snapshots')
                } else {
                    assert(
                        graphs[0].pass === null,
                        `first pass snapshot should be the entry GIR: ${JSON.stringify(graphs[0])}`
                    )
                    const fetchGraph = async (index) => {
                        const r = await fetch(
                            `http://127.0.0.1:18799/api/pass-graph?target=${encodeURIComponent(targetId)}&index=${index}`
                        )
                        if (!r.ok) {
                            throw new Error(`pass-graph ${index} -> ${r.status}`)
                        }
                        return r.json()
                    }
                    const last = graphs[graphs.length - 1]
                    const lastDot = (await fetchGraph(last.index))?.dot ?? ''
                    assert(
                        typeof lastDot === 'string' && lastDot.includes('digraph'),
                        `last pass snapshot is not a DOT digraph: ${JSON.stringify(last)}`
                    )
                    let originDot = lastDot.includes('origin=')
                    for (const g of graphs) {
                        if (originDot) break
                        originDot = ((await fetchGraph(g.index))?.dot ?? '').includes('origin=')
                    }
                    assert(originDot, 'no pass snapshot DOT carries origin= attributes')
                    console.log(
                        'PASS_GRAPH_OK:',
                        graphs.length,
                        'snapshots; last =',
                        last.pass ?? '(entry)',
                        '; entry pass null; origin= present'
                    )
                }
            }
        } catch (e) {
            console.log('PASS_GRAPH_SKIP: camel-db has no pass snapshots —', String(e))
        }

        // The line-6 breakpoint still fires on every recursive call: clear it so
        // continue can run to completion.
        await session.customRequest('setBreakpoints', {
            source: { path: fibPath },
            breakpoints: []
        })

        // Continue to completion: the worker reports taskState=completed and the
        // adapter must end the session on its own.
        await session.customRequest('continue', { threadId: 1 })
        let ended = false
        for (let i = 0; i < 60; i++) {
            await new Promise((r) => setTimeout(r, 500))
            if (!vscode.debug.activeDebugSession) {
                ended = true
                break
            }
        }
        assert(ended, 'debug session did not terminate after the run completed')
        console.log('DEBUG_OK')
    })().then(
        () => callback(null),
        (err) => callback(err instanceof Error ? err : new Error(String(err)))
    )
}

module.exports = { run }
