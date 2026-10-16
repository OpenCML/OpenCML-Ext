import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { loadTs } from './load-ts.mjs'
const { parseDot } = await loadTs('webview/src/panels/graphviz/dot.ts')
const { buildFlowModel } = await loadTs('webview/src/panels/graphviz/layout.ts')
const { focusGraph } = await loadTs('webview/src/panels/graphviz/hierarchy.ts')
const { loopLayoutDot, loopScope } = await loadTs('webview/src/panels/graphviz/loops.ts')

const fixture = `digraph G {
 subgraph m { label="main";
  subgraph c { label="main.loop1.cond"; test [type="OPER", label=":op/lt_l"]; }
  subgraph b { label="main.loop1.body";
   p [type="PORT", param_name="i", param_kind="normal", param_index="0", value_type="int"];
   cp [type="PORT", param_name="limit", param_kind="capture", param_index="0", value_type="int"];
   add [type="OPER", label=":op/add_l"]; p -> add [type="NORM"]; }
  subgraph f { label="main.loop2.body";
   x [type="PORT", param_name="x", param_kind="normal", param_index="0"];
   s [type="PORT", param_name="sum", param_kind="normal", param_index="1"]; }
  zero [type="DATA", label="0"]; limit [type="DATA", label="20"]; xs [type="DATA", label="[1, 2, 3]"];
  w [type="LOOP", label="LOOP while cond=main.loop1.cond body=main.loop1.body"];
  each [type="LOOP", label="LOOP for body=main.loop2.body"];
  zero -> w [type="NORM", label="0|0"]; limit -> w [type="WITH", label="0|0"];
  xs -> each [type="NORM", label="0|0"]; zero -> each [type="NORM", label="0|1"];
  w -> each [type="CTRL", label="0|0"];
 }
}`
const parsed = parseDot(fixture), model = buildFlowModel(parsed, {})
const before = JSON.stringify(model)
const loop = model.nodes.find(n => n.id === 'm/w').data.loop
assert.equal(loop.condition.scope, 'm/c')
assert.equal(loop.body.scope, 'm/b')
assert.deepEqual(loop.states, [{ name: 'i', value: '0', type: 'int' }])
assert.deepEqual(loop.captures, [{ name: 'limit', value: '20', type: 'int' }])
const forLoop = model.nodes.find(n => n.id === 'm/each').data.loop
assert.equal(forLoop.condition, undefined)
assert.equal(forLoop.iterable.name, 'x')
assert.equal(forLoop.iterable.value, '[1, 2, 3]')
assert.equal(forLoop.states[0].name, 'sum')
assert.equal(forLoop.states[0].value, '0')
const focus = focusGraph(model, 'm')
assert.equal(focus.nodes.filter(n => n.type === 'cluster').length, 0, 'referenced loop subgraphs must not occupy separate cards')
assert.equal(focus.nodes.find(n => n.id === 'm/w').data.enterScope, 'm/b')
assert.equal(loopScope(model, 'm/c').role, 'condition')
assert.equal(loopScope(model, 'm/b').role, 'body')
assert.equal(JSON.stringify(model), before, 'drilling must not mutate the original graph')
assert.equal(parseDot('digraph G { a [label="first\\nsecond\\lthird", tooltip="quote\\\" and slash\\\\"]; }').nodes[0].attrs.label, 'first\nsecond\nthird')
const full = fixture.replace('label="LOOP while cond=main.loop1.cond body=main.loop1.body"', 'label="LOOP wh\\nile...", tooltip="LOOP while cond=main.loop1.cond body=main.loop1.body\\nnode details"')
assert.equal(buildFlowModel(parseDot(full), {}).nodes.find(n => n.id === 'm/w').data.loop.body.scope, 'm/b')
const missing = buildFlowModel(parseDot('digraph G { l [type="LOOP", label="LOOP while cond=missing body=missing"]; }'), {}).nodes[0].data.loop
assert.equal(missing.body.scope, undefined)
const ambiguous = buildFlowModel(parseDot('digraph G { subgraph a { label="f"; } subgraph b { label="f"; } l [type="LOOP", label="LOOP for body=f"]; }'), {})
assert.equal(ambiguous.nodes.find(n => n.id === 'l').data.loop.body.scope, undefined)
assert.equal(focusGraph(ambiguous, '').nodes.filter(n => n.type === 'cluster').length, 2)
assert(loopLayoutDot(fixture, parsed).includes('fixedsize=true'))

if (process.env.GIR_LOOP_CASE_FILE) {
    for (const pass of ['std::rgir', 'std::gir', 'std::agir']) {
        const raw = execFileSync(process.env.CAMEL_EXE_PATH || 'camel', [process.env.GIR_LOOP_CASE_FILE, pass], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
        const graph = parseDot(raw.slice(raw.indexOf('digraph')))
        const actual = buildFlowModel(graph, {})
        const loops = actual.nodes.filter(n => n.data.nodeType === 'LOOP')
        assert(loops.length >= 4)
        for (const node of loops) {
            assert(node.data.loop.body.scope, `${pass}: missing body ${node.data.label}`)
            assert(node.data.loop.states.length, `${pass}: missing states ${node.data.label}`)
            if (node.data.loop.kind !== 'for') assert(node.data.loop.condition.scope)
            assert.equal(focusGraph(actual, node.id.slice(0, node.id.lastIndexOf('/'))).nodes.find(n => n.id === node.id).data.enterScope, node.data.loop.body.scope)
        }
        console.log(`LOOP_REAL_OK: ${pass}, ${loops.length} loops with body/condition navigation and state names`)
    }
}
console.log('LOOP_OK: graph references, captures, initial state, iterable, full DOT escapes, missing/ambiguous targets and hierarchy')
