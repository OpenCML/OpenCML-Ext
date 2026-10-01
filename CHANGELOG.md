# Change Log

All notable changes to the "OpenCML-Ext" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.1.0] - 2026-10-02

Node-level debugging becomes real: breakpoints hit, stepping works, and the editor, the GraphIR panel, and the debugger all speak the same node identity (the GIR node origin).

### Added

- **Line breakpoints**: verified against GIR node source spans served by `camel-db`; unverified breakpoints explain why and upgrade automatically once a node maps to the line (DAP `breakpoint` change events).
- **Stepping**: `next` (step over — next node in the current graph) and `stepIn` (next node anywhere), backed by the new `POST /api/step` node-level single-step in `camel-db`.
- **Source-mapped stack frames**: the paused node's source span becomes the top stack frame (1-based line/column), so the editor reveals the executing expression on every pause.
- **GraphIR panel ↔ debugger sync**: the paused node is highlighted in the panel (matched by node origin), node breakpoints are sent to the debugger by origin (they actually hit now), and the node info box offers "jump to source".
- Natural session termination: the adapter ends the debug session when the worker reports `completed`/`terminated`.

### Fixed (Camel-side, required for this release)

- GIR node breakpoints never fired: the `gir_node` hook was lost in the GIR refactor and the remaining hook machinery was compiled out in release builds. Camel now has an always-compiled, runtime-gated node hook that NodeVM fires before each node.
- Node id spaces were split three ways (rgir DOT ids, gir-json integer refs, runtime pointers). Camel now emits a unified origin id everywhere: gir-json nodes carry `originId` + resolved `span`, rgir DOT nodes carry `origin`/`span`/`srcfile`, and the debugger matches breakpoints by origin.
- `gir-json` recompiled the script on every request, so ids drifted between calls; it now serves the compile of the active run.
- `camel-db` tasks stayed `"running"` forever after the script finished; the worker's state is now merged into the parent task table, and completed tasks can be re-run directly.
- Paused-node identity (`pausedNode`: `nodeId`/`graphId`/`origin`/`ref`) is explicit in the aggregated state, and the aggregation no longer drops the node fields from `pauseReason`.

## [1.0.0] - 2026-10-01

First release centered on GraphIR visualization and debugging, with language services standardized on `camel-ls`.

### Added

- **GraphIR visualization panel** (interactive, Vue Flow based): pass picker (`std::rgir` / `std::agir` / `std::gir`), auto-refresh on save, node attribute inspection, nested function/cluster rendering, double-click node breakpoints.
- **Debugging**: `camel` debug adapter bridging DAP to `camel-db` (HTTP API). Launch (auto-spawn `camel-db --serve`) and attach; run/continue/restart/stop; pause detection with reason; logs streamed to Debug Console; GIR node breakpoints synced to the debugger.
- **Toolchain detection**: `camelPath` may point at the executable or its `bin` directory; `camel-ls` / `camel-format` / `camel-db` auto-detected; structured errors instead of silent failures.
- Settings: `camelDbPath`, `debugPort`.
- E2E suite: real-VSCode tests for diagnostics/formatting (via `camel-ls`), the GraphIR panel, and the full debug session lifecycle; fallback-mode E2E for the bundled Node language server.

### Changed

- Language services now prefer `camel-ls` (spawned over stdio) and fall back to the bundled Node server when it is missing.

### Fixed (Camel-side, required for this release)

- `camel-ls` was unusable since its creation: Windows text mode corrupted LSP framing (CRLF double-translation) and an uncaught exception aborted the process during `initialize`. Fixed in the Camel repo (`tools/lang-server`), which also added pull diagnostics (full `camel check` semantic pipeline) and `documentFormatting`.

## [0.7.0] - 2026-10-01

- Adapted to the Camel v0.1.23 toolchain: diagnostics via the new `camel check -O json` schema, formatting via the standalone `camel-format`, real `camel run` command, GraphIR panel rendering DOT via @hpcc-js/wasm.

## [0.6.0]

- Migrated the build from pnpm to npm workspaces and fixed the Vite builds (Node SSR target), restoring a working, installable extension.
