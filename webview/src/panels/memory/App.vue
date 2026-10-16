<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { t } from '../../../../client/src/localization'
import PanelIcon from '../graphviz/components/PanelIcon.vue'
import { byteRows, sizeText, usage } from './model'
declare function acquireVsCodeApi(): { postMessage(message: unknown): void }
const vscode = acquireVsCodeApi()
interface Region { name: string; type: string; start: string; used?: number; capacity?: number; objectBytes?: number; objectCount: number }
interface Allocation { supported: boolean; enabled: boolean; spaces: string[] }
const status = ref('none'), name = ref(''), error = ref(''), busy = ref(false)
const regions = ref<Region[]>([]), selected = ref(''), mode = ref('bytes'), offset = ref(0)
const bytes = ref<number[]>([]), objects = ref<{ addr: string; size: number; age: number }[]>([])
const hasMore = ref(false), total = ref(0), allocation = ref<Allocation>({ supported: false, enabled: false, spaces: [] })
const space = ref(''), allocationContext = ref('')
const current = computed(() => regions.value.find(r => r.name === selected.value))
const rows = computed(() => byteRows(bytes.value, offset.value))
const limit = computed(() => mode.value === 'bytes' ? 256 : 50)
let id = 0, revision = -1, sessionId = '', initialized = false
let pending: { id: number; operation: string } | null = null

function send(operation: string, args?: Record<string, unknown>) {
    if (status.value !== 'paused') { error.value = t('Pause a Camel debug session to inspect memory.'); return }
    pending = { id: ++id, operation }; busy.value = true; error.value = ''
    vscode.postMessage({ command: 'memoryRequest', ...pending, args })
}
function refresh() { send('snapshot') }
function loadPage() {
    bytes.value = []; objects.value = []; hasMore.value = false
    ++id; pending = null; busy.value = false
    if (!current.value || current.value.type !== 'bump') return
    send(mode.value, { region: selected.value, offset: offset.value, limit: limit.value })
}
function selectRegion(region: string) { selected.value = region; offset.value = 0; loadPage() }
function changeMode(value: string) { mode.value = value; offset.value = 0; loadPage() }
function page(direction: number) { offset.value = Math.max(0, offset.value + direction * limit.value); loadPage() }
function configureAllocation(enabled: boolean) { send('allocation', { enabled, spaces: space.value ? [space.value] : [] }) }
function receive(event: MessageEvent) {
    const message = event.data
    if (message?.command === 'memoryState') {
        const changed = revision !== message.revision || sessionId !== (message.sessionId ?? '') || status.value !== message.status
        revision = message.revision
        if (sessionId !== (message.sessionId ?? '')) initialized = false
        sessionId = message.sessionId ?? ''; name.value = message.name ?? ''; status.value = message.status
        allocationContext.value = message.allocation ? t('Allocated {0} in {1}', sizeText(message.allocation.size), message.allocation.space) : ''
        if (changed) {
            ++id; pending = null; busy.value = false; error.value = ''
            regions.value = []; bytes.value = []; objects.value = []; hasMore.value = false
        }
        if (status.value === 'paused' && !initialized) { initialized = true; refresh() }
    } else if (message?.command === 'memoryResponse' && pending && pending.id === message.id) {
        const operation = pending.operation; pending = null; busy.value = false
        if (message.error) { error.value = message.error; return }
        const result = message.result
        if (operation === 'snapshot') {
            regions.value = result.regions
            allocation.value = result.allocation
            space.value = allocation.value.spaces[0] ?? ''
            selectRegion(regions.value.some(r => r.name === selected.value) ? selected.value : regions.value.find(r => r.type === 'bump')?.name ?? '')
        } else if (operation === 'bytes') {
            bytes.value = result.data; hasMore.value = result.hasMore; total.value = result.capacity
        } else if (operation === 'objects') {
            objects.value = result.objects; hasMore.value = result.hasMore; total.value = result.total
        } else if (operation === 'allocation') allocation.value = result
    }
}
onMounted(() => { window.addEventListener('message', receive); vscode.postMessage({ command: 'ready' }) })
onUnmounted(() => window.removeEventListener('message', receive))
</script>

