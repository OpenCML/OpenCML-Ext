// client/vite.config.ts
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
    ssr: {
        noExternal: true
    },
    build: {
        target: 'node16',
        ssr: true,
        outDir: '../dist/extension',
        emptyOutDir: true,
        rollupOptions: {
            input: path.resolve(__dirname, 'src/extension.ts'),
            output: {
                format: 'cjs',
                entryFileNames: 'extension.cjs'
            },
            external: ['vscode']
        }
    }
})
