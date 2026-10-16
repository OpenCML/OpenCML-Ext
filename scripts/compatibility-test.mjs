import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { loadTs } from './load-ts.mjs'
const { classifyVersion, inspectCompatibility, languageFeatures, MINIMUM_CAMEL } = await loadTs('client/src/compatibility.ts')
assert.equal(JSON.parse(fs.readFileSync('package.json')).camelCompatibility.minimumSupportedVersion, MINIMUM_CAMEL)
for (const [input, status] of [
    ['Camel v0.2.11 (Build v0.2.10_dirty)', 'supported'], ['Camel v0.2.10', 'below-minimum'],
    ['Camel v0.2.11-rc.1', 'below-minimum'], ['Camel v0.10.0', 'supported'],
    ['Camel v0.2.11+local.1', 'supported'],
    ['Camel v1.0.0', 'supported'], ['dev build v0.2.11', 'unknown'], ['Camel Debugger v0.1.0', 'unknown']
]) assert.equal(classifyVersion(input).status, status, input)
let fixture
const runner = async (_, args) => {
    if (args[0] === '--version') return { stdout: 'Camel v0.2.10', stderr: '' }
    fixture = args.find(arg => arg.endsWith('.cml'))
    assert(fs.existsSync(fixture))
    return { stdout: args[0] === 'check'
        ? JSON.stringify([{ message: 'missing_capability_probe', range: {} }])
        : 'digraph GraphIR { p [type="PORT", param_name="value", span="1:1-1:2"]; f [type="FILL", value_type="int[]"]; }', stderr: '' }
}
const old = await inspectCompatibility('mock', runner)
assert.equal(old.status, 'below-minimum')
assert(old.warnings.length)
assert.equal(old.features.cliGir.supported, true, 'backported feature must remain usable')
assert.equal(old.features.fillTypes.supported, true)
assert.equal(old.features.cliDiagnostics.supported, true)
assert.equal(old.features.structuredGir.supported, false)
const jsonRuntime = await inspectCompatibility('mock', async (exe, args, cwd) => args.at(-1) === 'std::jgir'
    ? { stdout: JSON.stringify({ format: 'camel.gir', version: 1, root: 'g0', graphs: [{ id: 'g0' }] }), stderr: '' }
    : runner(exe, args, cwd))
assert.equal(jsonRuntime.features.structuredGir.supported, true)
assert(!fs.existsSync(path.dirname(fixture)), 'probe files leaked')
const unknown = await inspectCompatibility('mock', async () => ({ stdout: 'not a version or graph', stderr: '' }))
assert.equal(unknown.status, 'unknown')
assert.equal(unknown.features.cliGir.supported, false)
assert.equal(unknown.features.portNames.supported, null)
assert.equal(unknown.features.cliDiagnostics.supported, false)
const missing = await inspectCompatibility('mock', async () => ({ stdout: '', stderr: '', error: 'ENOENT' }))
assert.equal(missing.status, 'unavailable')
assert.equal(languageFeatures(undefined).completion.supported, null)
assert.equal(languageFeatures({ completionProvider: {}, definitionProvider: false }).completion.supported, true)
assert.equal(languageFeatures({}).nativeGir.supported, false)
assert.equal(languageFeatures({ experimental: { camelGraphProvider: true } }).nativeGir.supported, true)
if (process.env.CAMEL_EXE_PATH) {
    const actual = await inspectCompatibility(process.env.CAMEL_EXE_PATH)
    assert(actual.features.cliGir.supported)
    assert(actual.features.cliDiagnostics.supported)
    console.log('COMPATIBILITY_REAL_OK:', actual.version, actual.features)
}
console.log('COMPATIBILITY_OK: versions, backports, absent capabilities, probe cleanup')
