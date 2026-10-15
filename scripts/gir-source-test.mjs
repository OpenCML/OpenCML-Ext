import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import ts from 'typescript'
const js = ts.transpileModule(fs.readFileSync('client/src/girSource.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText
const { mapGirSources } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const source = path.resolve('test/with space/main.cml')
const scratch = path.join(path.dirname(source), '.camel-gir-123.cml')
const native = path.join(path.dirname(source), '.camel-ls-123-main.cml')
const attr = file => `srcfile=${JSON.stringify(file)}`
const expected = attr(source.replaceAll('\\', '/'))
for (const file of [native, native.replaceAll('\\', '/'), scratch]) {
    assert.equal(mapGirSources(attr(file), source, scratch), expected)
}
for (const file of [path.resolve('other/.camel-ls-123-main.cml'), path.join(path.dirname(source), 'lib.cml'), path.join(path.dirname(source), '.camel-ls-123-lib.cml')]) {
    assert.equal(mapGirSources(attr(file), source, scratch), attr(file), 'unrelated source must stay unchanged')
}
assert.equal(mapGirSources(`label=${JSON.stringify(native)}`, source), `label=${JSON.stringify(native)}`)
console.log('GIR source mapping passed')
