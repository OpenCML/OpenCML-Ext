<script setup lang="ts">
import { t } from '../../../../../client/src/localization'

import { computed, inject } from 'vue'
import { loopLabel, type LoopDetails } from '../loops'
import PanelIcon from './PanelIcon.vue'
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
const functionValue = computed(() => props.data.attrs.function_value === '1')
const boundary = computed(() => ['ARGS', 'EXIT'].includes(props.data.nodeType))
// Use runtime kinds and explicit function-value metadata, never label text.
const family = computed(() => boundary.value ? 'boundary'
    : functionValue.value || ['FUNC', 'CALL'].includes(props.data.nodeType) ? 'function'
    : ['BRCH', 'JOIN', 'GATE', 'LOOP', 'SYNC'].includes(props.data.nodeType) ? 'control'
    : ['OPER', 'FILL', 'ACCS', 'CAST', 'COPY'].includes(props.data.nodeType) ? 'operation' : 'value')
const diamond = computed(() => ['BRCH', 'JOIN', 'GATE'].includes(props.data.nodeType))
const controlOutline = computed(() => {
    const w = props.data.width, h = props.data.height
    return `M ${w / 2},.5 L ${w - .5},${h / 2} L ${w / 2},${h - .5} L .5,${h / 2} Z`
})
const openSubgraph = inject<(scope: string) => void>('gir-open-subgraph')
const nodeTitle = computed(() => {
    const data = props.data
    if (boundary.value) return data.nodeType === 'ARGS'
        ? t("Subgraph input boundary: groups parameter inputs; not a runtime node.")
        : t("Subgraph output boundary: marks the actual exit node's output; not a runtime node.")
    const kind = ({ normal: t("Normal parameter"), with: t("Context parameter"), capture: t("Captured variable") } as Record<string, string>)[data.attrs.param_kind]
    const details = [data.label]
    if (functionValue.value) details.push(data.attrs.label)
    details.push(`${t('Output type')}: ${data.attrs.value_type || t('Not provided')}`)
    if (kind) details.push(kind)
    if (data.attrs.param_index !== undefined) details.push(t("Port index (zero-based): {0}", data.attrs.param_index))
    if (data.enterScope) details.push(t('Double-click to enter subgraph'))
    return details.join('\n')
})
</script>

<template>
    <div
        class="gir-node"
        :title="nodeTitle"
        :class="[
            `t-${data.nodeType.toLowerCase()}`,
            `family-${family}`,
            { selected, boundary, diamond, 'function-value': functionValue, breakpoint: !boundary && data.breakpoint, paused: !boundary && data.paused }
        ]"
        :style="{ width: `${data.width}px`, height: `${data.height}px` }"
    >
        <svg v-if="diamond" class="control-outline" :viewBox="`0 0 ${data.width} ${data.height}`" aria-hidden="true"><path :d="controlOutline" /></svg>
        <template v-if="data.loop">
            <div class="loop-heading"><PanelIcon name="loop" :size="12" /><div class="gir-label" :title="nodeTitle">{{ loopLabel(data.loop) }}</div></div>
            <div class="loop-actions nodrag nopan">
                <button v-if="data.loop.condition" type="button" :disabled="!data.loop.condition.scope" :title="data.loop.condition.scope ? data.loop.condition.name : t('Subgraph unavailable or ambiguous')" :aria-label="t('Enter loop condition')" @dblclick.stop @click.stop="data.loop.condition.scope && openSubgraph?.(data.loop.condition.scope)">{{ t('Condition') }}<PanelIcon name="chevron" :size="10" /></button>
                <button type="button" :disabled="!data.loop.body?.scope" :title="data.loop.body?.scope ? data.loop.body.name : t('Subgraph unavailable or ambiguous')" :aria-label="t('Enter loop body')" @dblclick.stop @click.stop="data.loop.body?.scope && openSubgraph?.(data.loop.body.scope)">{{ t('Loop body') }}<PanelIcon name="chevron" :size="10" /></button>
            </div>
        </template>
        <template v-else>
            <div class="gir-label" :title="nodeTitle"><span v-if="functionValue" class="function-symbol" aria-hidden="true">ƒ</span>{{ boundary ? (data.nodeType === 'ARGS' ? t("Input") : t("Output")) : data.label }}</div>
            <div v-if="!boundary" class="gir-type">{{ functionValue ? t("Function value") : data.nodeType }}<span v-if="data.enterScope" :aria-label='t("Open subgraph")'>↗</span></div>
        </template>
        <Handle v-if="data.nodeType !== 'ARGS'" id="t" type="target" :position="Position.Top" />
        <Handle v-if="data.nodeType !== 'EXIT'" id="s" type="source" :position="Position.Bottom" />
    </div>
</template>

