<script setup lang="ts">
import { t } from '../../../../../client/src/localization'

import { Handle, Position } from '@vue-flow/core'
export interface GirClusterData {
    collapsed?: boolean
    count?: number
    label: string
    nodeType: string
    attrs: Record<string, string>
    width: number
    height: number
}

defineProps<{
    data: GirClusterData
    selected: boolean
}>()
</script>

<template>
    <div class="gir-cluster" :class="{ collapsed: data.collapsed }" :style="{ width: `${data.width}px`, height: `${data.height}px` }">
        <Handle v-if="data.collapsed" type="target" :position="Position.Top" />
        <div class="gir-cluster-label">{{ data.label }}</div>
        <div v-if="data.collapsed" class="cluster-summary">{{ data.count }} {{ t("nodes · Double-click to enter →") }} </div>
        <Handle v-if="data.collapsed" type="source" :position="Position.Bottom" />
    </div>
</template>

<style scoped>
.gir-cluster {
    border: 1px solid color-mix(in srgb, var(--gir-line, #454545) 60%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--gir-surface, #252526) 40%, transparent);
    pointer-events: none;
}

.gir-cluster.collapsed { pointer-events: auto; cursor: pointer; border-color: var(--gir-line); background: var(--gir-surface); }
.gir-cluster.collapsed:hover { border-color: var(--gir-accent); }
.cluster-summary { padding: 8px 10px; color: var(--gir-muted); font-size: 10px; }
.gir-cluster-label {
    padding: 6px 10px;
    font-size: 11px;
    color: var(--gir-muted, #9d9d9d);
    font-family: var(--gir-mono, monospace);
}
</style>
