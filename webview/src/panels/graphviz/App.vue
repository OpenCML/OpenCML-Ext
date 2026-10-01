<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { VueFlow, type Node, type Edge, type NodeTypesObject } from '@vue-flow/core'
import { Graphviz } from '@hpcc-js/wasm/graphviz'
import { parseDot, isDotGraph } from './dot'
import { buildFlowModel, type FlowNode, type FlowEdge } from './layout'
import GirNode from './components/GirNode.vue'
import GirCluster from './components/GirCluster.vue'

declare function acquireVsCodeApi(): { postMessage(message: unknown): void }
const vscode = acquireVsCodeApi()

interface RenderMessage {
    command: 'render'
    dot: string
    fileUri?: string
    fileName?: string
    pass?: string
    error?: string
}

const nodeTypes: NodeTypesObject = {
    gir: GirNode as unknown as NodeTypesObject[string],
    cluster: GirCluster as unknown as NodeTypesObject[string]
}

const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])
const status = ref('等待 GraphIR 数据…')
const fileName = ref('')
const pass = ref('std::rgir')
const autoRefresh = ref(true)
const selectedNode = ref<FlowNode['data'] & { id: string } | null>(null)
const useSvgFallback = ref(false)
const svgContainer = ref<HTMLElement | null>(null)

const breakpoints = new Set<string>()

let graphviz: Graphviz | null = null
let pendingDot: RenderMessage | null = null

function toVueFlow(model: { nodes: FlowNode[]; edges: FlowEdge[] }): { nodes: Node[]; edges: Edge[] } {
    return {
        nodes: model.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            position: n.position,
            data: { ...n.data, breakpoint: breakpoints.has(n.id) },
            draggable: false,
            connectable: false,
            selectable: n.type !== 'cluster'
        })),
        edges: model.edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            label: e.label,
            type: 'default',
            animated: false,
            labelStyle: { fill: '#9a9a9a', fontSize: 10 },
            style: { stroke: '#6a6a6a' }
        }))
    }
}

async function renderDotMessage(message: RenderMessage) {
    if (!graphviz) {
        pendingDot = message
        return
    }
    if (!isDotGraph(message.dot)) {
        status.value = message.error || '未获取到 GIR 图（Camel 是否编译通过？）'
        nodes.value = []
        edges.value = []
        return
    }
    fileName.value = message.fileName || ''
    status.value = '布局计算中…'
    try {
        const layoutJson = await graphviz.layout(message.dot, 'json', 'dot')
        const gv = JSON.parse(layoutJson)
        const dot = parseDot(message.dot)
        const model = buildFlowModel(dot, gv)
        if (model.nodes.length === 0) {
            throw new Error('layout produced no nodes')
        }
        const flow = toVueFlow(model)
        nodes.value = flow.nodes
        edges.value = flow.edges
        useSvgFallback.value = false
        status.value = `${model.nodes.length} 节点 / ${model.edges.length} 边`
    } catch (error) {
        // Fallback: static SVG rendering when the interactive pipeline fails.
        try {
            const svg = await graphviz.layout(message.dot, 'svg', 'dot')
            if (svgContainer.value) {
                svgContainer.value.innerHTML = svg
            }
            useSvgFallback.value = true
            nodes.value = []
            edges.value = []
            status.value = `交互渲染失败，已回退静态 SVG：${error}`
        } catch (svgError) {
            status.value = `渲染失败: ${svgError}`
        }
    }
}

function onNodeClick(event: { node: Node }) {
    const n = event.node
    if (n.type !== 'gir') {
        selectedNode.value = null
        return
    }
    selectedNode.value = { id: n.id, ...(n.data as FlowNode['data']) }
}

function onNodeDoubleClick(event: { node: Node }) {
    const n = event.node
    if (n.type !== 'gir') return
    const had = breakpoints.has(n.id)
    if (had) {
        breakpoints.delete(n.id)
    } else {
        breakpoints.add(n.id)
    }
    vscode.postMessage({ command: 'nodeBreakpoint', nodeKey: n.id, enabled: !had })
    nodes.value = nodes.value.map((vn) =>
        vn.id === n.id ? { ...vn, data: { ...vn.data, breakpoint: !had } } : vn
    )
}

