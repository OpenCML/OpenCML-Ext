/** Editing a module does not imply running it as a program entry point. */
export function moduleDiagnostics<T extends { code?: string | number | { value: string | number } }>(items: T[]): T[] {
    return items.filter(item => {
        const code = typeof item.code === 'object' ? item.code.value : item.code
        // SemanticDiag::EntryModuleMissingMain. Match the diagnostic identity,
        // never localized message text, file names, or other semantic errors.
        return String(code).toLowerCase() !== '0x0300001b'
    })
}
