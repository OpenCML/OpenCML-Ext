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
    Position
} from 'vscode-languageserver/node'

import { TextDocument, TextEdit } from 'vscode-languageserver-textdocument'
import * as util from 'util'
import * as fs from 'fs'
import * as child_process from 'child_process'

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
            hoverProvider: true,
            textDocumentSync: TextDocumentSyncKind.Incremental,
            // Tell the client that this server supports code completion.
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
})

connection.onHover((params: HoverParams): Promise<Hover> => {
    return Promise.resolve({
        contents: ['OpenCML']
    })
})

connection.onDocumentFormatting(async (params: DocumentFormattingParams): Promise<TextEdit[]> => {
    const { textDocument } = params
    const doc = documents.get(textDocument.uri)!
    const text = doc.getText()

    try {
        const formattedText = await formatCode(text)
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
    maxNumberOfProblems: number
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: Settings = { maxNumberOfProblems: 1000 }
let globalSettings: Settings = defaultSettings

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<Settings>> = new Map()

connection.onDidChangeConfiguration((change) => {
    if (hasConfigurationCapability) {
        // Reset all cached document settings
        documentSettings.clear()
    } else {
        globalSettings = <Settings>(change.settings.languageServerExample || defaultSettings)
    }
    // Refresh the diagnostics since the `maxNumberOfProblems` could have changed.
    // We could optimize things here and re-fetch the setting first can compare it
    // to the existing setting, but this is out of scope for this example.
    connection.languages.diagnostics.refresh()
})

function getDocumentSettings(resource: string): Thenable<Settings> {
    if (!hasConfigurationCapability) {
        return Promise.resolve(globalSettings)
    }
    let result = documentSettings.get(resource)
    if (!result) {
        result = connection.workspace.getConfiguration({
            scopeUri: resource,
            section: 'opencmlLanguageServer'
        })
        documentSettings.set(resource, result)
    }
    return result
}

// Only keep settings for open documents
documents.onDidClose((e) => {
    documentSettings.delete(e.document.uri)
})

connection.languages.diagnostics.on(async (params) => {
    const document = documents.get(params.textDocument.uri)
    try {
        if (document !== undefined) {
            return {
                kind: DocumentDiagnosticReportKind.Full,
                items: await validateCode(document.getText())
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
        console.error('Error during validation:', error)
        return {
            kind: DocumentDiagnosticReportKind.Full,
            items: []
        } satisfies DocumentDiagnosticReport
    }
})

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
    // console.log('onDidChangeContent')
    // validateCode(change.document.getText())
})

interface ErrorInfo {
    filename: string
    line: number
    column: number
    message: string
}

export async function validateCode(codeText: string) {
    try {
        const camelProcess = child_process.spawn('camel-stable', [
            '--syntax-only',
            '--error-format',
            'json'
        ])

        const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>(
            (resolve, reject) => {
                let stdout = ''
                let stderr = ''

                camelProcess.stdout.on('data', (data) => {
                    stdout += data.toString()
                })

                camelProcess.stderr.on('data', (data) => {
                    stderr += data.toString()
                })

                camelProcess.on('close', (code) => {
                    if (code !== 0) {
                        reject(new Error(`Camel process exited with code ${code}`))
                    } else {
                        resolve({ stdout, stderr })
                    }
                })

                camelProcess.stdin.write(codeText)
                camelProcess.stdin.end()
            }
        )

        const errors: ErrorInfo[] = []

        for (const line of stdout.split('\n')) {
            if (line === '') {
                continue
            }
            try {
                const error = JSON.parse(line)
                errors.push({
                    filename: error.filename,
                    line: error.line,
                    column: error.column,
                    message: error.message
                })
            } catch (error) {
                console.error('Error parsing line:', error)
            }
        }

        const diagnostics = errors.map((error) => {
            const line = Math.max(0, error.line - 1)
            const character = Math.max(0, error.column - 1)
            return {
                severity: DiagnosticSeverity.Error,
                range: {
                    start: { line, character },
                    end: { line, character }
                },
                message: error.message,
                source: 'OpenCML'
            }
        })

        if (diagnostics.length === 0) {
            console.log('No issues found')
        } else {
            console.log(`Found ${diagnostics.length} issue(s)`)
        }

        for (const diagnostic of diagnostics) {
            console.log(`Diagnostic: ${util.inspect(diagnostic, { depth: 10 })}`)
        }

        return diagnostics
    } catch (error) {
        console.error(error)
        throw error
    }
}

export async function formatCode(codeText: string) {
    try {
        const camelProcess = child_process.spawn('camel-stable', ['--format'])

        const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>(
            (resolve, reject) => {
                let formattedCode = ''
                let stderr = ''

                camelProcess.stdout.on('data', (data) => {
                    formattedCode += data.toString().replace(/\r\n/g, '\n')
                })

                camelProcess.stderr.on('data', (data) => {
                    stderr += data.toString()
                })

                camelProcess.on('close', (code) => {
                    if (code !== 0) {
                        reject(new Error(`Camel process exited with code ${code}`))
                    } else {
                        resolve({ stdout: formattedCode, stderr })
                    }
                })

                camelProcess.stdin.write(codeText)
                camelProcess.stdin.end()
            }
        )

        if (stderr) {
            throw new Error(stderr)
        }

        console.log('Formatted code:', stdout)

        return stdout
    } catch (error) {
        console.error(error)
        throw error
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
