// server/vite.config.ts
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
    build: {
        target: 'node16',
        ssr: true,
        lib: {
            entry: path.resolve(__dirname, 'src/server.ts'),
            formats: ['cjs'],
            fileName: () => 'server.js'
        },
        outDir: path.resolve(__dirname, '../dist/server'),
        emptyOutDir: false,
        rollupOptions: {
            input: path.resolve(__dirname, 'src/server.ts'),
            output: {
                format: 'cjs',
                entryFileNames: 'server.js'
            },
            external: ['vscode', 'path', 'fs', 'url', 'child_process', 'vscode-languageserver']
        }
    }
})
