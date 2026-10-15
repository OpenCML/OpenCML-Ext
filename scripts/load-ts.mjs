import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const urls = new Map()
function moduleUrl(file) {
    file = path.resolve(file)
    if (urls.has(file)) return urls.get(file)
    let js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 }
    }).outputText
    js = js.replace(/from ['"](\.[^'"]+)['"]/g, (_, specifier) =>
        `from '${moduleUrl(path.resolve(path.dirname(file), specifier + (path.extname(specifier) ? '' : '.ts')))}'`)
    const url = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
    urls.set(file, url)
    return url
}
export const loadTs = file => import(moduleUrl(file))
