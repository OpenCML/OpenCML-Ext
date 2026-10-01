# Change Log

All notable changes to the "OpenCML-Ext" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.7.0] - 2026-10-01

### Changed

- Adapted to the latest Camel toolchain (v0.1.23):
  - Diagnostics now run `camel check -O json` against a temporary copy of the buffer (next to the real file, so relative imports still resolve) and map the new diagnostic schema (0-based ranges, `Error|Warn|Info|Hint` severities, suggestions appended to messages) onto LSP diagnostics.
  - Formatting now uses the standalone `camel-format` executable, resolved next to the configured `camelPath` (`camel` -> `camel-format`, `camel.exe` -> `camel-format.exe`).
  - `Camel: Run Camel` now actually runs the active file with the Camel CLI and streams stdout/stderr to a "Camel" output channel.
  - `Camel: Visualize GraphIR` now runs `camel <file> std::rgir`, extracts the DOT graph and renders it in the graphviz webview panel (@hpcc-js/wasm).
- E2E smoke test extended: hover, diagnostics, formatting and GraphIR panel are all exercised against a real Camel build.

## [0.6.0]

- Migrated the build from pnpm to npm workspaces and fixed the Vite builds (Node SSR target), restoring a working, installable extension.
