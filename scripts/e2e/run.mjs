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
fs.writeFileSync(
    path.join(workspace, '.vscode', 'settings.json'),
    JSON.stringify({ 'opencmlLanguageServer.camelPath': camelExe }, null, 4)
)
console.log('E2E workspace:', workspace)
console.log('Camel exe:', camelExe)

if (!fs.existsSync(camelExe)) {
    console.error(`Camel executable not found: ${camelExe}`)
    console.error('Set CAMEL_EXE_PATH to a valid camel.exe and retry.')
    process.exit(1)
}

try {
    await runTests({
        vscodeExecutablePath: 'G:/DevTools/Microsoft VS Code/Code.exe',
        extensionDevelopmentPath: repoRoot,
        extensionTestsPath: path.join(__dirname, 'index.cjs'),
        launchArgs: [workspace, '--disable-extensions']
    })
    console.log('E2E PASSED')
    process.exit(0)
} catch (err) {
    console.error('E2E FAILED:', err)
    process.exit(1)
}