<template>
    <main class="memory-panel">
        <header>
            <div><strong>{{ t('Memory') }}</strong><span class="session-name" :title="name">{{ name }}</span></div>
            <span class="state">{{ status === 'paused' ? t('Paused') : status === 'running' ? t('Running') : status === 'ended' ? t('Session ended') : t('No debug session') }}</span>
            <button :disabled="status !== 'paused' || busy" :title="t('Refresh memory snapshot')" :aria-label="t('Refresh memory snapshot')" @click="refresh"><PanelIcon name="refresh" /></button>
        </header>
        <p v-if="allocationContext" class="hint">{{ allocationContext }}</p>
        <p v-if="status !== 'paused'" class="empty">{{ t('Pause a Camel debug session to inspect memory.') }}</p>
        <p v-if="error" role="alert" class="error">{{ error }}</p>
        <p v-if="busy" role="status" class="hint">{{ t('Loading…') }}</p>
        <template v-if="status === 'paused'">
            <p v-if="!regions.length && !busy" class="empty">{{ t('Refresh to capture region usage.') }}</p>
            <section v-if="regions.length" :aria-label="t('Memory regions')" class="regions">
                <button v-for="region in regions" :key="region.name" :aria-pressed="selected === region.name" @click="selectRegion(region.name)">
                    <span class="region-name">{{ region.name }}</span>
                    <span class="region-size">{{ sizeText(region.used ?? region.objectBytes ?? 0) }}<template v-if="region.capacity !== undefined"> / {{ sizeText(region.capacity) }}</template></span>
                    <span class="usage"><span :style="{ width: usage(region.used ?? region.objectBytes ?? 0, region.capacity ?? 0) + '%' }" /></span>
                </button>
            </section>
            <section v-if="current" class="detail" :aria-label="t('Selected region')">
                <div class="detail-header"><strong>{{ current.name }}</strong><code>{{ current.start }}</code><span>{{ current.objectCount }} {{ t('objects') }}</span></div>
                <p v-if="current.type !== 'bump'" class="hint">{{ t('Byte and object inspection is available for contiguous regions.') }}</p>
                <template v-else>
                    <div class="paging">
                        <div role="group" :aria-label="t('Memory view')">
                            <button :aria-pressed="mode === 'bytes'" @click="changeMode('bytes')">{{ t('Bytes') }}</button>
                            <button :aria-pressed="mode === 'objects'" @click="changeMode('objects')">{{ t('Objects') }}</button>
                        </div>
                        <form @submit.prevent="loadPage"><label>{{ mode === 'bytes' ? t('Byte offset') : t('Object offset') }} <input v-model.number="offset" type="number" min="0" step="1" required :disabled="busy" /></label><button :disabled="busy">{{ t('Go') }}</button></form>
                        <button :disabled="busy || offset <= 0" :aria-label="t('Previous page')" @click="page(-1)">←</button>
                        <button :disabled="busy || !hasMore" :aria-label="t('Next page')" @click="page(1)">→</button>
                    </div>
                    <div class="data-scroll" :aria-busy="busy">
                        <table v-if="mode === 'bytes'" class="hex"><thead><tr><th>{{ t('Offset') }}</th><th>{{ t('Hex bytes') }}</th><th>ASCII</th></tr></thead><tbody><tr v-for="row in rows" :key="row.offset"><th>{{ row.offset }}</th><td>{{ row.hex }}</td><td>{{ row.text }}</td></tr></tbody></table>
                        <table v-else class="objects"><thead><tr><th>{{ t('Address') }}</th><th>{{ t('Size') }}</th><th>{{ t('Age') }}</th></tr></thead><tbody><tr v-for="object in objects" :key="object.addr"><td>{{ object.addr }}</td><td>{{ object.size }}</td><td>{{ object.age }}</td></tr></tbody></table>
                    </div>
                    <p v-if="!busy && !(mode === 'bytes' ? rows.length : objects.length)" class="hint">{{ t('No data at this offset.') }}</p>
                    <p class="hint">{{ offset }} / {{ total }} · {{ limit }} {{ mode === 'bytes' ? t('bytes per page') : t('objects per page') }}</p>
                </template>
            </section>
            <section v-if="regions.length" class="allocation" :aria-label="t('Allocation breakpoints')">
                <label><input type="checkbox" :checked="allocation.enabled" :disabled="!allocation.supported || busy" @change="configureAllocation(($event.target as HTMLInputElement).checked)" />{{ t('Pause after allocations') }}</label>
                <select v-model="space" :disabled="!allocation.supported || busy" :aria-label="t('Allocation space')" @change="configureAllocation(allocation.enabled)">
                    <option value="">{{ t('All spaces') }}</option><option v-for="value in ['auto.birth', 'auto.haven', 'auto.elder', 'auto.large', 'bump', 'meta', 'perm']" :key="value">{{ value }}</option>
                </select>
                <p v-if="!allocation.supported" class="hint">{{ t('Allocation breakpoints require a Debug Camel build.') }}</p>
            </section>
        </template>
    </main>
