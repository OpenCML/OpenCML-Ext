import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { LspClient } from '../scripts/lsp-client.mjs'

const exe = process.env.CAMEL_LS_PATH || (process.env.CAMEL_HOME ? path.join(process.env.CAMEL_HOME, 'bin', process.platform === 'win32' ? 'camel-ls.exe' : 'camel-ls') : 'camel-ls')
const source = `func f13(a14: int[], a15: (a0: bool, a1: float) => float): int { return 7 }
func scalar(value: int): int { return value }
func pair(value: (int, int)): int { return value.0 }
func record(value: {a: int, b: int}): int { return value.a }
func array(value: int[]): int { return 1 }
func text(value: string): int { return 1 }
func main(): int {
 let a30 = 3
 let original = f13([a30, 7, 2], (p32: bool, p33: float): float => p33)
 let nested = array([scalar(5), 7, 2])
 let tuple = pair((1, 2))
 let structure = record({a: 1, b: 2})
 let expression = scalar(1 + 2)
 let parenthesized = scalar((9))
 let commented = scalar(/* argument */ 4)
 let quoted = text('hello')
 return scalar(6)
}
func extra(): int {
 let value = 3
 let same = scalar(value)
 return same
}
`
const ls = new LspClient(exe, ['--stdio'])
try {
    await ls.request('initialize', { capabilities: { textDocument: { diagnostic: {} } } })
    ls.notify('initialized', {})
    const uri = pathToFileURL(path.resolve('test/inlay-fixture.cml')).href
    ls.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'cml', version: 1, text: source } })
    const doc = { textDocument: { uri } }
    const diagnostics = (await ls.request('textDocument/diagnostic', doc)).items
    const hints = (await ls.request('textDocument/inlayHint', { ...doc, range: { start: { line: 0, character: 0 }, end: { line: 99, character: 0 } } })).filter(hint => hint.kind === 2)
    const labelAt = (line, fragment) => ({ line, character: source.split('\n')[line].indexOf(fragment) })
    if (process.argv.includes('--inspect')) {
        console.log(JSON.stringify({ diagnostics, hints: hints.map(h => ({ ...h, source: source.split('\n')[h.position.line] })) }, null, 2))
    } else {
        assert.deepEqual(diagnostics, [])
        assert.deepEqual(hints.map(h => ({ label: h.label, position: h.position })), [
            { label: 'a14:', position: labelAt(8, '[') },
            { label: 'a15:', position: labelAt(8, '(p32') },
            { label: 'value:', position: labelAt(9, '[') },
            { label: 'value:', position: labelAt(9, '5') },
            { label: 'value:', position: labelAt(10, '(1') },
            { label: 'value:', position: labelAt(11, '{') },
            { label: 'value:', position: labelAt(12, '1 + 2') },
            { label: 'value:', position: labelAt(13, '(9') },
            { label: 'value:', position: labelAt(14, '4') },
            { label: 'value:', position: labelAt(15, "'hello'") },
            { label: 'value:', position: labelAt(16, '6') }
        ], 'Hints attach to whole arguments, never to their nested elements')
        const insideArray = labelAt(8, '7')
        const innerHints = await ls.request('textDocument/inlayHint', { ...doc, range: { start: insideArray, end: { ...insideArray, character: insideArray.character + 1 } } })
        assert(!innerHints.some(h => h.kind === 2), 'a viewport inside an array cannot move its outer parameter hint onto an element')
        console.log('INLAY_OK: whole arrays/lambdas, nested calls, tuples, records, expressions, comments, strings and partial viewport')
    }
} finally { await ls.close() }
