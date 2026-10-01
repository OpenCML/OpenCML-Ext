// Minimal parser for the DOT subset produced by camel's std::rgir / std::gir dumps.
// Supports: digraph/graph blocks, nested subgraphs (clusters), node statements,
// edge statements (a -> b), attribute lists, and id=value assignments.

export interface DotAttrMap {
    [key: string]: string
}

export interface DotNodeStmt {
    id: string
    attrs: DotAttrMap
}

export interface DotEdgeStmt {
    from: string
    to: string
    attrs: DotAttrMap
}

export interface DotSubgraph {
    id: string | null
    attrs: DotAttrMap
    nodes: DotNodeStmt[]
    edges: DotEdgeStmt[]
    subgraphs: DotSubgraph[]
}

export interface DotGraph extends DotSubgraph {
    id: string
}

interface Token {
    kind: 'id' | 'str' | 'lbrace' | 'rbrace' | 'lbracket' | 'rbracket' | 'arrow' | 'semi' | 'comma' | 'equals' | 'eof'
    value: string
}

function tokenize(src: string): Token[] {
    const tokens: Token[] = []
    let i = 0
    const n = src.length
    const isIdChar = (c: string) => /[A-Za-z0-9_.$:+\-]/.test(c)

    while (i < n) {
        const c = src[i]
        if (/\s/.test(c)) {
            i++
            continue
        }
        if (src.startsWith('//', i)) {
            while (i < n && src[i] !== '\n') i++
            continue
        }
        if (src.startsWith('/*', i)) {
            i += 2
            while (i < n && !src.startsWith('*/', i)) i++
            i += 2
            continue
        }
        if (src.startsWith('->', i)) {
            tokens.push({ kind: 'arrow', value: '->' })
            i += 2
            continue
        }
        if (src.startsWith('--', i)) {
            tokens.push({ kind: 'arrow', value: '--' })
            i += 2
            continue
        }
        switch (c) {
            case '{':
                tokens.push({ kind: 'lbrace', value: c })
                i++
                continue
            case '}':
                tokens.push({ kind: 'rbrace', value: c })
                i++
                continue
            case '[':
                tokens.push({ kind: 'lbracket', value: c })
                i++
                continue
            case ']':
                tokens.push({ kind: 'rbracket', value: c })
                i++
                continue
            case ';':
                tokens.push({ kind: 'semi', value: c })
                i++
                continue
            case ',':
                tokens.push({ kind: 'comma', value: c })
                i++
                continue
            case '=':
                tokens.push({ kind: 'equals', value: c })
                i++
                continue
        }
        if (c === '"') {
            let j = i + 1
            let out = ''
            while (j < n) {
                if (src[j] === '\\' && j + 1 < n) {
                    out += src[j + 1]
                    j += 2
                    continue
                }
                if (src[j] === '"') break
                out += src[j]
                j++
            }
            tokens.push({ kind: 'str', value: out })
            i = j + 1
            continue
        }
        if (c === '<') {
            // HTML-like label: skip to matching '>'
            let j = i + 1
            let depth = 1
            while (j < n && depth > 0) {
                if (src[j] === '<') depth++
                if (src[j] === '>') depth--
                j++
            }
            tokens.push({ kind: 'str', value: src.slice(i, j) })
            i = j
            continue
        }
        if (isIdChar(c)) {
            let j = i
            while (j < n && isIdChar(src[j])) j++
            tokens.push({ kind: 'id', value: src.slice(i, j) })
            i = j
            continue
        }
        // unknown char, skip
        i++
    }
    tokens.push({ kind: 'eof', value: '' })
    return tokens
}

class Parser {
    private pos = 0
    private tokens: Token[]

    constructor(tokens: Token[]) {
        this.tokens = tokens
    }

    private peek(): Token {
        return this.tokens[this.pos]
    }

    private next(): Token {
        return this.tokens[this.pos++]
    }