<style scoped>
.gir-node {
    --node-accent: var(--gir-muted, #9d9d9d);
    --node-base-line: color-mix(in srgb, var(--gir-fg, #d4d4d4) 55%, var(--gir-bg, #1e1e1e));
    --node-line: var(--node-base-line);
    --node-fill: var(--gir-bg, #1e1e1e);
    box-sizing: border-box; padding: 3px 8px; border: 1px solid var(--node-line);
    border-radius: 6px; background: var(--node-fill); color: var(--gir-fg, #d4d4d4);
    font-size: 11px; text-align: center; cursor: pointer; user-select: none;
    display: flex; flex-direction: column; justify-content: center; gap: 2px;
    box-shadow: 0 2px 5px #00000008;
}
.gir-node:hover { --node-line: var(--node-accent); border-color: var(--node-line); }
.gir-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; font: 500 11px/1.2 var(--gir-mono, monospace); }
.gir-type { color: var(--gir-muted, #9d9d9d); font-size: 8px; flex-shrink: 0; letter-spacing: .07em; line-height: 1.2; display: flex; align-items: center; justify-content: center; gap: 5px; }
.gir-type::before { content: ''; width: 4px; height: 4px; border-radius: 50%; background: var(--node-accent); }
.t-exit { --node-accent: var(--vscode-symbolIcon-eventForeground, #ee9d28); }
.function-symbol { color: var(--node-accent); margin-right: 6px; }
.family-function { --node-accent: var(--vscode-charts-purple, #b180d7); --node-line: color-mix(in srgb, var(--node-accent) 55%, var(--node-base-line)); --node-fill: color-mix(in srgb, var(--node-accent) 4%, var(--gir-bg)); border-radius: 9px; padding-inline: 12px; }
.family-function::after { content: ''; position: absolute; inset: 5px; border-inline: 1px solid color-mix(in srgb, var(--node-accent) 50%, transparent); border-radius: 4px; pointer-events: none; }
.family-operation { --node-accent: var(--vscode-charts-blue, #3794ff); border-radius: 2px; }
.family-operation .gir-type::before { border-radius: 0; }
.family-control { --node-accent: var(--vscode-charts-orange, #d18616); --node-line: color-mix(in srgb, var(--node-accent) 40%, var(--node-base-line)); --node-fill: color-mix(in srgb, var(--node-accent) 3%, var(--gir-bg)); border-radius: 4px; box-shadow: none; }
.diamond, .diamond:hover, .gir-node.diamond.selected, .gir-node.diamond.paused { border-color: transparent; background: transparent; padding: 0; }
.diamond .gir-label { max-width: 65%; align-self: center; }
.family-control .gir-type::before { border-radius: 0; transform: rotate(45deg); }
.control-outline { position: absolute; inset: -1px; width: calc(100% + 2px); height: calc(100% + 2px); overflow: visible; pointer-events: none; }
.control-outline path { fill: var(--node-fill); stroke: var(--node-line); stroke-width: 1; vector-effect: non-scaling-stroke; }
.family-control > :not(.control-outline) { position: relative; }
.family-control > :deep(.vue-flow__handle) { position: absolute; }
.function-value .gir-type { letter-spacing: 0; }
.t-loop { padding: 7px 8px 5px; gap: 0; box-shadow: none; }
.loop-heading { display: flex; align-items: center; justify-content: center; gap: 6px; min-width: 0; }
.loop-heading > svg { flex-shrink: 0; color: var(--node-accent); }
.loop-actions { display: flex; align-items: center; margin-top: 6px; padding-top: 3px; border-top: 1px solid var(--gir-line); }
.loop-actions button { display: flex; align-items: center; justify-content: center; gap: 4px; flex: 1; min-width: 0; border: 0; border-radius: 2px; padding: 2px 3px; background: transparent; color: var(--gir-fg); font: 10px/1.3 var(--vscode-font-family, sans-serif); white-space: nowrap; cursor: pointer; }
.loop-actions button + button { border-left: 1px solid var(--gir-line); border-top-left-radius: 0; border-bottom-left-radius: 0; }
.loop-actions button > svg { flex-shrink: 0; }
.loop-actions button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, #8882); color: var(--gir-accent); }
.loop-actions button:active:not(:disabled) { background: var(--vscode-toolbar-activeBackground, #8883); }
.loop-actions button:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: 2px; }
.loop-actions button:disabled { color: var(--vscode-disabledForeground, #858585); cursor: default; }
.gir-node.selected { --node-line: var(--gir-accent, #007fd4); border-color: var(--node-line); box-shadow: none; }
.gir-node.t-loop.selected { box-shadow: none; }
.gir-node.breakpoint { outline: 2px solid var(--vscode-debugIcon-breakpointForeground, #e51400); outline-offset: 2px; }
.gir-node.paused { --node-fill: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700) 12%, var(--gir-bg, #1e1e1e)); --node-line: var(--vscode-editorWarning-foreground, #cca700); border-color: var(--node-line); }
:global(body.vscode-high-contrast) .gir-node:not(.selected):not(.paused), :global(body.vscode-high-contrast-light) .gir-node:not(.selected):not(.paused) { --node-line: var(--gir-fg); }
.gir-node.boundary { border: 0; border-radius: 0; background: transparent; box-shadow: none; padding: 0; color: var(--gir-fg); }
.boundary .gir-label { font: 10px/1.4 var(--vscode-font-family, sans-serif); }
.boundary::after { content: ''; position: absolute; left: 0; right: 0; border-top: 1px solid var(--gir-edge, #858585); }
.boundary.t-args::after { bottom: 0; }
.boundary.t-exit::after { top: 0; }
.boundary:hover::after, .boundary.selected::after { border-color: var(--gir-accent, #007fd4); border-top-width: 2px; }
.boundary.selected .gir-label { color: var(--gir-accent, #007fd4); }
.gir-node :deep(.vue-flow__handle) { width: 5px; height: 5px; background: var(--gir-bg, #1e1e1e); border: 1px solid var(--gir-edge, #858585); }
</style>
