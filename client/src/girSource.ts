import * as path from 'path'

// DOT escapes Windows separators, so replacing the raw filename in compiler
// stdout misses it. Decode only srcfile attributes, never labels or other text.
export function mapGirSources(dot: string | null, source: string, scratch?: string): string | null {
    if (!dot) return dot
    const key = (file: string) => {
        const normalized = path.resolve(file).replace(/\\/g, '/')
        return process.platform === 'win32' ? normalized.toLowerCase() : normalized
    }
    return dot.replace(/\bsrcfile\s*=\s*"((?:\\.|[^"\\])*)"/g, (attribute, encoded: string) => {
        const file = encoded.replace(/\\([\\"])/g, '$1')
        const resolved = path.resolve(path.dirname(source), file)
        const basename = path.basename(resolved)
        const nativeSource = basename.replace(/^\.camel-ls-\d+-/, '')
        const isNativeScratch = nativeSource !== basename &&
            key(path.join(path.dirname(resolved), nativeSource)) === key(source)
        if (!isNativeScratch && (!scratch || key(resolved) !== key(scratch))) return attribute
        return `srcfile="${source.replace(/\\/g, '/').replace(/"/g, '\\"')}"`
    })
}