</template>

<style>
:root { color-scheme: light dark; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
* { box-sizing: border-box; }
body { margin: 0; padding: 0; }
button, input, select { font: inherit; color: inherit; background: var(--vscode-input-background); border: 1px solid var(--vscode-widget-border, var(--vscode-input-border, transparent)); border-radius: 3px; min-height: 26px; }
button { cursor: pointer; padding: 4px 8px; }
button:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
button:disabled, input:disabled, select:disabled { opacity: .55; cursor: default; }
:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
button[aria-pressed=true] { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.memory-panel { width: 100%; min-width: 0; padding: 12px 16px; max-width: 1100px; margin: auto; }
header { display: flex; align-items: center; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
header > div { display: flex; align-items: baseline; gap: 12px; min-width: 0; flex: 1; }
.session-name { color: var(--vscode-descriptionForeground); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.state { font-size: 11px; color: var(--vscode-descriptionForeground); }
header button { display: flex; align-items: center; border-color: transparent; background: none; }
.hint, .empty { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.6; }
.empty { margin: 24px 0; }
.error { color: var(--vscode-errorForeground); white-space: pre-wrap; overflow-wrap: anywhere; }
.regions { display: grid; gap: 4px; margin: 12px 0 16px; }
.regions > button { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; text-align: left; column-gap: 12px; padding: 6px 8px; background: none; }
.region-name { overflow: hidden; text-overflow: ellipsis; }
.region-size { font-size: 11px; font-variant-numeric: tabular-nums; }
.usage { grid-column: 1 / -1; height: 2px; margin-top: 5px; background: var(--vscode-panel-border); }
.usage > span { display: block; height: 2px; background: var(--vscode-progressBar-background); }
.detail { border-top: 1px solid var(--vscode-panel-border); padding-top: 12px; }
.detail-header, .paging, .paging form, .paging label { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; }
.detail-header { margin-bottom: 10px; }
.detail-header code, .detail-header > span { overflow-wrap: anywhere; min-width: 0; font-size: 11px; color: var(--vscode-descriptionForeground); }
.paging { margin-bottom: 8px; font-size: 12px; }
.paging input { width: 90px; padding: 2px 5px; }
.paging form { flex: 1 1 100%; min-width: 0; }
.data-scroll { overflow-x: auto; max-height: 440px; overflow-y: auto; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
th { color: var(--vscode-descriptionForeground); font-weight: 400; }
th, td { text-align: left; padding: 3px 10px 3px 0; border-bottom: 1px solid var(--vscode-panel-border); }
.hex { font-family: var(--vscode-editor-font-family, monospace); white-space: pre; }
.objects td:first-child { font-family: var(--vscode-editor-font-family, monospace); }
.allocation { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--vscode-panel-border); display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; font-size: 12px; }
.allocation label { display: flex; align-items: center; gap: 6px; }
.allocation input { min-height: 0; }
.allocation .hint { width: 100%; margin: 0; }
@media (max-width: 360px) { .memory-panel { width: 100%; min-width: 0; padding: 10px; } .session-name { display: none; } }
</style>
