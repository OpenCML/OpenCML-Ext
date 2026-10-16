const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
exports.run = async (vscode, workspace) => {
    const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')
    const { loadTs } = await import('../load-ts.mjs')
    const { zh } = await loadTs(path.resolve(__dirname, '../../client/src/messages.ts'))
    const label = s => /^zh/i.test(vscode.env.language) ? zh[s] || s : s
    const program = path.join(workspace.uri.fsPath, 'pipeline.cml')
    fs.writeFileSync(program, `module pipeline
macro func add_one(x: int): int { return x + 1 }
func main(): int sync {
    let result = add_one(41)
    println(result)
    return 0
}
`)
    const stops = [], sessions = []
    const tracker = vscode.debug.registerDebugAdapterTrackerFactory('camel', {
        createDebugAdapterTracker: session => { sessions.push(session); return { onDidSendMessage: m => {
            if (m.type === 'event' && m.event === 'camel/stopped') stops.push(m.body)
        } } }
    })
    let browser, session
    try {
        const doc = await vscode.workspace.openTextDocument(program)
        await vscode.window.showTextDocument(doc)
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.E2E_CDP_PORT || 19338}`)
        if (process.env.E2E_COMPOSE_PIPELINE) {
            const page = browser.contexts().flatMap(c => c.pages())[0]
            const chinese = /^zh/i.test(vscode.env.language)
            await page.locator('.editor-actions .codicon-chevron-down').click()
            const menu = page.locator('.monaco-menu')
            await menu.getByText(chinese ? '运行 Pass…' : 'Run with Passes…', { exact: true }).waitFor()
            await menu.getByText(chinese ? '逐遍调试 GIR…' : 'Debug GIR Passes…', { exact: true }).waitFor()
            await page.screenshot({ path: path.join(workspace.uri.fsPath, 'pipeline-localized-menu.png') })
            await page.keyboard.press('Escape')
            const input = page.locator('.quick-input-widget input[type="text"]')
            const runInput = `camel "${program}" std::macro std::nvm`
            const run = vscode.commands.executeCommand('camel.runPipeline')
            await input.waitFor({ state: 'visible' })
            await input.fill(runInput)
            await input.press('Enter')
            assert.equal(await run, 0, 'composed CLI run failed')
            const cancelledRun = vscode.commands.executeCommand('camel.runPipeline')
            await input.waitFor({ state: 'visible' })
            assert.equal(await input.inputValue(), runInput, 'run sequence was not remembered')
            await input.press('Escape')
            assert.equal(await cancelledRun, undefined)
            const launch = vscode.commands.executeCommand('camel.inspectPipeline')
            await input.waitFor({ state: 'visible' })
            await input.fill(`camel "${program}" std::macro std::inline std::nvm`)
            await input.press('Enter')
            await page.locator('.quick-input-widget').getByText(label('Pause before pass'), { exact: true }).waitFor()
            assert.equal(await input.inputValue(), 'std::macro', 'pause input must default to the first pass')
            await page.screenshot({ path: path.join(workspace.uri.fsPath, 'pipeline-pause-input.png') })
            await input.press('Enter')
            assert(await launch)
            assert(!fs.existsSync(path.join(workspace.uri.fsPath, '.vscode/launch.json')))
            console.log('PIPELINE_COMPOSE_OK: pasted command, keyboard-only pause-before input and launch without launch.json')
        } else assert(await vscode.debug.startDebugging(undefined, {
            type: 'camel', request: 'launch', name: 'Pipeline UI', program,
            passes: ['std::macro', 'std::inline', 'std::nvm'], stopOnPassEntry: true
        }))
        session = vscode.debug.activeDebugSession
        let frame
        for (let i = 0; i < 100 && !frame; i++) {
            for (const page of browser.contexts().flatMap(c => c.pages())) {
                for (const f of page.frames()) if (await f.locator('.debug-strip').count()) frame = f
            }
            if (!frame) await new Promise(r => setTimeout(r, 100))
        }
        assert(frame, 'debug GIR panel did not open automatically')
        const next = frame.getByRole('button', { name: label('Next pass'), exact: false })
        await next.waitFor({ state: 'visible' })
        assert.equal(stops.at(-1).pipeline.index, 0)
        await frame.getByRole('button', { name: label('Text'), exact: true }).click()
        await frame.locator('.gir-text').waitFor({ state: 'visible' })
        const original = await frame.locator('.gir-text').innerText()
        assert.equal(JSON.parse(original).format, 'camel.gir')
        await next.click()
        await frame.waitForFunction(() => document.querySelector('.debug-position')?.textContent.includes('std::macro'))
        await frame.waitForFunction(text => { const current = document.querySelector('.gir-text')?.textContent; return current && current !== text }, original)
        const after = await frame.locator('.gir-text').innerText()
        assert.notEqual(after, original, 'macro stop displayed the input graph')
        assert(JSON.parse(after).graphs.some(g => g.nodes.some(n => n.label === '42')))
        const history = frame.getByRole('combobox', { name: label('Inspected stage') })
        await history.selectOption('0')
        await frame.waitForFunction(text => document.querySelector('.gir-text')?.textContent === text, original)
        assert.equal(stops.at(-1).pipeline.index, 1, 'inspecting history moved execution')
        await frame.getByRole('button', { name: label('Return to current stop'), exact: true }).click()
        await frame.waitForFunction(text => document.querySelector('.gir-text')?.textContent === text, after)
        await next.click()
        await frame.waitForFunction(() => document.querySelector('.debug-position')?.textContent.includes('std::inline'))
        await frame.getByRole('button', { name: label('Graph'), exact: true }).click()
        await frame.locator('.gir-node').first().waitFor({ state: 'visible' })
        await vscode.commands.executeCommand('notifications.clearAll')
        await frame.page().screenshot({ path: path.join(workspace.uri.fsPath, 'pipeline-debug.png') })
        await frame.locator('.panel').evaluate(p => { p.style.width = '320px' })
        const overflow = await frame.locator('.debug-strip').evaluate(strip => {
            const bounds = strip.getBoundingClientRect()
            return [...strip.querySelectorAll('button, select')].some(el => el.getBoundingClientRect().right > bounds.right + 1)
        })
        assert(!overflow, 'pipeline controls overflow narrow panel')
        await frame.page().screenshot({ path: path.join(workspace.uri.fsPath, 'pipeline-debug-narrow.png') })
        await next.click()
        await frame.getByText(label('Runtime paused'), { exact: true }).waitFor()
        assert(!stops.at(-1).pipeline, 'last compiler step did not hand off to runtime')
        const secondProgram = path.join(workspace.uri.fsPath, 'second-session.cml')
        fs.writeFileSync(secondProgram, 'func main(): int { return 7777 }\n')
        assert(await vscode.debug.startDebugging(undefined, {
            type: 'camel', request: 'launch', name: 'Second compiler session', program: secondProgram,
            passes: ['std::nvm'], stopOnPassEntry: true
        }))
        for (let i = 0; i < 100 && sessions.length < 2; i++) await new Promise(r => setTimeout(r, 100))
        const second = sessions[1]
        await vscode.commands.executeCommand('workbench.action.debug.selectDebugSession')
        await frame.page().locator('.quick-input-widget').getByRole('option', { name: 'Second compiler session', exact: false }).click()
        for (let i = 0; i < 100 && vscode.debug.activeDebugSession?.id !== second.id; i++) await new Promise(r => setTimeout(r, 100))
        try {
            assert.notEqual(second.id, session.id)
            await frame.getByText(label('Before compiler passes'), { exact: true }).waitFor()
            await frame.getByRole('button', { name: label('Text'), exact: true }).click()
            await frame.waitForFunction(() => document.querySelector('.gir-text')?.textContent.includes('7777'))
            await vscode.debug.stopDebugging(second)
            for (let i = 0; i < 100 && vscode.debug.activeDebugSession?.id !== session.id; i++) await new Promise(r => setTimeout(r, 100))
            assert.equal(vscode.debug.activeDebugSession?.id, session.id)
            await frame.getByText(label('Runtime paused'), { exact: true }).waitFor()
            await frame.waitForFunction(() => { const text = document.querySelector('.gir-text')?.textContent; return text && !text.includes('7777') && text.includes('42') })
        } finally { await vscode.debug.stopDebugging(second) }
        const stopsBeforeRestart = stops.length
        await vscode.commands.executeCommand('workbench.action.debug.restart')
        for (let i = 0; i < 150 && stops.length === stopsBeforeRestart; i++) await new Promise(r => setTimeout(r, 100))
        assert.equal(stops.at(-1).pipeline?.index, 0, 'restart did not return to initial compiler boundary')
        session = vscode.debug.activeDebugSession
        await frame.getByText(label('Before compiler passes'), { exact: true }).waitFor()
        if (process.env.E2E_COMPOSE_PIPELINE) {
            await vscode.debug.stopDebugging(session)
            await vscode.window.showTextDocument(doc)
            const page = frame.page()
            const input = page.locator('.quick-input-widget input[type="text"]')
            const sessionCount = sessions.length
            const launch = vscode.commands.executeCommand('camel.inspectPipeline')
            await input.waitFor({ state: 'visible' })
            await input.press('Enter')
            await page.locator('.quick-input-widget').getByText(label('Pause before pass'), { exact: true }).waitFor()
            assert.equal(await input.inputValue(), 'std::macro')
            await input.fill('std::inline')
            await input.press('Enter')
            assert(await launch)
            for (let i = 0; i < 100 && sessions.length === sessionCount; i++) await new Promise(r => setTimeout(r, 100))
            session = sessions.at(-1)
            assert.deepEqual(session.configuration.passBreakpoints, [1])
            for (let i = 0; i < 100 && stops.at(-1).pipeline?.index !== 1; i++) await new Promise(r => setTimeout(r, 100))
            assert.equal(stops.at(-1).pipeline?.index, 1, 'pause before inline must show the graph after macro')
            console.log('PIPELINE_BEFORE_OK: Enter defaults to before macro; named inline pauses after macro')
        }
        console.log('PIPELINE_UI_OK: actual macro graph, history/current separation, pass stepping, runtime handoff, multiple sessions, restart and narrow layout')
        console.log('PIPELINE_SCREENSHOTS:', workspace.uri.fsPath)
    } finally {
        if (session) await vscode.debug.stopDebugging(session)
        tracker.dispose()
        if (browser) await browser.close()
    }
}
