<script setup lang="ts">
import { t } from '../../../../client/src/localization'

import { onMounted, onUnmounted, ref, computed, nextTick, watch, provide } from 'vue'
import { VueFlow, useVueFlow, MarkerType, type Node, type Edge, type NodeTypesObject } from '@vue-flow/core'
import { Graphviz } from '@hpcc-js/wasm/graphviz'
import { parseDot, isDotGraph } from './dot'
import { buildFlowModel, type FlowNode, type FlowEdge } from './layout'
import { neighbors } from './explore'
import { focusGraph, parentScope, moduleEntries } from './hierarchy'
import { loopLayoutDot, loopScope, loopLabel, stateLabel } from './loops'
import GirNode from './components/GirNode.vue'
import GirCluster from './components/GirCluster.vue'
import PanelIcon from './components/PanelIcon.vue'

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): { view?: string; arrangement?: string; browsing?: string } | undefined; setState(state: unknown): void }
const vscode = acquireVsCodeApi()
const { fitView, zoomIn, zoomOut, viewport, setViewport } = useVueFlow()
const showOptions = ref(false)
const copied = ref(false)
let nodeClickTimer: ReturnType<typeof setTimeout> | undefined
let copyTimer: ReturnType<typeof setTimeout> | undefined

interface RenderMessage {
    command: 'render'
    dot: string | null
    fileUri?: string
    fileName?: string
    pass?: string
    error?: string
}

interface PassGraphEntry {
    index: number
    pass: string | null
}

interface PassGraphMessage {
    command: 'passGraph'
    index: number
    pass: string | null
    dot: string | null
    error?: string
}

const nodeTypes: NodeTypesObject = {
    gir: GirNode as unknown as NodeTypesObject[string],
    cluster: GirCluster as unknown as NodeTypesObject[string]
}

