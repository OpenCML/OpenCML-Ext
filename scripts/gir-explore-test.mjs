import fs from 'node:fs'
import assert from 'node:assert/strict'
import ts from 'typescript'
const js = ts.transpileModule(fs.readFileSync('webview/src/panels/graphviz/explore.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 } }).outputText
const { neighbors } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const edges = [['a','b'], ['b','c'], ['c','d'], ['x','b'], ['d','b']].map(([source,target],i) => ({ id: String(i), source, target }))
assert.deepEqual([...neighbors('b', edges, 'down', 1).downstream], ['c'])
assert.deepEqual([...neighbors('b', edges, 'down', 2).downstream], ['c', 'd'])
assert.deepEqual([...neighbors('b', edges, 'up', 1).upstream], ['a', 'x', 'd'])
assert.equal(neighbors('b', edges, 'up', 2).downstream.size, 0)
assert(!neighbors('b', edges, 'both', 2).upstream.has('b'))
assert.equal(neighbors('isolated', edges, 'both', 2).connected.size, 0)
console.log('GIR exploration traversal passed')
