# Camel extension host

## Register

product

## Users and purpose

Camel developers run source files and inspect compiler passes without writing debug configuration files. Native VS Code commands and quick inputs complement the GIR webview.

## Design principles

Use editor theme, icons, keyboard navigation and familiar quick inputs. Keep ordinary Run immediate; place composed runs and pass inspection beside it. Accept explicit pass sequences without shell execution. Show ordered pass occurrences when choosing pause points, preserve repeated passes and remember choices per workspace. Cancellation must not launch or overwrite saved choices. Keep English and Simplified Chinese labels aligned.