const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])
const hoveredNode = ref<string | null>(null)
const lockedNode = ref<string | null>(null)
const direction = ref<'both' | 'up' | 'down'>('both')
const depth = ref(1)
const edgeFilters = ref<Record<string, boolean>>({ norm: true, with: true, ctrl: true })
const hideFiltered = ref(false)
const edgeLabels = ref('onHover')
const hoverNeighborhood = ref('both')
const rememberViewport = ref(true)
const filtering = computed(() => Object.values(edgeFilters.value).some(enabled => !enabled))
const edgeEnabled = (edge: Edge) => edgeFilters.value[edge.data?.kind] !== false
const neighborhood = computed(() => {
    const id = lockedNode.value ?? hoveredNode.value
    if (!id || (!lockedNode.value && hoverNeighborhood.value === 'off') || !nodes.value.some(n => n.id === id)) return null
    return neighbors(id, edges.value.filter(edgeEnabled), lockedNode.value ? direction.value : hoverNeighborhood.value === 'upstream' ? 'up' : hoverNeighborhood.value === 'downstream' ? 'down' : 'both', lockedNode.value ? depth.value : 1)
})
const searchOpen = ref(false)
const searchQuery = ref('')
const searchIndex = ref(-1)
const searchInput = ref<HTMLInputElement | null>(null)
const searchHighlight = ref<string | null>(null)
let highlightTimer: ReturnType<typeof setTimeout> | undefined
const visibleNodes = computed(() => nodes.value.map(node => {
    const near = neighborhood.value
    let relation = ''
    if (near) {
        if (node.id === near.id) relation = 'neighbor-focus'
        else if (near.upstream.has(node.id) && near.downstream.has(node.id)) relation = 'neighbor-both'
        else if (near.upstream.has(node.id)) relation = 'neighbor-upstream'
        else if (near.downstream.has(node.id)) relation = 'neighbor-downstream'
        else if (node.type !== 'cluster' || node.data.collapsed) relation = 'neighbor-muted'
    }
    return { ...node, class: `${relation} ${searchHighlight.value === node.id ? 'search-hit' : ''}` }
}))
const visibleEdges = computed(() => edges.value.map(edge => ({ ...edge,
    hidden: !edgeEnabled(edge) && hideFiltered.value,
    label: edgeEnabled(edge) && (edgeLabels.value === 'always' || edgeLabels.value === 'onHover' && neighborhood.value?.connected.has(edge.id)) ? edge.label : undefined,
    class: `${edge.class ?? ''} ${!edgeEnabled(edge) ? 'filter-muted' : neighborhood.value ? neighborhood.value.connected.has(edge.id) ? 'neighbor-edge' : 'neighbor-muted' : ''}`
})))
function hoverNode(event: { node: Node }) {
    if (event.node.type === 'cluster' && !event.node.data.collapsed) return
    hoveredNode.value = event.node.id
}
const status = ref(t("Waiting for GraphIR…"))
const fileName = ref('')
const pass = ref('std::rgir')
const autoRefresh = ref(true)
const followSource = ref(true)
function toggleFollowSource() { vscode.postMessage({ command: 'followSource', enabled: !followSource.value }) }
const selectedNode = ref<FlowNode['data'] & { id: string } | null>(null)
const useSvgFallback = ref(false)
const svgMarkup = ref('')
const view = ref(vscode.getState()?.view === 'text' ? 'text' : 'graph')
const arrangement = ref<'vertical' | 'original'>(vscode.getState()?.arrangement === 'original' ? 'original' : 'vertical')
const browsing = ref(vscode.getState()?.browsing === 'flat' ? 'flat' : 'hierarchy')
const scope = ref('')
const fullModel = ref<{ nodes: FlowNode[]; edges: FlowEdge[] }>({ nodes: [], edges: [] })
const currentLoopScope = computed(() => browsing.value === 'hierarchy' ? loopScope(fullModel.value, scope.value) : undefined)
provide('gir-open-subgraph', openSubgraph)
const showModuleFunctions = ref(false)
const moduleEntryIds = computed(() => moduleEntries(fullModel.value))
const moduleFunctions = computed(() => fullModel.value.nodes.filter(n => n.type === 'cluster' && !parentScope(n.id)))
const scopeHistory = ref<string[]>([])
const cameras = new Map<string, { x: number; y: number; zoom: number }>()
const selections = new Map<string, typeof selectedNode.value>()
// Keep independent cameras and navigation for each source and GIR pass during this panel session.
let documentKey = ''
const documentViews = new Map<string, { scope: string; history: string[]; cameras: typeof cameras; selections: typeof selections }>()
function saveDocumentView() {
    if (!rememberViewport.value || !documentKey || !fullModel.value.nodes.length) return
    cameras.set(`${browsing.value}:${scope.value}`, { ...viewport.value })
    selections.set(`${browsing.value}:${scope.value}`, selectedNode.value)
    documentViews.delete(documentKey)
    documentViews.set(documentKey, { scope: scope.value, history: [...scopeHistory.value], cameras: new Map(cameras), selections: new Map(selections) })
    if (documentViews.size > 30) documentViews.delete(documentViews.keys().next().value!)
}
function restoreDocumentView() {
    const saved = rememberViewport.value ? documentViews.get(documentKey) : undefined
    if (!saved) return
    const exists = (id: string) => !id || fullModel.value.nodes.some(n => n.type === 'cluster' && n.id === id)
    scope.value = exists(saved.scope) ? saved.scope : ''
    scopeHistory.value = saved.history.filter(exists)
    saved.cameras.forEach((camera, key) => cameras.set(key, camera))
    saved.selections.forEach((selection, key) => selections.set(key, selection))
}
const crumbs = computed(() => {
    const result = [{ id: '', label: t("Module") }]
    let current = ''
    for (const part of scope.value.split('/').filter(Boolean)) {
        current = current ? `${current}/${part}` : part
        result.push({ id: current, label: fullModel.value.nodes.find(n => n.id === current)?.data.label ?? part })
    }
    return result
})
const canvas = ref<HTMLElement | null>(null)
const girText = ref('')
const lineCount = computed(() => girText.value ? girText.value.split('\n').length : 0)
const nodeCount = computed(() => nodes.value.filter(node => node.type !== 'cluster').length)
const errorText = ref('')
const loading = ref(false)
const searchResults = computed(() => {
    const query = searchQuery.value.trim().toLowerCase()
    if (!query) return []
    return fullModel.value.nodes.filter(n => n.type === 'gir' &&
        [n.id, n.data.label, n.data.nodeType].some(value => value.toLowerCase().includes(query)))
})
const searchOrigin = ref<{ scope: string; browsing: string; camera: { x: number; y: number; zoom: number }; selected: typeof selectedNode.value; locked: string | null } | null>(null)
watch(searchQuery, () => { searchIndex.value = -1 })
function openSearch() {
    if (!searchOpen.value) searchOrigin.value = { scope: scope.value, browsing: browsing.value, camera: { ...viewport.value }, selected: selectedNode.value, locked: lockedNode.value }
    searchOpen.value = true
    void nextTick(() => searchInput.value?.focus())
}
function searchPath(id: string) {
    const parts = parentScope(id).split('/').filter(Boolean)
    return [t("Module"), ...parts.map((_, i) => fullModel.value.nodes.find(n => n.id === parts.slice(0, i + 1).join('/'))?.data.label ?? parts[i])].join(' › ')
}
async function locateResult(index: number) {
    const match = searchResults.value[index]
    if (!match) return
    searchIndex.value = index
    if (browsing.value === 'hierarchy') navigateScope(parentScope(match.id))
    else { lockedNode.value = null; hoveredNode.value = null }
    await nextTick()
    const node = nodes.value.find(n => n.id === match.id)
    if (!node || !canvas.value) return
    const zoom = Math.max(.65, Math.min(1.2, viewport.value.zoom))
    const camera = { x: canvas.value.clientWidth / 2 - (node.position.x + node.data.width / 2) * zoom,
        y: canvas.value.clientHeight * .65 - (node.position.y + node.data.height / 2) * zoom, zoom }
    cameras.set(`${browsing.value}:${scope.value}`, camera)
    void setViewport(camera)
    searchHighlight.value = match.id
    clearTimeout(highlightTimer)
    highlightTimer = setTimeout(() => { searchHighlight.value = null }, 2200)
}
function nextResult(back = false) {
    const count = searchResults.value.length
    if (count) void locateResult((searchIndex.value + (back ? -1 : 1) + count) % count)
}
function returnFromSearch() {
    const origin = searchOrigin.value
    if (origin) {
        browsing.value = origin.browsing
        scope.value = origin.scope
        cameras.set(`${browsing.value}:${scope.value}`, origin.camera)
        applyScope()
        selectedNode.value = origin.selected
        lockedNode.value = origin.locked
    }
    searchOpen.value = false
    searchHighlight.value = null
}
function onKeydown(event: KeyboardEvent) {
    if (view.value !== 'graph') return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault(); event.stopPropagation(); openSearch()
    } else if (event.key === 'Escape') {
        event.preventDefault()
        searchOpen.value = false; lockedNode.value = null; hoveredNode.value = null
    }
}
function resetExploration() {
    scopeHistory.value = []
    showModuleFunctions.value = false
    lockedNode.value = null; hoveredNode.value = null; searchHighlight.value = null
    searchOrigin.value = null; searchIndex.value = -1
    clearTimeout(highlightTimer)
}
function setView(value: 'graph' | 'text') {
    view.value = value
    vscode.setState({ view: value, arrangement: arrangement.value, browsing: browsing.value })
    if (value === 'graph') void nextTick(fitLayout)
}
function fitLayout() {
    if (!nodes.value.length || !canvas.value?.clientWidth || view.value !== 'graph') return
    const saved = rememberViewport.value ? cameras.get(`${browsing.value}:${scope.value}`) : undefined
    if (saved) { void setViewport(saved); return }
    if (arrangement.value === 'original') { void fitView({ padding: 0.2 }); return }
    const left = Math.min(...nodes.value.map(n => n.position.x))
    const right = Math.max(...nodes.value.map(n => n.position.x + n.data.width))
    const top = Math.min(...nodes.value.map(n => n.position.y))
    const zoom = Math.max(0.1, Math.min(1, (canvas.value.clientWidth - 48) / (right - left)))
    void setViewport({ x: (canvas.value.clientWidth - (right - left) * zoom) / 2 - left * zoom, y: 24 - top * zoom, zoom })
}
function changeArrangement() {
    vscode.setState({ view: view.value, arrangement: arrangement.value, browsing: browsing.value })
    if (girText.value) void renderDotMessage({ command: 'render', dot: girText.value, fileName: fileName.value })
}
function applyScope() {
    clearTimeout(nodeClickTimer)
    hoveredNode.value = null
    lockedNode.value = null
    const model = browsing.value === 'hierarchy' ? focusGraph(fullModel.value, scope.value, moduleEntryIds.value.size > 0) : fullModel.value
    const flow = toVueFlow(model)
    nodes.value = flow.nodes
    edges.value = flow.edges
    void nextTick(fitLayout)
}
function navigateScope(next: string) {
    if (next !== scope.value) scopeHistory.value.push(scope.value)
    showModuleFunctions.value = false
    cameras.set(`${browsing.value}:${scope.value}`, { ...viewport.value })
    selections.set(`${browsing.value}:${scope.value}`, selectedNode.value)
    scope.value = next
    selectedNode.value = selections.get(`${browsing.value}:${scope.value}`) ?? null
    applyScope()
}
function openSubgraph(next: string) {
    clearTimeout(nodeClickTimer)
    if (!fullModel.value.nodes.some(n => n.type === 'cluster' && n.id === next)) return
    if (browsing.value !== 'hierarchy') {
        cameras.set(`${browsing.value}:${scope.value}`, { ...viewport.value })
        const owner = loopScope(fullModel.value, next)
        scope.value = owner ? parentScope(owner.loop.id) : parentScope(next)
        browsing.value = 'hierarchy'
        vscode.setState({ view: view.value, arrangement: arrangement.value, browsing: browsing.value })
    }
    navigateScope(next)
}
function returnToLoop() {
    const owner = currentLoopScope.value
    if (!owner) return
    navigateScope(parentScope(owner.loop.id))
    selectedNode.value = { id: owner.loop.id, ...owner.loop.data }
}
function goBackScope() {
    const previous = scopeHistory.value.pop()
    if (previous === undefined) return
    cameras.set(`${browsing.value}:${scope.value}`, { ...viewport.value })
    scope.value = previous
    selectedNode.value = selections.get(`${browsing.value}:${scope.value}`) ?? null
    applyScope()
}
function changeBrowsing() {
    vscode.postMessage({ command: 'browsingChanged', value: browsing.value })
    selectedNode.value = null
    vscode.setState({ view: view.value, arrangement: arrangement.value, browsing: browsing.value })
    applyScope()
}
function copyGir() { vscode.postMessage({ command: 'copyGir', text: girText.value }) }
function openGirText() { vscode.postMessage({ command: 'openGirText', text: girText.value }) }
const pausedOrigin = ref(0)
// Per-compile-pass snapshots served by camel-db; null selection = original GIR.
const snapshots = ref<PassGraphEntry[]>([])
const snapshotError = ref('')
const snapshotSel = ref<number | null>(null)

