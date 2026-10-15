import { spawn } from 'node:child_process'
export class LspClient {
    constructor(command, args, configuration = {}) {
        this.proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
        this.pending = new Map()
        this.nextId = 0
        this.buffer = Buffer.alloc(0)
        this.notifications = []
        this.stderr = ''
        this.proc.stderr.on('data', data => { this.stderr += data })
        this.proc.on('error', error => this.fail(error))
        this.proc.on('exit', code => this.fail(new Error(`LSP exited ${code}: ${this.stderr}`)))
        this.proc.stdin.on('error', error => this.fail(error))
        this.proc.stdout.on('data', data => {
            this.buffer = Buffer.concat([this.buffer, data])
            while (true) {
                const end = this.buffer.indexOf('\r\n\r\n')
                if (end < 0) return
                const match = /Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, end).toString())
                if (!match) { this.fail(new Error('Invalid LSP frame')); return }
                const length = Number(match[1])
                if (this.buffer.length < end + 4 + length) return
                const msg = JSON.parse(this.buffer.subarray(end + 4, end + 4 + length).toString())
                this.buffer = this.buffer.subarray(end + 4 + length)
                if (msg.method && msg.id !== undefined) {
                    this.send({ id: msg.id, result: msg.method === 'workspace/configuration' ? msg.params.items.map(() => configuration) : null })
                } else if (msg.id !== undefined) {
                    const waiter = this.pending.get(msg.id)
                    if (waiter) {
                        this.pending.delete(msg.id)
                        clearTimeout(waiter.timer)
                        if (msg.error) waiter.reject(new Error(JSON.stringify(msg.error)))
                        else waiter.resolve(msg.result)
                    }
                } else this.notifications.push(msg)
            }
        })
    }
    fail(error) { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error) } this.pending.clear() }
    send(message) { const body = JSON.stringify({ jsonrpc: '2.0', ...message }); this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`) }
    notify(method, params) { this.send({ method, params }) }
    request(method, params) {
        const id = ++this.nextId
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout: ${method} ${this.stderr}`)) }, 15000)
            this.pending.set(id, { resolve, reject, timer })
            this.send({ id, method, params })
        })
    }
    async close() {
        try { await this.request('shutdown', null); this.notify('exit', null) }
        finally { this.proc.kill() }
    }
}
