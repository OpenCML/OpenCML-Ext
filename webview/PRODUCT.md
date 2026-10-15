# GraphIR webview

## Register
Product: a VS Code developer tool embedded beside Camel source code.

## Users and purpose
Camel developers inspect compiler GIR, node types, connections and source locations. The current request requires switching between an interactive graph and the exact GIR text.

## Design principles
Preserve the existing compact toolbar and graph interactions. Follow the editor theme and system typography. Keep graph and text views synchronized. Provide keyboard-accessible controls and readable loading/error states. Avoid decorative UI, animation and blocking dialogs.
