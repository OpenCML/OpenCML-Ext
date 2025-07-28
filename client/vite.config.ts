// client/vite.config.ts
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
    build: {
        target: 'node16',
        ssr: true,
        outDir: '../dist/extension',
        lib: {
            entry: path.resolve(__dirname, 'src/extension.ts'),
            formats: ['cjs']
        },
        rollupOptions: {
            input: path.resolve(__dirname, 'src/extension.ts'),
            output: {
                format: 'cjs',
                entryFileNames: 'extension.js'
            },
            external: [
                'vscode',
                'path',
                'fs',
                'os',
                'url',
                'child_process',
                'vscode-languageclient'
            ]
        },
        emptyOutDir: true
    }
})
