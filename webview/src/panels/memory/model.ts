/** Display formatting is independent of transport; addresses remain backend hex strings. */
export function byteRows(bytes: number[], offset: number) {
    const rows: { offset: string; hex: string; text: string }[] = []
    for (let i = 0; i < bytes.length; i += 16) {
        const part = bytes.slice(i, i + 16)
        rows.push({ offset: (offset + i).toString(16).padStart(8, '0'),
            hex: part.map(n => n.toString(16).padStart(2, '0')).join(' '),
            text: part.map(n => n >= 32 && n <= 126 ? String.fromCharCode(n) : '.').join('') })
    }
    return rows
}
export function usage(used: number, capacity: number): number {
    return capacity > 0 ? Math.max(0, Math.min(100, used / capacity * 100)) : 0
}
export function sizeText(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1048576).toFixed(1)} MiB`
}
