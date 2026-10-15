import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { loadTs } from './load-ts.mjs'
const { detectToolchain } = await loadTs('client/src/toolchain.ts')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'camel-tools-'))
const savedPath = process.env.PATH
const savedHome = process.env.CAMEL_HOME
try {
    const bin = path.join(root, 'bin')
    fs.mkdirSync(bin)
    const exe = name => path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''))
    for (const name of ['camel', 'camel-ls', 'camel-format', 'camel-db']) fs.writeFileSync(exe(name), '')
    process.env.PATH = bin
    delete process.env.CAMEL_HOME
    for (const configured of ['camel', bin, exe('camel'), path.join(bin, 'camel')]) {
        const tools = detectToolchain(configured)
        assert.equal(tools.camel, exe('camel'))
        assert.equal(tools.camelLs, exe('camel-ls'))
        assert.equal(tools.camelFormat, exe('camel-format'))
    }
    process.env.PATH = ''
    process.env.CAMEL_HOME = root
    assert.equal(detectToolchain('camel').camelLs, exe('camel-ls'))
    const missing = path.join(root, 'missing', 'camel')
    assert.equal(detectToolchain(missing).camelLs, null)
    assert.equal(detectToolchain(missing, exe('camel-ls')).camelLs, exe('camel-ls'))
    assert.equal(detectToolchain('camel', path.join(root, 'missing-ls')).camelLs, null)
    console.log('TOOLCHAIN_OK: PATH, CAMEL_HOME, bin, executable, missing path, server override')
} finally {
    if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath
    if (savedHome === undefined) delete process.env.CAMEL_HOME; else process.env.CAMEL_HOME = savedHome
    fs.rmSync(root, { recursive: true, force: true })
}
