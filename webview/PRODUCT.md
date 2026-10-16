# GraphIR webview

## Register
Product: a VS Code developer tool embedded beside Camel source code.

## Users and purpose
Camel developers inspect compiler GIR, node types, connections and source locations. The current request requires switching between an interactive graph and the exact GIR text.

## Design principles
Preserve the existing compact toolbar and graph interactions. Follow the editor theme and system typography. Keep graph and text views synchronized. Provide keyboard-accessible controls and readable loading/error states. Avoid decorative UI, animation and blocking dialogs.

Structured loops expose separate condition/body routes on compact cards. Keep state and capture details in the inspector, explain returned state in a small context bar, and retain breadcrumbs and a direct return to the owning LOOP. Do not guess ambiguous graph targets or add verbose edge labels.
LOOP nodes use two rows: a loop icon/title and unboxed navigation links. State explanations belong in the inspector or subgraph context bar, not on the graph node. Keep selection to a single border rather than a glow.
