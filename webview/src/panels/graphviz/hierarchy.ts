import { t } from '../../../../client/src/localization'
import type { FlowModel, FlowNode } from './layout'
import { resolveGraphName } from './loops'

export function parentScope(id: string): string { return id.slice(0, Math.max(0, id.lastIndexOf('/'))) }

// Names are a fallback for DOT, which currently exposes no stable callee ID.
// Resolve only unambiguous references; never guess among duplicate graph names.
export function graphTarget(model: FlowModel, node: FlowNode): string | undefined {
    if (node.type !== 'gir') return undefined
    if (node.data.attrs.jgir) return node.data.attrs.callee_scope
    const name = node.data.nodeType === 'FUNC' ? node.data.label : node.data.nodeType === 'DATA'
        ? /^Function\(graph=([^,]+), tupleSlots=/.exec(node.data.label)?.[1] : undefined
    if (!name) return undefined
    return resolveGraphName(model, node, name)
}

export function moduleEntries(model: FlowModel): Set<string> {
    const result = new Set<string>()
    for (const node of model.nodes) {
        if (parentScope(node.id) || node.data.nodeType !== 'DATA') continue
        const target = graphTarget(model, node)
        if (target && model.edges.some(e => e.source === node.id && model.nodes.some(n => n.id === e.target && n.data.nodeType === 'CALL'))) result.add(target)
    }
    return result
}

/** Enter only a main graph reached by an actual module-level function-value call.
 * A library graph named main, an unrelated call or ambiguous entries are not sufficient. */
export function initialScope(model: FlowModel): string {
    const entries = [...moduleEntries(model)].filter(id => {
        const graph = model.nodes.find(n => n.type === 'cluster' && n.id === id)
        return graph && /(?:^|::)main$/.test(graph.data.label)
    })
    return entries.length === 1 ? entries[0] : ''
}

// Collapse descendants into cards without changing stable node/edge identities.
export function focusGraph(model: FlowModel, scope: string, compactModule = false): FlowModel {
    const direct = model.nodes.filter(n => parentScope(n.id) === scope)
    const children = direct.filter(n => n.type === 'cluster')
    const references = new Map<string, string[]>()
    for (const node of direct) {
        const target = graphTarget(model, node)
        const targets = node.data.loop
            ? [node.data.loop.condition?.scope, node.data.loop.body?.scope].filter((s): s is string => !!s)
            : target ? [target] : []
        if (targets.length) references.set(node.id, targets)
    }
    const referenced = new Set([...references.values()].flat())
    const cards = children.filter(n => !referenced.has(n.id) && !(compactModule && !scope)).map(n => ({ ...n,
        position: { x: 0, y: 0 }, data: { ...n.data, collapsed: true, width: 220, height: 76,
            count: model.nodes.filter(child => child.type === 'gir' && child.id.startsWith(n.id + '/')).length } }))
    const local = direct.filter(n => n.type !== 'cluster').map(n => ({ ...n, position: { ...n.position }, data: { ...n.data, enterScope: n.data.loop ? n.data.loop.body?.scope : references.get(n.id)?.[0] } }))
    const left = Math.min(...local.map(n => n.position.x))
    const top = Math.min(...local.map(n => n.position.y))
    const localWidth = local.length ? Math.max(...local.map(n => n.position.x + n.data.width)) - left : 0
    const cardWidth = cards.length ? (scope ? cards.length * 244 - 24 : 220) : 0
    const width = Math.max(cardWidth, localWidth)
    const cardHeight = scope ? (cards.length ? 100 : 0) : cards.length * 100
    cards.forEach((card, index) => { card.position = { x: scope ? (width - cardWidth) / 2 + index * 244 : (width - 220) / 2, y: scope ? 0 : index * 100 } })
    for (const node of local) node.position = { x: node.position.x - left + (width - localWidth) / 2, y: node.position.y - top + cardHeight }
    const nodes: FlowNode[] = [...cards, ...local]
    const visible = new Set(nodes.map(n => n.id))
    const project = (id: string) => {
        if (visible.has(id)) return id
        const child = children.find(child => id.startsWith(child.id + '/'))
        if (!child) return undefined
        return cards.find(card => card.id === child.id)?.id ?? [...references].find(([, targets]) => targets.includes(child.id))?.[0]
    }
    const right = Math.max(0, ...nodes.map(n => n.position.x + n.data.width))
    const boundary = new Map<string, string>()
    const boundaryNode = (id: string, incoming: boolean) => {
        if (boundary.has(id)) return boundary.get(id)!
        const original = model.nodes.find(n => n.id === id)
        const key = `boundary:${id}`
        boundary.set(id, key)
        nodes.push({ id: key, type: 'gir', position: { x: incoming ? -260 : right + 60, y: (boundary.size - 1) * 100 },
            data: { label: original?.data.label ?? id, nodeType: incoming ? t("External input") : t("External output"), attrs: {}, width: 200, height: 60 } })
        return key
    }
    const edges: FlowModel['edges'] = []
    for (const edge of model.edges) {
        let source = project(edge.source), target = project(edge.target)
        if (!source && !target || source && source === target && (edge.source !== edge.target || source !== edge.source)) continue
        if (!source) source = boundaryNode(edge.source, true)
        if (!target) target = boundaryNode(edge.target, false)
        edges.push({ ...edge, source, target })
    }
    return { nodes, edges }
}
