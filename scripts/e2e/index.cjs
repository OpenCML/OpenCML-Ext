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
