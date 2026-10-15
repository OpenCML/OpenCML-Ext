import { zh } from './messages'

let hostLocale = 'en'

export function setLocale(locale: string | undefined) {
    hostLocale = locale || 'en'
}

/** Webviews receive the editor locale on <html>; host processes set it explicitly. */
export function t(message: string, ...values: unknown[]): string {
    const browser = globalThis as typeof globalThis & { document?: { documentElement: { lang: string } } }
    const locale = browser.document?.documentElement.lang || hostLocale
    const localized = /^zh(?:[-_]|$)/i.test(locale) ? zh[message] ?? message : message
    return localized.replace(/\{(\d+)\}/g, (placeholder, index) =>
        Number(index) < values.length ? String(values[Number(index)]) : placeholder)
}
