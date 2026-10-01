// Map a parsed DOT graph + a graphviz JSON layout onto Vue Flow nodes/edges.
// Clusters become background box nodes (not parents), members stay absolute.
import type { DotGraph, DotSubgraph } from './dot'

export interface FlowNode {
    id: string
    position: { x: number; y: number }
    type: 'gir' | 'cluster'
    data: {
        label: string
        nodeType: string
        role?: string
        attrs: Record<string, string>
        width: number
        height: number
    }
}

export interface FlowEdge {
    id: string
    source: string
    target: string
    label?: string
    edgeType: string
}

export interface FlowModel {
    nodes: FlowNode[]
    edges: FlowEdge[]
}

// graphviz JSON layout output (subset of what `layout(dot, 'json', 'dot')` returns)
interface GvJson {
    bb?: string
    objects?: GvObject[]
}

interface GvObject {
    name: string
    bb?: string
    pos?: string
    width?: string
    height?: string
}

function parseBb(bb: string | undefined): { x0: number; y0: number; x1: number; y1: number } {
    const fallback = { x0: 0, y0: 0, x1: 100, y1: 100 }
    if (!bb) return fallback
    const parts = bb.split(',').map(Number)
    if (parts.length < 4 || parts.some((p) => isNaN(p))) return fallback
    return { x0: parts[0], y0: parts[1], x1: parts[2], y1: parts[3] }
}

function centerOf(obj: GvObject): { x: number; y: number } {
    if (obj.bb) {
        const b = parseBb(obj.bb)
        return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }
    }
    if (obj.pos) {
        const [x, y] = obj.pos.split(',').map(Number)
        return { x, y }
    }
    return { x: 0, y: 0 }
}

function sizeOf(obj: GvObject): { width: number; height: number } {
    if (obj.bb) {
        const b = parseBb(obj.bb)
        return { width: Math.max(40, b.x1 - b.x0), height: Math.max(30, b.y1 - b.y0) }
    }
    // node width/height come in inches; convert to points
    const w = Number(obj.width)
    const h = Number(obj.height)
    if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
        return { width: Math.max(40, w * 72), height: Math.max(30, h * 72) }
    }
    return { width: 80, height: 40 }
}

export function buildFlowModel(dot: DotGraph, gv: GvJson): FlowModel {
    const bb = parseBb(gv.bb)
    // graphviz y axis grows upward; Vue Flow grows downward
    const flip = (y: number) => bb.y1 - y

    const nodes: FlowNode[] = []
    const edges: FlowEdge[] = []
    const nodeIds = new Set<string>()

    const gvFind = (name: string): GvObject | undefined => (gv.objects ?? []).find((o) => o.name === name)

    // Vue Flow anchors nodes at their top-left corner
    const topLeft = (c: { x: number; y: number }, s: { width: number; height: number }) => ({
        x: c.x - s.width / 2,
        y: c.y - s.height / 2
    })

    const walk = (sub: DotSubgraph, scope: string) => {
        for (const child of sub.subgraphs) {
            const childScope = scope ? `${scope}/${child.id ?? 'cluster'}` : (child.id ?? 'cluster')
            const gvCluster = gvFind(child.id ?? '')
            const c = gvCluster ? centerOf(gvCluster) : { x: 0, y: 0 }
            const s = gvCluster ? sizeOf(gvCluster) : { width: 200, height: 150 }
            nodes.push({
                id: childScope,
                position: topLeft({ x: c.x, y: flip(c.y) }, s),
                type: 'cluster',
                data: {
                    label: child.attrs.label ?? child.id ?? 'cluster',
                    nodeType: 'cluster',
                    attrs: child.attrs,
                    width: s.width,
                    height: s.height
                }
            })
            walk(child, childScope)
        }

        for (const node of sub.nodes) {
            const key = scope ? `${scope}/${node.id}` : node.id
            const gvObj = gvFind(node.id)
            const c = gvObj ? centerOf(gvObj) : { x: 0, y: 0 }
            const s = gvObj ? sizeOf(gvObj) : { width: 80, height: 40 }
            nodeIds.add(key)
            nodes.push({
                id: key,
                position: topLeft({ x: c.x, y: flip(c.y) }, s),
                type: 'gir',
                data: {
                    label: node.attrs.label ?? node.id,
                    nodeType: node.attrs.type ?? 'NODE',
                    role: node.attrs.role,
                    attrs: node.attrs,
                    width: Math.min(s.width, 220),
                    height: Math.min(s.height, 80)
                }
            })
        }

        for (const edge of sub.edges) {
            const src = scope ? `${scope}/${edge.from}` : edge.from
            const dst = scope ? `${scope}/${edge.to}` : edge.to
            if (!nodeIds.has(src) || !nodeIds.has(dst)) continue
            edges.push({
                id: `${src}->${dst}#${edges.length}`,
                source: src,
                target: dst,
                label: edge.attrs.label,
                edgeType: edge.attrs.type ?? ''
            })
        }
    }

    walk(dot, '')

    // clusters first so they render below member nodes
    nodes.sort((a, b) => (a.type === b.type ? 0 : a.type === 'cluster' ? -1 : 1))

    return { nodes, edges }
}
