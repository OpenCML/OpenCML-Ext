// Launches the real VSCode extension host with our extension and runs the E2E smoke test.
import { runTests } from '@vscode/test-electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')

try {
    await runTests({
        vscodeExecutablePath: 'G:/DevTools/Microsoft VS Code/Code.exe',
        extensionDevelopmentPath: repoRoot,
        extensionTestsPath: path.join(__dirname, 'index.cjs'),
        launchArgs: [path.join(repoRoot, 'test', 'test'), '--disable-extensions']
    })
    console.log('E2E PASSED')
    process.exit(0)
} catch (err) {
    console.error('E2E FAILED:', err)
    process.exit(1)
}
