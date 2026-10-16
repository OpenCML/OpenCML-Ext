## 1.12.2

- Use `std::macro std::opt std::nvm` as the default pass pipeline in quick inputs and launch templates. Preserve previously saved user pipelines.

- Mark the paused GIR node with an external execution arrow and outer frame instead of a yellow fill. Preserve category colors, selection borders and separate breakpoint outlines, including diamond control nodes.

## 1.12.0

- Add Run with Passes and Debug GIR Passes beside the editor Run icon and in the command palette. Accept ordered pass sequences or pasted Camel commands without editing launch.json; remember the pipeline per workspace.
- Start pass inspection with a keyboard-only pause-before-pass field, defaulting to the first pass. Advance manually with Next pass; repeated names target their first occurrence.
- Distinguish function nodes with a slanted function icon and double-side frames, and operations with a lightly rounded single frame. Grow function cards with their names while reserving matching layout space.
- Render BRCH/JOIN as unfilled square diamonds at the normal font size. Keep GATE/SYNC as compact, tinted single-line markers without repeating their kind.
- Hide unused DATA input handles while preserving real and projected connections in hierarchy views.
- Color literal DATA values with the active theme's Camel lexical scopes and user TextMate overrides. Highlight literal containers conservatively and leave opaque values and function metadata unchanged.
- Align English and Chinese command names and verify native pass debugging, graph interactions, theme changes and live color overrides in real VS Code windows.

## 1.11.0

- Use the native Camel DAP debugger for compiler-pass and runtime debugging. Configure pass breakpoints, step through passes, and inspect the paused GIR with snapshot history and multi-session navigation.
- Add a paused-memory inspector with region summaries, paged objects, hex/ASCII bytes and allocation stops when supported by the runtime. Keep memory inspection visible across debugger stops.
- Enter an unambiguous main function automatically in hierarchy mode. Render DATA function values as compact function references while preserving full values and output types in details.
- Localize the new debugger controls and memory views in English and Simplified Chinese. Requires a recent Camel runtime with the corresponding native DAP capabilities.

## 1.10.0

- Use the versioned `std::jgir` JSON interchange by default. Graph references, output types, input kinds, port indices, source ranges and origins are structured fields; display labels no longer determine JSON navigation.
- Align export choices with the new runtime semantics: `gir` is compact DOT, `rgir` is rich DOT, `agir` is compact DOT with roles. Require `jgir` support rather than silently substituting an older format.
- Show node output types in full-node hover and details without adding permanent graph labels. Preserve raw JSON for text, copy and editor export, and generate DOT only for layout.
- Validate JSON versions, graph/node identities, references, ports, edges and source ranges. Keep synthetic ARGS/EXIT markers in the viewer.

## 1.9.1

- Reduce LOOP nodes to a compact title and unboxed condition/body navigation row. Remove inline state explanations and selection glow; keep state/capture details in the inspector.
- Preserve double-click entry through the compact node's central divider while keeping navigation buttons independent.

## 1.9.0

- Make LOOP nodes navigable: separate condition/body buttons, double-click body entry, nested-loop breadcrumbs, sibling switching and return to the owning LOOP.
- Show initial state, iterated elements and captured inputs in LOOP details. Explain next-state/condition results inside subgraphs; keep breakpoints available in the inspector.
- Hide referenced loop subgraph cards in hierarchy mode, reserve compact LOOP card geometry and preserve fallback cards for unresolved/ambiguous references.
- Decode quoted DOT escapes correctly, including multiline styled labels. Add real Camel export and bilingual VS Code interaction coverage.

## 1.8.2

- Default Camel inlay hints to VS Code's hold-to-show mode (`offUnlessPressed`, Ctrl+Alt), respecting explicit editor preferences.
- With the updated Camel language server, place parameter names before whole positional arguments, including arrays, lambdas, tuples and expressions. Use parser argument ranges and omit redundant names, named arguments and uncertain positions after spreads.
- Add native LSP argument-boundary checks and real-editor checks for the language default and user overrides.

