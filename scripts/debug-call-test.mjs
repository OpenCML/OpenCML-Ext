import assert from 'node:assert/strict'
import { loadTs } from './load-ts.mjs'
const { callState } = await loadTs('client/src/debug/callState.ts')
const frame = (activation, value, extra = {}) => ({ functionId: 'timed_1', function: 'timed', activation,
    entry: true, arguments: [{ name: 'remaining', value, type: 'int', evaluated: true }], ...extra })
const first = callState(frame(1, '3'))
const next = callState(frame(2, '2', { tailReplaced: 1 }), first)
assert.equal(next.arguments[0].previous, '3')
assert.equal(callState(frame(2, '2', { entry: false }), next).arguments[0].previous, '3')
assert.equal(callState(frame(3, '1'), next).arguments[0].previous, '2')
assert.equal(callState(frame(2, '3'), first).arguments[0].previous, undefined)
assert.equal(callState(frame(1, '3', { entry: false }), next).arguments[0].previous, undefined, 'returning to a caller is not a fresh entry')
assert.equal(callState(frame(2, '2', { functionId: 'other' }), first).arguments[0].previous, undefined)
assert.equal(callState(frame(2, '<unavailable>', { arguments: [{ name: 'remaining', value: '<unavailable>', type: 'int', evaluated: false }] }), first).arguments[0].previous, undefined)
assert.equal(callState({ graph: 'legacy' }), undefined)
assert.equal(first.arguments[0].value, '3', 'a later stop must not mutate its predecessor')
console.log('DEBUG_CALL_OK: activation deltas, unchanged values, unavailable arguments and function isolation')
