/** Parse a pass sequence or a pasted Camel command without invoking a shell. */
export function parsePipelineInput(input: string): { program?: string; passes: string[] } {
    const words: string[] = []
    let word = '', quote = '', started = false
    for (const character of input.trim()) {
        if (quote) {
            if (character === quote) quote = ''
            else word += character
        } else if (character === '"' || character === "'") {
            quote = character
            started = true
        } else if (/\s/.test(character)) {
            if (started) { words.push(word); word = ''; started = false }
        } else { word += character; started = true }
    }
    if (quote) throw new Error('quote')
    if (started) words.push(word)
    if (/^(?:.*[\\/])?camel(?:\.exe)?$/i.test(words[0] ?? '')) words.shift()
    let program: string | undefined
    if (/\.cml$/i.test(words[0] ?? '')) program = words.shift()
    if (!words.length || words.some(pass => !/^[A-Za-z_][\w]*(?:::[A-Za-z_][\w]*)*$/.test(pass))) throw new Error('passes')
    return { program, passes: words }
}

/** Snapshot N is the input of pass N (zero-based), before that pass executes. */
export function pauseBeforePass(passes: string[], name: string): number {
    const index = passes.indexOf(name.trim())
    if (index < 0) throw new Error('unknown pass')
    return index
}
