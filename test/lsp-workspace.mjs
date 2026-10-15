import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { LspClient } from '../scripts/lsp-client.mjs'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'camel-workspace-check-'))
const source = {
    'lib.cml': 'module lib\nexport func increment(value: int): int { return value + 1 }\n',
    'main.cml': 'import { increment } from lib\nfunc main(): int {\n let answer = increment(2)\n return answer\n}\n',
    'other.cml': 'import { increment } from lib\nfunc other(): int { return increment(3) }\n'
}
for (const [name, text] of Object.entries(source)) fs.writeFileSync(path.join(root, name), text)
const uri = name => pathToFileURL(path.join(root, name)).href
const doc = name => ({ textDocument: { uri: uri(name) } })
const exe = process.argv[2] || process.env.CAMEL_LS_PATH || (process.env.CAMEL_HOME ? path.join(process.env.CAMEL_HOME, 'bin', process.platform === 'win32' ? 'camel-ls.exe' : 'camel-ls') : 'camel-ls')
const ls = new LspClient(exe, ['--stdio'])
let version = 1
const open = (name, text = source[name]) => ls.notify('textDocument/didOpen', { textDocument: { uri: uri(name), languageId: 'cml', version: ++version, text } })
const change = (name, text) => ls.notify('textDocument/didChange', { textDocument: { uri: uri(name), version: ++version }, contentChanges: [{ text }] })
const diagnostics = async name => (await ls.request('textDocument/diagnostic', doc(name))).items
try {
    const init = await ls.request('initialize', { rootUri: pathToFileURL(root).href, capabilities: { textDocument: { diagnostic: {} }, workspace: { workspaceEdit: { documentChanges: true }, diagnostics: { refreshSupport: true } } } })
    ls.notify('initialized', {})
    for (const feature of ['foldingRangeProvider', 'selectionRangeProvider', 'inlayHintProvider', 'callHierarchyProvider', 'typeDefinitionProvider', 'codeActionProvider']) assert(init.capabilities[feature], feature)
    open('lib.cml'); open('main.cml')
    assert.deepEqual(await diagnostics('lib.cml'), [], 'library should compile without main')
    assert.deepEqual(await diagnostics('main.cml'), [])
    const at = { ...doc('main.cml'), position: { line: 2, character: 16 } }
    const refs = await ls.request('textDocument/references', { ...at, context: { includeDeclaration: true } })
    assert.equal(refs.length, 5)
    assert(refs.some(r => r.uri === uri('other.cml')), 'unopened file references')
    const rename = await ls.request('textDocument/rename', { ...at, newName: 'increase' })
    assert.equal(rename.documentChanges.length, 3)
    assert.equal(rename.documentChanges.flatMap(d => d.edits).length, 5)
    assert.equal(rename.documentChanges.find(d => d.textDocument.uri === uri('other.cml')).textDocument.version, null)
    assert.equal(fs.readFileSync(path.join(root, 'lib.cml'), 'utf8'), source['lib.cml'], 'rename is previewable and never writes sources')
    await assert.rejects(ls.request('textDocument/rename', { ...at, newName: 'answer' }), /collide|capture/)
    await assert.rejects(ls.request('textDocument/rename', { ...at, newName: 'return' }), /keyword/)
    const hints = await ls.request('textDocument/inlayHint', { ...doc('main.cml'), range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } } })
    assert(hints.some(h => h.label === ': int' && h.kind === 1))
    assert(hints.some(h => h.label === 'value:' && h.kind === 2))
    const folds = await ls.request('textDocument/foldingRange', doc('main.cml'))
    assert(folds.some(f => f.startLine === 1 && f.endLine === 4))
    const selections = await ls.request('textDocument/selectionRange', { ...doc('main.cml'), positions: [at.position] })
    assert.equal(selections[0].range.start.character, 14)
    assert(selections[0].parent.parent)
    const items = await ls.request('textDocument/prepareCallHierarchy', at)
    const incoming = await ls.request('callHierarchy/incomingCalls', { item: items[0] })
    assert.deepEqual(incoming.map(c => c.from.name).sort(), ['main', 'other'])
    const outgoing = await ls.request('callHierarchy/outgoingCalls', { item: incoming.find(c => c.from.name === 'main').from })
    assert.equal(outgoing[0].to.name, 'increment')
    change('main.cml', source['main.cml'].replace('increment(2)', 'incremen(2)'))
    const actions = await ls.request('textDocument/codeAction', { ...doc('main.cml'), range: { start: { line: 2, character: 14 }, end: { line: 2, character: 22 } }, context: { diagnostics: await diagnostics('main.cml') } })
    assert.equal(actions[0].edit.documentChanges[0].edits[0].newText, 'increment')
    assert.deepEqual(await ls.request('textDocument/codeAction', { ...doc('main.cml'), range: { start: { line: 2, character: 14 }, end: { line: 2, character: 22 } }, context: { diagnostics: [], only: ['refactor'] } }), [], 'quick fixes must respect requested action kinds')
    change('main.cml', source['main.cml'])
    change('lib.cml', source['lib.cml'].replaceAll('int', 'float').replace(' + 1', ' + 1.0'))
    assert((await diagnostics('main.cml')).some(d => d.message.includes('No matching function')), 'unsaved dependency must be analyzed')
    ls.notify('textDocument/didClose', doc('lib.cml'))
    assert.deepEqual(await diagnostics('main.cml'), [], 'closing dependency restores its disk contents')
    fs.writeFileSync(path.join(root, 'lib.cml'), source['lib.cml'].replaceAll('int', 'float').replace(' + 1', ' + 1.0'))
    ls.notify('workspace/didChangeWatchedFiles', { changes: [{ uri: uri('lib.cml'), type: 2 }] })
    assert((await diagnostics('main.cml')).length, 'external edit invalidates dependencies')
    fs.writeFileSync(path.join(root, 'lib.cml'), source['lib.cml'])
    ls.notify('workspace/didChangeWatchedFiles', { changes: [{ uri: uri('lib.cml'), type: 2 }] })
    assert.deepEqual(await diagnostics('main.cml'), [])
    fs.unlinkSync(path.join(root, 'lib.cml'))
    ls.notify('workspace/didChangeWatchedFiles', { changes: [{ uri: uri('lib.cml'), type: 3 }] })
    assert((await diagnostics('main.cml')).length, 'deleted dependency produces a diagnostic')
    fs.writeFileSync(path.join(root, 'lib.cml'), source['lib.cml'])
    ls.notify('workspace/didChangeWatchedFiles', { changes: [{ uri: uri('lib.cml'), type: 1 }] })
    assert.deepEqual(await diagnostics('main.cml'), [])
    open('types.cml', 'type Count = int\nfunc main(): int {\n let count: Count = 2\n return count\n}\n')
    const type = await ls.request('textDocument/typeDefinition', { ...doc('types.cml'), position: { line: 3, character: 9 } })
    assert(type.some(t => t.range.start.line === 0), 'named annotation type definition')
    const cancelId = ls.nextId + 1
    ls.notify('$/cancelRequest', { id: cancelId })
    await assert.rejects(ls.request('textDocument/references', { ...at, context: { includeDeclaration: true } }), /cancel/)
    assert(await ls.request('textDocument/hover', at), 'server remains usable after cancellation')
    console.log('WORKSPACE_LSP_OK: unsaved imports, libraries, unopened references, atomic rename, conflicts, calls, hints, folding, selections, typo fix, type navigation, file changes and cancellation')
} finally { await ls.close(); fs.rmSync(root, { recursive: true, force: true }) }
