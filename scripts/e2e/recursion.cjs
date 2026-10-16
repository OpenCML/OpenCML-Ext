const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
exports.run = async (vscode, workspace) => {
    const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')
    const chinese = /^zh/i.test(vscode.env.language)
    const program = path.join(workspace.uri.fsPath, 'recursion.cml')
    fs.writeFileSync(program, `module recursion
sync func timed(remaining: int, ticks: int): int {
    return if remaining <= 0 then ticks else sync {
        return timed(remaining - 1, ticks + 1)
    }
}
func main(): int sync {
    let result = timed(3, 0)
    println(result)
    return 0
}
`)
    const stops = []
    const tracker = vscode.debug.registerDebugAdapterTrackerFactory('camel', {
        createDebugAdapterTracker: () => ({ onDidSendMessage: m => {
            if (m.type === 'event' && m.event === 'camel/stopped') stops.push(m.body)
        } })
    })
    const wait = async predicate => {
        for (let i = 0; i < 200; ++i) {
            if (await predicate()) return
            await new Promise(resolve => setTimeout(resolve, 100))
        }
        throw new Error('Timed out waiting for recursion debug state')
    }
    let browser, session
    try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.E2E_CDP_PORT}`)
        const doc = await vscode.workspace.openTextDocument(program)
        for (const backend of ['std::nvm', 'std::fvm']) {
            await vscode.window.showTextDocument(doc)
            const count = stops.length
            assert(await vscode.debug.startDebugging(undefined, {
                type: 'camel', request: 'launch', name: `Recursion ${backend}`, program,
                passes: [backend], stopOnEntry: true, stepBy: 'line', frames: 'functions'
            }))
            session = vscode.debug.activeDebugSession
            await wait(() => stops.length > count)
            await session.customRequest('setBreakpoints', { source: { path: program }, breakpoints: [{ line: 4 }] })
            const initial = stops.length
            await session.customRequest('continue', { threadId: 1 })
            await wait(() => stops.length > initial)
            await session.customRequest('setBreakpoints', { source: { path: program }, breakpoints: [] })
            let frame
            await wait(async () => {
                for (const page of browser.contexts().flatMap(c => c.pages()))
                    for (const f of page.frames()) if (await f.locator('.debug-call').count()) frame = f
                return frame && (await frame.locator('.debug-call').innerText()).includes('remaining')
            })
            const step = async command => {
                const n = stops.length
                await vscode.commands.executeCommand(command)
                await wait(() => stops.length > n)
            }
            await step('workbench.action.debug.stepInto') // F11 command
            assert.equal(stops.at(-1).frame.entry, true)
            const call = frame.locator('.debug-call')
            await call.getByText(chinese ? '进入 timed' : 'Entered timed', { exact: true }).waitFor()
            await wait(async () => (await call.innerText()).includes('3 → 2'))
            assert((await call.innerText()).includes('0 → 1'))
            assert((await call.innerText()).includes(chinese ? '尾调用 · 1' : 'Tail call · 1'))
            await vscode.commands.executeCommand('notifications.clearAll')
            const page = frame.page()
            await page.screenshot({ path: path.join(workspace.uri.fsPath, `recursion-${backend.slice(5)}.png`) })
            if (backend === 'std::nvm') {
                await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Light Modern', vscode.ConfigurationTarget.Workspace)
                await frame.waitForFunction(() => document.body.classList.contains('vscode-light'))
                await page.screenshot({ path: path.join(workspace.uri.fsPath, 'recursion-light.png') })
                await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Workspace)
                await frame.waitForFunction(() => document.body.classList.contains('vscode-dark'))
            }
            await frame.locator('.panel').evaluate(panel => { panel.style.width = '320px' })
            assert(await call.evaluate(el => el.scrollWidth <= el.clientWidth), 'argument summary overflows narrow panel')
            await page.screenshot({ path: path.join(workspace.uri.fsPath, `recursion-${backend.slice(5)}-narrow.png`) })
            await frame.locator('.panel').evaluate(panel => { panel.style.width = '' })
            await step('workbench.action.debug.stepOver') // F10 to recursive call line
            assert.equal(stops.at(-1).frame.line, 4)
            await wait(async () => (await call.innerText()).includes('3 → 2'))
            await step('workbench.action.debug.stepOver') // F10 skips remaining tail calls
            assert.equal(stops.at(-1).frame.function, 'main')
            assert.equal(stops.at(-1).frame.line, 9)
            await wait(async () => !(await call.innerText()).includes('remaining'))
            await vscode.debug.stopDebugging(session)
            await wait(() => !vscode.debug.activeDebugSession)
        }
        console.log('RECURSION_UI_OK: F10 skips tail calls, F11 enters with argument deltas on NVM/FVM; narrow layout and session isolation')
        console.log('RECURSION_SCREENSHOTS:', workspace.uri.fsPath)
    } finally {
        if (session) await vscode.debug.stopDebugging(session)
        tracker.dispose()
        if (browser) await browser.close()
    }
}