const breakpoints = new Set<string>()

let graphviz: Graphviz | null = null
let pendingDot: RenderMessage | null = null

function nodeOrigin(data: unknown): number {
    const attrs = (data as { attrs?: Record<string, string> })?.attrs
    const origin = Number(attrs?.origin)
    return Number.isFinite(origin) && origin > 0 ? origin : 0
}

function parseSpan(span: string | undefined): { line: number; character: number } | null {
    if (!span) return null
    const m = /^(\d+):(\d+)-(\d+):(\d+)$/.exec(span)
    if (!m) return null
    return { line: Number(m[1]), character: Number(m[2]) }
}

/** Recompute per-node flags (breakpoint, paused) over the current node list. */
function decorate(list: Node[]): Node[] {
    return list.map((vn) => ({
        ...vn,
        data: {
            ...vn.data,
            breakpoint: breakpoints.has(vn.id),
            paused: vn.type === 'gir' && pausedOrigin.value > 0 && nodeOrigin(vn.data) === pausedOrigin.value
        }
    }))
}

function edgeKind(type: string): string {
    if (type === 'WITH' || type === 'WITH_PORT') return 'with'
    if (type === 'NORM' || type === 'NORM_PORT') return 'norm'
    if (type === 'CTRL') return 'ctrl'
    return 'other'
}
function edgeColor(type: string): string { return edgeKind(type) === 'with' ? 'var(--gir-context)' : edgeKind(type) === 'ctrl' ? 'var(--gir-control)' : 'var(--gir-edge)' }
function edgeLabel(edge: FlowEdge): string {
    const names: Record<string, string> = { WITH: t("Context"), WITH_PORT: t("Context parameter"), NORM: t("Normal"), NORM_PORT: t("Normal parameter"), CTRL: t("Control") }
    const name = names[edge.edgeType]
    return name ? `${name}${edge.label ? ` · ${edge.label}` : ''}` : edge.label ?? ''
}

function toVueFlow(model: { nodes: FlowNode[]; edges: FlowEdge[] }): { nodes: Node[]; edges: Edge[] } {
    return {
        nodes: decorate(
            model.nodes.map((n) => ({
                id: n.id,
                type: n.type,
                position: n.position,
                data: { ...n.data },
                draggable: false,
                connectable: false,
                selectable: n.type !== 'cluster'
            }))
        ),
        edges: model.edges.map((e) => ({
            id: e.id,
            data: { kind: edgeKind(e.edgeType) },
            source: e.source,
            target: e.target,
            label: e.label,
            markerEnd: { type: e.edgeType === 'CTRL' ? MarkerType.Arrow : MarkerType.ArrowClosed, color: edgeColor(e.edgeType), width: 14, height: 14 },
            class: `gir-edge-${edgeKind(e.edgeType)}`,
            ariaLabel: edgeLabel(e),
            type: 'default',
            animated: false,
            labelStyle: { fill: 'var(--gir-muted)', fontSize: 10, fontFamily: 'var(--gir-mono)' },
            labelBgStyle: { fill: 'var(--gir-bg)', fillOpacity: 0.95 },
            style: { stroke: edgeColor(e.edgeType), strokeWidth: 1.4, strokeDasharray: edgeKind(e.edgeType) === 'with' ? '6 4' : edgeKind(e.edgeType) === 'ctrl' ? '2 4' : undefined }
        }))
    }
}

async function renderDotMessage(message: RenderMessage) {
    saveDocumentView()
    if (message.fileUri) documentKey = `${message.fileUri}:${message.pass || pass.value}`
    resetExploration()
    clearTimeout(nodeClickTimer)
    hoveredNode.value = null
    cameras.clear()
    selections.clear()
    scope.value = ''
    fullModel.value = { nodes: [], edges: [] }
    girText.value = message.dot || ''
    errorText.value = message.error || ''
    fileName.value = message.fileName || ''
    if (message.pass && ['std::rgir', 'std::agir', 'std::gir'].includes(message.pass)) pass.value = message.pass
    selectedNode.value = null
    nodes.value = []
    edges.value = []
    loading.value = false
    svgMarkup.value = ''
    useSvgFallback.value = false
    if (!message.dot || !isDotGraph(message.dot)) {
        status.value = t("No GIR generated")
        errorText.value ||= t("No GIR was generated. Check compilation errors, then refresh.")
        nodes.value = []
        edges.value = []
        pendingDot = null
        return
    }
    if (!graphviz) {
        pendingDot = message
        status.value = t("GIR is ready. Loading the graph engine; text view is available.")
        return
    }
    status.value = t("Computing layout…")
    try {
        const dot = parseDot(message.dot)
        const layoutJson = await graphviz.layout(loopLayoutDot(message.dot, dot), 'json', 'dot')
        const gv = JSON.parse(layoutJson)
        const model = buildFlowModel(dot, gv, arrangement.value)
        if (model.nodes.length === 0) {
            throw new Error('layout produced no nodes')
        }
        fullModel.value = model
        restoreDocumentView()
        applyScope()
        const savedSelection = selections.get(`${browsing.value}:${scope.value}`)
        if (savedSelection && model.nodes.some(n => n.id === savedSelection.id)) selectedNode.value = savedSelection
        useSvgFallback.value = false
        status.value = t("{0} nodes / {1} edges", model.nodes.length, model.edges.length)
    } catch (error) {
        // Fallback: static SVG rendering when the interactive pipeline fails.
        try {
            const svg = await graphviz.layout(message.dot, 'svg', 'dot')
            svgMarkup.value = svg
            useSvgFallback.value = true
            nodes.value = []
            edges.value = []
            status.value = t("Interactive rendering failed. Showing static SVG: {0}", error)
        } catch (svgError) {
            status.value = t("Graph rendering failed. Switch to text to inspect GIR.")
            errorText.value = String(svgError)
        }
    }
}

function onNodeClick(event: { node: Node; event: MouseEvent | TouchEvent }) {
    if ('shiftKey' in event.event && event.event.shiftKey) {
        clearTimeout(nodeClickTimer)
        lockedNode.value = lockedNode.value === event.node.id ? null : event.node.id
        return
    }
    clearTimeout(nodeClickTimer)
    const n = event.node
    if (n.type !== 'gir') {
        selectedNode.value = null
        return
    }
    // Avoid opening an inspector over the second click of FUNC navigation.
    if (n.data.enterScope || n.data.loop?.body?.scope) {
        nodeClickTimer = setTimeout(() => { selectedNode.value = { id: n.id, ...(n.data as FlowNode['data']) } }, 300)
    } else selectedNode.value = { id: n.id, ...(n.data as FlowNode['data']) }
}

function onNodeDoubleClick(event: { node: Node }) {
    clearTimeout(nodeClickTimer)
    const n = event.node
    if (n.data.loop?.body?.scope) { openSubgraph(n.data.loop.body.scope); return }
    if (browsing.value === 'hierarchy') {
        if (n.type === 'cluster') { navigateScope(n.id); return }
        if (n.data.enterScope) { navigateScope(n.data.enterScope); return }
    }
    toggleNodeBreakpoint(n)
}
function toggleNodeBreakpoint(n: Pick<Node, 'id' | 'type' | 'data'>) {
    if (n.type !== 'gir') return
    if (n.id.startsWith('boundary:')) return
    if (['ARGS', 'EXIT'].includes(n.data.nodeType)) return
    const had = breakpoints.has(n.id)
    if (had) {
        breakpoints.delete(n.id)
    } else {
        breakpoints.add(n.id)
    }
    vscode.postMessage({
        command: 'nodeBreakpoint',
        nodeKey: n.id,
        origin: nodeOrigin(n.data) || undefined,
        enabled: !had
    })
    nodes.value = nodes.value.map((vn) =>
        vn.id === n.id ? { ...vn, data: { ...vn.data, breakpoint: !had } } : vn
    )
}

