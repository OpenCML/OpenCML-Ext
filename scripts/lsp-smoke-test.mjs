// Quick LSP smoke test: spawn the built server over stdio and send initialize.
import { spawn } from 'child_process'

const server = spawn(process.execPath, ['dist/server/server.cjs', '--stdio'], {
    stdio: ['pipe', 'pipe', 'inherit']
})

let buffer = Buffer.alloc(0)
let gotResponse = false

server.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n')
        if (headerEnd === -1) return
        const header = buffer.slice(0, headerEnd).toString()
        const match = /Content-Length: (\d+)/i.exec(header)
        if (!match) return
        const len = parseInt(match[1], 10)
        if (buffer.length < headerEnd + 4 + len) return
        const body = buffer.slice(headerEnd + 4, headerEnd + 4 + len).toString()
        buffer = buffer.slice(headerEnd + 4 + len)
        const msg = JSON.parse(body)
        if (msg.id === 1) {
            gotResponse = true
            console.log('initialize response capabilities:', JSON.stringify(msg.result?.capabilities, null, 2))
            server.kill()
            process.exit(msg.result?.capabilities ? 0 : 1)
        }
    }
})

function send(msg) {
    const body = JSON.stringify(msg)
    server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}

server.on('exit', (code) => {
    if (!gotResponse) {
        console.error('Server exited before responding, code:', code)
        process.exit(1)
    }
})

send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
        processId: process.pid,
        rootUri: null,
        capabilities: {},
        workspaceFolders: null
    }
})

setTimeout(() => {
    console.error('TIMEOUT: no initialize response within 10s')
    server.kill()
    process.exit(1)
}, 10000)
