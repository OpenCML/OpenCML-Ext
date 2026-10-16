/** Immutable stop snapshots; compare only activations of the same native function. */
export interface CallArgument { name: string; value: string; type: string; evaluated: boolean; previous?: string }
export interface CallState {
    functionId: string; name: string; activation: number; entry: boolean; tailReplaced: number
    arguments: CallArgument[]
}
export function callState(frame: any, previous?: CallState): CallState | undefined {
    if (!frame || typeof frame.functionId !== 'string' || !Number.isSafeInteger(frame.activation) ||
        !Array.isArray(frame.arguments)) return undefined
    const sameFunction = previous?.functionId === frame.functionId
    const sameActivation = sameFunction && previous?.activation === frame.activation
    return {
        functionId: frame.functionId, name: frame.function || frame.graph, activation: frame.activation,
        entry: frame.entry === true, tailReplaced: Number(frame.tailReplaced) || 0,
        arguments: frame.arguments.filter((v: any) => typeof v?.name === 'string' && typeof v.value === 'string')
            .map((v: any) => {
                const old = sameFunction ? previous?.arguments.find(a => a.name === v.name && a.type === v.type) : undefined
                const prior = sameActivation ? old?.previous : frame.entry === true && old?.evaluated && v.evaluated !== false && old.value !== v.value ? old.value : undefined
                return { name: v.name, value: v.value, type: v.type || '', evaluated: v.evaluated !== false, previous: prior }
            })
    }
}