## 1.8.1

- Refresh Camel TextMate highlighting against the current runtime token table: namespaces, loops, reserved words, operators, qualified declarations, calls, annotations, numeric literals and comments.
- Fix multiline string precedence, remove unsupported interpolation guesses and replace variable-length lookbehinds. Basic highlighting works without the language server; bare function references still require semantic tokens.
- Stop automatically closing or indenting Camel comparisons as angle brackets. Remove legacy PSL language registration and syntax assets.
- Add real TextMate/Oniguruma regression tests and a script to check keyword/operator drift against a Camel source checkout.

## 1.8.0

- Add type and parameter inlay-hint preferences, applied immediately to visible editors, and localized compiler-validated typo fixes.
- Synchronize file-system changes with the native server and preserve saved-only diagnostics during dependency refreshes.
- With the updated Camel language server: analyze unsaved imports, refresh dependent diagnostics, find references in unopened workspace files and safely rename exported functions across files. Add call hierarchy, named type navigation, folding, selection expansion and conservative inlay hints/quick fixes.
- Add protocol and real-editor regression coverage. These language features require the updated runtime; the bundled fallback still provides diagnostics and formatting only.

## 1.7.2

- Add bilingual diagnostic trigger/debounce/severity settings and a CLI check/GIR timeout.
- Add live GIR preferences for following sources, refreshing, browsing, edge labels, hover neighborhoods and viewport restoration. Remember toolbar choices per workspace; explicit setting changes take precedence.
- Apply the problem limit consistently to native and fallback diagnostics.

## 1.7.1

- Declare Camel 0.2.11 as the tested support baseline. Warn for older/unknown versions and probe actual features, allowing backported capabilities.
- Probe CLI GIR, JSON diagnostics and graph metadata using disposable compile-only fixtures. Report LSP capabilities and reasons in Runtime Info and Health Check; gate unavailable CLI GIR and fallback features.
- Treat debugger versions independently. Report unsupported HTTP endpoints, avoid repeated unsupported debugger requests, and disable unavailable pass-snapshot controls with a reason.
- Test version boundaries, capability failures, temporary-file cleanup, real runtime probes, runtime health and debugger lifecycle.

## 1.7.0

- Localize commands, settings, debug configurations, runtime notifications, diagnostic advice and the complete GIR interface into English and Simplified Chinese.
- Follow the VS Code display language in the extension host and webview; use English for unsupported locales. Preserve source identifiers and raw Camel output.
- Add catalog/placeholder checks and run GIR interaction tests with both English and Chinese editor locales. Allow the toolbar to wrap in narrow panels.

## 1.6.4

- Render synthetic ARGS/EXIT markers as compact input/output boundary lines, with a single label and only the connected handle.
- Explain boundary semantics in hover/details and prevent setting runtime breakpoints on these markers.

## 1.6.3

- Display parameter and captured-variable names on PORT nodes when supplied by Camel.
- Display the assembled type on FILL nodes; keep the node kind beneath the title and expose full types, parameter kinds and indices in hover/details.
- Requires a Camel build with DOT port/type metadata for complete details; older exports remain supported.

## 1.6.2

- GIR follows active CML source by default, with a workspace-persisted pin toggle and source-navigation protection.
- Reuse the GIR panel with Ctrl+K Ctrl+G (Cmd+K Cmd+G on macOS); retain per-file/pass navigation and cameras within the panel session.
- Keep the function directory visible in hierarchy mode, including entry and current-function labels.

# Change Log

All notable changes to the "OpenCML-Ext" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.6.1] - 2026-10-15

- Recognize DATA function values as graph navigation targets alongside FUNC nodes, including the root main function value.
- Resolve unambiguous cross-level and recursive graph references. Preserve fallback cards for ambiguous names.
- When the module has an explicit function-value CALL entry, show its entry flow without duplicate function cards; retain other top-level graphs in a compact expandable Module Functions list beside breadcrumbs.
- Add back navigation to return from cross-level calls. Verify navigation and retained module graphs against the real perm_query_types case and the VS Code webview.

