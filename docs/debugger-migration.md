# Debugger migration goal

Status: active · Owner: this Codex goal · Started: 2026-10-16

## Outcome

OpenCML-Ext becomes the maintained graphical debugger for Camel. Retire the standalone
Web frontend after its useful capabilities have an accepted replacement. Keep camel-db,
its REPL, the debug core and protocol tests. No automatic Marketplace release.

This document is the durable task ledger: update it with each focused implementation commit.
A checked item needs evidence, not only an implementation or a successful build.

## Architecture

- **LSP** owns editor analysis: diagnostics, symbols, navigation and semantic information.
- **DAP / camel-db** owns execution: breakpoints, stopping, stepping, stack, values and faults.
- **The plugin** presents source and GIR as two views of the same session. It never invents
  execution state or recompiles a separate graph to stand in for a paused program.
- Reuse the native `camel-db --dap` adapter. Remove the plugin's parallel HTTP-based DAP
  implementation rather than extending its simplified stack/variable behavior.
- Compiler pass stops must work in Release builds, through the debug core, independently
  of the old NDEBUG-only DebugBreakpoint hooks. Before/after boundaries are explicit.
- Snapshots are immutable serialized data. Do not retain unrooted GC graph pointers.
- Use versioned GIR JSON for whole-program graph interchange. Keep origins lossless.
- No legacy fallback or second UI to maintain after migration.

## UX contract

Use the VS Code theme, native debugging views and existing compact GIR panel. No Gemini
Designer. All new user-facing text supports English and Chinese.

A compact session strip exposes the pass sequence, current boundary and breakpoint state.
A stage being inspected is visibly distinct from the execution position. Selecting history
never resumes execution. Returning to the current stop is one action. Details and help live
in hover/inspectors, not permanent labels over the graph. Controls are keyboard accessible.

Use standard Continue / Step / Stop controls wherever their meaning is clear. Pass stepping
is explicitly labelled; source-line stepping cannot silently mean advancing a compiler pass.
Compiler-stage stops have no fabricated runtime variables or source call stack.

Memory inspection is a secondary view: region overview, selected-region objects and paged
hex bytes; refresh while paused or on explicit request. Never continuously fetch full heaps.
Unsupported build-only allocation hooks are explained, not displayed as working controls.

## Capability ledger

| Existing capability | Destination | Acceptance |
| --- | --- | --- |
| Source breakpoints, stack, scopes, variables, functions, exceptions | Native DAP + VS Code views | Real stdio DAP and VS Code tests; no HTTP adapter duplicate |
| Launch pass sequence, main args, cwd/env, entry stop, frame presentation | launch.json | Values reach the worker; invalid configuration is actionable |
| Pipeline strip / stage breakpoints | Debug session controls + compact GIR strip | Stops at exact requested boundary in Release |
| Step by compiler pass | DAP/debug core | One requested boundary per step; final scheduling handled explicitly |
| Initial/per-pass/current GIR | Existing GraphIR panel | Correct session and stage; source/type/navigation preserved |
| Node breakpoints and paused node | GIR + native DAP extensions | Origin-based breakpoints survive transformations; stopped node highlighted |
| Task selection / lifecycle | VS Code debug sessions | No first-session guessing; cleanup and restart tested |
| Debugger vs worker logs | Debug Console / Output | stdout/stderr and diagnostics preserved; failures terminate coherently |
| Region usage/space allocation breakpoints | Memory inspection view | Explicit target, build support and pause reason |
| Region hex/object inspection | Memory view / DAP memory where appropriate | Paging, bounds, stale-request protection and empty/error states |
| Assertion overlay | Exception/failure presentation | Fault details remain accessible without a blocking overlay |
| File picker/sidebar/layout preferences | Native editor/workspace | Reuse VS Code; no replacement custom file browser |

## Milestones

### M0 — Inventory and goal
- [x] Locate standalone Vue UI, Python proxy, unused embed script and npm entries.
- [x] Identify native DAP vs plugin HTTP adapter duplication.
- [x] Record scope, design contract, protocol boundaries and deletion gates here.

### M1 — One debugging adapter
- [x] Use native camel-db DAP in the plugin; remove duplicated protocol logic.
- [x] Expose launch passes, main arguments, cwd/env, stopOnEntry, stepBy and frames.
- [x] Preserve GIR node breakpoints, current graph and historical snapshots through DAP.
- [x] Validate launch, breakpoints, scopes/variables, faults and session teardown.

### M2 — Compiler pipeline debugging
- [ ] Add release-capable pass boundary stops to the debug core.
- [ ] Support per-occurrence pass breakpoints, pause-at-entry and pass stepping.
- [ ] Serialize the actual current graph on the execution thread at a safe boundary.
- [ ] Test repeated pass names, failed/consumed graphs, continue, restart and termination.

### M3 — Session/GIR experience
- [ ] Compact pipeline controls; distinct live position and inspected history.
- [ ] Automatically reveal the correct GIR at a compiler stop and execution stop.
- [ ] Handle multiple sessions, source refresh, stale results and return-to-current.
- [ ] Real VS Code tests and screenshot review in Chinese/English and narrow panels.

### M4 — Memory and remaining capabilities
- [ ] Region overview, paged hex and objects, explicit refresh and clear pause context.
- [ ] Allocation/space breakpoints only when supported; retain backend diagnostics.
- [ ] Validate pagination, invalid addresses, session end and unsupported build behavior.

### M5 — Retire standalone frontend
- [ ] Demonstrate every useful ledger capability or document intentional native replacement.
- [ ] Remove tools/debugger/ui, serve_ui.py, embed_ui.py and frontend-only npm entries.
- [ ] Update debugger principles, README, API/user docs and references.
- [ ] Preserve CLI/REPL, DAP, HTTP backend as needed and all relevant regression tests.
- [ ] Final build, integration tests, bilingual UX review; focused commits pushed in both repos.

## Verification and operating constraints

Use standard Camel builds and meaningful protocol/integration tests. Never terminate a user's
editor to unlock binaries. Do not overwrite the pinned `.local/camel/runtime` automatically:
update it only with explicit authorization. The user's previous update request has completed.
Other agents share Camel's working tree: stage only this goal's changes. Commit/push focused
changes on the existing feature branch; no force pushes, release tags or automatic publishing.

## Evidence / decisions

- 2026-10-16: inventory confirms old pipeline controls pause *before* a stage using debug-only
  hooks; pass snapshots also exist in Release. The plugin currently offers snapshots but
  neither compiler-stage control nor the native adapter's full inspection capabilities.
- 2026-10-16: native DAP already supports launch passes, main args, cwd/env, stopOnEntry,
  source/node steps, stack/variables, exceptions and `camel/graph`; start migration there.

- M1 evidence: real VS Code `native-debug` E2E passed with main argument `n=6`,
  macro+nvm, entry stop, parameter inspection, function breakpoint, line step, output 12,
  current graph, historical snapshots and natural exit. Native DAP session/protocol tests
  passed (99/85 checks). Source stepping and fault regressions passed (136/62 checks).
- M1 decision: native DAP owns the worker and its port. Remove the old HTTP attach snippet
  and unused debugPort controls rather than imply that a gateway attachment still works.
  Multi-session selection uses VS Code's selected session; the graph frontend never guesses
  the first worker. Ordinary debugging does not require LSP availability.
