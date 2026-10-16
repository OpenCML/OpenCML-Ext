import assert from 'node:assert/strict'
import fs from 'node:fs'
import { loadTs } from './load-ts.mjs'
const { parseGirJson } = await loadTs('webview/src/panels/graphviz/jgir.ts')
const { buildFlowModel } = await loadTs('webview/src/panels/graphviz/layout.ts')
const { graphTarget, focusGraph } = await loadTs('webview/src/panels/graphviz/hierarchy.ts')
const node = (id, kind, extra = {}) => ({ id, kind, label: 'not a graph reference', outputType: 'int', ...extra })
const graph = (id, nodes, extra = {}) => ({ id, name: 'same name', signature: '() => int', dependencies: [], normalPorts: [], contextPorts: [], capturePorts: [], nodes, edges: [], exit: nodes.at(-1).id, ...extra })
const document = { format: 'camel.gir', version: 1, root: 'g0', graphs: [
    graph('g0', [node('n0', 'DATA', { callee: 'g1' }), node('n1', 'CALL')], { dependencies: ['g1', 'g2'], edges: [{ source: 'n0', target: 'n1', kind: 'context', sourceIndex: 0, targetIndex: 0 }] }),
    graph('g1', [node('n2', 'LOOP', { loop: { kind: 'for', condition: null, body: 'g2' } })]),
    graph('g2', [node('n3', 'PORT', { parameter: { name: 'item', kind: 'normal', index: 0 } }), node('n4', 'PORT', { parameter: { name: 'sum', kind: 'normal', index: 1 } })], { normalPorts: ['n3', 'n4'] })
] }
const result = parseGirJson(JSON.stringify(document))
const model = buildFlowModel(result.graph, {})
assert.equal(graphTarget(model, model.nodes.find(n => n.id === 'n0')), 'cluster_g1', 'explicit IDs must win over duplicate display names')
const loop = model.nodes.find(n => n.id === 'cluster_g1/n2').data.loop
assert.equal(loop.kind, 'for')
assert.equal(loop.body.scope, 'cluster_g2')
assert.equal(loop.states[0].name, 'sum')
assert.equal(model.nodes.find(n => n.id === 'n1').data.attrs.value_type, 'int')
assert(result.dot.includes('subgraph "cluster_g1"'))
assert(!model.nodes.filter(n => ['ARGS', 'EXIT'].includes(n.data.nodeType)).some(n => n.data.attrs.value_type))
for (const mutate of [
    d => { d.version = 2 }, d => { d.graphs[0].nodes[0].id = 'n1' },
    d => { d.graphs[0].nodes[0].callee = 'missing' }, d => { d.graphs[0].edges[0].source = 'missing' },
    d => { d.graphs[0].edges[0].targetIndex = -1 }, d => { d.graphs[0].dependencies = [] },
    d => { d.graphs[1].nodes[0].loop.body = 'missing' },
    d => { d.graphs[0].nodes[0].source = { file: 'a.cml', start: { line: 2, character: 0 }, end: { line: 1, character: 0 } } }
]) {
    const bad = structuredClone(document); mutate(bad)
    assert.throws(() => parseGirJson(JSON.stringify(bad)), /Invalid GIR JSON/)
}
if (process.env.GIR_JSON_PATH) {
    const actual = parseGirJson(fs.readFileSync(process.env.GIR_JSON_PATH, 'utf8'))
    const full = buildFlowModel(actual.graph, {})
    for (const node of full.nodes.filter(n => n.data.loop)) {
        assert(node.data.loop.body.scope)
        assert(focusGraph(full, node.id.slice(0, node.id.lastIndexOf('/'))).nodes.some(n => n.id === node.id))
    }
    assert(full.nodes.some(n => n.data.nodeType === 'LOOP'))
    console.log(`JGIR_REAL_OK: ${full.nodes.length} nodes, ${full.edges.length} edges`)
}
console.log('JGIR_OK: explicit graph IDs, duplicate names, output types, ports, loop navigation, boundaries and validation')
