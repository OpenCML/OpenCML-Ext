import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import { parse } from 'jsonc-parser'
import { literalScopes, tokenForeground, type TokenColorRule } from './syntaxTokenColors'

/** Theme lexical colors are not exposed as webview CSS variables. Read the active
 * installed theme, its includes and user TextMate overrides; unsupported themes
 * fall back to the webview's theme-aware symbol colors. */
export function literalThemeColors(): Record<string, string> {
    const themeName = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme', '')
    const rules: TokenColorRule[] = []
    const visited = new Set<string>()
    const readTheme = (file: string, depth = 0) => {
        if (depth > 8 || visited.has(file)) return
        visited.add(file)
        try {
            const theme = parse(fs.readFileSync(file, 'utf8'))
            if (typeof theme?.include === 'string') readTheme(path.resolve(path.dirname(file), theme.include), depth + 1)
            if (Array.isArray(theme?.tokenColors)) rules.push(...theme.tokenColors)
        } catch { /* Keep a readable fallback when a theme cannot be read. */ }
    }
    for (const extension of vscode.extensions.all) {
        const theme = extension.packageJSON.contributes?.themes?.find((item: { id?: string; label?: string }) => item.id === themeName || item.label === themeName)
        if (theme?.path) { readTheme(path.resolve(extension.extensionPath, theme.path)); break }
    }
    const rawCustom = vscode.workspace.getConfiguration('editor').get<Record<string, unknown>>('tokenColorCustomizations', {})
    const custom = rawCustom && typeof rawCustom === 'object' ? rawCustom : {}
    const apply = (settings: Record<string, unknown>) => {
        for (const [key, scope] of [['strings', 'string'], ['numbers', 'constant.numeric']] as const) {
            if (typeof settings[key] === 'string') rules.push({ scope, settings: { foreground: settings[key] as string } })
        }
        if (Array.isArray(settings.textMateRules)) rules.push(...settings.textMateRules)
    }
    apply(custom)
    for (const [key, value] of Object.entries(custom)) {
        const patterns = [...key.matchAll(/\[([^\]]+)\]/g)].map(match => match[1])
        const matches = patterns.some(pattern => new RegExp('^' + pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(themeName))
        if (matches && value && typeof value === 'object') apply(value as Record<string, unknown>)
    }
    return Object.fromEntries(Object.entries(literalScopes).flatMap(([kind, scope]) => {
        const color = tokenForeground(rules, scope)
        return color ? [[kind, color]] : []
    }))
}
