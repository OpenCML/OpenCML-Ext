const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
exports.run = async (vscode, workspace) => {
    const program = path.join(workspace.uri.fsPath, 'native-debug.cml')
    fs.writeFileSync(program, `module main
func double(x: int): int { return x * 2 }
func main(n: int): int sync {
    let a = double(n)
    println(a)
    return 0
}
`)
    const stops = [], events = [], outputs = []
    const tracker = vscode.debug.registerDebugAdapterTrackerFactory('camel', {
        createDebugAdapterTracker: () => ({ onDidSendMessage: m => {
            if (m.type !== 'event') return
            events.push(m)
            if (m.event === 'stopped') stops.push(m)
            if (m.event === 'output') outputs.push(m.body)
        } })
    })
    const wait = async (condition, label) => {
        for (let i = 0; i < 200; i++) {
            if (condition()) return
            await new Promise(r => setTimeout(r, 100))
        }
        throw new Error('Timed out: ' + label)
    }
    let session
    try {
        assert(await vscode.debug.startDebugging(undefined, {
            type: 'camel', request: 'launch', name: 'Native DAP integration', program,
            passes: ['std::macro', 'std::nvm'], args: { n: 6 }, stopOnEntry: true,
            stepBy: 'line', frames: 'functions', cwd: workspace.uri.fsPath,
            env: { OPENCML_DEBUG_TEST: '1' }
        }))
        await wait(() => stops.length > 0, 'entry stop')
        session = vscode.debug.activeDebugSession
        assert(session?.type === 'camel')
        const stack = await session.customRequest('stackTrace', { threadId: 1 })
        assert(stack.stackFrames.length > 0)
        const frame = stack.stackFrames[0]
        assert.equal(path.normalize(frame.source.path), path.normalize(program))
        const scopes = await session.customRequest('scopes', { frameId: frame.id })
        assert(scopes.scopes.length > 0)
        const values = []
        for (const scope of scopes.scopes) {
            const result = await session.customRequest('variables', { variablesReference: scope.variablesReference })
            values.push(...result.variables)
        }
        assert(values.some(v => v.name === 'n' && v.value === '6'), JSON.stringify(values))
        const graph = await session.customRequest('camel/graph', { frameId: frame.id })
        assert(graph.dot.includes('digraph'))
        const snapshots = await session.customRequest('camel/passGraphs')
        assert.equal(snapshots.graphs[0].pass, null)
        assert(snapshots.graphs.some(g => g.pass === 'std::macro'))
        const entry = await session.customRequest('camel/passGraph', { index: 0 })
        assert(entry.dot.includes('origin='))
        await assert.rejects(session.customRequest('camel/passGraph', { index: -1 }))
        await session.customRequest('camel/setNodeBreakpoints', { origins: [] })
        const functionBreakpoints = await session.customRequest('setFunctionBreakpoints', { breakpoints: [{ name: 'double' }] })
        assert(functionBreakpoints.breakpoints[0].verified)
        const count = stops.length
        await session.customRequest('continue', { threadId: 1 })
        await wait(() => stops.length > count, 'function breakpoint')
        assert.equal(stops.at(-1).body.reason, 'function breakpoint')
        await session.customRequest('setFunctionBreakpoints', { breakpoints: [] })
        const stepped = stops.length
        await session.customRequest('next', { threadId: 1 })
        await wait(() => stops.length > stepped, 'source step')
        await session.customRequest('continue', { threadId: 1 })
        await wait(() => events.some(e => e.event === 'terminated'), 'natural termination')
        assert(outputs.some(o => o.category === 'stdout' && o.output.includes('12')))
        assert.equal(events.find(e => e.event === 'exited').body.exitCode, 0)
        console.log('NATIVE_DAP_OK: launch passes/args, entry, scopes/values, graph/snapshots, function breakpoint, step, output and lifecycle')
    } finally {
        if (session) await vscode.debug.stopDebugging(session)
        tracker.dispose()
    }
}
