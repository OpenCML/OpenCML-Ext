// webview/vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import fs from 'fs'

const panelDirs = fs.readdirSync(path.resolve(__dirname, 'src/panels'))
const inputEntries: Record<string, string> = {}

panelDirs.forEach((dir) => {
    const htmlPath = path.resolve(__dirname, `src/panels/${dir}/index.html`)
    if (fs.existsSync(htmlPath)) {
        inputEntries[dir] = htmlPath
    }
})

export default defineConfig({
    base: './',
    root: path.resolve(__dirname, 'src/'),
    publicDir: path.resolve(__dirname, 'public'),
    plugins: [vue()],
    build: {
        outDir: path.resolve(__dirname, '../dist/'),
        emptyOutDir: false,
        rollupOptions: {
            input: inputEntries,
            output: {
                entryFileNames: 'assets/[name]/[hash].js',
                assetFileNames: 'assets/[name]/[hash].[ext]',
                chunkFileNames: 'assets/[name]/[hash].js'
            }
        }
    },
    resolve: {
        alias: {
            '@common': path.resolve(__dirname, 'src/common'),
            '@graphviz': path.resolve(__dirname, 'src/panels/graphviz')
        }
    }
})
