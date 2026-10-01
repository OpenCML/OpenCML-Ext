<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

export interface GirNodeData {
    label: string
    nodeType: string
    role?: string
    attrs: Record<string, string>
    width: number
    height: number
    breakpoint?: boolean
    paused?: boolean
}

defineProps<{
    data: GirNodeData
    selected: boolean
}>()
</script>

<template>
    <div
        class="gir-node"
        :class="[
            `t-${data.nodeType.toLowerCase()}`,
            { selected, breakpoint: data.breakpoint, paused: data.paused }
        ]"
        :style="{ width: `${data.width}px`, height: `${data.height}px` }"
    >
        <div class="gir-label">{{ data.label }}</div>
        <div class="gir-type">{{ data.nodeType }}</div>
        <Handle id="t" type="target" :position="Position.Top" />
        <Handle id="s" type="source" :position="Position.Bottom" />
    </div>
</template>

<style scoped>
.gir-node {
    box-sizing: border-box;
    padding: 4px 8px;
    border: 1px solid #7a7a7a;
    border-radius: 6px;
    background: #2d2d30;
    color: #e6e6e6;
    font-size: 11px;
    text-align: center;
    cursor: pointer;
    user-select: none;
    display: flex;
    flex-direction: column;
    justify-content: center;
    overflow: hidden;
}

.gir-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
}

.gir-type {
    margin-top: 2px;
    font-size: 10px;
    color: #9a9a9a;
}

.t-exit {
    border-color: #d16969;
}

.t-call {
    border-color: #d7ba7d;
}

.t-data {
    border-color: #569cd6;
}

.gir-node.selected {
    outline: 2px solid #3794ff;
}

.gir-node.breakpoint {
    box-shadow: 0 0 0 2px #f14c4c;
}

.gir-node.paused {
    background: #4d1f1f;
    box-shadow: 0 0 0 3px #ff9800;
}
</style>
