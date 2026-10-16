// Exercise the actual TextMate/Oniguruma engine used by VS Code, without an LSP.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import textmate from 'vscode-textmate'
import oniguruma from 'vscode-oniguruma'

const require = createRequire(import.meta.url)
const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'))
await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength))
const raw = JSON.parse(fs.readFileSync(new URL('../syntaxes/cml.tmLanguage.json', import.meta.url), 'utf8'))
const registry = new textmate.Registry({
    onigLib: Promise.resolve({ createOnigScanner: patterns => new oniguruma.OnigScanner(patterns), createOnigString: text => new oniguruma.OnigString(text) }),
    loadGrammar: async scope => scope === 'source.cml' ? raw : null
})
const grammar = await registry.loadGrammar('source.cml')
function tokenize(source) {
    let state = textmate.INITIAL
    return source.split('\n').map(line => {
        const result = grammar.tokenizeLine(line, state)
        state = result.ruleStack
        return result.tokens.map(token => ({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes }))
    })
}
function has(source, text, scope) {
    const tokens = tokenize(source).flat()
    assert(tokens.some(token => token.text === text && token.scopes.includes(scope + '.cml')), `${JSON.stringify(text)} must have ${scope}: ${JSON.stringify(tokens)}`)
}
function plain(source, text) { has(source, text, 'variable.other') }

// Every expression is evaluated by Oniguruma; malformed or variable-length lookbehinds fail here.
for (const entry of raw.repository.keywords.patterns) {
    for (const word of entry.match.slice(5, -3).split('|')) has(word, word, word === 'func' ? 'storage.type.function' : entry.name.slice(0, -4))
}
has('namespace Tools::Inner {', 'Tools::Inner', 'entity.name.namespace')
has('module library', 'library', 'entity.name.namespace')
has('with <ctx: int> export sync func Tools::inc(x: int): int { return x + 1 }', 'Tools::inc', 'entity.name.function')
has('func\ninc(x: int) { return x }', 'inc', 'entity.name.function')
has('func operator +(a: V, b: V): V { return a }', '+', 'entity.name.function.operator')
has('func operator [](a: V, i: int): int { return 1 }', '[]', 'entity.name.function.operator')
has('type Pair<T> = (T, T)', 'Pair', 'entity.name.type')
has('let result = Tools::inc(1)', 'Tools', 'entity.name.namespace')
has('let result = Tools::inc(1)', 'inc', 'entity.name.function')
has('xs->map<(x: int): int => x>', 'map', 'entity.name.function')
has('f?..g', 'g', 'entity.name.function')
has('let x = (value: 3)', 'value', 'variable.parameter')
has('@trace<true>', 'trace', 'entity.name.function.annotation')
for (const word of ['use', 'raise', 'long', 'double', 'number', 'functor', 'char', 'operator']) plain(`let ${word} = 1`, word)
plain('let g = inc', 'inc') // Only semantic analysis can classify a bare function value.
plain('let namespaceSuffix = 1', 'namespaceSuffix')
for (const type of ['int','i32','i64','float','f32','f64','bool','string','void','Map','Set']) has(`let x: ${type}`, type, 'support.type')
for (const [number, kind] of [['0xff','hex'],['0b1010','binary'],['077','integer'],['42','integer'],['1e6','real'],['1E-2','real'],['2.5e+3','real']]) has(`let x = ${number}`, number, `constant.numeric.${kind}`)
has('n-1', '-', 'keyword.operator')
has('n-1', '1', 'constant.numeric.integer')
for (const op of ['?..','?->','??','!!','->','..','...','=>','<=','>=','===','!==','+=','^=','@=','&=','|=','~','\\','@']) has(`a ${op} b`, op, 'keyword.operator')
has('/// func inc', '/// func inc', 'comment.line.documentation')
has('//// func inc', '//// func inc', 'comment.line.double-slash')
has('#!/usr/bin/env camel', '#!/usr/bin/env camel', 'comment.line.number-sign')
has('#no-space', '#no-space', 'comment.line.number-sign')
has('/*\nfunc inc\n*/\ninc(1)', 'func inc', 'comment.block')
has('/*\nfunc inc\n*/\ninc(1)', 'inc', 'entity.name.function')
has('"""\nfunc inc " // literal\n"""\ninc(1)', 'func inc " // literal', 'string.quoted.triple.double')
has("'''\nnamespace Foo ' # literal\n'''\ninc(1)", "namespace Foo ' # literal", 'string.quoted.triple.single')
has('"// func loop"', '// func loop', 'string.quoted.double')
has('"\\x41\\n"', '\\x41', 'constant.character.escape')
has('`literal ${inc(1)}`', 'literal ${inc(1)}', 'string.quoted.backtick') // Reserved syntax; no invented interpolation.
const config = JSON.parse(fs.readFileSync(new URL('../language-configuration.json', import.meta.url), 'utf8'))
const indent = new RegExp(config.indentationRules.increaseIndentPattern)
assert(!indent.test('if a < b'), 'comparison must not increase indentation')
assert(indent.test('func main() {'))
assert(!config.autoClosingPairs.some(pair => pair.open === '<'), 'typing a comparison must not insert >')
const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
assert.deepEqual(manifest.contributes.languages.map(language => language.id), ['cml'])
assert.deepEqual(manifest.contributes.grammars.map(grammar => grammar.scopeName), ['source.cml'])
registry.dispose()
console.log('GRAMMAR_OK: current keywords/operators, declarations, calls, strings, comments, numbers and editor pairs without semantic tokens')