## [1.6.0] - 2026-10-15

- Search all GIR nodes by name, type or ID using Ctrl/Cmd+F or the status-bar Search button. Results include graph paths, navigate across hierarchy levels, center and highlight the target, and provide return-to-origin navigation. Enter/Shift+Enter cycle results; Escape closes search.
- Shift-click a node to lock its neighborhood highlight. Choose upstream/downstream/both and one/two hops in the status bar; Escape or Unlock releases it.
- Filter ordinary/context/control edges in display options. Unselected kinds fade by default or can be fully hidden without moving nodes. A status-bar indicator makes active filtering explicit.
- Verify traversal cycles, direction/depth, cross-level search/return, hover lock, filter visibility and stable node positions with model and real VS Code webview tests.

## [1.5.0] - 2026-10-15

- Highlight direct upstream/downstream neighbors and connected edges on hover; fade unrelated nodes and restore on leave. Show counts in the existing status bar.
- Replace repeated edge-type text with colors, solid/dashed/dotted lines and directional arrows. Reveal port indices only on edges connected to the hovered node; retain accessible type descriptions and the optional legend.
- Enter uniquely matched child graphs by double-clicking FUNC nodes. Remove duplicate child cards while preserving cards for unreferenced or ambiguously named children; retain breadcrumb navigation.
- Verify hover reset, edge styles/arrows, FUNC entry and ambiguous-reference fallback with model and real webview tests.

## [1.4.1] - 2026-10-15

- Stack only module-level graphs vertically; preserve the original Graphviz layout within functions. Hierarchical child cards are horizontal inside functions and vertical at module level.
- Combine GIR identity, view/mode switches and actions into one compact toolbar. Keep breadcrumbs only in hierarchical mode and show the edge legend with display options.
- Verify toolbar height, horizontal function subgraphs, nested cards and existing navigation in the VS Code webview.

## [1.4.0] - 2026-10-15

- Add default hierarchical GIR browsing alongside the existing flat view. Child graphs appear as compact cards with node counts; double-click to enter and use breadcrumbs to return.
- Restore per-level camera and inspector state during navigation. New compiler output resets navigation to the module overview.
- Preserve cross-scope connections through collapsed graph cards and external input/output boundary nodes, retaining edge kinds and port indices.
- Keep ordinary node source navigation and breakpoint interactions, and verify nested navigation, camera restoration and boundary projection with model and real VS Code webview tests.

## [1.3.3] - 2026-10-15

- Render GIR WITH/WITH_PORT context inputs as accented dashed lines, NORM/NORM_PORT ordinary inputs as solid lines, and CTRL dependencies as dotted lines.
- Label input kinds explicitly while preserving port indices, and add a compact legend explaining output/input indices.
- Verify edge labels and rendered line styles in the VS Code webview regression suite.

## [1.3.2] - 2026-10-15

- Fix GIR source navigation when native LSP output retains DOT-escaped Windows temporary paths. Map only matching source attributes back to the original editor document; preserve imported library paths.
- Handle the same escaped-path mapping for CLI-generated GIR and open source locations in the existing source editor group.
- Validate source mapping, exact jump positions and preservation of unsaved buffers in the real VS Code webview. Current runtime source spans are available in rgir.

## [1.3.1] - 2026-10-15

- Stack sibling GIR graphs vertically by default, including nested subgraphs, with centered groups and resized containing boxes. Preserve each graph's direct-node layout and connections.
- Add a persisted vertical/original layout selector in display options. Vertical mode opens at a readable width-fit scale; Fit still shows the complete graph.
- Verify nested graph spacing, layout switching and unchanged raw GIR in the VS Code webview regression suite.

## [1.3.0] - 2026-10-15

