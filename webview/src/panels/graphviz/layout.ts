// Map a parsed DOT graph + a graphviz JSON layout onto Vue Flow nodes/edges.
// Clusters become background box nodes (not parents), members stay absolute.
import type { DotGraph, DotSubgraph } from './dot'
import { loopDetails, type LoopDetails } from './loops'

export interface FlowNode {
    id: string
    position: { x: number; y: number }
    type: 'gir' | 'cluster'
    data: {
        label: string
        nodeType: string
        role?: string
        enterScope?: string
        loop?: LoopDetails
        collapsed?: boolean
        count?: number
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

export function buildFlowModel(dot: DotGraph, gv: GvJson, arrangement: 'original' | 'vertical' = 'original'): FlowModel {
    const bb = parseBb(gv.bb)
    // graphviz y axis grows upward; Vue Flow grows downward
    const flip = (y: number) => bb.y1 - y

    const nodes: FlowNode[] = []
    const edges: FlowEdge[] = []
    const nodeIds = new Set<string>()
    const pendingEdges: { scope: string; edge: DotSubgraph["edges"][number] }[] = []

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
            const measured = gvObj ? sizeOf(gvObj) : { width: 80, height: 40 }
            // Graphviz positions are centers. Apply display limits before converting
            // to top-left, otherwise long labels shift the node and its edge handles.
            const s = { width: Math.min(measured.width, 220), height: Math.min(measured.height, 80) }
            if (node.attrs.type === 'ARGS' || node.attrs.type === 'EXIT') {
                s.width = 64
                s.height = 24
            }
            if (node.attrs.type === 'LOOP') { s.width = 180; s.height = 80 }
            nodeIds.add(key)
            nodes.push({
                id: key,
                position: topLeft({ x: c.x, y: flip(c.y) }, s),
                type: 'gir',
                data: {
                    label: (node.attrs.type === 'PORT' || node.attrs.type === 'CLOSURE_PORT')
                        ? node.attrs.param_name || node.attrs.label || node.id
                        : node.attrs.type === 'FILL' ? node.attrs.value_type || node.attrs.label || node.id
                        : node.attrs.label ?? node.id,
                    nodeType: node.attrs.type ?? 'NODE',
                    role: node.attrs.role,
                    attrs: node.attrs,
                    width: s.width,
                    height: s.height
                }
            })
        }

        for (const edge of sub.edges) pendingEdges.push({ scope, edge })
    }

    walk(dot, '')
    const resolveNode = (scope: string, id: string) => {
        const scoped = scope ? `${scope}/${id}` : id
        if (nodeIds.has(scoped)) return scoped
        const matches = [...nodeIds].filter(key => key === id || key.endsWith('/' + id))
        return matches.length === 1 ? matches[0] : undefined
    }
    for (const { scope, edge } of pendingEdges) {
        const source = resolveNode(scope, edge.from), target = resolveNode(scope, edge.to)
        if (!source || !target) continue
        edges.push({ id: `${source}->${target}#${edges.length}`, source, target, label: edge.attrs.label, edgeType: edge.attrs.type ?? '' })
    }

    for (const node of nodes) {
        const loop = loopDetails({ nodes, edges }, node)
        if (loop) node.data.loop = loop
    }
    if (arrangement === 'vertical') stackGraphs(dot, nodes)

    // clusters first so they render below member nodes
    nodes.sort((a, b) => (a.type === b.type ? 0 : a.type === 'cluster' ? -1 : 1))

    return { nodes, edges }
}

// Only stack module-level graphs. Each complete function subtree moves as a
// single unit, preserving Graphviz's internal positions and container sizes.
function stackGraphs(dot: DotGraph, nodes: FlowNode[]) {
    const groups = dot.subgraphs.map(child => {
        const id = child.id ?? 'cluster'
        return nodes.filter(node => node.id === id || node.id.startsWith(id + '/'))
    })
    const local = nodes.filter(node => !node.id.includes('/') && node.type !== 'cluster')
    if (local.length) groups.push(local)
    const content = groups.filter(group => group.length)
    const bounds = (group: FlowNode[]) => {
        const x = Math.min(...group.map(n => n.position.x))
        const y = Math.min(...group.map(n => n.position.y))
        return { x, y, width: Math.max(...group.map(n => n.position.x + n.data.width)) - x,
            height: Math.max(...group.map(n => n.position.y + n.data.height)) - y }
    }
    const width = Math.max(0, ...content.map(group => bounds(group).width))
    let y = 0
    for (const group of content) {
        const box = bounds(group)
        for (const node of group) node.position = {
            x: node.position.x + (width - box.width) / 2 - box.x,
            y: node.position.y + y - box.y
        }
        y += box.height + 48
    }
}
