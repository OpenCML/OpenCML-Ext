/** Shared display bounds for Vue Flow cards and their Graphviz layout slots. */
export function nodeDisplaySize(attrs: Record<string, string>, fallbackLabel: string): { width: number; height: number } | undefined {
    if (attrs.function_value === '1' || ['FUNC', 'CALL'].includes(attrs.type)) {
        const label = attrs.function_value === '1' ? attrs.function_name || fallbackLabel : attrs.label || fallbackLabel
        // Reserve frame padding and the function icon; estimate wide glyphs separately.
        const textWidth = Array.from(label).reduce((width, char) => width + (char.codePointAt(0)! > 255 ? 14 : 7), 0)
        return { width: Math.max(attrs.function_value === '1' ? 104 : 72, Math.min(220, textWidth + 44)), height: attrs.function_value === '1' ? 44 : 40 }
    }
    if (attrs.type === 'LOOP') return { width: 148, height: 56 }
    if (['BRCH', 'JOIN', 'GATE', 'SYNC'].includes(attrs.type)) return { width: 44, height: 26 }
    return undefined
}
