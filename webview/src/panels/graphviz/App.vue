<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { Graphviz } from '@hpcc-js/wasm/graphviz'

declare function acquireVsCodeApi(): { postMessage(message: unknown): void }
const vscode = acquireVsCodeApi()

const container = ref<HTMLElement | null>(null)
const status = ref('正在加载 Graphviz 渲染器…')
let graphviz: Graphviz | null = null
let pendingDot: string | null = null

async function renderDot(dot: string) {
    if (!container.value) {
        return
    }
    if (!graphviz) {
        pendingDot = dot
        return
    }
    try {
        status.value = '渲染中…'
        const svg = await graphviz.layout(dot, 'svg', 'dot')
        container.value.innerHTML = svg
        status.value = ''
    } catch (error) {
        status.value = `渲染失败: ${error}`
        vscode.postMessage({ command: 'alert', text: `Graphviz render failed: ${error}` })
    }
}

function onMessage(event: MessageEvent) {
    const message = event.data
    if (message && message.command === 'render' && typeof message.dot === 'string') {
        renderDot(message.dot)
    }
}

onMounted(async () => {
    window.addEventListener('message', onMessage)
    try {
        graphviz = await Graphviz.load()
        status.value = '等待 GraphIR 数据…'
        if (pendingDot) {
            const dot = pendingDot
            pendingDot = null
            await renderDot(dot)
        }
    } catch (error) {
        status.value = `Graphviz 加载失败: ${error}`
    }
    // Let the extension know we are ready to receive the DOT source.
    vscode.postMessage({ command: 'ready' })
})

onUnmounted(() => {
    window.removeEventListener('message', onMessage)
})
</script>

<template>
    <div class="graph-container">
        <div v-if="status" class="status">{{ status }}</div>
        <div ref="container" class="graph"></div>
    </div>
</template>

<style>
body {
    margin: 0;
    padding: 8px;
    background: #ffffff;
}

.graph-container {
    min-height: 95vh;
}

.status {
    color: #888;
    font-family: sans-serif;
    padding: 4px 0;
}

.graph svg {
    max-width: 100%;
    height: auto;
}
</style>
