import assert from 'node:assert/strict'
import { loadTs } from './load-ts.mjs'
const { parsePipelineInput, pauseBeforePass } = await loadTs('client/src/debug/pipelineInput.ts')
assert.equal(pauseBeforePass(['std::macro', 'std::inline', 'std::macro'], 'std::macro'), 0)
assert.equal(pauseBeforePass(['std::macro', 'std::inline'], ' std::inline '), 1)
assert.throws(() => pauseBeforePass(['std::macro'], 'std::nvm'))
assert.throws(() => pauseBeforePass(['std::macro'], ''))
assert.deepEqual(parsePipelineInput('std::macro std::inline std::macro std::nvm').passes,
    ['std::macro', 'std::inline', 'std::macro', 'std::nvm'])
assert.deepEqual(parsePipelineInput('camel "D:\\My Project\\main.cml" std::macro custom::pass'), {
    program: 'D:\\My Project\\main.cml', passes: ['std::macro', 'custom::pass']
})
assert.deepEqual(parsePipelineInput('"D:\\Camel Tools\\camel.exe" ./main.cml std::macro').program, './main.cml')
for (const invalid of ['', 'camel x.cml', 'std::macro && whoami', 'std::macro;whoami', 'std::macro | more',
    'camel "main.cml std::macro', 'std::macro --log-level debug', 'std::macro > out', '$(whoami)']) {
    assert.throws(() => parsePipelineInput(invalid), undefined, invalid)
}
console.log('PIPELINE_INPUT_OK: quoted Windows paths, custom/repeated passes, malformed commands and shell syntax')
