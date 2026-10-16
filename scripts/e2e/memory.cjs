const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
exports.run = async (vscode, workspace) => {
    const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')
    const { loadTs } = await import('../load-ts.mjs')
    const { zh } = await loadTs(path.resolve(__dirname, '../../client/src/messages.ts'))
    const label = s => /^zh/i.test(vscode.env.language) ? zh[s] || s : s
    const program = path.join(workspace.uri.fsPath, 'memory.cml')
    fs.writeFileSync(program, 'func double(n: int): int { return n * 2 }\nfunc main(): int sync {\n    let value = double(6)\n    println(value)\n    return 0\n}\n')
    let browser, session, frame
    const pauses = [], sessions = []
    const tracker = vscode.debug.registerDebugAdapterTrackerFactory('camel', {
        createDebugAdapterTracker: s => { sessions.push(s); return { onDidSendMessage: m => {
            if (m.type === 'event' && m.event === 'camel/stopped') pauses.push({ session: s.id, body: m.body })
        } } }
    })
    const wait = async predicate => {
        for (let i = 0; i < 100; ++i) { if (await predicate()) return; await new Promise(r => setTimeout(r, 100)) }
        assert.fail('timed out waiting for debug state')
    }
    try {
        await vscode.commands.executeCommand('camel.showMemory')
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.E2E_CDP_PORT || 19338}`)
        await wait(async () => {
            for (const page of browser.contexts().flatMap(c => c.pages())) for (const f of page.frames()) {
                if (await f.locator('.memory-panel').count().catch(() => 0)) { frame = f; return true }
            }
        })
        await frame.getByText(label('Pause a Camel debug session to inspect memory.'), { exact: true }).waitFor()
        assert(await frame.getByRole('button', { name: label('Refresh memory snapshot') }).isDisabled())
        const doc = await vscode.workspace.openTextDocument(program)
        await vscode.window.showTextDocument(doc)
        assert(await vscode.debug.startDebugging(undefined, { type: 'camel', request: 'launch', name: 'Memory UI', program, passes: ['std::nvm'], stopOnEntry: true }))
        session = vscode.debug.activeDebugSession
        await wait(() => pauses.length > 0)
        await vscode.commands.executeCommand('camel.showMemory')
        await wait(async () => {
            for (const page of browser.contexts().flatMap(c => c.pages())) for (const f of page.frames()) {
                if (await f.locator('.memory-panel').count().catch(() => 0)) { frame = f; return true }
            }
        })
        await frame.locator('.hex tbody tr').first().waitFor()
        const snapshot = (await session.customRequest('camel/memorySnapshot')).regions
        assert.equal(await frame.locator('.regions button').count(), snapshot.length)
        assert(!(await frame.locator('.memory-panel').innerText()).includes('NaN'))
        const regionName = await frame.locator('.regions button[aria-pressed=true] .region-name').innerText()
        const region = snapshot.find(r => r.name === regionName)
        const first = await session.customRequest('camel/regionMemory', { region: regionName, offset: 0, limit: 256 })
        assert.equal(await frame.locator('.hex tbody tr td').first().innerText(), first.data.slice(0,16).map(n => n.toString(16).padStart(2,'0')).join(' '))
        await frame.getByRole('button', { name: label('Next page'), exact: true }).click()
        await frame.locator('.hex tbody th').filter({ hasText: /^00000100$/ }).waitFor()
        const offset = frame.getByRole('spinbutton')
        await offset.fill(String(region.capacity))
        await frame.getByRole('button', { name: label('Go'), exact: true }).click()
        await frame.getByText(label('No data at this offset.'), { exact: true }).waitFor()
        assert(await frame.getByRole('button', { name: label('Next page'), exact: true }).isDisabled())
        await frame.getByRole('button', { name: label('Objects'), exact: true }).click()
        await frame.locator('.objects tbody tr').first().waitFor()
        const objects = await session.customRequest('camel/regionObjects', { region: regionName, offset: 0, limit: 50 })
        assert.equal(await frame.locator('.objects tbody tr').count(), objects.objects.length)
        assert.equal(await frame.locator('.objects tbody td').first().innerText(), objects.objects[0].addr)
        await frame.getByText(label('Allocation breakpoints require a Debug Camel build.'), { exact: true }).waitFor()
        assert(await frame.getByRole('checkbox').isDisabled())
        await frame.locator('.memory-panel').evaluate(p => { p.style.width = Math.min(320, window.innerWidth) + 'px' })
        assert(await frame.locator('.memory-panel').evaluate(p => p.scrollWidth <= p.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1), 'memory controls overflow narrow panel')
        await frame.evaluate(() => window.scrollTo(0, 0))
        await vscode.commands.executeCommand('notifications.clearAll')
        await frame.page().screenshot({ path: path.join(workspace.uri.fsPath, 'memory-narrow.png') })
        await frame.locator('.memory-panel').evaluate(p => { p.style.width = '' })
        await frame.page().screenshot({ path: path.join(workspace.uri.fsPath, 'memory-debug.png') })
        // Same selected session event must not cancel a pending refresh or leave a spinner.
        await vscode.commands.executeCommand('camel.showMemory')
        await frame.getByRole('button', { name: label('Refresh memory snapshot') }).click()
        await frame.locator('.objects tbody tr').first().waitFor()
        const before = pauses.length
        await session.customRequest('next', { threadId: 1 })
        await wait(() => pauses.length > before)
        await frame.getByText(label('Refresh to capture region usage.'), { exact: true }).waitFor()
        assert.equal(await frame.locator('.objects tbody tr').count(), 0, 'old heap leaked into new stop')
        await frame.getByRole('button', { name: label('Refresh memory snapshot') }).click()
        await frame.locator('.objects tbody tr').first().waitFor()
        // The selected session, rather than the first worker, supplies every heap query.
        assert(await vscode.debug.startDebugging(undefined, { type: 'camel', request: 'launch', name: 'Second memory session', program, passes: ['std::nvm'], stopOnEntry: true }))
        await wait(() => sessions.length === 2 && pauses.some(p => p.session === sessions[1].id))
        const second = sessions[1]
        await vscode.commands.executeCommand('workbench.action.debug.selectDebugSession')
        await frame.page().locator('.quick-input-widget').getByRole('option', { name: 'Second memory session', exact: false }).click()
        await wait(() => vscode.debug.activeDebugSession?.id === second.id)
        await vscode.commands.executeCommand('camel.showMemory')
        await wait(async () => {
            for (const page of browser.contexts().flatMap(c => c.pages())) for (const f of page.frames()) {
                if (await f.locator('.memory-panel').count().catch(() => 0)) { frame = f; return true }
            }
        })
        await frame.locator('.session-name').filter({ hasText: 'Second memory session' }).waitFor()
        await frame.locator('.objects tbody tr').first().waitFor()
        const secondSnapshot = await second.customRequest('camel/memorySnapshot')
        const secondRegion = secondSnapshot.regions.find(r => r.name === regionName)
        assert.equal(await frame.locator('.detail-header code').innerText(), secondRegion.start)
        await vscode.debug.stopDebugging(second)
        await wait(() => vscode.debug.activeDebugSession?.id === session.id)
        await vscode.commands.executeCommand('camel.showMemory')
        await wait(async () => {
            for (const page of browser.contexts().flatMap(c => c.pages())) for (const f of page.frames()) {
                if (await f.locator('.memory-panel').count().catch(() => 0)) { frame = f; return true }
            }
        })
        await frame.locator('.session-name').filter({ hasText: 'Memory UI' }).waitFor()
        await frame.locator('.objects tbody tr').first().waitFor()
        const firstSnapshot = await session.customRequest('camel/memorySnapshot')
        assert.equal(await frame.locator('.detail-header code').innerText(), firstSnapshot.regions.find(r => r.name === regionName).start)
        await session.customRequest('continue', { threadId: 1 })
        await wait(() => !vscode.debug.activeDebugSession)
        await frame.getByText(label('Pause a Camel debug session to inspect memory.'), { exact: true }).waitFor()
        assert.equal(await frame.locator('.regions button').count(), 0)
        console.log('MEMORY_UI_OK: actual heap bytes/objects, paging/end, no session, stop invalidation, selected sessions, refresh, Release capability and 320px controls')
        console.log('MEMORY_SCREENSHOTS:', workspace.uri.fsPath)
    } finally {
        tracker.dispose()
        if (session && vscode.debug.activeDebugSession) await vscode.debug.stopDebugging(session)
        if (browser) await browser.close()
    }
}
