# Debugger migration goal

Status: complete · Owner: this Codex goal · Started: 2026-10-16

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
- [x] Add release-capable pass boundary stops to the debug core.
- [x] Support per-occurrence pass breakpoints, pause-at-entry and pass stepping.
- [x] Serialize the actual current graph on the execution thread at a safe boundary.
- [x] Test repeated pass names, failed/consumed graphs, continue, restart and termination.

### M3 — Session/GIR experience
- [x] Compact pipeline controls; distinct live position and inspected history.
- [x] Automatically reveal the correct GIR at a compiler stop and execution stop.
- [x] Handle multiple sessions, source refresh, stale results and return-to-current.
- [x] Real VS Code tests and screenshot review in Chinese/English and narrow panels.

### M4 — Memory and remaining capabilities
- [x] Region overview, paged hex and objects, explicit refresh and clear pause context.
- [x] Allocation/space breakpoints only when supported; retain backend diagnostics.
- [x] Validate pagination, invalid addresses, session end and unsupported build behavior.

### M5 — Retire standalone frontend
- [x] Demonstrate every useful ledger capability or document intentional native replacement.
- [x] Remove tools/debugger/ui, serve_ui.py, embed_ui.py and frontend-only npm entries.
- [x] Update debugger principles, README, API/user docs and references.
- [x] Preserve CLI/REPL, DAP, HTTP backend as needed and all relevant regression tests.
- [x] Final build, integration tests, bilingual UX review; focused commits pushed in both repos.

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

- M2/M3 evidence: standard Release build; debugger plan 9/9 passed, including 32 pipeline
  assertions (expanded with failure diagnostics before commit). Real VS Code pipeline E2E
  passed in English/Chinese: initial/macro/inline graph changes, history without execution,
  return-to-current, execution entry handoff, 320px controls and reviewed screenshots.
  Additional E2E uses native session selection for two simultaneous stopped workers and
  verifies returning to the first, then VS Code restart returns to initial GIR.
- Boundary contract: index 0 is initial; later indices are after a pass that returned a graph.
  We do not pretend to stop inside a transformation. A consumed graph ends the sequence;
  pass stepping into a scheduler stops at runtime entry. No fictitious compiler stack/values.

- M4 partial evidence: native Release memory protocol passed 20 checks; debugger plan 10/10 passed; real VS Code memory
  UI passed English and Chinese with actual heap byte/object comparisons, paging/end, no-session
  and ended-session states, stop invalidation, explicit refresh, unsupported allocation controls
  and 320px controls. Overview now counts objects without constructing whole-heap arrays.
- M4 gate resolved: isolated Linux Debug standard build passed; the memory test passed 32
  checks including matching/nonmatching allocation spaces, live heap/object/GIR inspection at
  allocation stops, disabling/resuming and termination through the scope. Native allocation
  pauses are explicitly **after** the outer allocator releases locks (the old in-lock hook
  deadlocked when inspecting the heap). Release remains unsupported for allocation hooks.
- Known platform build limitation: Windows Debug exceeds the PE DLL export limit (69,406 vs
  65,535 symbols). Linux Debug proves the supported-build path. No Windows Debug capability
  is claimed; the user's pinned runtime was not changed.

- M5 cleanup: removed the plugin-only HTTP client and its obsolete transport test. Native
  DAP owns all current debugger requests; backend HTTP/REPL remain intact.

## Retirement audit

| Requirement | Authoritative replacement/evidence |
| --- | --- |
| Source/function breakpoints, stack, scopes, values, stepping, faults | Native DAP session/stepping/frames/faults/protocol tests; real VS Code native-debug E2E |
| Launch passes/args/cwd/env/entry/frame settings | Native adapter launch; manifest/provider; native-debug E2E launches macro+nvm with n=6, cwd/env |
| Pass boundaries, repeated passes, step/handoff, failure/consume | dap_pipeline test; pipeline E2E with selected sessions and restart |
| Current/initial/history GIR and node origins | structuredGraph/passGraph from worker; GIR/pipeline E2E; dap_node_breakpoints (24 checks across NodeVM/FastVM/macro+inline) |
| Multi-session lifecycle and stale state | pipeline E2E selected workers/restart; memory E2E selected heaps, step/end invalidation |
| Output, diagnostics, assertion visibility | Native stdout/stderr forwarding; faults/protocol tests; expected language errors no longer become Debug assertions |
| Memory overview/pages/explicit refresh | dap_memory (Release 20, Debug 32 checks); bilingual real UI byte/object comparisons, paging/empty/end and narrow controls |
| Allocation/space breakpoints | Linux Debug real allocation/inspect/clear/resume/filter/terminate; Release capability/refusal and disabled UI |
| File picker, sidebar, task selection, layout, logs, assertion overlay | Deliberately replaced by VS Code editor, selected sessions, native debug views and Debug Console; no second file browser or blocking overlay |

Linux Debug debugger plan 10/10 passed after fixing unique-consumer GIR export and expected
Debug diagnostics. Windows Release debugger plan 10/10 passed; final post-retirement runs
also include the new origin-breakpoint case. User's pinned runtime and Marketplace release
remain outside this goal's authorized actions.

## Completion evidence — 2026-10-16

- Standard Windows Release and isolated Linux Debug builds passed. Final debugger plans:
  **11/11** on each build; memory protocol **20/32** checks respectively; origin stops **24**
  checks across NodeVM, FastVM and macro+inline. Real JSON GIR contract passed in Debug and
  Release, including duplicate inputs sharing a unique-consumer source index.
- Final real VS Code native-debug E2E passed (launch/configuration, values, function breakpoint,
  step, output, graph/history and natural exit); pipeline E2E passed (macro result, history,
  next pass, runtime handoff, selected sessions, restart and narrow controls).
- Real memory UI E2E passed in English and Chinese: actual bytes/objects, page/end states,
  selected worker heaps, stop/end invalidation, explicit refresh, Release support messaging
  and narrow controls. Active memory tabs stay selected while GIR updates in the background.
- Standalone UI/proxy/embed sources and their npm entries/dependencies removed in Camel
  **32c9205d**; native index locking hardened in **7bd88c8e**. HTTP/REPL/DAP and regression
  coverage remain. No executable/documentation points to the retired frontend.
- Expected diagnostics no longer become Debug assertions (**e1b46bc6**); duplicate-input
  JSON export follows current runtime use indices (**7a7ab0d2**). Allocation inspection uses
  completed outer-allocator boundaries rather than in-lock hooks (**3cf4a038**).
- Extension build, TypeScript, localization and compatibility checks passed. Changes are
  committed/pushed on existing feature branches; no Marketplace release/tag and no pinned
  runtime replacement were performed.
