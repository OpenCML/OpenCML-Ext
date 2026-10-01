// Debug: full LSP session against dist/server/server.cjs — initialize, didOpen
// err.cml, then pull textDocument/diagnostic, printing every server message.
import { spawn } from 'child_process'
import fs from 'fs'

const server = spawn(process.execPath, ['dist/server/server.cjs', '--stdio'], {
    stdio: ['pipe', 'pipe', 'inherit']
})

const errContent = fs.readFileSync('test/test/err.cml', 'utf8')
const errUri = 'file:///D:/Projects/OpenCML-Ext/test/test/err.cml'

let buffer = Buffer.alloc(0)
server.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n')
        if (headerEnd === -1) return
        const header = buffer.slice(0, headerEnd).toString()
        const m = /Content-Length: (\d+)/i.exec(header)
        if (!m) return
        const len = parseInt(m[1], 10)
        if (buffer.length < headerEnd + 4 + len) return
        const body = buffer.slice(headerEnd + 4, headerEnd + 4 + len).toString()
        buffer = buffer.slice(headerEnd + 4 + len)
        const msg = JSON.parse(body)
        console.log('SERVER>>', JSON.stringify(msg).slice(0, 300))
        // answer the server's configuration pull so it picks up the camel path
        if (msg.method === 'workspace/configuration' && Array.isArray(msg.params?.items)) {
            const results = msg.params.items.map((item) =>
                item.section === 'opencmlLanguageServer'
                    ? { camelPath: process.env.CAMEL_EXE_PATH || 'D:/Projects/Camel/out/latest/bin/camel.exe' }
                    : null
            )
            send({ jsonrpc: '2.0', id: msg.id, result: results })
        }
    }
})

function send(msg) {
    const body = JSON.stringify(msg)
    server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}

send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { processId: process.pid, rootUri: null, capabilities: {}, workspaceFolders: null }
})
setTimeout(() => send({ jsonrpc: '2.0', method: 'initialized', params: {} }), 500)
setTimeout(
    () =>
        send({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: { textDocument: { uri: errUri, languageId: 'cml', version: 1, text: errContent } }
        }),
    1000
)
setTimeout(
    () =>
        send({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/diagnostic',
            params: { textDocument: { uri: errUri } }
        }),
    2000
)
setTimeout(
    () =>
        send({
            jsonrpc: '2.0',
            id: 3,
            method: 'textDocument/formatting',
            params: { textDocument: { uri: errUri }, options: { tabSize: 4, insertSpaces: true } }
        }),
    2500
)
setTimeout(() => process.exit(0), 8000)
