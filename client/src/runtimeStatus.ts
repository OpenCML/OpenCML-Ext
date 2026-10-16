import { t } from './localization'
import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { execFile } from 'child_process'
import { detectToolchain, type CamelToolchain } from './toolchain'
import { inspectCompatibility, languageFeatures, type Compatibility } from './compatibility'

type Phase = 'starting' | 'native' | 'fallback' | 'failed' | 'stopped'
export interface RuntimeState {
    phase: Phase
    toolchain?: CamelToolchain
    serverVersion?: string
    error?: string
    compatibility?: Compatibility
    capabilities?: Record<string, any>
}

/** The status reflects the process actually started, not merely the configured path. */
export class RuntimeStatus implements vscode.Disposable {
    private readonly item = vscode.window.createStatusBarItem('camel.runtime', vscode.StatusBarAlignment.Left, 20)
    private readonly listeners: vscode.Disposable[] = []
    private current: RuntimeState = { phase: 'starting' }
    constructor() {
        this.item.name = t("Camel Runtime")
        this.item.command = 'camel.runtimeMenu'
        this.listeners.push(vscode.window.onDidChangeActiveTextEditor(() => this.render()))
        this.render()
    }
    set(state: RuntimeState) { this.current = state; this.render() }
    get snapshot(): RuntimeState { return this.current }
    private render() {
        const labels: Record<Phase, string> = {
            starting: t("$(sync~spin) Camel · Starting"), native: '$(check) Camel · LSP',
            fallback: t("$(warning) Camel · Fallback"), failed: t("$(error) Camel · Failed"), stopped: t("$(circle-slash) Camel · Stopped")
        }
        this.item.text = labels[this.current.phase]
        if (this.current.phase === 'native' && this.current.compatibility?.warnings.length) this.item.text = t('$(warning) Camel · Limited')
        this.item.backgroundColor = this.current.phase === 'failed' ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined
        this.item.tooltip = [
            this.current.phase === 'fallback' ? t("CLI fallback: diagnostics and formatting only") : t("Language server: {0}", this.current.serverVersion || this.current.phase),
            `Camel: ${this.current.toolchain?.camel || t("Not resolved")}`,
            `camel-ls: ${this.current.toolchain?.camelLs || t("Not found")}`,
            this.current.error || '', t("Click for runtime details, health check or restart"),
            ...(this.current.compatibility?.warnings || [])
        ].filter(Boolean).join('\n')
        if (vscode.window.activeTextEditor?.document.languageId === 'cml') this.item.show()
        else this.item.hide()
    }
    dispose() { this.item.dispose(); this.listeners.forEach(item => item.dispose()) }
}

export async function inspectRuntime(state: RuntimeState) {
    const config = vscode.workspace.getConfiguration('opencmlLanguageServer')
    const configured = detectToolchain(config.get<string>('camelPath') || 'camel', config.get<string>('camelLsPath') || '')
    const active = state.toolchain || configured
    const version = await new Promise<{ version?: string; error?: string }>(resolve => {
        execFile(active.camel, ['--version'], { timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true }, (error, stdout, stderr) => {
            resolve(error ? { error: `${error.message}${stderr ? `\n${stderr}` : ''}` } : { version: stdout.trim() || stderr.trim() })
        })
    })
    const files = [
        ['Camel', active.camel], [t("Language server"), active.camelLs], [t("Formatter"), active.camelFormat],
        [t("Debugger"), config.get<string>('camelDbPath')?.trim() || active.camelDb]
    ].map(([name, executable]) => {
        let exists = false
        try { exists = !!executable && fs.statSync(executable).isFile() } catch { /* reported below */ }
        return { name, path: executable || null, exists }
    })
    const warnings = [...configured.warnings]
    const compatibility = await inspectCompatibility(active.camel)
    compatibility.features = { ...compatibility.features, ...languageFeatures(state.capabilities) }
    const missing = Object.entries(compatibility.features).filter(([, feature]) => feature.supported === false).map(([name]) => name)
    if (missing.length) compatibility.warnings.push(t('Unavailable runtime features: {0}. See Runtime Info and Health Check for details.', missing.join(', ')))
    warnings.push(...compatibility.warnings)
    if (active.camelLs && path.dirname(active.camelLs) !== path.dirname(active.camel)) {
        warnings.push(t("Camel and camel-ls are in different directories; GIR requests may use Camel next to camel-ls."))
    }
    if (state.phase === 'fallback') warnings.push(t("CLI fallback is active; completion, navigation, rename and semantic highlighting are unavailable."))
    return {
        phase: state.phase, runtimeVersion: version.version || null, versionError: version.error || null,
        serverVersion: state.serverVersion || null, startupError: state.error || null, files, warnings,
        compatibility,
        environment: {
            CAMEL_HOME: process.env.CAMEL_HOME || t("(not set)"),
            CAMEL_STD_LIB: process.env.CAMEL_STD_LIB || t("(not set)"),
            CAMEL_PACKAGES: process.env.CAMEL_PACKAGES || t("(not set)")
        }
    }
}
