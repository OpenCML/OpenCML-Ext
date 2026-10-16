// Keep the lexical keyword/operator inventory aligned with Camel's authoritative token table.
// Usage: node scripts/sync-grammar.mjs [--check] <Camel source directory>
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const check = args.includes('--check')
const source = args.find(arg => arg !== '--check') || process.env.CAMEL_SOURCE_PATH
if (!source) throw new Error('Pass the Camel source directory or set CAMEL_SOURCE_PATH')
const table = fs.readFileSync(path.join(source, 'include/camel/parse/syntax/token_kinds.def'), 'utf8')
const grammarPath = fileURLToPath(new URL('../syntaxes/cml.tmLanguage.json', import.meta.url))
const grammar = JSON.parse(fs.readFileSync(grammarPath, 'utf8'))
const before = JSON.stringify(grammar)
const words = [...table.matchAll(/^CAMEL_KEYWORD\(\w+, "([^"]+)", (\w+)\)/gm)]
if (!words.length) throw new Error('No keywords found in Camel token table')
const scopes = { Declaration: 'keyword.declaration', Control: 'keyword.control', Type: 'keyword.operator.word', Literal: 'constant.language', Reserved: 'keyword.other.reserved' }
grammar.repository.keywords.patterns = Object.entries(scopes).map(([group, scope]) => ({
    name: scope + '.cml',
    match: '\\b(?:' + words.filter(word => word[2] === group).map(word => word[1]).join('|') + ')\\b'
}))
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const operators = [...new Set([...table.matchAll(/^CAMEL_PUNCT\(\w+, ("(?:[^"\\]|\\.)*")\)/gm)].map(match => JSON.parse(match[1]))) ]
    .filter(token => ![';', ',', ':', '::', '.', '(', ')', '[', ']', '{', '}', '_'].includes(token))
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
grammar.repository.operators.patterns = [{ name: 'keyword.operator.cml', match: operators.map(escape).join('|') }]
if (check) {
    if (JSON.stringify(grammar) !== before) throw new Error('Camel token table has changed: run sync-grammar.mjs without --check')
    console.log(`GRAMMAR_SYNC_OK: ${words.length} keywords, ${operators.length} operators`)
} else {
    fs.writeFileSync(grammarPath, JSON.stringify(grammar, null, 4) + '\n')
    console.log(`Updated ${words.length} keywords and ${operators.length} operators`)
}