function refresh() {
    vscode.postMessage({ command: 'refresh', pass: pass.value })
}

function changePass() {
    vscode.postMessage({ command: 'passChanged', pass: pass.value })
}

function onMessage(event: MessageEvent) {
    const message = event.data
    if (!message || typeof message !== 'object') return
    if (message.command === 'render') {
        renderDotMessage(message as RenderMessage)
    } else if (message.command === 'setBreakpoints') {
        const list: string[] = Array.isArray(message.nodes) ? message.nodes : []
        breakpoints.clear()
        list.forEach((k) => breakpoints.add(k))
        nodes.value = nodes.value.map((vn) => ({
            ...vn,
            data: { ...vn.data, breakpoint: breakpoints.has(vn.id) }
        }))
    }
}

onMounted(async () => {
    window.addEventListener('message', onMessage)
    try {
        graphviz = await Graphviz.load()
        status.value = '等待 GraphIR 数据…'
        if (pendingDot) {
            const m = pendingDot
            pendingDot = null
            await renderDotMessage(m)
        }
    } catch (error) {
        status.value = `Graphviz 加载失败: ${error}`
    }
    vscode.postMessage({ command: 'ready' })
})

onUnmounted(() => {
    window.removeEventListener('message', onMessage)
})
</script>

<template>
    <div class="panel">
        <div class="toolbar">
            <span class="title">GraphIR</span>
            <span class="file">{{ fileName }}</span>
            <select v-model="pass" @change="changePass" title="GIR pass">
                <option value="std::rgir">rgir（精简）</option>
                <option value="std::agir">agir（角色标注）</option>
                <option value="std::gir">gir（完整样式）</option>
            </select>
            <label class="auto">
                <input type="checkbox" v-model="autoRefresh" @change="vscode.postMessage({ command: 'autoRefresh', enabled: autoRefresh })" />
                保存时刷新
            </label>
            <button @click="refresh">刷新</button>
            <span class="status">{{ status }}</span>
        </div>
        <div class="canvas">
            <VueFlow
                v-if="!useSvgFallback"
                :nodes="nodes"
                :edges="edges"
                :node-types="nodeTypes"
                :fit-view-on-init="true"
                :min-zoom="0.1"
                :max-zoom="2.5"
                @node-click="onNodeClick"
                @node-double-click="onNodeDoubleClick"
            >
            </VueFlow>
            <div v-else ref="svgContainer" class="svg-fallback"></div>
            <div v-if="selectedNode" class="info">
                <div><b>{{ selectedNode.id }}</b></div>
                <div>label: {{ selectedNode.label }}</div>
                <div>type: {{ selectedNode.nodeType }}</div>
                <div v-if="selectedNode.role">role: {{ selectedNode.role }}</div>
                <div class="hint">双击节点切换断点</div>
            </div>
        </div>
    </div>
</template>

<style>
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';

html,
body,
#app {
    margin: 0;
    height: 100%;
    background: #1e1e1e;
    color: #e6e6e6;
    font-family: -apple-system, 'Segoe UI', sans-serif;
}

.panel {
    display: flex;
    flex-direction: column;
    height: 100vh;
}

.toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid #333;
    font-size: 12px;
    flex-wrap: wrap;
}

.toolbar .title {
    font-weight: 700;
}

.toolbar .file {
    color: #9a9a9a;
}

.toolbar select,
.toolbar button {
    background: #3c3c3c;
    color: #e6e6e6;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 12px;
}

.toolbar .auto {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #9a9a9a;
}

.toolbar .status {
    color: #9a9a9a;
    margin-left: auto;
}

.canvas {
    position: relative;
    flex: 1;
}

.vue-flow {
    background: #1e1e1e;
}

.vue-flow__edge-text {
    fill: #9a9a9a;
}

.info {
    position: absolute;
    right: 10px;
    top: 10px;
    background: rgba(45, 45, 48, 0.95);
    border: 1px solid #444;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 12px;
    max-width: 260px;
}

.info .hint {
    margin-top: 6px;
    color: #888;
    font-size: 11px;
}

.svg-fallback {
    padding: 10px;
    overflow: auto;
    height: 100%;
}
</style>
