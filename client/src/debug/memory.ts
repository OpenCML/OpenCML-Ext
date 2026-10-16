import * as vscode from 'vscode'
import { t } from '../localization'
import type { CamelDebugAdapterFactory, DebugViewState } from './adapter'

/** Session-scoped, request-driven memory inspection. No heap polling or extra worker. */
export class MemoryInspector {
    private panel?: vscode.WebviewPanel
    private revision = 0
    private lastSession?: string
    private lastState?: DebugViewState
    constructor(private readonly context: vscode.ExtensionContext,
        private readonly factory: CamelDebugAdapterFactory,
        private readonly html: (panel: vscode.WebviewPanel) => string) {
        context.subscriptions.push(vscode.commands.registerCommand('camel.showMemory', () => this.show()),
            vscode.debug.onDidChangeActiveDebugSession(() => this.update()))
    }
    show() {
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel('camel.memory', t('Camel Memory'), vscode.ViewColumn.Beside,
                { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')] })
            this.panel.webview.html = this.html(this.panel)
            this.panel.onDidDispose(() => { this.panel = undefined; ++this.revision }, undefined, this.context.subscriptions)
            this.panel.webview.onDidReceiveMessage(message => {
                if (message.command === 'ready') { this.update(undefined, undefined, true); return }
                if (message.command === 'memoryRequest') void this.request(message)
            }, undefined, this.context.subscriptions)
        }
        this.panel.reveal(vscode.ViewColumn.Beside, true)
        this.update()
    }
    update(session?: vscode.DebugSession, state?: DebugViewState, force = false) {
        if (!this.panel) return
        const current = this.factory.currentSession()
        if (session && session.id !== current?.id) return
        const status = state ?? this.factory.currentState()
        const changed = this.lastSession !== current?.id || this.lastState !== status
        if (!changed && !force) return
        if (changed) ++this.revision
        this.lastSession = current?.id; this.lastState = status
        void this.panel.webview.postMessage({ command: 'memoryState', revision: this.revision, sessionId: current?.id,
            name: current?.name, status: status?.status ?? (current ? 'running' : 'none'), allocation: status?.allocation })
    }
    private async request(message: { id: number; operation: string; args?: Record<string, unknown> }) {
        const session = this.factory.currentSession(), revision = this.revision
        const commands: Record<string, string> = { snapshot: 'camel/memorySnapshot', bytes: 'camel/regionMemory', objects: 'camel/regionObjects', allocation: 'camel/allocationBreakpoints' }
        try {
            if (!session || this.factory.currentState()?.status !== 'paused') throw new Error(t('Pause a Camel debug session to inspect memory.'))
            const command = commands[message.operation]
            if (!command) throw new Error('Unknown memory operation')
            const result = await session.customRequest(command, message.args ?? {})
            if (revision !== this.revision || session.id !== this.factory.currentSession()?.id) return
            void this.panel?.webview.postMessage({ command: 'memoryResponse', id: message.id, result })
        } catch (error) {
            if (revision !== this.revision) return
            void this.panel?.webview.postMessage({ command: 'memoryResponse', id: message.id, error: String(error) })
        }
    }
}
