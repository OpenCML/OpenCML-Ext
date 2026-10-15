// CLI-only fallback for installations without camel-ls.
import {
    createConnection, TextDocuments, ProposedFeatures, TextDocumentSyncKind,
    DocumentDiagnosticReportKind, DiagnosticSeverity, type Diagnostic,
    type InitializeResult
} from 'vscode-languageserver/node'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { execFile } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'
import { fileURLToPath } from 'url'
import { detectToolchain } from '../../client/src/toolchain'
import { moduleDiagnostics } from '../../client/src/diagnostics'
import { setLocale, t } from '../../client/src/localization'

const connection = createConnection(ProposedFeatures.all)
const documents = new TextDocuments(TextDocument)
interface Settings { camelPath: string; maxNumberOfProblems: number; runtime?: { checkTimeoutMs?: number } }
const defaults: Settings = { camelPath: 'camel', maxNumberOfProblems: 100 }
let globalSettings = defaults
let hasConfiguration = false
let pullsDiagnostics = false
let diagnosticsEnabled = true
const versions = new Map<string, number>()

connection.onInitialize(params => {
    setLocale(params.locale)
    diagnosticsEnabled = params.initializationOptions?.cliDiagnostics !== false
    hasConfiguration = !!params.capabilities.workspace?.configuration
    pullsDiagnostics = !!params.capabilities.textDocument?.diagnostic
    return { capabilities: {
        textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Incremental, save: true },
        ...(diagnosticsEnabled ? { diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false } } : {}),
        documentFormattingProvider: params.initializationOptions?.cliFormatting !== false
    } } satisfies InitializeResult
})

async function settingsFor(uri: string): Promise<Settings> {
    const settings = hasConfiguration
        ? await connection.workspace.getConfiguration({ scopeUri: uri, section: 'opencmlLanguageServer' })
        : globalSettings
    return { ...defaults, ...settings }
}
connection.onDidChangeConfiguration(change => {
    globalSettings = { ...defaults, ...change.settings?.opencmlLanguageServer }
    if (pullsDiagnostics) void connection.languages.diagnostics.refresh()
    else documents.all().forEach(doc => void publish(doc))
})

// Compilation errors intentionally exit nonzero while still producing diagnostics.
function run(command: string, args: string[], cwd: string, allowDiagnostics = false, timeout = 60000): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(command, args, { cwd, windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error && !(allowDiagnostics && typeof error.code === 'number' && stdout.trim())) reject(error)
                else resolve(stdout.toString())
            })
    })
}
async function withSource<T>(doc: TextDocument, action: (file: string, settings: Settings) => Promise<T>): Promise<T> {
    const file = fileURLToPath(doc.uri)
    const settings = await settingsFor(doc.uri)
    const tmp = path.join(path.dirname(file), `.camel-lsp-${crypto.randomBytes(8).toString('hex')}.cml`)
    try {
        await fs.promises.writeFile(tmp, doc.getText())
        return await action(tmp, settings)
    } finally {
        await fs.promises.unlink(tmp).catch(() => {})
    }
}
function parseDiagnostics(text: string): Diagnostic[] {
    // Current runtime emits a JSON array. Retain compatibility with older JSON dumps.
    const clean = text.replace(/"severity":\s*(Error|Warn|Info|Hint)\b/g, '"severity":"$1"')
    let records: any[]
    try {
        const value = JSON.parse(clean)
        records = Array.isArray(value) ? value : [value]
    } catch {
        records = clean.split('\n').flatMap(line => {
            try { return [JSON.parse(line.trim().replace(/^Uncaught diagnostic:\s*/, '').replace(/,+$/, ''))] }
            catch { return [] }
        })
    }
    const severities: Record<string, DiagnosticSeverity> = { Error: 1, Warn: 2, Warning: 2, Info: 3, Hint: 4 }
    return records.filter(d => d && typeof d.message === 'string' && d.range).map(d => ({
        range: d.range,
        severity: typeof d.severity === 'number' ? d.severity : severities[d.severity] || DiagnosticSeverity.Error,
        code: d.code, message: d.message, data: d.data, source: 'Camel'
    }))
}
async function validate(doc: TextDocument): Promise<Diagnostic[]> {
    if (!diagnosticsEnabled) return []
    if (!doc.uri.startsWith('file:')) return []
    try {
        return await withSource(doc, async (file, settings) => {
            const tools = detectToolchain(settings.camelPath)
            const output = await run(tools.camel, ['check', '-O', 'json', file], path.dirname(file), true, Math.max(1000, Math.min(600000, settings.runtime?.checkTimeoutMs ?? 60000)))
            return moduleDiagnostics(parseDiagnostics(output)).slice(0, Math.max(0, settings.maxNumberOfProblems))
        })
    } catch (error) {
        connection.console.error(t('Camel diagnostics failed: {0}', error))
        return []
    }
}
connection.languages.diagnostics.on(async params => {
    const doc = documents.get(params.textDocument.uri)
    return { kind: DocumentDiagnosticReportKind.Full, items: doc ? await validate(doc) : [] }
})
async function publish(doc: TextDocument) {
    const version = doc.version
    versions.set(doc.uri, version)
    const items = await validate(doc)
    if (versions.get(doc.uri) === version && documents.get(doc.uri)) {
        await connection.sendDiagnostics({ uri: doc.uri, version, diagnostics: items })
    }
}
documents.onDidChangeContent(({ document }) => { if (!pullsDiagnostics) void publish(document) })
documents.onDidClose(({ document }) => {
    versions.delete(document.uri)
    if (!pullsDiagnostics) void connection.sendDiagnostics({ uri: document.uri, diagnostics: [] })
})
connection.onDocumentFormatting(async params => {
    const doc = documents.get(params.textDocument.uri)
    if (!doc || !doc.uri.startsWith('file:')) return []
    try {
        const newText = await withSource(doc, async (file, settings) => {
            const tools = detectToolchain(settings.camelPath)
            const formatter = tools.camelFormat || path.join(path.dirname(tools.camel), process.platform === 'win32' ? 'camel-format.exe' : 'camel-format')
            return run(formatter, [file], path.dirname(file))
        })
        return newText === doc.getText() ? [] : [{ range: { start: { line: 0, character: 0 }, end: doc.positionAt(doc.getText().length) }, newText }]
    } catch (error) {
        connection.console.error(t('Camel formatting failed: {0}', error))
        return []
    }
})
documents.listen(connection)
connection.listen()