function revealSelectedSource() {
    const data = selectedNode.value as (FlowNode['data'] & { attrs?: Record<string, string> }) | null
    if (!data) return
    const span = parseSpan(data.attrs?.span)
    const file = data.attrs?.srcfile
    if (!span || !file) {
        return
    }
    vscode.postMessage({ command: 'revealSource', file, line: span.line, character: span.character })
}

function refresh() {
    if (snapshotSel.value !== null) {
        vscode.postMessage({ command: 'passGraph', index: snapshotSel.value })
        return
    }
    vscode.postMessage({ command: 'refresh', pass: pass.value })
}

function changePass() {
    snapshotSel.value = null
    vscode.postMessage({ command: 'passChanged', pass: pass.value })
}

function changeSnapshot() {
    if (snapshotSel.value === null) {
        // Back to the original GIR view.
        vscode.postMessage({ command: 'refresh' })
        return
    }
    status.value = t("Loading pass snapshot…")
    vscode.postMessage({ command: 'passGraph', index: snapshotSel.value })
}

function onPassGraph(message: PassGraphMessage) {
    // Ignore stale replies after the user switched to another snapshot.
    if (Number.isInteger(message.index) && message.index !== snapshotSel.value) {
        return
    }
    if (!message.dot) {
        void renderDotMessage({ command: 'render', dot: null, fileName: fileName.value, error: t("Could not load pass snapshot{0}", message.error ? `: ${message.error}` : '') })
        return
    }
    void renderDotMessage({
        command: 'render',
        dot: message.dot,
        fileName: fileName.value,
        pass: message.pass ?? undefined
    })
}

function onMessage(event: MessageEvent) {
    const message = event.data
    if (!message || typeof message !== 'object') return
    if (message.command === 'preferences') {
        autoRefresh.value = !!message.autoRefresh
        followSource.value = !!message.followSource
        edgeLabels.value = message.edgeLabels
        hoverNeighborhood.value = message.hoverNeighborhood
        rememberViewport.value = !!message.rememberViewport
        if (!rememberViewport.value) { cameras.clear(); documentViews.clear() }
        if (browsing.value !== message.browsing) {
            browsing.value = message.browsing === 'flat' ? 'flat' : 'hierarchy'
            applyScope()
        }
    } else if (message.command === 'girCopied') {
        copied.value = true
        clearTimeout(copyTimer)
        copyTimer = setTimeout(() => { copied.value = false }, 1800)
    } else if (message.command === 'followSource') {
        followSource.value = !!message.enabled
    } else if (message.command === 'loading') {
        saveDocumentView()
        documentKey = `${message.fileUri || ''}:${message.pass || pass.value}`
        searchOpen.value = false
        resetExploration()
        fullModel.value = { nodes: [], edges: [] }
        scope.value = ''
        cameras.clear()
        selections.clear()
        loading.value = true
        girText.value = ''
        errorText.value = ''
        nodes.value = []
        edges.value = []
        svgMarkup.value = ''
        pendingDot = null
        selectedNode.value = null
        fileName.value = message.fileName || fileName.value
        status.value = t("Generating GIR…")
    } else if (message.command === 'render') {
        // Any extension-pushed render is the original GIR view; leave snapshot mode.
        snapshotSel.value = null
        renderDotMessage(message as RenderMessage)
    } else if (message.command === 'passGraphs') {
        snapshotError.value = typeof message.error === 'string' ? message.error : ''
        const raw: unknown[] = Array.isArray(message.graphs) ? message.graphs : []
        const list: PassGraphEntry[] = raw
            .filter((g): g is PassGraphEntry => !!g && Number.isInteger((g as PassGraphEntry).index))
            .map((g) => ({ index: Number(g.index), pass: typeof g.pass === 'string' ? g.pass : null }))
            .sort((a, b) => a.index - b.index)
        snapshots.value = list
        if (snapshotSel.value !== null && !list.some((g) => g.index === snapshotSel.value)) {
            snapshotSel.value = null
            // The selected snapshot vanished (e.g. recompiled): back to the original view.
            vscode.postMessage({ command: 'refresh' })
        }
    } else if (message.command === 'passGraph') {
        onPassGraph(message as PassGraphMessage)
    } else if (message.command === 'pausedOrigin') {
        pausedOrigin.value = typeof message.origin === 'number' ? message.origin : 0
        nodes.value = decorate(nodes.value)
    } else if (message.command === 'setBreakpoints') {
        const list: string[] = Array.isArray(message.nodes) ? message.nodes : []
        breakpoints.clear()
        list.forEach((k) => breakpoints.add(k))
        nodes.value = decorate(nodes.value)
    }
}

onMounted(async () => {
    window.addEventListener('message', onMessage)
    window.addEventListener('keydown', onKeydown, true)
    vscode.postMessage({ command: 'ready' })
    vscode.postMessage({ command: 'passGraphsList' })
    try {
        graphviz = await Graphviz.load()
        if (!pendingDot && !loading.value && !errorText.value) status.value = t("Waiting for GraphIR…")
        if (pendingDot) {
            const m = pendingDot
            pendingDot = null
            await renderDotMessage(m)
        }
    } catch (error) {
        status.value = t("Could not load Graphviz: {0}", error)
    }
})

onUnmounted(() => {
    window.removeEventListener('message', onMessage)
    window.removeEventListener('keydown', onKeydown, true)
    clearTimeout(highlightTimer)
    clearTimeout(nodeClickTimer)
    clearTimeout(copyTimer)
})
</script>

