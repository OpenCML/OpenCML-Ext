import assert from 'node:assert/strict'
import { loadTs } from './load-ts.mjs'
const { literalTokens } = await loadTs('webview/src/panels/graphviz/literals.ts')
const { tokenForeground } = await loadTs('client/src/syntaxTokenColors.ts')
assert.deepEqual(literalTokens('[1, false, "hello"]', 'DATA', {}).filter(t => t.kind).map(t => t.kind), ['integer', 'constant', 'string'])
assert.equal(literalTokens('hello {name}', 'DATA', { value_type: 'string' })[0].kind, 'string')
for (const value of ['0xff', '-0b10', '1.25e-3', 'true', 'null']) assert(literalTokens(value, 'DATA', {})[0].kind, value)
for (const value of ['L4 {} {}', 'Function(graph=main)', 'someName42', '[1, value]', '[1, 2', '1 + 2']) assert(literalTokens(value, 'DATA', {}).every(t => !t.kind), value)
assert(literalTokens('123', 'OPER', {}).every(t => !t.kind))
assert(literalTokens('123', 'DATA', { function_value: '1' }).every(t => !t.kind))
const rules = [
    { scope: 'constant', settings: { foreground: '#111111' } },
    { scope: ['source.cpp constant.numeric', 'constant.numeric'], settings: { foreground: '#222222' } },
    { scope: 'constant.numeric.integer.cml', settings: { foreground: '#333333' } },
    { scope: 'constant.numeric.integer.cml', settings: { foreground: '#444444' } },
    { scope: 'constant.numeric.integer.cml', settings: { foreground: 'url(bad)' } }
]
assert.equal(tokenForeground(rules, 'constant.numeric.integer.cml'), '#444444')
assert.equal(tokenForeground(rules, 'constant.numeric.real.cml'), '#222222')
assert.equal(tokenForeground(rules, 'constant.language.cml'), '#111111')
assert.equal(tokenForeground(rules, 'string.quoted.double.cml'), undefined)
console.log('GIR_LITERAL_OK: complete literals, mixed containers, opaque values, scope precedence and safe colors')
