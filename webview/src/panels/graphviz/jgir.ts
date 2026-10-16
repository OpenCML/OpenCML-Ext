// GIR interchange v1 -> semantic display model and generated layout-only DOT.
// Node kinds, edge classes and graph references come from fields, never display labels.
import type { DotGraph, DotSubgraph, DotAttrMap } from './dot'

interface Position { line: number; character: number }
interface GirNode {
    id: string; kind: string; label: string; outputType: string | null
    origin?: string; source?: { file: string; start: Position; end: Position }
    parameter?: { name: string; kind: string; index: number }
    callee?: string | null; loop?: { kind: string; condition: string | null; body: string }
    roles?: string[]; numeric?: string
}
interface GirGraph {
    id: string; name: string; signature: string; dependencies: string[]
    nodes: GirNode[]; edges: { source: string; target: string; kind: string; sourceIndex: number; targetIndex: number }[]
    normalPorts: string[]; contextPorts: string[]; capturePorts: string[]; exit: string
}
export interface GirDocument { format: 'camel.gir'; version: 1; root: string; graphs: GirGraph[] }

function requireField(ok: unknown, message: string): asserts ok {
    if (!ok) throw new Error(`Invalid GIR JSON: ${message}`)
}
const index = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0
const text = (v: unknown): v is string => typeof v === 'string'
const kinds = new Set(['DATA', 'PORT', 'OPER', 'FUNC', 'CALL', 'FILL', 'ACCS', 'CAST', 'COPY', 'BRCH', 'JOIN', 'LOOP', 'GATE', 'SYNC'])

