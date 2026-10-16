import * as vscode from 'vscode'
import { t } from '../localization'

/** One native DAP adapter per VS Code session. The plugin observes events for GIR only;
 * breakpoints, stack, values, stepping and lifecycle belong to camel-db. */
export class CamelDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    onDidChangePausedNode: ((session: vscode.DebugSession, origin: number | null) => void) | null = null
    onDidRefreshGirIndex: ((session: vscode.DebugSession) => void) | null = null
    onDidStop: ((session: vscode.DebugSession) => void) | null = null
    private origins: number[] = []

    constructor(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('camel', {
            createDebugAdapterTracker: session => ({
                onDidSendMessage: message => {
                    if (message.type !== 'event') return
                    if (message.event === 'initialized') {
                        // This event follows compilation and precedes configurationDone.
                        void this.sendBreakpoints(session)
                        this.onDidRefreshGirIndex?.(session)
                    } else if (message.event === 'camel/stopped') {
                        const origin = Number(message.body?.frame?.node?.origin ?? 0)
                        this.onDidChangePausedNode?.(session, origin > 0 ? origin : null)
                        this.onDidStop?.(session)
                    } else if (message.event === 'continued' || message.event === 'terminated') {
                        this.onDidChangePausedNode?.(session, null)
                    }
                }
            })
        }))
    }

    createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.DebugAdapterDescriptor {
        const executable = session.configuration.camelDbPath?.trim()
        if (!executable) throw new Error(t('camel-db not found. Set "opencmlLanguageServer.camelDbPath" or fix camelPath.'))
        return new vscode.DebugAdapterExecutable(executable, ['--dap'])
    }

    currentSession(): vscode.DebugSession | null {
        const session = vscode.debug.activeDebugSession
        return session?.type === 'camel' ? session : null
    }

    async syncNodeBreakpoints(origins: number[]): Promise<void> {
        this.origins = origins
        const session = this.currentSession()
        if (session) await this.sendBreakpoints(session)
    }

    private async sendBreakpoints(session: vscode.DebugSession): Promise<void> {
        try { await session.customRequest('camel/setNodeBreakpoints', { origins: this.origins }) }
        catch (error) { void vscode.window.showWarningMessage(t('Could not synchronize GIR breakpoints: {0}', String(error))) }
    }
}
