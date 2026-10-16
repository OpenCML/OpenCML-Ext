// Launches the real VSCode extension host with our extension and runs the E2E smoke test.
// Creates a throwaway workspace (a copy of test/test) and points camelPath at the
// local Camel build, so the repo fixtures are never modified.
import { runTests } from '@vscode/test-electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const camelExe =
    process.env.CAMEL_EXE_PATH || 'D:/Projects/Camel/out/latest/bin/camel.exe'

// Prepare a temp workspace with fixtures and a workspace-level camelPath setting.
const mode = process.env.E2E_MODE || 'full'
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'opencml-e2e-'))
for (const entry of fs.readdirSync(path.join(repoRoot, 'test', 'test'))) {
    if (entry.endsWith('.cml')) {
        fs.copyFileSync(
            path.join(repoRoot, 'test', 'test', entry),
            path.join(workspace, entry)
        )
    }
}
fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true })
const camelPathSetting =
    mode === 'fallback' ? 'C:/definitely-not-exists/camel.exe' : camelExe
fs.writeFileSync(
    path.join(workspace, '.vscode', 'settings.json'),
    JSON.stringify({ 'opencmlLanguageServer.camelPath': camelPathSetting }, null, 4)
)
fs.writeFileSync(path.join(workspace, 'mode.txt'), mode)
// An isolated profile needs its own installed language-pack registry for --locale.
if (process.env.E2E_LANGUAGEPACKS) {
    fs.mkdirSync(path.join(workspace, 'vscode-user'), { recursive: true })
    fs.copyFileSync(process.env.E2E_LANGUAGEPACKS, path.join(workspace, 'vscode-user', 'languagepacks.json'))
}
console.log('E2E workspace:', workspace)
console.log('E2E mode:', mode)
console.log('Camel exe:', camelExe)

if (mode !== 'fallback' && !fs.existsSync(camelExe)) {
    console.error(`Camel executable not found: ${camelExe}`)
    console.error('Set CAMEL_EXE_PATH to a valid camel.exe and retry.')
    process.exit(1)
}

try {
    await runTests({
        vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH || 'G:/DevTools/Microsoft VS Code/Code.exe',
        extensionDevelopmentPath: repoRoot,
        extensionTestsPath: path.join(__dirname, 'index.cjs'),
        launchArgs: ['--locale', process.env.E2E_LOCALE || 'en', ...(['gir', 'pipeline', 'memory', 'recursion'].includes(mode) ? [`--remote-debugging-port=${process.env.E2E_CDP_PORT || 19338}`] : []), workspace, '--disable-extensions', '--user-data-dir', path.join(workspace, 'vscode-user'), '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust']
    })
    console.log('E2E PASSED')
    process.exit(0)
} catch (err) {
    console.error('E2E FAILED:', err)
    process.exit(1)
}
