// server/vite.config.ts
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
    ssr: {
        noExternal: true
    },
    build: {
        target: 'node16',
        ssr: true,
        outDir: '../dist/server',
        emptyOutDir: true,
        rollupOptions: {
            input: path.resolve(__dirname, 'src/server.ts'),
            output: {
                format: 'cjs',
                entryFileNames: 'server.cjs'
            }
        }
    }
})
