export interface LiteralToken { text: string; kind?: 'integer' | 'real' | 'hex' | 'binary' | 'string' | 'constant' }
const number = '[-+]?(?:0[xX][\\da-fA-F_]+|0[bB][01_]+|(?:\\d[\\d_]*(?:\\.[\\d_]*)?|\\.\\d[\\d_]*)(?:[eE][-+]?\\d[\\d_]*)?)'
const token = new RegExp('(?:"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\')|\\b(?:true|false|null)\\b|' + number, 'g')

/** Highlight only complete literal displays, never runtime object names or functions. */
export function literalTokens(label: string, kind: string, attrs: Record<string, string>): LiteralToken[] {
    const plain = [{ text: label }]
    if (kind !== 'DATA' || attrs.function_value === '1') return plain
    if (attrs.value_type === 'string') return [{ text: label, kind: 'string' }]
    const result: LiteralToken[] = [], brackets: string[] = []
    let offset = 0
    for (const match of label.matchAll(new RegExp(token))) {
        const gap = label.slice(offset, match.index)
        if (!/^[\s,:[\](){}]*$/.test(gap)) return plain
        if (gap) result.push({ text: gap })
        const text = match[0]
        result.push({ text, kind: /^["']/.test(text) ? 'string' : /^(true|false|null)$/.test(text) ? 'constant'
            : /^[-+]?0x/i.test(text) ? 'hex' : /^[-+]?0b/i.test(text) ? 'binary' : /[.eE]/.test(text) ? 'real' : 'integer' })
        offset = match.index! + text.length
    }
    const tail = label.slice(offset)
    if (!/^[\s,:[\](){}]*$/.test(tail) || !result.some(part => part.kind)) return plain
    if (tail) result.push({ text: tail })
    for (const char of result.filter(part => !part.kind).map(part => part.text).join('')) {
        if ('[({'.includes(char)) brackets.push(char)
        else if ('])}'.includes(char) && brackets.pop() !== ({ ']': '[', ')': '(', '}': '{' } as Record<string, string>)[char]) return plain
    }
    return brackets.length ? plain : result
}
