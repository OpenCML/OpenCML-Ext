import { t } from '../../../../client/src/localization'
import type { FlowModel, FlowNode } from './layout'
import type { DotGraph, DotSubgraph } from './dot'

export interface GraphLink { name: string; scope?: string }
export interface LoopBinding { name: string; value?: string; type?: string }
export interface LoopDetails {
    kind: string
    condition?: GraphLink
    body?: GraphLink
    states: LoopBinding[]
    captures: LoopBinding[]
    iterable?: LoopBinding
}

const parent = (id: string) => id.slice(0, Math.max(0, id.lastIndexOf('/')))

// A name is usable only if unique in the caller's scope, or unique globally.
export function resolveGraphName(model: FlowModel, node: FlowNode, name: string): string | undefined {
    const matches = model.nodes.filter(n => n.type === 'cluster' && n.data.label === name)
    const local = matches.filter(n => parent(n.id) === parent(node.id))
    return local.length ? local.length === 1 ? local[0].id : undefined : matches.length === 1 ? matches[0].id : undefined
}

export function loopDetails(model: FlowModel, node: FlowNode): LoopDetails | undefined {
    if (node.data.nodeType !== 'LOOP') return undefined
    // Full-styling DOT shortens labels but retains the complete label in its tooltip.
    const label = [node.data.attrs.tooltip, node.data.label].find(text => /^LOOP (while|for(?:-while)?)\b/.test(text || '')) || ''
    const kind = node.data.attrs.loop_kind || /^LOOP (while|for-while|for)\b/.exec(label)?.[1] || 'loop'
    const link = (role: string): GraphLink | undefined => {
        if (node.data.attrs.jgir) {
            const scope = node.data.attrs[role === 'body' ? 'loop_body' : 'loop_condition']
            const graph = model.nodes.find(n => n.type === 'cluster' && n.id === scope)
            return graph ? { name: graph.data.label, scope } : undefined
        }
        const name = new RegExp(`\\b${role}=([^\\s]+)`).exec(label)?.[1]
        return name ? { name, scope: resolveGraphName(model, node, name) } : undefined
    }
    const body = link('body'), condition = link('cond')
    const ports = body?.scope ? model.nodes.filter(n => parent(n.id) === body.scope && n.type === 'gir' && ['PORT', 'CLOSURE_PORT'].includes(n.data.nodeType)) : []
    const ordered = (kinds: string[]) => ports.filter(n => kinds.includes(n.data.attrs.param_kind)).sort((a, b) => Number(a.data.attrs.param_index) - Number(b.data.attrs.param_index))
    const input = (kinds: string[], index: number): string | undefined => {
        const edge = model.edges.find(e => e.target === node.id && kinds.includes(e.edgeType) && e.label !== undefined && Number(e.label.split('|').pop()) === index)
        return edge ? model.nodes.find(n => n.id === edge.source)?.data.label : undefined
    }
    const binding = (p: FlowNode, value?: string): LoopBinding => ({ name: p.data.attrs.param_name || p.data.label, type: p.data.attrs.value_type, value })
    const normal = ordered(['normal'])
    const forLoop = kind === 'for' || kind === 'for-while'
    const offset = forLoop ? 1 : 0
    return {
        kind, condition, body,
        states: normal.slice(offset).map((p, i) => binding(p, input(['NORM', 'NORM_PORT'], offset + i))),
        captures: ordered(['capture', 'with']).map((p, i) => binding(p, input(['WITH', 'WITH_PORT'], i))),
        iterable: forLoop && normal[0] ? binding(normal[0], input(['NORM', 'NORM_PORT'], 0)) : undefined
    }
}

// Reserve display geometry while keeping the raw DOT intact.
export function loopLayoutDot(raw: string, dot: DotGraph): string {
    const overrides: string[] = []
    const walk = (sub: DotSubgraph) => {
        for (const node of sub.nodes) {
            if (node.attrs.type === 'LOOP') overrides.push(`${JSON.stringify(node.id)} [label="", fixedsize=true, width=${148 / 72}, height=${56 / 72}];`)
            if (['BRCH', 'JOIN', 'GATE'].includes(node.attrs.type)) overrides.push(`${JSON.stringify(node.id)} [label="", shape=box, fixedsize=true, width=${80 / 72}, height=${40 / 72}];`)
        }
        sub.subgraphs.forEach(walk)
    }
    walk(dot)
    return overrides.length ? raw.replace(/}\s*$/, overrides.join('\n') + '\n}') : raw
}

export function loopScope(model: FlowModel, scope: string): { loop: FlowNode; role: 'condition' | 'body'; details: LoopDetails } | undefined {
    for (const node of model.nodes) {
        const details = node.data.loop
        if (!details) continue
        if (details.condition?.scope === scope) return { loop: node, role: 'condition', details }
        if (details.body?.scope === scope) return { loop: node, role: 'body', details }
    }
}

export function loopLabel(details: LoopDetails): string {
    return details.kind === 'for-while' ? 'LOOP for · while' : details.kind === 'loop' ? 'LOOP' : `LOOP ${details.kind}`
}

export function stateLabel(details: LoopDetails): string {
    return details.states.length ? details.states.map(s => s.name).join(', ') : t('Loop state')
}