    private is(kind: Token['kind']): boolean {
        return this.peek().kind === kind
    }

    parseGraph(): DotGraph {
        // tolerate `strict` prefix
        if (this.is('id') && this.peek().value === 'strict') this.next()
        const kw = this.next()
        if (kw.kind !== 'id' || (kw.value !== 'digraph' && kw.value !== 'graph')) {
            throw new Error(`not a DOT graph: ${kw.value}`)
        }
        let id = 'G'
        if (this.is('id') || this.is('str')) id = this.next().value
        const body = this.parseBlock()
        return { ...body, id }
    }

    private parseBlock(): DotSubgraph {
        if (!this.is('lbrace')) throw new Error(`expected '{', got ${this.peek().value}`)
        this.next()
        const graph: DotSubgraph = { id: null, attrs: {}, nodes: [], edges: [], subgraphs: [] }
        while (!this.is('rbrace') && !this.is('eof')) {
            if (this.is('semi') || this.is('comma')) {
                this.next()
                continue
            }
            this.parseStmt(graph)
        }
        if (this.is('rbrace')) this.next()
        return graph
    }

    private parseStmt(graph: DotSubgraph): void {
        const tok = this.peek()

        // subgraph (with or without id)
        if (this.is('id') && tok.value === 'subgraph') {
            this.next()
            let subId: string | null = null
            if (this.is('id') || this.is('str')) subId = this.next().value
            const sub = this.parseBlock()
            sub.id = subId
            graph.subgraphs.push(sub)
            return
        }

        // anonymous { ... }
        if (this.is('lbrace')) {
            const sub = this.parseBlock()
            graph.subgraphs.push(sub)
            return
        }

        // id = value (attribute assignment)
        if ((this.is('id') || this.is('str')) && this.tokens[this.pos + 1]?.kind === 'equals') {
            const key = this.next().value
            this.next() // '='
            const value = this.is('id') || this.is('str') ? this.next().value : ''
            graph.attrs[key] = value
            this.eatSemi()
            return
        }

        // node or edge statement
        if (this.is('id') || this.is('str')) {
            const from = this.next().value
            if (this.is('arrow')) {
                this.next()
                const to = this.is('id') || this.is('str') ? this.next().value : ''
                const attrs = this.parseAttrLists()
                graph.edges.push({ from, to, attrs })
                // chained edges a -> b -> c
                while (this.is('arrow')) {
                    this.next()
                    const nextTo = this.is('id') || this.is('str') ? this.next().value : ''
                    graph.edges.push({ from: to, to: nextTo, attrs: {} })
                }
            } else {
                const attrs = this.parseAttrLists()
                graph.nodes.push({ id: from, attrs })
            }
            this.eatSemi()
            return
        }

        // unexpected token: skip it to guarantee progress
        this.next()
    }

    private parseAttrLists(): DotAttrMap {
        const attrs: DotAttrMap = {}
        while (this.is('lbracket')) {
            this.next()
            while (!this.is('rbracket') && !this.is('eof')) {
                if (this.is('comma') || this.is('semi')) {
                    this.next()
                    continue
                }
                if (this.is('id') || this.is('str')) {
                    const key = this.next().value
                    let value = 'true'
                    if (this.is('equals')) {
                        this.next()
                        value = this.is('id') || this.is('str') ? this.next().value : ''
                    }
                    attrs[key] = value
                } else {
                    this.next()
                }
            }
            if (this.is('rbracket')) this.next()
        }
        return attrs
    }

    private eatSemi(): void {
        if (this.is('semi')) this.next()
    }
}

export function parseDot(src: string): DotGraph {
    return new Parser(tokenize(src)).parseGraph()
}

/** Check whether a DOT string looks like the supported rgir output. */
export function isDotGraph(src: string): boolean {
    return /^\s*(strict\s+)?(di)?graph\b/m.test(src)
}
