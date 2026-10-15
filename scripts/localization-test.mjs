import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { loadTs } from './load-ts.mjs'

const { t, setLocale } = await loadTs('client/src/localization.ts')
const { zh } = await loadTs('client/src/messages.ts')
const slots = text => [...text.matchAll(/\{\d+\}/g)].map(m => m[0]).sort()
for (const [english, chinese] of Object.entries(zh)) {
    assert(chinese.trim(), english)
    assert.deepEqual(slots(english), slots(chinese), english)
}
for (const locale of ['zh', 'zh-cn', 'zh-TW', 'ZH_hans']) {
    setLocale(locale)
    assert.equal(t('Refresh'), '刷新')
    assert.equal(t('Port index (zero-based): {0}', 0), '端口索引（从 0 开始）：0')
}
for (const locale of ['en', 'en-US', 'de', undefined]) {
    setLocale(locale)
    assert.equal(t('Refresh'), 'Refresh')
    assert.equal(t('Port index (zero-based): {0}', 0), 'Port index (zero-based): 0')
}
setLocale('zh-cn')
assert.equal(t('Unknown message {0}', '$& {1} <script>'), 'Unknown message $& {1} <script>')
assert.equal(t('Port index (zero-based): {0}'), '端口索引（从 0 开始）：{0}')

const manifest = JSON.parse(fs.readFileSync('package.json'))
const english = JSON.parse(fs.readFileSync('package.nls.json'))
for (const locale of ['zh', 'zh-cn', 'zh-tw']) {
    const translated = JSON.parse(fs.readFileSync(`package.nls.${locale}.json`))
    assert.deepEqual(Object.keys(translated).sort(), Object.keys(english).sort())
    for (const value of Object.values(translated)) assert(value.trim())
}
for (const [, key] of JSON.stringify(manifest).matchAll(/%([^%]+)%/g)) assert(english[key], key)

// Audit every translation call, including Vue template expressions, for missing keys.
let calls = 0
for (const root of ['client/src', 'webview/src', 'server/src']) {
    for (const file of fs.readdirSync(root, { recursive: true }).filter(f => /\.(ts|vue)$/.test(f))) {
        if (file === 'messages.ts') continue
        const text = fs.readFileSync(`${root}/${file}`, 'utf8')
        for (const match of text.matchAll(/\bt\(("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) {
            const node = ts.createSourceFile('literal.ts', match[1], 99).statements[0].expression
            assert(Object.hasOwn(zh, node.text), `${file}: ${node.text}`)
            calls++
        }
        assert(!/\p{Script=Han}/u.test(text), `Unextracted Chinese text in ${file}`)
    }
}
console.log(`LOCALIZATION_OK: ${calls} calls, ${Object.keys(zh).length} bilingual messages; manifests, fallback and placeholders`)
