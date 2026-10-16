# GraphIR webview

## Register
Product: a VS Code developer tool embedded beside Camel source code.

## Users and purpose
Camel developers inspect compiler GIR, node types, connections and source locations. The current request requires switching between an interactive graph and the exact GIR text.

## Design principles
Preserve the existing compact toolbar and graph interactions. Follow the editor theme and system typography. Keep graph and text views synchronized. Provide keyboard-accessible controls and readable loading/error states. Avoid decorative UI, animation and blocking dialogs.

Structured loops expose separate condition/body routes on compact cards. Keep state and capture details in the inspector, explain returned state in a small context bar, and retain breadcrumbs and a direct return to the owning LOOP. Do not guess ambiguous graph targets or add verbose edge labels.
LOOP nodes use two rows: a loop icon/title and unboxed navigation links. State explanations belong in the inspector or subgraph context bar, not on the graph node. Keep selection to a single border rather than a glow.

Read versioned GIR JSON by default. Keep graph references and output types as data, independent of labels and layout. Show output types in hover/inspection rather than adding permanent labels. The graph engine receives generated layout DOT; the text view retains the original JSON. Unsupported structured runtimes fail explicitly.

Debug session graphs come from native DAP and the stopped worker, never from recompiling the
editor. A compact strip identifies the actual initial/after-pass/runtime stop, offers explicit
pass stepping, and separates inspected history from execution position. Standard source
stepping cannot silently mean a compiler step. Preserve theme tokens and wrap at narrow widths.

Hierarchy opens a uniquely referenced module-entry main directly, with a route back to the
module. Preserve explicit navigation choices; a library graph merely named main is not an entry.

Function-valued DATA nodes use explicit JSON callee references for a compact function name and
function glyph. Retain DATA semantics and the original runtime representation in inspection;
never infer function identity from a display string. Layout uses the compact card dimensions.

Node families use redundant visual cues without adding graph labels: rounded double-side
function references/calls, plain single-frame operations, and diamond branch/merge/gate
nodes. LOOP keeps a compact rectangle for its navigation controls. Plain values stay neutral. Derive families from runtime kinds and function metadata;
retain node dimensions, visible edge handles, loop actions and distinct debugger state cues.

The secondary memory panel follows the selected native debug session. Read an aggregate once
on first paused open, then refresh explicitly; invalidate old heap responses on stop/session
changes. Byte/object pages scroll within their data area, controls wrap at narrow widths.
Debug allocation stops are labelled after allocation, outside allocator locks. Explain and
disable unsupported hooks. Subsequent steps update GIR without covering an active memory tab.
