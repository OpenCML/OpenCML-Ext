import { t } from './localization'
// Central place to resolve the Camel toolchain (camel / camel-ls / camel-format / camel-db)
// from the user-configured camelPath. camelPath may point at:
//   - the camel executable itself (e.g. .../bin/camel.exe)
//   - a bin directory containing the executables
//   - a bare command name resolved via PATH (e.g. "camel")
import * as fs from 'fs'
import * as path from 'path'

export interface CamelToolchain {
    /** Executable used for run/check/vizGIR. */
    camel: string
    /** Absolute path to camel-ls, or null when not locatable. */
    camelLs: string | null
    /** Absolute path to camel-format, or null when not locatable. */
    camelFormat: string | null
    /** Absolute path to camel-db, or null when not locatable. */
    camelDb: string | null
    /** Directory the sibling tools were resolved from, or null for PATH-based setups. */
    homeDir: string | null
    /** Human-readable problems (e.g. camel configured but file missing). */
    warnings: string[]
}

function exeNames(base: string): string[] {
    return process.platform === 'win32' ? [`${base}.exe`, base] : [base]
}

function findExecutable(dir: string, base: string): string | null {
    for (const name of exeNames(base)) {
        const candidate = path.join(dir, name)
        try {
            if (fs.statSync(candidate).isFile()) {
                return path.resolve(candidate)
            }
        } catch {
            // ignore and continue
        }
    }
    return null
}

/**
 * Resolve the toolchain from the configured camelPath setting.
 * Never throws; unlocatable pieces come back as null plus a warning.
 */
export function detectToolchain(camelPath: string, camelLsPath = ''): CamelToolchain {
    const warnings: string[] = []
    const cleaned = (camelPath || 'camel').trim() || 'camel'
    const hasSeparator = /[\\/]/.test(cleaned)

    let homeDir: string | null = null

    if (hasSeparator) {
        try {
            if (fs.existsSync(cleaned) && fs.statSync(cleaned).isDirectory()) {
                // camelPath points at a directory (e.g. the bin folder)
                homeDir = cleaned
            } else if (fs.existsSync(cleaned)) {
                // camelPath points at the camel executable itself
                homeDir = path.dirname(cleaned)
            } else if (findExecutable(path.dirname(cleaned), path.basename(cleaned).replace(/\.exe$/i, ''))) {
                // e.g. user dropped the .exe suffix but the folder is right
                homeDir = path.dirname(cleaned)
            } else {
                warnings.push(
                    t("Configured camelPath \"{0}\" does not exist. Fix the \"opencmlLanguageServer.camelPath\" setting.", cleaned)
                )
            }
        } catch {
            homeDir = path.dirname(cleaned)
        }
    }

    // A default installation may only be advertised through CAMEL_HOME or PATH.
    const searchDirs = [
        ...(process.env.CAMEL_HOME ? [path.join(process.env.CAMEL_HOME, 'bin')] : []),
        ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(d => d.replace(/^"|"$/g, ''))
    ]
    let camel = cleaned
    if (homeDir) {
        camel = findExecutable(homeDir, path.basename(cleaned).replace(/\.exe$/i, ''))
            || findExecutable(homeDir, 'camel') || cleaned
    } else if (!hasSeparator) {
        const dirs = cleaned === 'camel' ? searchDirs : searchDirs.filter(d => d !== path.join(process.env.CAMEL_HOME || '', 'bin'))
        for (const dir of dirs) {
            const found = findExecutable(dir, cleaned.replace(/\.exe$/i, ''))
            if (found) {
                camel = found
                homeDir = path.dirname(found)
                break
            }
        }
    }

    const toolchain: CamelToolchain = {
        camel,
        camelLs: null,
        camelFormat: null,
        camelDb: null,
        homeDir,
        warnings
    }

    if (homeDir) {
        toolchain.camelLs = findExecutable(homeDir, 'camel-ls')
        toolchain.camelFormat = findExecutable(homeDir, 'camel-format')
        toolchain.camelDb = findExecutable(homeDir, 'camel-db')
    }

    // Do not silently select another installation for an explicit camelPath.
    if (!hasSeparator && !homeDir) {
        for (const dir of searchDirs) {
            toolchain.camelLs ||= findExecutable(dir, 'camel-ls')
            toolchain.camelFormat ||= findExecutable(dir, 'camel-format')
            toolchain.camelDb ||= findExecutable(dir, 'camel-db')
        }
    }
    if (camelLsPath.trim()) {
        const configured = camelLsPath.trim()
        toolchain.camelLs = /[\\/]/.test(configured)
            ? findExecutable(path.dirname(configured), path.basename(configured).replace(/\.exe$/i, ''))
                || findExecutable(configured, 'camel-ls')
            : searchDirs.map(d => findExecutable(d, configured.replace(/\.exe$/i, ''))).find(Boolean) || null
        if (!toolchain.camelLs) {
            warnings.push(t("Configured camelLsPath \"{0}\" does not exist. Fix \"opencmlLanguageServer.camelLsPath\".", configured))
        }
    }

    return toolchain
}

/** Error message shown when spawning a tool that cannot be found. */
export function spawnHint(settingKey = 'opencmlLanguageServer.camelPath'): string {
    return t("Make sure Camel is built and on PATH, or point \"{0}\" at the camel executable (e.g. .../out/latest/bin/camel.exe).", settingKey)
}
