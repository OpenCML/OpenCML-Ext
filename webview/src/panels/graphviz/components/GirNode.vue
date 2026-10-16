<script setup lang="ts">
import { t } from '../../../../../client/src/localization'

import { computed, inject } from 'vue'
import { loopLabel, stateLabel, type LoopDetails } from '../loops'
import { Handle, Position } from '@vue-flow/core'

export interface GirNodeData {
    enterScope?: string
    loop?: LoopDetails
    label: string
    nodeType: string
    role?: string
    attrs: Record<string, string>
    width: number
    height: number
    breakpoint?: boolean
    paused?: boolean
}

const props = defineProps<{
    data: GirNodeData
    selected: boolean
}>()
const boundary = computed(() => ['ARGS', 'EXIT'].includes(props.data.nodeType))
const openSubgraph = inject<(scope: string) => void>('gir-open-subgraph')
const nodeTitle = computed(() => {
    const data = props.data
    if (boundary.value) return data.nodeType === 'ARGS'
        ? t("Subgraph input boundary: groups parameter inputs; not a runtime node.")
        : t("Subgraph output boundary: marks the actual exit node's output; not a runtime node.")
    const kind = ({ normal: t("Normal parameter"), with: t("Context parameter"), capture: t("Captured variable") } as Record<string, string>)[data.attrs.param_kind]
    const details = [data.label]
    if (data.attrs.value_type) details.push(`${data.nodeType === 'FILL' ? t("Assembled type") : t("Data type")}: ${data.attrs.value_type}`)
    if (kind) details.push(kind)
    if (data.attrs.param_index !== undefined) details.push(t("Port index (zero-based): {0}", data.attrs.param_index))
    return details.join('\n')
})
</script>

<template>
    <div
        class="gir-node"
        :title="data.enterScope ? t('Double-click to enter subgraph') : undefined"
        :class="[
            `t-${data.nodeType.toLowerCase()}`,
            { selected, boundary, breakpoint: !boundary && data.breakpoint, paused: !boundary && data.paused }
        ]"
        :style="{ width: `${data.width}px`, height: `${data.height}px` }"
    >
        <template v-if="data.loop">
            <div class="gir-label" :title="nodeTitle">{{ loopLabel(data.loop) }}</div>
            <div class="loop-state" :title="stateLabel(data.loop)">{{ stateLabel(data.loop) }} <span aria-hidden="true">→</span> {{ t('Next state') }}</div>
            <div class="loop-actions nodrag nopan" @dblclick.stop>
                <button v-if="data.loop.condition" type="button" :disabled="!data.loop.condition.scope" :title="data.loop.condition.scope ? data.loop.condition.name : t('Subgraph unavailable or ambiguous')" :aria-label="t('Enter loop condition')" @click.stop="data.loop.condition.scope && openSubgraph?.(data.loop.condition.scope)">{{ t('Condition') }} ↗</button>
                <button type="button" :disabled="!data.loop.body?.scope" :title="data.loop.body?.scope ? data.loop.body.name : t('Subgraph unavailable or ambiguous')" :aria-label="t('Enter loop body')" @click.stop="data.loop.body?.scope && openSubgraph?.(data.loop.body.scope)">{{ t('Loop body') }} ↗</button>
            </div>
        </template>
        <template v-else>
            <div class="gir-label" :title="nodeTitle">{{ boundary ? (data.nodeType === 'ARGS' ? t("Input") : t("Output")) : data.label }}</div>
            <div v-if="!boundary" class="gir-type">{{ data.nodeType }}<span v-if="data.enterScope" :aria-label='t("Open subgraph")'>↗</span></div>
        </template>
        <Handle v-if="data.nodeType !== 'ARGS'" id="t" type="target" :position="Position.Top" />
        <Handle v-if="data.nodeType !== 'EXIT'" id="s" type="source" :position="Position.Bottom" />
    </div>
</template>

<style scoped>
.gir-node {
    --node-accent: var(--vscode-symbolIcon-variableForeground, #75beff);
    box-sizing: border-box; padding: 3px 8px; border: 1px solid var(--gir-line, #454545);
    border-radius: 6px; background: var(--gir-bg, #1e1e1e); color: var(--gir-fg, #d4d4d4);
    font-size: 11px; text-align: center; cursor: pointer; user-select: none;
    display: flex; flex-direction: column; justify-content: center; gap: 2px;
    box-shadow: 0 2px 5px #00000008;
}
.gir-node:hover { border-color: var(--node-accent); }
.gir-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; font: 500 11px/1.2 var(--gir-mono, monospace); }
.gir-type { color: var(--gir-muted, #9d9d9d); font-size: 8px; flex-shrink: 0; letter-spacing: .07em; line-height: 1.2; display: flex; align-items: center; justify-content: center; gap: 5px; }
.gir-type::before { content: ''; width: 4px; height: 4px; border-radius: 50%; background: var(--node-accent); }
.t-exit { --node-accent: var(--vscode-symbolIcon-eventForeground, #ee9d28); }
.t-call { --node-accent: var(--vscode-symbolIcon-functionForeground, #b180d7); }
.t-loop { --node-accent: var(--vscode-symbolIcon-functionForeground, #b180d7); gap: 5px; }
.loop-state { font: 10px/1.3 var(--gir-mono, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loop-state span { color: var(--gir-muted); margin: 0 3px; }
.loop-actions { display: flex; align-items: center; justify-content: center; gap: 6px; }
.loop-actions button { border: 1px solid var(--gir-line); border-radius: 4px; padding: 3px 7px; background: transparent; color: var(--gir-fg); font: 10px/1.3 var(--vscode-font-family, sans-serif); cursor: pointer; }
.loop-actions button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, #8882); border-color: var(--node-accent); }
.loop-actions button:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: 2px; }
.loop-actions button:disabled { color: var(--vscode-disabledForeground, #858585); cursor: default; }
.gir-node.selected { border-color: var(--gir-accent, #007fd4); box-shadow: 0 0 0 2px color-mix(in srgb, var(--gir-accent, #007fd4) 20%, transparent); }
.gir-node.breakpoint { outline: 2px solid var(--vscode-debugIcon-breakpointForeground, #e51400); outline-offset: 2px; }
.gir-node.paused { background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700) 12%, var(--gir-bg, #1e1e1e)); border-color: var(--vscode-editorWarning-foreground, #cca700); }
.gir-node.boundary { border: 0; border-radius: 0; background: transparent; box-shadow: none; padding: 0; color: var(--gir-fg); }
.boundary .gir-label { font: 10px/1.4 var(--vscode-font-family, sans-serif); }
.boundary::after { content: ''; position: absolute; left: 0; right: 0; border-top: 1px solid var(--gir-edge, #858585); }
.boundary.t-args::after { bottom: 0; }
.boundary.t-exit::after { top: 0; }
.boundary:hover::after, .boundary.selected::after { border-color: var(--gir-accent, #007fd4); border-top-width: 2px; }
.boundary.selected .gir-label { color: var(--gir-accent, #007fd4); }
.gir-node :deep(.vue-flow__handle) { width: 5px; height: 5px; background: var(--gir-bg, #1e1e1e); border: 1px solid var(--gir-edge, #858585); }
</style>