export function parseGirJson(raw: string): { graph: DotGraph; dot: string; document: GirDocument } {
    const data = JSON.parse(raw) as GirDocument
    requireField(data?.format === 'camel.gir' && data.version === 1, 'unsupported format/version')
    requireField(Array.isArray(data.graphs) && data.graphs.length > 0, 'missing graphs')
    const graphs = new Map<string, GirGraph>(), nodes = new Set<string>()
    for (const g of data.graphs) {
        requireField(g && text(g.id) && !graphs.has(g.id) && text(g.name) && text(g.signature), 'duplicate or invalid graph')
        requireField(Array.isArray(g.nodes) && Array.isArray(g.edges) && Array.isArray(g.dependencies), 'graph arrays')
        graphs.set(g.id, g)
        for (const n of g.nodes) {
            requireField(n && text(n.id) && !nodes.has(n.id) && kinds.has(n.kind) && text(n.label), 'duplicate or invalid node')
            requireField(n.outputType === null || text(n.outputType), 'output type')
            nodes.add(n.id)
        }
    }
    requireField(graphs.has(data.root), 'root graph')
    const scopes = new Map<string, string>(), children = new Map<string, string[]>()
    const visit = (id: string, scope: string) => {
        if (scopes.has(id)) return
        const g = graphs.get(id)
        requireField(g, `unknown graph ${id}`)
        scopes.set(id, scope); children.set(id, [])
        for (const dep of g.dependencies) {
            requireField(graphs.has(dep), `unknown dependency ${dep}`)
            if (scopes.has(dep)) continue
            children.get(id)!.push(dep)
            visit(dep, scope ? `${scope}/cluster_${dep}` : `cluster_${dep}`)
        }
    }
    visit(data.root, '')
    requireField(scopes.size === graphs.size, 'unreachable graph')
    const attrsOf = (n: GirNode): DotAttrMap => {
        const attrs: DotAttrMap = { label: n.label, type: n.kind, jgir: '1' }
        if (n.outputType !== null) attrs.value_type = n.outputType
        if (n.origin !== undefined) {
            requireField(text(n.origin) && /^\d+$/.test(n.origin), 'origin identity')
            attrs.origin = n.origin
        }
        if (n.source) {
            const s = n.source
            requireField(text(s.file) && s.start && s.end && [s.start.line, s.start.character, s.end.line, s.end.character].every(index), 'source range')
            requireField(s.end.line > s.start.line || s.end.line === s.start.line && s.end.character >= s.start.character, 'reversed source range')
            attrs.srcfile = s.file; attrs.span = `${s.start.line}:${s.start.character}-${s.end.line}:${s.end.character}`
        }
        if (n.parameter) {
            requireField(text(n.parameter.name) && ['normal', 'with', 'capture'].includes(n.parameter.kind) && index(n.parameter.index), 'parameter')
            attrs.param_name = n.parameter.name; attrs.param_kind = n.parameter.kind; attrs.param_index = String(n.parameter.index)
        }
        if (n.callee != null) {
            requireField(scopes.has(n.callee), 'callee graph')
            attrs.callee_scope = scopes.get(n.callee)!
            if (n.kind === 'DATA') {
                attrs.function_value = '1'
                attrs.function_name = graphs.get(n.callee)!.name
            }
        }
        if (n.loop) {
            requireField(['while', 'for', 'for-while'].includes(n.loop.kind) && scopes.has(n.loop.body), 'loop body')
            attrs.loop_kind = n.loop.kind; attrs.loop_body = scopes.get(n.loop.body)!
            if (n.loop.condition !== null) {
                requireField(scopes.has(n.loop.condition), 'loop condition')
                attrs.loop_condition = scopes.get(n.loop.condition)!
            }
        }
        if (n.roles) { requireField(Array.isArray(n.roles) && n.roles.every(text), 'roles'); attrs.role = n.roles.join(';') }
        if (n.numeric) { requireField(text(n.numeric), 'numeric permissions'); attrs.numeric = n.numeric }
        return attrs
    }
    const build = (id: string): DotSubgraph => {
        const g = graphs.get(id)!, local = new Set(g.nodes.map(n => n.id))
        const inputId = `__gir_inputs_${id}`, outputId = `__gir_output_${id}`
        requireField(!nodes.has(inputId) && !nodes.has(outputId) && local.has(g.exit), 'graph boundaries')
        const sub: DotSubgraph = { id: id === data.root ? 'GraphIR' : `cluster_${id}`, attrs: { label: g.name, tooltip: g.signature },
            nodes: g.nodes.map(n => ({ id: n.id, attrs: attrsOf(n) })), edges: [], subgraphs: children.get(id)!.map(build) }
        let hasInputs = false
        for (const [ports, kind] of [[g.normalPorts, 'NORM_PORT'], [g.contextPorts, 'WITH_PORT'], [g.capturePorts, 'WITH_PORT']] as const) {
            requireField(Array.isArray(ports) && new Set(ports).size === ports.length, 'port list')
            ports.forEach((port, i) => {
                requireField(local.has(port) && g.nodes.find(n => n.id === port)?.kind === 'PORT', 'port node')
                sub.edges.push({ from: inputId, to: port, attrs: { type: kind, label: String(i) } }); hasInputs = true
            })
        }
        if (hasInputs) sub.nodes.push({ id: inputId, attrs: { label: 'ARGS', type: 'ARGS' } })
        sub.nodes.push({ id: outputId, attrs: { label: 'EXIT', type: 'EXIT' } })
        sub.edges.push({ from: g.exit, to: outputId, attrs: { type: 'EXIT', label: '0' } })
        for (const e of g.edges) {
            requireField(local.has(e.source) && local.has(e.target) && ['normal', 'context', 'control'].includes(e.kind) && index(e.sourceIndex) && index(e.targetIndex), 'edge endpoints/kind/indices')
            sub.edges.push({ from: e.source, to: e.target, attrs: { type: ({ normal: 'NORM', context: 'WITH', control: 'CTRL' } as Record<string, string>)[e.kind], label: `${e.sourceIndex}|${e.targetIndex}` } })
        }
        return sub
    }
    const graph = build(data.root) as DotGraph
    const quoted = (s: string) => JSON.stringify(s)
    const attributes = (attrs: DotAttrMap) => Object.entries(attrs).map(([k, v]) => `${k}=${quoted(v)}`).join(', ')
    const emit = (g: DotSubgraph, root = false): string => `${root ? 'digraph GraphIR' : `subgraph ${quoted(g.id!)}`} {\n`
        + (root ? '' : `label=${quoted(g.attrs.label || '')};\n`)
        + g.subgraphs.map(child => emit(child)).join('')
        + g.nodes.map(n => `${quoted(n.id)} [${attributes(n.attrs.function_value === '1' ? { ...n.attrs, label: n.attrs.function_name, fixedsize: 'true', width: String(Math.max(104, Math.min(220, n.attrs.function_name.length * 7 + 32)) / 72), height: String(44 / 72) } : n.attrs)}];\n`).join('')
        + g.edges.map(e => `${quoted(e.from)} -> ${quoted(e.to)} [${attributes(e.attrs)}];\n`).join('') + '}\n'
    return { graph, dot: emit(graph, true), document: data }
}
