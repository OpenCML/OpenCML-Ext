# Camel extension host

## Register

product

## Users and purpose

Camel developers run source files and inspect compiler passes without writing debug configuration files. Native VS Code commands and quick inputs complement the GIR webview.

## Design principles

Use editor theme, icons, keyboard navigation and familiar quick inputs. Keep ordinary Run immediate; place composed runs and pass inspection beside it. Accept explicit pass sequences without shell execution. Use a keyboard-only pause-before-pass field, prefilled with the first pass on every launch. Repeated names target their first occurrence. Remember the pipeline input per workspace. Cancellation must not launch or overwrite saved choices. Keep English and Simplified Chinese labels aligned.
