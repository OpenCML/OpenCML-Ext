// Minimal JSON HTTP client for the camel-db API (127.0.0.1 only).
import * as http from 'http'

function request(port: number, method: string, path: string, body?: unknown, timeoutMs = 3000): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const data = body === undefined ? null : Buffer.from(JSON.stringify(body))
        const req = http.request(
            {
                host: '127.0.0.1',
                port,
                path,
                method,
                headers: data
                    ? { 'Content-Type': 'application/json', 'Content-Length': data.length }
                    : {},
                timeout: timeoutMs
            },
            (res) => {
                const chunks: Buffer[] = []
                res.on('data', (c: Buffer) => chunks.push(c))
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString()
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`camel-db ${method} ${path} -> ${res.statusCode}: ${text.slice(0, 200)}`))
                        return
                    }
                    try {
                        resolve(text ? JSON.parse(text) : {})
                    } catch {
                        resolve(text)
                    }
                })
            }
        )
        req.on('timeout', () => req.destroy(new Error(`timeout calling camel-db ${method} ${path}`)))
        req.on('error', reject)
        if (data) {
            req.write(data)
        }
        req.end()
    })
}

export function apiGet(port: number, path: string): Promise<any> {
    return request(port, 'GET', path)
}

export function apiPost(port: number, path: string, body?: unknown): Promise<any> {
    return request(port, 'POST', path, body ?? {})
}