<template>
    <div class="panel">
        <header class="header">
            <div class="identity">
                <span class="brand-icon"><PanelIcon name="graph" :size="18" /></span>
                <h1>GIR</h1>
                <span class="divider"></span>
                <span class="file" :title="fileName">{{ fileName || 'Graph intermediate representation' }}</span>
            </div>
        <nav class="viewbar" :aria-label='t("GIR views and actions")'>
            <div class="view-switch" role="group" :aria-label='t("GIR view")'>
                <button :aria-pressed="view === 'graph'" @click="setView('graph')"><PanelIcon name="graph" :size="14" /> {{ t("Graph") }} </button>
                <button :aria-pressed="view === 'text'" @click="setView('text')"><PanelIcon name="text" :size="14" /> {{ t("Text") }} </button>
            </div>

            <select v-if="view === 'graph'" v-model="browsing" @change="changeBrowsing" :aria-label='t("Browse mode")'><option value="hierarchy"> {{ t("Hierarchy") }} </option><option value="flat"> {{ t("Flat view") }} </option></select>
            <div class="export-actions">
                <button class="icon-button" :disabled="!girText || loading" :aria-label='t("Copy GIR")' :title="copied ? t('Copied') : t('Copy GIR')" @click="copyGir"><PanelIcon :name="copied ? 'check' : 'copy'" /></button>
                <button class="icon-button" :disabled="!girText || loading" :aria-label='t("Open in editor")' :title='t("Open in editor")' @click="openGirText"><PanelIcon name="open" /></button>
            </div>
        </nav>
            <div class="header-actions">
                <button class="follow-button" :aria-pressed="followSource" :aria-label='t("Follow active source")' :title="followSource ? t('Update when switching CML files; click to pin this graph') : t('Graph pinned; click to follow the active source')" @click="toggleFollowSource"><PanelIcon :name="followSource ? 'follow' : 'pin'" />{{ followSource ? t("Follow") : t("Pinned") }}</button>
                <button class="icon-button" :class="{ active: showOptions }" :aria-expanded="showOptions" aria-controls="gir-options" :aria-label='t("Display options")' :title='t("Display options")' @click="showOptions = !showOptions"><PanelIcon name="settings" /></button>
                <button class="icon-button" :disabled="loading" :aria-label='t("Refresh")' :title='t("Refresh current editor contents")' @click="refresh"><PanelIcon name="refresh" :class="{ spinning: loading }" /></button>
            </div>
        </header>
        <nav v-if="view === 'graph' && browsing === 'hierarchy'" class="hierarchy-bar" :aria-label='t("Graph navigation")'>

            <template v-if="browsing === 'hierarchy'">
                <button v-if="scopeHistory.length" @click="goBackScope" :aria-label='t("Back to previous view")' :title='t("Back to previous view")'>←</button>
                <button v-for="(crumb, index) in crumbs" :key="crumb.id" :aria-current="crumb.id === scope ? 'page' : undefined" @click="navigateScope(crumb.id)">{{ index ? '› ' : '' }}{{ crumb.label }}</button>
            </template>
        <div v-if="view === 'graph' && browsing === 'hierarchy'" class="module-functions">
            <button @click="showModuleFunctions = !showModuleFunctions" :aria-expanded="showModuleFunctions">{{ showModuleFunctions ? '▾' : '▸' }} {{ t("Functions ·") }} {{ moduleFunctions.length }}</button>
            <div v-if="showModuleFunctions" class="module-function-list">
                <span v-if="!moduleFunctions.length"> {{ t("This GIR has no function subgraphs") }} </span>
                <span> {{ t("Select a function to enter its subgraph. This list is not a call sequence.") }} </span>
                <button v-for="fn in moduleFunctions" :key="fn.id" @click="navigateScope(fn.id)">{{ fn.data.label }} <small>{{ moduleEntryIds.has(fn.id) ? t("Entry · ") : '' }}{{ scope === fn.id || scope.startsWith(fn.id + '/') ? t("Current · ") : '' }}{{ fullModel.nodes.filter(n => n.type === 'gir' && n.id.startsWith(fn.id + '/')).length }} {{ t("nodes") }} </small></button>
            </div>
        </div>
        </nav>
        <section v-if="showOptions" id="gir-options" class="options" :aria-label='t("Display options")'>
            <label class="option-field"><span> {{ t("Output format") }} </span>
                <select v-model="pass" @change="changePass" title="GIR pass" :disabled="snapshotSel !== null">
                    <option value="std::rgir"> {{ t("rgir · Compact") }} </option>
                    <option value="std::agir"> {{ t("agir · Roles") }} </option>
                    <option value="std::gir"> {{ t("gir · Full styling") }} </option>
                </select>
            </label>
            <label class="option-field"><span> {{ t("Compilation stage") }} </span>
                <select v-model="snapshotSel" :disabled="!!snapshotError" @change="changeSnapshot" :title="snapshotError || t('Compiler pass snapshots (requires a debug session)')">
                    <option :value="null"> {{ t("Current source") }} </option>
                    <option v-for="g in snapshots" :key="g.index" :value="g.index">{{ g.pass === null ? t("Initial GIR") : `${g.index} · ${g.pass}` }}</option>
                </select>
            </label>
            <label class="option-field"><span> {{ t("Graph arrangement") }} </span>
                <select v-model="arrangement" @change="changeArrangement" :title='t("Graph arrangement")'>
                    <option value="vertical"> {{ t("Vertical modules · Original functions") }} </option>
                    <option value="original"> {{ t("Original layout") }} </option>
                </select>
            </label>
            <label class="auto"><input type="checkbox" v-model="autoRefresh" @change="vscode.postMessage({ command: 'autoRefresh', enabled: autoRefresh })" /> {{ t("Refresh on save") }} </label>
            <fieldset class="edge-filter"><legend> {{ t("Edge filters") }} </legend>
                <label><input type="checkbox" v-model="edgeFilters.norm" /> {{ t("Normal input") }} </label>
                <label><input type="checkbox" v-model="edgeFilters.with" /> {{ t("Context input") }} </label>
                <label><input type="checkbox" v-model="edgeFilters.ctrl" /> {{ t("Control dependency") }} </label>
                <label><input type="checkbox" v-model="hideFiltered" /> {{ t("Hide unchecked edge types") }} </label>
            </fieldset>
            <span v-if="!snapshots.length" class="option-hint"> {{ snapshotError || t("Compilation snapshots are available while debugging") }} </span>
        </section>
        <div v-if="showOptions && view === 'graph'" class="edge-legend" :aria-label='t("Edge legend")'>
            <span><i class="norm"></i> {{ t("Normal input") }} </span><span><i class="with"></i> {{ t("Context input") }} </span><span><i class="ctrl"></i> {{ t("Control dependency") }} </span>
            <span class="edge-index-hint" :title='t("Edge labels show source output and target input indices, both zero-based")'> {{ t("Index: output | input") }} </span>
        </div>
        <section v-if="errorText" class="error" role="alert"><span class="error-title"> {{ t("Could not generate GIR") }} </span><pre>{{ errorText }}</pre><span> {{ t("Fix the source errors, then refresh using the top-right button.") }} </span></section>
        <div v-if="loading" class="empty loading-state" role="status"><PanelIcon name="graph" :size="28" /><strong> {{ t("Generating GIR") }} </strong><span> {{ t("Compiling current editor contents…") }} </span></div>
        <div v-show="view === 'text' && !loading" class="code-scroll">
            <div v-if="girText" class="line-numbers" aria-hidden="true"><div v-for="n in lineCount" :key="n">{{ n }}</div></div>
            <pre class="gir-text" tabindex="0" :aria-label='t("GIR source text")'>{{ girText || t("No GIR yet. Open a CML file and refresh.") }}</pre>
        </div>
        <nav v-if="view === 'graph' && currentLoopScope && !loading" class="loop-context" :aria-label="t('Loop subgraph')">
            <button class="loop-back" @click="returnToLoop">← {{ t('Back to LOOP') }}</button>
            <strong>{{ currentLoopScope.role === 'body' ? t('Loop body') : t('Condition') }}</strong>
            <span>{{ currentLoopScope.role === 'body' ? t('Returns the next state: {0}', stateLabel(currentLoopScope.details)) : t('true continues; false stops') }}</span>
            <button v-if="currentLoopScope.role === 'body' && currentLoopScope.details.condition?.scope" class="loop-switch" @click="openSubgraph(currentLoopScope.details.condition.scope)">{{ t('Condition') }} ↗</button>
            <button v-if="currentLoopScope.role === 'condition' && currentLoopScope.details.body?.scope" class="loop-switch" @click="openSubgraph(currentLoopScope.details.body.scope)">{{ t('Loop body') }} ↗</button>
        </nav>
        <div v-show="view === 'graph' && !loading" class="canvas" ref="canvas">
            <section v-if="searchOpen" class="graph-search" :aria-label='t("Search nodes")'>
                <div class="search-input-row"><input ref="searchInput" v-model="searchQuery" :aria-label='t("Search name, type or ID")' :placeholder='t("Search name, type or ID")' @keydown.enter.prevent="nextResult($event.shiftKey)" />
                    <span>{{ searchResults.length ? searchIndex + 1 : 0 }}/{{ searchResults.length }}</span>
                    <button @click="nextResult()" :disabled="!searchResults.length" :aria-label='t("Next result")'>↓</button>
                    <button @click="searchOpen = false" :aria-label='t("Close search")'>×</button>
                </div>
                <div class="search-results">
                    <button v-for="(result, index) in searchResults.slice(0, 100)" :key="result.id" :class="{ current: searchIndex === index }" @click="locateResult(index)"><strong>{{ result.data.label }}</strong><small>{{ result.data.nodeType }} · {{ searchPath(result.id) }}</small></button>
                    <span v-if="searchQuery && !searchResults.length"> {{ t("No matching nodes") }} </span>
                    <span v-if="searchResults.length > 100"> {{ t("Showing the first 100 results; press Enter to cycle through all") }} </span>
                </div>
                <button class="search-return" :disabled="!searchOrigin" @click="returnFromSearch"> {{ t("Return to search origin") }} </button>
            </section>
            <div v-if="!nodes.length && !useSvgFallback" class="empty"><PanelIcon name="graph" :size="28" /><strong>{{ errorText ? t("No graph to display") : t("Waiting for GIR") }}</strong><span>{{ errorText ? t("The graph will appear here after successful compilation.") : status }}</span></div>
            <VueFlow v-if="!useSvgFallback" :nodes="visibleNodes" :edges="visibleEdges" @node-mouse-enter="hoverNode" @node-mouse-leave="hoveredNode = null" :node-types="nodeTypes" :fit-view-on-init="false" @nodes-initialized="fitLayout" :min-zoom="0.1" :max-zoom="2.5" @node-click="onNodeClick" @node-double-click="onNodeDoubleClick" @pane-click="selectedNode = null" />
            <div v-else class="svg-fallback" v-html="svgMarkup"></div>
            <div v-if="nodes.length && !useSvgFallback" class="canvas-controls" :aria-label='t("Canvas zoom")'>
                <button class="icon-button" :aria-label='t("Zoom out")' :title='t("Zoom out")' @click="zoomOut()"><PanelIcon name="minus" :size="14" /></button>
                <span class="zoom-level">{{ Math.round(viewport.zoom * 100) }}%</span>
                <button class="icon-button" :aria-label='t("Zoom in")' :title='t("Zoom in")' @click="zoomIn()"><PanelIcon name="plus" :size="14" /></button>
                <span class="divider"></span>
                <button class="icon-button" :aria-label='t("Fit to view")' :title='t("Fit to view")' @click="fitView({ padding: 0.2 })"><PanelIcon name="fit" :size="14" /></button>
            </div>
            <aside v-if="selectedNode" class="info" :aria-label='t("Node details")'>
                <div class="info-heading"><span> {{ t("Node details") }} </span><button class="icon-button" :aria-label='t("Close node details")' @click="selectedNode = null"><PanelIcon name="close" :size="14" /></button></div>
                <div class="node-name">{{ selectedNode.loop ? loopLabel(selectedNode.loop) : selectedNode.label }}</div>
                <dl><dt>ID</dt><dd>{{ selectedNode.id }}</dd><dt> {{ t("Kind") }} </dt><dd>{{ selectedNode.nodeType }}</dd><template v-if="selectedNode.attrs.value_type"><dt>{{ selectedNode.nodeType === 'FILL' ? t("Assembled type") : t("Data type") }}</dt><dd>{{ selectedNode.attrs.value_type }}</dd></template><template v-if="selectedNode.attrs.param_kind"><dt> {{ t("Parameter") }} </dt><dd>{{ ({ normal: t("Normal parameter"), with: t("Context parameter"), capture: t("Captured variable") } as Record<string, string>)[selectedNode.attrs.param_kind] || selectedNode.attrs.param_kind }}</dd></template><template v-if="selectedNode.attrs.param_index !== undefined"><dt> {{ t("Index") }} </dt><dd>{{ selectedNode.attrs.param_index }} {{ t("(zero-based)") }} </dd></template><template v-if="selectedNode.role"><dt> {{ t("Role") }} </dt><dd>{{ selectedNode.role }}</dd></template><template v-if="selectedNode.attrs?.span"><dt> {{ t("Location") }} </dt><dd>{{ selectedNode.attrs.srcfile }}:{{ selectedNode.attrs.span }}</dd></template></dl>
                <section v-if="selectedNode.loop" class="loop-detail" :aria-label="t('Loop structure')">
                    <div class="loop-graph-links">
                        <button v-if="selectedNode.loop.condition" :disabled="!selectedNode.loop.condition.scope" :title="selectedNode.loop.condition.name" @click="selectedNode.loop.condition.scope && openSubgraph(selectedNode.loop.condition.scope)">{{ t('Condition') }} ↗</button>
                        <button :disabled="!selectedNode.loop.body?.scope" :title="selectedNode.loop.body?.name" @click="selectedNode.loop.body?.scope && openSubgraph(selectedNode.loop.body.scope)">{{ t('Loop body') }} ↗</button>
                    </div>
                    <h3>{{ t('Initial state') }}</h3>
                    <dl v-if="selectedNode.loop.states.length"><template v-for="s in selectedNode.loop.states" :key="s.name"><dt>{{ s.name }}</dt><dd>{{ s.value ?? '—' }}<small v-if="s.type">{{ s.type }}</small></dd></template></dl>
                    <p v-else>{{ t('State names unavailable in this export') }}</p>
                    <template v-if="selectedNode.loop.iterable"><h3>{{ t('Iterated element') }}</h3><dl><dt>{{ selectedNode.loop.iterable.name }}</dt><dd>{{ selectedNode.loop.iterable.value ?? '—' }}</dd></dl></template>
                    <template v-if="selectedNode.loop.captures.length"><h3>{{ t('Captured inputs') }}</h3><dl><template v-for="s in selectedNode.loop.captures" :key="s.name"><dt>{{ s.name }}</dt><dd>{{ s.value ?? '—' }}<small v-if="s.type">{{ s.type }}</small></dd></template></dl></template>
                    <p>{{ t('Body output feeds the next iteration. LOOP output is the final state.') }}</p>
                    <button class="source-link" @click="toggleNodeBreakpoint({ id: selectedNode.id, type: 'gir', data: selectedNode })">{{ t('Toggle breakpoint') }}</button>
                </section>
                <button v-if="selectedNode.attrs?.span && selectedNode.attrs?.srcfile" class="source-link" @click="revealSelectedSource"> {{ t("Go to source") }} <PanelIcon name="arrow" :size="14" /></button>
                <div class="hint">{{ selectedNode.loop ? t('Double-click to enter the loop body') : ['ARGS', 'EXIT'].includes(selectedNode.nodeType) ? (selectedNode.nodeType === 'ARGS' ? t("Subgraph input boundary, grouping parameter inputs. ") : t("Subgraph output boundary, connected to the actual exit node. ")) + t("This is a visual marker, not a runtime node. Breakpoints are unavailable.") : selectedNode.enterScope ? t("Double-click to enter subgraph") : t("Double-click to toggle breakpoint") }}</div>
            </aside>
        </div>
        <footer class="statusbar" role="status" aria-live="polite">
            <span class="status-main"><span class="status-dot" :class="{ failed: errorText, busy: loading }"></span>{{ loading ? t("Generating") : errorText ? t("Compilation failed") : girText ? t("Up to date") : t("Waiting for source") }}</span>
            <span v-if="view === 'graph' && neighborhood" class="neighbor-summary"> {{ t("Upstream") }} {{ neighborhood.upstream.size }} {{ t("· Downstream") }} {{ neighborhood.downstream.size }} · {{ lockedNode ? t("Locked") : t("Direct neighbors") }}</span>
            <span v-else>{{ view === 'text' ? t("{0} lines", lineCount) : t("{0} nodes · {1} edges", nodeCount, edges.length) }}</span>
            <template v-if="lockedNode && neighborhood">
                <select v-model="direction" :aria-label='t("Trace direction")'><option value="both"> {{ t("Both") }} </option><option value="up"> {{ t("Upstream") }} </option><option value="down"> {{ t("Downstream") }} </option></select>
                <select v-model="depth" :aria-label='t("Trace depth")'><option :value="1"> {{ t("1 hop") }} </option><option :value="2"> {{ t("2 hops") }} </option></select>
                <button @click="lockedNode = null" :title='t("Esc to unlock")'> {{ t("Unlock") }} </button>
            </template>
            <button v-if="filtering" @click="showOptions = true" class="filter-indicator"> {{ t("Filtered") }} </button>
            <button v-if="view === 'graph' && !lockedNode" @click="openSearch" :title='t("Ctrl+F to search; Shift+click to lock neighbor highlighting")'> {{ t("Search") }} </button>
            <span class="status-pass">{{ snapshotSel !== null ? t("Snapshot") : pass.replace('std::', '') }}</span>
        </footer>
    </div>
