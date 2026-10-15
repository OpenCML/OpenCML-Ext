import { execFile } from 'child_process'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { t } from './localization'

/** Tested support baseline, not a claim that every earlier release is incompatible. */
export const MINIMUM_CAMEL = '0.2.11'
export type Feature = { supported: boolean | null; reason: string }
export interface Compatibility {
    minimumVersion: string
    version: string | null
    versionOutput: string
    status: 'supported' | 'below-minimum' | 'unknown' | 'unavailable'
    features: Record<string, Feature>
    warnings: string[]
}
export function classifyVersion(output: string): Pick<Compatibility, 'version' | 'status'> {
    // Never mistake a git tag inside Build (...) for the executable's version.
    const match = /^Camel\s+v?(\d+)\.(\d+)\.(\d+)(-[\w.-]+)?(?:\+[\w.-]+)?(?:\s|$)/im.exec(output)
    if (!match) return { version: null, status: 'unknown' }
    const parts = match.slice(1, 4).map(Number)
    const baseline = MINIMUM_CAMEL.split('.').map(Number)
    const index = parts.findIndex((part, i) => part !== baseline[i])
    const below = index < 0 ? !!match[4] : parts[index] < baseline[index]
    return { version: parts.join('.') + (match[4] || ''), status: below ? 'below-minimum' : 'supported' }
}
type CommandResult = { stdout: string; stderr: string; error?: string }
export type Runner = (executable: string, args: string[], cwd?: string) => Promise<CommandResult>
const run: Runner = (executable, args, cwd) => new Promise(resolve => {
    execFile(executable, args, { cwd, timeout: 5000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) =>
        resolve({ stdout: stdout.toString(), stderr: stderr.toString(), error: error?.message }))
})

export async function inspectCompatibility(executable: string, runner: Runner = run): Promise<Compatibility> {
    const version = await runner(executable, ['--version'])
    const output = version.stdout.trim() || version.stderr.trim()
    const report: Compatibility = {
        minimumVersion: MINIMUM_CAMEL, ...classifyVersion(output), versionOutput: output,
        features: {}, warnings: []
    }
    if (version.error) {
        report.status = 'unavailable'
        report.warnings.push(t('Could not query Camel version: {0}', version.error))
    } else if (report.status === 'below-minimum') {
        report.warnings.push(t('Camel {0} is below the supported baseline {1}. Features are checked individually; upgrade for supported operation.', report.version, MINIMUM_CAMEL))
    } else if (report.status === 'unknown') {
        report.warnings.push(t('Camel version is unknown. Required baseline: {0}. Feature probes will determine availability.', MINIMUM_CAMEL))
    }
    // Compile disposable fixtures only: never run user code or touch workspace files.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'camel-capabilities-'))
    try {
        const source = path.join(dir, 'probe.cml')
        await fs.writeFile(source, 'func make(value: int): int[] { return [value, value] }\nfunc main(): int[] { return make(1) }\n')
        const bad = path.join(dir, 'diagnostics.cml')
        await fs.writeFile(bad, 'func main(): int { return missing_capability_probe }\n')
        const [gir, diagnostics] = await Promise.all([
            runner(executable, ['--color', 'never', source, 'std::rgir'], dir),
            runner(executable, ['check', '-O', 'json', bad], dir)
        ])
        const graph = !gir.error && /\bdigraph\s+\w*\s*\{/.test(gir.stdout)
        report.features.cliGir = { supported: graph, reason: graph ? t('Read-only compilation probe passed.') : gir.stderr || gir.error || t('No GIR generated') }
        for (const [name, attribute] of [['portNames', 'param_name'], ['fillTypes', 'value_type'], ['sourceLocations', 'span']]) {
            const candidates = gir.stdout.split('\n').filter(line => name === 'fillTypes' ? /type="FILL"/.test(line) : name === 'portNames' ? /type="(?:CLOSURE_)?PORT"/.test(line) : true)
            report.features[name] = { supported: graph ? candidates.some(line => new RegExp(`\\b${attribute}="`).test(line)) : null,
                reason: graph ? t('Inspected CLI GIR metadata: {0}', attribute) : t('GIR is unavailable; metadata support is unknown.') }
        }
        let jsonDiagnostics = false
        try {
            const records = JSON.parse(diagnostics.stdout.replace(/"severity":\s*(Error|Warn|Info|Hint)\b/g, '"severity":"$1"'))
            jsonDiagnostics = Array.isArray(records) && records.some(d => typeof d.message === 'string' && d.message.includes('missing_capability_probe') && d.range)
        } catch { /* Never infer support from an exit code alone. */ }
        report.features.cliDiagnostics = { supported: jsonDiagnostics,
            reason: jsonDiagnostics ? t('JSON diagnostic probe passed.') : diagnostics.stderr || diagnostics.error || t('Structured diagnostics were not returned.') }
    } finally { await fs.rm(dir, { recursive: true, force: true }) }
    if (report.status === 'unavailable' && (report.features.cliGir.supported || report.features.cliDiagnostics.supported)) report.status = 'unknown'
    report.features.debugger = { supported: null, reason: t('Debugger versions are independent. HTTP features are checked when used in a debug session.') }
    return report
}

export function languageFeatures(capabilities: Record<string, any> | undefined): Record<string, Feature> {
    const fields = { completion: 'completionProvider', navigation: 'definitionProvider', rename: 'renameProvider', semanticHighlighting: 'semanticTokensProvider', formatting: 'documentFormattingProvider' }
    return Object.fromEntries([...Object.entries(fields).map(([feature, field]) => [feature, {
        supported: capabilities ? !!capabilities[field] : null,
        reason: capabilities ? t('Advertised by LSP: {0}', field) : t('Language server has not initialized.')
    }]), ['nativeGir', { supported: capabilities ? capabilities.experimental?.camelGraphProvider === true : null,
        reason: t('Native GIR requires the camelGraphProvider capability; otherwise the CLI is used.') }]])
}
