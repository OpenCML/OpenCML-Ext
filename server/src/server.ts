import {
    createConnection,
    TextDocuments,
    DiagnosticSeverity,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    CompletionItem,
    CompletionItemKind,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    InitializeResult,
    DocumentDiagnosticReportKind,
    type DocumentDiagnosticReport,
    HoverParams,
    Hover,
    DocumentFormattingParams,
    SignatureHelpParams,
    SignatureHelp,
    Range,
    Position,
} from 'vscode-languageserver/node'

import { TextDocument, TextEdit } from 'vscode-languageserver-textdocument'
import * as child_process from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'
import { fileURLToPath } from 'url'
// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all)

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

let hasConfigurationCapability = false
let hasWorkspaceFolderCapability = false
let hasDiagnosticRelatedInformationCapability = false

connection.onInitialize((params: InitializeParams) => {
    const capabilities = params.capabilities

    // Does the client support the `workspace/configuration` request?
    // If not, we fall back using global settings.
    hasConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.configuration
    )
    hasWorkspaceFolderCapability = !!(
        capabilities.workspace && !!capabilities.workspace.workspaceFolders
    )
    hasDiagnosticRelatedInformationCapability = !!(
        capabilities.textDocument &&
        capabilities.textDocument.publishDiagnostics &&
        capabilities.textDocument.publishDiagnostics.relatedInformation
    )

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: {
                openClose: true,
                change: TextDocumentSyncKind.Incremental,
                willSave: true,
                save: { includeText: true }
            },
            // Tell the client that this server supports code completion.
            hoverProvider: true,
            completionProvider: {
                resolveProvider: true
            },
            diagnosticProvider: {
                interFileDependencies: false,
                workspaceDiagnostics: false
            },
            documentFormattingProvider: true,
            signatureHelpProvider: {
                triggerCharacters: ['(', '->', '.']
            }
        }
    }
    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true
            }
        }
    }
    return result
})

connection.onInitialized(() => {
    if (hasConfigurationCapability) {
        // Register for all configuration changes.
        connection.client.register(DidChangeConfigurationNotification.type, undefined)
    }
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders((_event) => {
            connection.console.log('Workspace folder change event received.')
        })
    }
    updateSettings()
})

connection.onHover((params: HoverParams): Promise<Hover> => {
    return Promise.resolve({
        contents: ['OpenCML']
    })
})

connection.onDocumentFormatting(async (params: DocumentFormattingParams): Promise<TextEdit[]> => {
    const { textDocument } = params

    if (!textDocument.uri.endsWith('.cml')) {
        return []
    }
    const doc = documents.get(textDocument.uri)!
    const filePath = fileURLToPath(textDocument.uri)
    const text = doc.getText()

    try {
        const formattedText = await formatCode(text, filePath)
        const fullRange = Range.create(Position.create(0, 0), doc.positionAt(text.length))
        const edit: TextEdit = {
            range: fullRange,
            newText: formattedText
        }
        return [edit]
    } catch (error) {
        console.error(error)
        return []
    }
})

connection.onSignatureHelp((params: SignatureHelpParams): Promise<SignatureHelp> => {
    return Promise.resolve({
        signatures: [
            // {
            //     label: 'Signature Demo',
            //     documentation: '帮助文档',
            //     parameters: [
            //         {
            //             label: '@p1 first param',
            //             documentation: '参数说明'
            //         }
            //     ]
            // }
        ],
        activeSignature: 0,
        activeParameter: 0
    })
})

// The example settings
interface Settings {
    maxNumberOfProblems: number,
    camelPath: string
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: Settings = { maxNumberOfProblems: 1000, camelPath: 'camel' }
let globalSettings: Settings = defaultSettings

async function updateSettings() {
    const settings = await connection.workspace.getConfiguration('opencmlLanguageServer')
    globalSettings = settings as Settings
}

connection.onDidChangeConfiguration(async () => {
    if (hasConfigurationCapability) {
        // fetch the settings for this client
        await updateSettings()
        console.log('Settings updated:', globalSettings)
    }
    // Refresh the diagnostics since the `maxNumberOfProblems` could have changed.
    // We could optimize things here and re-fetch the setting first can compare it
    // to the existing setting, but this is out of scope for this example.
    connection.languages.diagnostics.refresh()
})

connection.languages.diagnostics.on(async (params) => {
    const document = documents.get(params.textDocument.uri)
    documents.listen(connection);
    if (!document || !document.uri.endsWith('.cml')) {
        console.log('Skipping non-CML file:', document?.uri);
        return {
            kind: DocumentDiagnosticReportKind.Full,
            items: []
        };
    }
    try {
        const filePath = fileURLToPath(document.uri)
        if (document !== undefined) {
            return {
                kind: DocumentDiagnosticReportKind.Full,
                items: await validateCode(document.getText(), filePath)
            } satisfies DocumentDiagnosticReport
        } else {
            // We don't know the document. We can either try to read it from disk
            // or we don't report problems for it.
            return {
                kind: DocumentDiagnosticReportKind.Full,
                items: []
            } satisfies DocumentDiagnosticReport
        }
    } catch (error) {
        console.log('Error during validation:', error)
        return {
            kind: DocumentDiagnosticReportKind.Full,
            items: []
        } satisfies DocumentDiagnosticReport
    }
})

interface CamelDiagnostic {
    range?: {
        start: { line: number; character: number }
        end: { line: number; character: number }
    }
    severity?: string
    message?: string
    data?: { suggestion?: string }
}

function execFileAsync(
    command: string,
    args: string[],
    options: child_process.ExecFileOptions = {}
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        child_process.execFile(
            command,
            args,
            { maxBuffer: 16 * 1024 * 1024, timeout: 30000, ...options },
            (error, stdout, stderr) => {
                if (error) {
                    reject(error)
                } else {
                    resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
                }
            }
        )
    })
}

