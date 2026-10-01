// Smoke test for camel-ls: initialize, didOpen err.cml, pull textDocument/diagnostic,
// textDocument/formatting. Usage: node scripts/lsp-camel-ls-check.mjs [camel-ls.exe]
import { spawn } from 'child_process'
import fs from 'fs'

const exe = process.argv[2] || 'D:/Projects/Camel/out/latest/bin/camel-ls.exe'
const errContent = fs.readFileSync('test/test/err.cml', 'utf8')
const errUri = 'file:///D:/Projects/OpenCML-Ext/test/test/err.cml'

const server = spawn(exe, ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit'] })

let buffer = Buffer.alloc(0)
let sawPush = false
let sawPull = false
let sawFormat = false

server.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n')
        if (headerEnd === -1) return
        const m = /Content-Length: (\d+)/i.exec(buffer.slice(0, headerEnd).toString())
        if (!m) return
        const len = parseInt(m[1], 10)
        if (buffer.length < headerEnd + 4 + len) return
        const body = buffer.slice(headerEnd + 4, headerEnd + 4 + len).toString()
        buffer = buffer.slice(headerEnd + 4 + len)
        const msg = JSON.parse(body)
        if (msg.method === 'textDocument/publishDiagnostics') {
            sawPush = true
            console.log('UNEXPECTED_PUSH_DIAG')
        } else if (msg.id === 2) {
            sawPull = msg.result?.kind === 'full' && msg.result?.items?.length === 2
            console.log('PULL_DIAG:', msg.result?.items?.length, 'item(s)')
        } else if (msg.id === 3) {
            const edits = msg.result || []
            sawFormat = edits.length === 1 && edits[0].newText.includes('\n    ')
            console.log('FORMAT:', edits.length, 'edit(s), newText head:', JSON.stringify(edits[0]?.newText?.slice(0, 40)))
        } else if (msg.id === 1) {
            console.log('INIT_OK caps:', Object.keys(msg.result?.capabilities || {}).join(','))
        }
    }
})

function send(msg) {
    const body = JSON.stringify(msg)
    server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: process.pid, rootUri: null, capabilities: {}, workspaceFolders: null } })
setTimeout(() => send({ jsonrpc: '2.0', method: 'initialized', params: {} }), 300)
setTimeout(() => send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: errUri, languageId: 'cml', version: 1, text: errContent } } }), 600)
setTimeout(() => send({ jsonrpc: '2.0', id: 2, method: 'textDocument/diagnostic', params: { textDocument: { uri: errUri } } }), 1500)
setTimeout(() => send({ jsonrpc: '2.0', id: 3, method: 'textDocument/formatting', params: { textDocument: { uri: errUri }, options: { tabSize: 4, insertSpaces: true } } }), 2000)
setTimeout(() => {
    server.kill()
    const ok = sawPull && sawFormat && !sawPush
    console.log(ok ? 'CAMEL_LS_OK' : 'CAMEL_LS_FAILED')
    process.exit(ok ? 0 : 1)
}, 5000)