</template>

<style>
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
:root {
    --gir-bg: var(--vscode-editor-background, #1e1e1e);
    --gir-surface: var(--vscode-sideBar-background, #252526);
    --gir-fg: var(--vscode-editor-foreground, #d4d4d4);
    --gir-muted: var(--vscode-descriptionForeground, #9d9d9d);
    --gir-line: var(--vscode-widget-border, #454545);
    --gir-accent: var(--vscode-focusBorder, #007fd4);
    --gir-edge: var(--vscode-editorLineNumber-foreground, #858585);
    --gir-context: var(--vscode-charts-purple, #a074c4);
    --gir-control: var(--vscode-charts-orange, #d18616);
    --gir-mono: var(--vscode-editor-font-family, monospace);
}
* { box-sizing: border-box; }
html, body, #app { margin: 0; height: 100%; background: var(--gir-bg); color: var(--gir-fg); font-family: var(--vscode-font-family, 'Segoe UI', sans-serif); font-size: 12px; }
button, select, input { font: inherit; }
button { cursor: pointer; }
button:disabled { opacity: .35; cursor: default; }
button:focus-visible, select:focus-visible, pre:focus-visible, input:focus-visible { outline: 1px solid var(--gir-accent); outline-offset: 2px; }
button svg { flex-shrink: 0; }
.panel { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
.header { min-height: 38px; padding: 3px 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; flex-shrink: 0; border-bottom: 1px solid var(--gir-line); }
.identity { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
.brand-icon { display: flex; color: var(--gir-fg); }
h1 { margin: 0; font-size: 13px; font-weight: 650; letter-spacing: .04em; }
.divider { width: 1px; height: 14px; background: var(--gir-line); flex-shrink: 0; }
.file { color: var(--gir-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; }
.header-actions, .export-actions { display: flex; gap: 0; align-items: center; }
.header-actions { margin-left: auto; }
.icon-button { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--gir-muted); }
.icon-button:hover:not(:disabled), .icon-button.active { background: var(--vscode-toolbar-hoverBackground, #ffffff12); color: var(--gir-fg); }
.viewbar { min-height: 30px; display: flex; align-items: center; gap: 6px; padding: 0; flex-shrink: 0; }
.view-switch { display: flex; padding: 3px; gap: 2px; border-radius: 6px; background: var(--gir-surface); border: 1px solid color-mix(in srgb, var(--gir-line) 60%, transparent); }
.view-switch button { display: flex; align-items: center; justify-content: center; gap: 6px; height: 25px; min-width: 42px; padding: 0 6px; color: var(--gir-muted); background: transparent; border: 1px solid transparent; border-radius: 4px; font-size: 11px; }
.view-switch button[aria-pressed="true"] { color: var(--gir-fg); background: var(--gir-bg); border-color: color-mix(in srgb, var(--gir-line) 50%, transparent); box-shadow: 0 1px 2px #0000000a; }
.view-switch button:hover { color: var(--gir-fg); }
.view-meta { color: var(--gir-muted); font-size: 10px; letter-spacing: .02em; }
.export-actions { margin-left: auto; }
.options { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; padding: 14px 16px; background: var(--gir-surface); border-bottom: 1px solid var(--gir-line); flex-shrink: 0; }
.option-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; color: var(--gir-muted); font-size: 11px; }
.option-field select { width: 100%; min-height: 28px; border: 1px solid var(--gir-line); border-radius: 4px; background: var(--vscode-dropdown-background, var(--gir-bg)); color: var(--gir-fg); padding: 0 6px; }
.auto { display: flex; gap: 6px; align-items: center; font-size: 11px; }
.auto input { margin: 0; accent-color: var(--gir-accent); }
.option-hint { font-size: 10px; color: var(--gir-muted); align-self: center; }
.follow-button { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; background: transparent; border: 0; color: var(--gir-muted); font-size: 11px; cursor: pointer; }
.follow-button[aria-pressed="false"] { color: var(--vscode-focusBorder); }
.module-functions { position: relative; margin-left: auto; }
.module-functions button { background: transparent; color: var(--gir-muted); border: 0; font-size: 11px; padding: 4px 6px; text-align: left; }
.module-function-list { position: absolute; z-index: 7; top: 100%; right: 0; max-height: 240px; overflow: auto; min-width: 220px; width: min(300px, 85vw); background: var(--gir-bg); border: 1px solid var(--gir-line); border-radius: 5px; padding: 8px; box-shadow: 0 4px 16px #0002; }
.module-function-list span { display: block; font-size: 10px; color: var(--gir-muted); padding: 4px 6px 8px; }
.module-function-list button { display: flex; width: 100%; justify-content: space-between; gap: 20px; color: var(--gir-fg); }
.module-function-list button:hover { background: var(--gir-surface); }
.module-function-list small { color: var(--gir-muted); }
.hierarchy-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 2px; padding: 2px 10px; border-bottom: 1px solid var(--gir-line); }
.viewbar select, .hierarchy-bar button { background: var(--gir-bg); color: var(--gir-muted); border: 1px solid var(--gir-line); border-radius: 4px; padding: 4px 8px; font-size: 11px; }
.hierarchy-bar button { border-color: transparent; }
.hierarchy-bar button:hover, .hierarchy-bar button[aria-current] { color: var(--gir-fg); background: var(--gir-surface); }
.edge-legend { display: flex; flex-wrap: wrap; gap: 8px 16px; padding: 8px 16px; border-bottom: 1px solid var(--gir-line); font-size: 10px; color: var(--gir-muted); }
.edge-legend span { display: inline-flex; align-items: center; gap: 6px; }
.edge-legend i { width: 20px; border-top: 1.4px solid var(--gir-edge); }
.edge-legend i.with { border-top: 1.4px dashed var(--gir-context); }
.edge-legend i.ctrl { border-top: 1.4px dotted var(--gir-control); }
.edge-index-hint { margin-left: auto; }
.canvas { flex: 1; min-height: 0; position: relative; overflow: hidden; }
.vue-flow { background-color: var(--gir-bg); background-image: radial-gradient(color-mix(in srgb, var(--gir-edge) 20%, transparent) .7px, transparent .7px); background-size: 20px 20px; }
.vue-flow__node.search-hit > div { outline: 2px solid var(--gir-accent); outline-offset: 4px; }
.vue-flow__edge.filter-muted { opacity: .12; }
.edge-filter { grid-column: 1 / -1; border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: 11px; }
.edge-filter legend { color: var(--gir-muted); margin-bottom: 8px; }
.edge-filter label { display: flex; align-items: center; gap: 4px; }
.graph-search { position: absolute; z-index: 6; right: 10px; top: 10px; width: min(360px, calc(100% - 20px)); border: 1px solid var(--gir-line); border-radius: 6px; background: var(--gir-bg); box-shadow: 0 4px 16px #0002; padding: 8px; }
.search-input-row { display: flex; gap: 6px; align-items: center; }
.search-input-row input { min-width: 0; width: 100%; background: var(--gir-surface); color: var(--gir-fg); border: 1px solid var(--gir-line); padding: 5px; }
.graph-search button, .statusbar button, .statusbar select { background: var(--gir-bg); color: var(--gir-fg); border: 1px solid var(--gir-line); border-radius: 3px; font-size: 10px; padding: 3px 5px; }
.search-results { max-height: 180px; overflow: auto; }
.search-results > button { display: flex; flex-direction: column; gap: 3px; text-align: left; width: 100%; border: 0; padding: 8px; }
.search-results > button:hover, .search-results > button.current { background: var(--gir-surface); }
.search-results strong { font-weight: 500; overflow-wrap: anywhere; }
.search-results small { color: var(--gir-muted); overflow-wrap: anywhere; }
.search-return { margin-top: 6px; }
.vue-flow__node.neighbor-muted, .vue-flow__edge.neighbor-muted { opacity: .2; }
.vue-flow__edge.neighbor-edge .vue-flow__edge-path { stroke-width: 2.5; }
.vue-flow__node.neighbor-focus > div { border-color: var(--gir-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--gir-accent) 30%, transparent); }
.vue-flow__node.neighbor-upstream > div, .vue-flow__node.neighbor-both > div { border-color: var(--vscode-charts-blue, #3794ff); }
.vue-flow__node.neighbor-downstream > div { border-color: var(--vscode-charts-orange, #d18616); }
.vue-flow__edge-textbg { rx: 3; ry: 3; }
.canvas-controls { position: absolute; left: 16px; bottom: 16px; display: flex; align-items: center; gap: 2px; padding: 3px; border: 1px solid var(--gir-line); border-radius: 7px; background: var(--gir-bg); box-shadow: 0 2px 10px #00000009; z-index: 3; }
.zoom-level { min-width: 40px; text-align: center; font-size: 10px; font-variant-numeric: tabular-nums; color: var(--gir-muted); }
.canvas-controls .divider { margin: 0 4px; }
.code-scroll { flex: 1; min-height: 0; display: flex; overflow: auto; font: 12px/1.85 var(--gir-mono); padding: 14px 0; }
.line-numbers { position: sticky; left: 0; padding: 0 14px 0 16px; text-align: right; color: var(--vscode-editorLineNumber-foreground, #858585); background: var(--gir-bg); user-select: none; border-right: 1px solid color-mix(in srgb, var(--gir-line) 40%, transparent); }
.gir-text { margin: 0; padding: 0 20px 0 14px; font: inherit; tab-size: 4; color: var(--gir-fg); }
.empty { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; padding: 32px; color: var(--gir-muted); text-align: center; }
.empty strong { font-size: 13px; color: var(--gir-fg); font-weight: 500; }
.empty span { font-size: 11px; max-width: 36ch; line-height: 1.7; }
.canvas > .empty { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
.loading-state { flex: 1; }
.error { padding: 16px; border-bottom: 1px solid var(--gir-line); max-height: 35vh; overflow: auto; flex-shrink: 0; }
.error-title { display: block; color: var(--vscode-errorForeground, #f48771); font-weight: 600; }
.error pre { font: 11px/1.7 var(--gir-mono); white-space: pre-wrap; overflow-wrap: anywhere; color: var(--gir-muted); margin: 10px 0; }
.error > span:last-child { font-size: 11px; color: var(--gir-muted); }
.statusbar { min-height: 30px; padding: 0 16px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; border-top: 1px solid var(--gir-line); color: var(--gir-muted); font-size: 10px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.status-main { display: flex; align-items: center; gap: 6px; }
.status-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--vscode-testing-iconPassed, #73b991); }
.status-dot.failed { background: var(--vscode-errorForeground, #f48771); }
.status-dot.busy { background: var(--gir-muted); }
.status-pass { margin-left: auto; font-family: var(--gir-mono); }
.info { position: absolute; right: 16px; top: 16px; width: min(270px, calc(100% - 32px)); max-height: calc(100% - 32px); overflow-y: auto; box-sizing: border-box; background: var(--gir-bg); border: 1px solid var(--gir-line); border-radius: 8px; padding: 12px 14px; box-shadow: 0 6px 24px #00000012; z-index: 4; }
.loop-context { display: flex; align-items: center; gap: 10px; padding: 5px 16px; border-bottom: 1px solid var(--gir-line); font-size: 10px; flex-wrap: wrap; }
.loop-context strong { font-weight: 500; }
.loop-context > span { color: var(--gir-muted); }
.loop-context button, .loop-graph-links button { border: 1px solid var(--gir-line); border-radius: 4px; padding: 4px 7px; font: inherit; color: var(--gir-fg); background: transparent; cursor: pointer; }
.loop-context button:hover, .loop-graph-links button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground); }
.loop-switch { margin-left: auto; }
.loop-context button:focus-visible, .loop-graph-links button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.loop-graph-links { display: flex; gap: 8px; }
.loop-graph-links button:disabled { color: var(--vscode-disabledForeground); cursor: default; }
.loop-detail { border-top: 1px solid var(--gir-line); margin-top: 12px; padding-top: 12px; font-size: 11px; }
.loop-detail h3 { font: 500 11px/1.5 var(--vscode-font-family); margin: 12px 0 6px; }
.loop-detail p { font-size: 10px; line-height: 1.6; margin: 8px 0; color: var(--gir-muted); }
.loop-detail small { display: block; color: var(--gir-muted); }
.info-heading { display: flex; justify-content: space-between; align-items: center; color: var(--gir-muted); font-size: 10px; }
.info-heading .icon-button { width: 22px; height: 22px; margin-right: -5px; }
.node-name { font: 12px/1.5 var(--gir-mono); overflow-wrap: anywhere; margin: 10px 0 14px; }
.info dl { margin: 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 12px; font-size: 10px; line-height: 1.5; }
.info dt { color: var(--gir-muted); }
.info dd { margin: 0; font-family: var(--gir-mono); overflow-wrap: anywhere; }
.hint { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--gir-line); color: var(--gir-muted); font-size: 10px; }
.source-link { margin-top: 12px; border: 0; padding: 0; background: transparent; color: var(--vscode-textLink-foreground, #3794ff); display: flex; gap: 6px; align-items: center; font-size: 11px; }
.svg-fallback { padding: 16px; overflow: auto; height: 100%; }
.spinning { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
@media (max-width: 520px) { .identity .file, .identity .divider, .brand-icon { display: none; } .identity { display: none; } .viewbar { margin-right: auto; } .header { gap: 2px; padding-left: 6px; padding-right: 6px; } .viewbar { gap: 2px; } }
@media (max-width: 340px) { .header, .viewbar { padding-left: 10px; padding-right: 10px; } .view-meta { display: none; } .options { grid-template-columns: 1fr; } .statusbar { gap: 10px; padding: 0 10px; } }
</style>
