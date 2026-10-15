// Real runtime contract test. Usage: node scripts/lsp-camel-ls-check.mjs [camel-ls]
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { LspClient } from './lsp-client.mjs'
const exe = process.argv[2] || process.env.CAMEL_LS_PATH || (process.env.CAMEL_HOME ? path.join(process.env.CAMEL_HOME, 'bin', process.platform === 'win32' ? 'camel-ls.exe' : 'camel-ls') : 'camel-ls')
const ls = new LspClient(exe, ['--stdio'])
try {
    const init = await ls.request('initialize', { processId: process.pid, rootUri: null, capabilities: { textDocument: { diagnostic: {} } } })
    ls.notify('initialized', {})
    for (const feature of ['hoverProvider', 'definitionProvider', 'referencesProvider', 'documentSymbolProvider', 'workspaceSymbolProvider', 'completionProvider', 'signatureHelpProvider', 'renameProvider', 'semanticTokensProvider', 'documentFormattingProvider']) assert.ok(init.capabilities[feature], feature)
    const text = 'module err_function_part\n\nfunc inc(x: int): int { return x + 1 }\n\nfunc main(): int sync {\n    let fs = [inc]\n    println(fs == fs)\n    return 0\n}\n'
    const uri = pathToFileURL(path.resolve('test/test/semantic-inc.cml')).href
    const document = { textDocument: { uri } }
    ls.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'cml', version: 1, text } })
    const diagnostics = await ls.request('textDocument/diagnostic', document)
    assert.ok(diagnostics.items.some(d => d.message.includes('No matching function')), 'type error in function array comparison')
    const tokens = await ls.request('textDocument/semanticTokens/full', document)
    const decoded = []
    let line = 0, column = 0
    for (let i = 0; i < tokens.data.length; i += 5) {
        const [dl, dc, length, type] = tokens.data.slice(i, i + 5)
        column = dl ? dc : column + dc; line += dl
        decoded.push({ line, column, length, type: init.capabilities.semanticTokensProvider.legend.tokenTypes[type] })
    }
    for (const [line, column] of [[2, 5], [5, 14]]) assert.ok(decoded.some(t => t.line === line && t.column === column && t.type === 'function' && t.length === 3), 'inc declaration AND function value must be function tokens, even with a type error')
    const position = { ...document, position: { line: 5, character: 15 } }
    assert.ok(await ls.request('textDocument/hover', position))
    assert.ok((await ls.request('textDocument/definition', position)).length)
    assert.ok((await ls.request('textDocument/references', { ...position, context: { includeDeclaration: true } })).length >= 2)
    assert.ok((await ls.request('textDocument/documentSymbol', document)).length)
    ls.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: text.replace('println(fs == fs)', 'println(1)').replace('[inc]', ' inc(1)') }] })
    assert.equal((await ls.request('textDocument/diagnostic', document)).items.length, 0)
    assert.ok(await ls.request('textDocument/prepareRename', position))
    const rename = await ls.request('textDocument/rename', { ...position, newName: 'increment' })
    assert.equal(rename.changes[uri].length, 2)
    const completion = await ls.request('textDocument/completion', { ...document, position: { line: 7, character: 4 } })
    assert.ok(completion.items.some(item => item.label === 'inc'))
    const signature = await ls.request('textDocument/signatureHelp', { ...document, position: { line: 6, character: 12 } })
    assert.ok(signature.signatures.length)
    assert.ok((await ls.request('textDocument/formatting', { ...document, options: { tabSize: 4, insertSpaces: true } })).length)
    assert.ok(!ls.notifications.some(n => n.method === 'textDocument/publishDiagnostics'), 'pull clients must not receive duplicate push diagnostics')
    console.log('CAMEL_LS_OK: diagnostics, unsaved edits, hover, definition, references, symbols, completion, signature, rename, format, inc function tokens')
} finally { await ls.close() }
