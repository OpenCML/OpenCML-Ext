export interface Link { id: string; source: string; target: string }

export function neighbors(id: string, edges: Link[], direction: 'both' | 'up' | 'down', depth: number) {
    const connected = new Set<string>()
    const walk = (up: boolean) => {
        const found = new Set<string>([id])
        let frontier = new Set([id])
        for (let step = 0; step < depth; step++) {
            const next = new Set<string>()
            for (const edge of edges) {
                const from = up ? edge.target : edge.source, to = up ? edge.source : edge.target
                if (!frontier.has(from)) continue
                connected.add(edge.id)
                if (!found.has(to)) { found.add(to); next.add(to) }
            }
            frontier = next
        }
        found.delete(id)
        return found
    }
    return { id, upstream: direction === 'down' ? new Set<string>() : walk(true),
        downstream: direction === 'up' ? new Set<string>() : walk(false), connected }
}
