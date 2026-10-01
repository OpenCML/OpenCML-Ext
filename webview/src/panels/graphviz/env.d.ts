/// <reference types="vite/client" />

// The published @hpcc-js/wasm types re-export "@hpcc-js/wasm-graphviz", which is
// missing from the installed dependency tree. Declare the surface we use so that
// vue-tsc can typecheck without it.
declare module '@hpcc-js/wasm-graphviz' {
    export class Graphviz {
        static load(): Promise<Graphviz>
        layout(dot: string, format?: string, engine?: string): string
    }
}
