# OpenCML-Ext

VSCode extension for the [Camel](https://github.com/OpenCML/Camel) language, centered on two things:

- **GraphIR visualization** — an interactive graph view of your program's Graph IR
- **Debugging** — launch/attach debugging of Camel scripts via `camel-db`

Language features (diagnostics, formatting) are served by the standardized Camel language server (`camel-ls`).

## Requirements

A Camel toolchain build (`camel.exe`, `camel-ls.exe`, `camel-format.exe`, `camel-db.exe`). Configure its location with `opencmlLanguageServer.camelPath` (point it at the `camel` executable or its `bin` directory); the other tools are auto-detected next to it.

## Features

### GraphIR visualization

`Camel: Visualize GraphIR` (editor title button) opens an interactive panel:

- pan / zoom / node selection with attribute inspection
- pass picker: `std::rgir` (compact), `std::agir` (role-annotated), `std::gir` (styled)
- auto-refresh on save
- **double-click a node to set a node breakpoint** (used by the debugger)
- nested subgraphs (functions/closures) rendered as clusters; layout computed by Graphviz

### Debugging

Full debug adapter (`camel` debug type). `F5` on a `.cml` file launches `camel-db` and streams execution to the Debug Console. Supports launch (auto-spawns `camel-db`) and attach (to a running `camel-db --serve <port>`).

Current capabilities: run / continue / restart / stop, node breakpoints from the GraphIR panel, pause detection with reason. Line-level breakpoints and stepping need source spans and node-level stepping on the Camel side (on the Camel roadmap).

### Language features

- Diagnostics via `camel check`-equivalent pipeline (syntax + semantic errors with ranges and suggestions)
- Document formatting via `camel-format`
- `Camel: Run Camel` streams program output to an output channel

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `opencmlLanguageServer.camelPath` | `camel` | Path to the Camel executable; sibling tools are auto-detected next to it |
| `opencmlLanguageServer.camelDbPath` | `""` | Path to `camel-db` (debugger); empty = resolve next to Camel |
| `opencmlLanguageServer.debugPort` | `8765` | Port `camel-db` serves its API on |
| `opencmlLanguageServer.maxNumberOfProblems` | `100` | Max problems reported |
| `opencmlLanguageServer.trace.server` | `off` | LSP traffic tracing |

## Architecture

```
VSCode
├─ Language Client ──stdio──► camel-ls.exe        (standardized LSP, lives in Camel repo)
├─ Debug Adapter ────DAP────► this extension ──HTTP──► camel-db.exe (parent + worker)
└─ GraphIR Webview ◄─postMessage─ extension ──CLI/HTTP──► Camel (rgir passes / gir-json)
```

- Language server: `camel-ls` is spawned directly when available; otherwise the bundled Node server shells out to the Camel CLI (fallback).
- Debug adapter: an inline Node adapter translates DAP to the `camel-db` HTTP API (`run`/`continue`/`restart`/`terminate`, pause polling, log streaming).

## Development

```bash
npm install
npm run build        # client + server + webview
npm run pub          # build + package vsix into rollup/
node scripts/e2e/run.mjs           # E2E (needs CAMEL_EXE_PATH or a local Camel build)
E2E_MODE=fallback node scripts/e2e/run.mjs   # fallback-path E2E
```

E2E launches a real VSCode instance with a throwaway workspace and exercises hover, diagnostics, formatting, the GraphIR panel and a full debug session lifecycle.
