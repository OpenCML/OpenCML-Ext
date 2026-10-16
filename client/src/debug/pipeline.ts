import * as vscode from 'vscode'
import * as path from 'path'
import { t } from '../localization'
import { parsePipelineInput, pauseBeforePass } from './pipelineInput'

interface SavedPipeline { input: string }

/** Native quick inputs keep the common run command immediate and configuration reviewable. */
export async function launchPipeline(context: vscode.ExtensionContext, inspect: boolean,
    run?: (program: string, passes: string[]) => Promise<number | undefined>): Promise<boolean | number | undefined> {
    const editor = vscode.window.activeTextEditor
    const source = editor?.document.languageId === 'cml' && editor.document.uri.scheme === 'file' ? editor.document : undefined
    const folder = source ? vscode.workspace.getWorkspaceFolder(source.uri) : vscode.workspace.workspaceFolders?.[0]
    const key = `debug.pipeline.${folder?.uri.toString() ?? 'standalone'}.${inspect ? 'inspect' : 'run'}`
    const saved = context.workspaceState.get<SavedPipeline>(key)
    const input = await vscode.window.showInputBox({
        title: inspect ? t('Debug GIR Passes') : t('Run with Passes'),
        value: saved?.input ?? 'std::macro std::inline std::nvm',
        prompt: t('Enter passes in execution order, or paste camel "file.cml" pass1 pass2. No shell commands or CLI flags.'),
        placeHolder: 'std::macro std::inline std::nvm',
        ignoreFocusOut: true,
        validateInput: value => {
            try { parsePipelineInput(value); return undefined }
            catch { return t('Use space-separated pass names (for example std::macro std::nvm) and close any file-path quotes.') }
        }
    })
    if (input === undefined) return
    const parsed = parsePipelineInput(input)
    const program = parsed.program
        ? path.resolve(folder?.uri.fsPath ?? (source ? path.dirname(source.uri.fsPath) : process.cwd()), parsed.program)
        : source?.uri.fsPath
    if (!program) {
        void vscode.window.showErrorMessage(t('Open a saved CML file, or include its path in the Camel command.'))
        return
    }
    const uri = vscode.Uri.file(program)
    try { await vscode.workspace.fs.stat(uri) }
    catch { void vscode.window.showErrorMessage(t('CML file not found: {0}', program)); return }
    if (!inspect && run) {
        const result = await run(program, parsed.passes)
        if (result !== undefined) await context.workspaceState.update(key, { input })
        return result
    }
    let pauseIndex = 0
    if (inspect) {
        const before = await vscode.window.showInputBox({
            title: t('Pause before pass'), value: parsed.passes[0], ignoreFocusOut: true,
            prompt: t('Pause before this pass executes; use Next pass afterwards. Repeated names select the first occurrence.'),
            validateInput: value => {
                try { pauseBeforePass(parsed.passes, value); return undefined }
                catch { return t('Enter a pass name from this pipeline: {0}', parsed.passes.join(' ')) }
            }
        })
        if (before === undefined) return
        pauseIndex = pauseBeforePass(parsed.passes, before)
    }
    const document = await vscode.workspace.openTextDocument(uri)
    const targetFolder = vscode.workspace.getWorkspaceFolder(uri)
    const dirty = vscode.workspace.textDocuments.filter(doc => doc.isDirty && doc.languageId === 'cml' &&
        doc.uri.scheme === 'file' && (doc === document || (targetFolder &&
            vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.toString() === targetFolder.uri.toString())))
    for (const doc of dirty) if (!await doc.save() || doc.isDirty) return
    if (dirty.some(doc => doc.isDirty)) return
    const started = await vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(uri) ?? folder, {
        type: 'camel', request: 'launch', name: inspect ? t('Debug GIR Passes') : t('Run with Passes'),
        program, passes: parsed.passes, passBreakpoints: [pauseIndex],
        stopOnEntry: false, stepBy: 'line', frames: 'functions',
        cwd: (vscode.workspace.getWorkspaceFolder(uri) ?? folder)?.uri.fsPath ?? path.dirname(program)
    })
    if (started) await context.workspaceState.update(key, { input })
    return started
}