// Write buffer content to a temporary file next to the real file so that
// relative module resolution keeps working. `camel check` requires a file
// argument (it does not read stdin).
function writeTempSourceFile(filePath: string, content: string): string {
    const dir = path.dirname(filePath)
    const ext = path.extname(filePath) || '.cml'
    const tmp = path.join(dir, `.camel-lsp-${crypto.randomBytes(6).toString('hex')}${ext}`)
    fs.writeFileSync(tmp, content)
    return tmp
}

function removeFileQuietly(filePath: string | null) {
    if (!filePath) {
        return
    }
    try {
        fs.unlinkSync(filePath)
    } catch {
        // ignore
    }
}

// The formatter is a separate executable shipped next to camel:
// camel -> camel-format, camel.exe -> camel-format.exe
function resolveFormatterPath(camelPath: string): string {
    const dir = path.dirname(camelPath)
    const base = path.basename(camelPath)
    const match = /^camel(\.exe)?$/.exec(base)
    const fmtBase = match ? `camel-format${match[1] || ''}` : 'camel-format'
    return dir === '.' ? fmtBase : path.join(dir, fmtBase)
}

// Parse `camel check -O json` output. Two shapes exist:
//  - dumpAllModuleDiagnostics: a JSON array, pretty-printed with one diagnostic object per line
//  - uncaught parse errors: a single line `Uncaught diagnostic: {json}`
function parseCamelDiagnostics(stdout: string): CamelDiagnostic[] {
    const out: CamelDiagnostic[] = []
    for (const line of stdout.split('\n')) {
        const trimmed = line.trim()
        let jsonText = ''
        if (trimmed.startsWith('{"range"')) {
            jsonText = trimmed
        } else if (trimmed.startsWith('Uncaught diagnostic:')) {
            jsonText = trimmed.slice('Uncaught diagnostic:'.length).trim()
        }
        if (!jsonText) {
            continue
        }
        // Sanitize: array elements carry trailing commas, and `severity` is an
        // unquoted identifier in camel's JSON dump.
        jsonText = jsonText
            .replace(/,+$/, '')
            .replace(/"severity":(Error|Warn|Info|Hint)\b/g, '"severity":"$1"')
        try {
            const obj = JSON.parse(jsonText) as CamelDiagnostic
            if (obj && obj.message) {
                out.push(obj)
            }
        } catch {
            // not a diagnostic JSON line, ignore
        }
    }
    return out
}

function mapSeverity(severity: string | undefined): DiagnosticSeverity {
    switch (severity) {
        case 'Warn':
            return DiagnosticSeverity.Warning
        case 'Info':
            return DiagnosticSeverity.Information
        case 'Hint':
            return DiagnosticSeverity.Hint
        default:
            return DiagnosticSeverity.Error
    }
}

export async function validateCode(codeText: string, filePath: string) {
    let tmpFile: string | null = null
    try {
        const camelPath = globalSettings.camelPath
        console.log('using camel path:', camelPath)
        console.log('checking file', filePath)

        tmpFile = writeTempSourceFile(filePath, codeText)
        const { stdout } = await execFileAsync(camelPath, ['check', '-O', 'json', tmpFile], {
            cwd: path.dirname(filePath)
        })

        const parsed = parseCamelDiagnostics(stdout)
        console.log(`Found ${parsed.length} issue(s) for ${filePath}`)

        return parsed.map((d) => ({
            severity: mapSeverity(d.severity),
            range: {
                start: {
                    line: Math.max(0, d.range?.start?.line ?? 0),
                    character: Math.max(0, d.range?.start?.character ?? 0)
                },
                end: {
                    line: Math.max(0, d.range?.end?.line ?? 0),
                    character: Math.max(0, d.range?.end?.character ?? 0)
                }
            },
            message: d.data?.suggestion ? `${d.message} (${d.data.suggestion})` : (d.message as string),
            source: 'Camel'
        }))
    } catch (error) {
        console.log('Error validating code:', error)
        return []
    } finally {
        removeFileQuietly(tmpFile)
    }
}

export async function formatCode(codeText: string, filePath: string) {
    let tmpFile: string | null = null
    try {
        const formatterPath = resolveFormatterPath(globalSettings.camelPath)
        console.log('using formatter path:', formatterPath)
        console.log('formatting file:', filePath)

        tmpFile = writeTempSourceFile(filePath, codeText)
        const { stdout } = await execFileAsync(formatterPath, [tmpFile], {
            cwd: path.dirname(filePath)
        })

        console.log('Formatted code:', stdout)
        return stdout
    } catch (error) {
        console.log('Error formatting code:', error)
        return codeText
    } finally {
        removeFileQuietly(tmpFile)
    }
}

connection.onDidChangeWatchedFiles((_change) => {
    // Monitored files have change in VSCode
    connection.console.log('We received a file change event')
})

// This handler provides the initial list of the completion items.
connection.onCompletion((_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    // The pass parameter contains the position of the text document in
    // which code complete got requested. For the example we ignore this
    // info and always provide the same completion items.
    return [
        {
            label: 'TypeScript',
            kind: CompletionItemKind.Text,
            data: 1
        },
        {
            label: 'JavaScript',
            kind: CompletionItemKind.Text,
            data: 2
        }
    ]
})

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
    if (item.data === 1) {
        item.detail = 'TypeScript details'
        item.documentation = 'TypeScript documentation'
    } else if (item.data === 2) {
        item.detail = 'JavaScript details'
        item.documentation = 'JavaScript documentation'
    }
    return item
})

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection)

// Listen on the connection
connection.listen()
