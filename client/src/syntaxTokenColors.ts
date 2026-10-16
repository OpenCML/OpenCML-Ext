export interface TokenColorRule { scope?: string | string[]; settings?: { foreground?: string } }
export const literalScopes = {
    integer: 'constant.numeric.integer.cml', real: 'constant.numeric.real.cml',
    hex: 'constant.numeric.hex.cml', binary: 'constant.numeric.binary.cml',
    string: 'string.quoted.double.cml', constant: 'constant.language.cml'
}

/** Resolve foreground rules against the same lexical scopes as the Camel grammar. */
export function tokenForeground(rules: TokenColorRule[], scope: string): string | undefined {
    let foreground: string | undefined, specificity = -1
    const stack = ['source.cml', scope]
    for (const rule of rules) {
        if (!rule || typeof rule !== 'object') continue
        const color = rule.settings?.foreground
        if (!color || !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)) continue
        for (const selector of (Array.isArray(rule.scope) ? rule.scope : [rule.scope ?? '']).filter(value => typeof value === 'string').flatMap(value => value.split(','))) {
            const parts = selector.trim().split(/\s+/)
            if (!selector.trim() || parts.some(part => !/^[\w.]+$/.test(part))) continue
            let position = stack.length - 1, matched = true
            for (let i = parts.length - 1; i >= 0; i--) {
                while (position >= 0 && stack[position] !== parts[i] && !stack[position].startsWith(parts[i] + '.')) position--
                if (position-- < 0) { matched = false; break }
            }
            const score = parts.reduce((sum, part) => sum + part.split('.').length * 100 + part.length, 0)
            if (matched && score >= specificity) { specificity = score; foreground = color }
        }
    }
    return foreground
}
