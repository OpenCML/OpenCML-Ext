<script setup lang="ts">
export interface GirClusterData {
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
    <div class="gir-cluster" :style="{ width: `${data.width}px`, height: `${data.height}px` }">
        <div class="gir-cluster-label">{{ data.label }}</div>
    </div>
</template>

<style scoped>
.gir-cluster {
    border: 1px dashed #5a5a5a;
    border-radius: 8px;
    background: rgba(128, 128, 128, 0.08);
    pointer-events: none;
}

.gir-cluster-label {
    padding: 4px 8px;
    font-size: 11px;
    color: #9a9a9a;
}
</style>
