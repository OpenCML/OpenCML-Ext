// Fallback protocol test; optional CLI checks use CAMEL_EXE_PATH.
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { LspClient } from './lsp-client.mjs'
const configuration = { camelPath: process.env.CAMEL_EXE_PATH || 'camel', maxNumberOfProblems: 1 }
const ls = new LspClient(process.execPath, ['dist/server/server.cjs', '--stdio'], configuration)
try {
    const init = await ls.request('initialize', { processId: process.pid, rootUri: null, capabilities: { workspace: { configuration: true }, textDocument: { diagnostic: {} } } })
    assert(init.capabilities.documentFormattingProvider)
    assert(!init.capabilities.hoverProvider && !init.capabilities.completionProvider)
    ls.notify('initialized', {})
    if (process.env.CAMEL_EXE_PATH) {
        const uri = pathToFileURL(path.resolve('test/test/unsaved-fallback.cml')).href
        const document = { textDocument: { uri } }
        ls.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'cml', version: 1, text: 'func main(): int { return undefined_symbol }' } })
        const result = await ls.request('textDocument/diagnostic', document)
        assert.equal(result.items.length, 1, 'nonzero compiler exit must retain diagnostics')
        assert(result.items[0].message.includes('undefined_symbol'))
        assert(result.items[0].code)
        ls.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: 'func main(): int { return 42 }' }] })
        assert.equal((await ls.request('textDocument/diagnostic', document)).items.length, 0)
        assert((await ls.request('textDocument/formatting', { ...document, options: { tabSize: 4, insertSpaces: true } })).length)
        ls.notify('textDocument/didChange', { textDocument: { uri, version: 3 }, contentChanges: [{ text: 'module lib\nexport func inc(x: int): int { return x + 1 }\n' }] })
        assert.equal((await ls.request('textDocument/diagnostic', document)).items.length, 0, 'library does not need main')
        ls.notify('textDocument/didChange', { textDocument: { uri, version: 4 }, contentChanges: [{ text: 'module lib\nlet broken = missing_library_symbol\n' }] })
        const libraryErrors = (await ls.request('textDocument/diagnostic', document)).items
        assert(libraryErrors.some(d => d.message.includes('missing_library_symbol')), 'keep genuine library errors')
    }
    console.log('FALLBACK_OK: capabilities' + (process.env.CAMEL_EXE_PATH ? ', compiler errors, unsaved edits, formatting' : ' (set CAMEL_EXE_PATH for CLI checks)'))
} finally { await ls.close() }