- Add a Camel status-bar entry showing the active native LSP, CLI fallback, startup failure and stopped states. Its menu opens runtime checks, restarts the server or opens path settings.
- Add **Camel: Runtime Info and Health Check**: actual executable paths, CLI/LSP versions, startup and version-probe failures, tool availability, environment search roots and mixed-installation warnings.
- Display compiler suggestions in diagnostics and offer **View Camel repair suggestion** through Quick Fix. Suggestions remain advisory; no guessed source edits are applied.
- Save modified open Camel files in the current workspace before running, including the active file and open dependencies. Cancel execution if saving fails or a saved buffer changes again, and prevent overlapping runs.
- Remove automatic changes to workspace spell-checker settings.
- Verify these flows in a real VS Code extension host, including invalid-server and fallback configurations.

## [1.2.4] - 2026-10-15

- Preserve Graphviz node centers when limiting displayed width and height. Long function-value nodes now align with their CALL nodes instead of shifting left and bending the connecting edge.
- Add a real webview regression check for Function-to-CALL center alignment.

## [1.2.3] - 2026-10-15

- Treat opened source files as editable modules: suppress only `EntryModuleMissingMain` (`0x0300001B`) in editor diagnostics, including native push/pull reports and the CLI fallback. Other syntax and semantic errors remain visible. Running a file still enforces the runtime's entry-point requirements.
- Add regression coverage for valid libraries without `main`, real errors in library code, and clearing errors after edits.

## [1.2.2] - 2026-10-15

- Fix blank GraphIR panels: resolve bundled scripts/styles relative to the panel HTML.
- Redesign the panel with a compact toolbar, theme-aware nodes, collapsible options, zoom controls, text line numbers and dismissible node details.
- Add graph/text switching, copy GIR and open GIR in an editor, with matching compiler output in both views.
- Add editor title and context-menu entry points, and keep source and graph side by side.
- Use `camel/graph` for current editor contents; CLI style variants also compile unsaved contents. Show compilation errors and discard stale responses.
- Add a real VS Code webview rendering test covering nodes, view switching, copy, editor export, unsaved buffers and compiler errors.

## [1.2.1] - 2026-10-15

- Resolve Camel tools through `CAMEL_HOME` and `PATH`, and correctly handle a configured `bin` directory. Add an explicit `camelLsPath` override.
- Enable CML semantic highlighting, including function references used as values (`[inc]`), with token scopes for current camel-ls.
- Restart the language server after toolchain path changes and add **Camel: Restart Language Server**; surface startup errors and resynchronize open documents.
- Keep CLI fallback diagnostics when the compiler exits nonzero, retain error codes and suggestions, honor the problem limit, and support push-only clients. Remove demo hover, signature and TypeScript/JavaScript completion providers.
- Add native protocol, tool discovery, fallback and VS Code language-feature regression tests.

## [1.2.0] - 2026-10-02

The GraphIR panel can now step through the compilation itself: while a debug session is active, `camel-db` serves the GIR snapshots taken before and after each compiler pass, and a new stage dropdown in the panel switches the view between them.

### Added

- **Per-pass snapshot views in the GraphIR panel**: a stage dropdown (`原始 GIR（当前行为）` / `入口 GIR（passes 前）` / `N. <pass 名>`) lists the snapshots of the current run's compile, fetched from the new camel-db endpoints `GET /api/pass-graphs` and `GET /api/pass-graph?index=N`. Selecting one renders its DOT through the existing layout pipeline; node breakpoints, pause highlight, and jump-to-source keep working because snapshot nodes carry the same `origin` / `span` / `srcfile` attributes.
- The snapshot list refreshes automatically when a run starts or restarts (hooked to the same gir-json refresh point as line-breakpoint verification), and the E2E suite validates the new endpoints when a supporting camel-db is present (`PASS_GRAPH_OK`, otherwise `PASS_GRAPH_SKIP`).

### Changed

- Older camel-db builds without `/api/pass-graphs` (404) degrade gracefully: the dropdown simply shows only `原始 GIR`.

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
