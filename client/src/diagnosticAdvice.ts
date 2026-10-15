import { t } from './localization'
import * as vscode from 'vscode'
import { moduleDiagnostics } from './diagnostics'

export function diagnosticSuggestion(diagnostic: vscode.Diagnostic): string | undefined {
    const data = (diagnostic as vscode.Diagnostic & { data?: unknown }).data
    if (!data || typeof data !== 'object') return undefined
    const suggestion = (data as { suggestion?: unknown }).suggestion
    return typeof suggestion === 'string' && suggestion.trim() ? suggestion.trim() : undefined
}

export function presentDiagnostics(diagnostics: vscode.Diagnostic[], uri?: vscode.Uri): vscode.Diagnostic[] {
    const config = vscode.workspace.getConfiguration('opencmlLanguageServer', uri)
    const overrides = config.get<Record<string, string>>('diagnostics.severityOverrides', {})
    const byCode = new Map(Object.entries(overrides).map(([code, level]) => [code.toLowerCase(), level]))
    const levels: Record<string, vscode.DiagnosticSeverity> = { error: vscode.DiagnosticSeverity.Error, warning: vscode.DiagnosticSeverity.Warning, information: vscode.DiagnosticSeverity.Information, hint: vscode.DiagnosticSeverity.Hint }
    return moduleDiagnostics(diagnostics).flatMap(original => {
        const code = typeof original.code === 'object' ? original.code.value : original.code
        const level = byCode.get(String(code).toLowerCase())
        if (level === 'off') return []
        const diagnostic = Object.assign(new vscode.Diagnostic(original.range, original.message, original.severity), original)
        if (level && level in levels) diagnostic.severity = levels[level]
        const suggestion = diagnosticSuggestion(diagnostic)
        if (suggestion && !diagnostic.message.includes(t("\n\nSuggestion:\n{0}", suggestion))) {
            diagnostic.message += t("\n\nSuggestion:\n{0}", suggestion)
        }
        return [diagnostic]
    }).slice(0, Math.max(0, config.get<number>('maxNumberOfProblems', 100)))
}

export function registerDiagnosticAdvice(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('camel.showDiagnosticAdvice', async (uri: vscode.Uri, diagnostic: vscode.Diagnostic) => {
            const suggestion = diagnosticSuggestion(diagnostic)
            if (!suggestion) return
            const code = typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code
            const content = [
                t("Camel diagnostic advice"), '', `${uri.fsPath}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}`,
                t("Diagnostic code: {0}", code ?? t("None")), '', diagnostic.message.split(t("\n\nSuggestion:\n"))[0], '', t("Runtime suggestion"), '', suggestion
            ].join('\n')
            const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content })
            await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: true })
        }),
        vscode.languages.registerCodeActionsProvider({ language: 'cml' }, {
            provideCodeActions(document, _range, context) {
                return context.diagnostics.filter(d => d.source === 'Camel' && diagnosticSuggestion(d)).map(diagnostic => {
                    const code = typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code
                    const title = t("Show Camel fix suggestion{0}", code ? ` (${code})` : '')
                    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix)
                    action.diagnostics = [diagnostic]
                    // Suggestions are prose, not verified edits. Never turn them into guessed changes.
                    action.command = { title, command: 'camel.showDiagnosticAdvice', arguments: [document.uri, diagnostic] }
                    return action
                })
            }
        }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] })
    )
}
