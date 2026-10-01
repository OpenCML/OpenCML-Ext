# Change Log

All notable changes to the "OpenCML-Ext" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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
