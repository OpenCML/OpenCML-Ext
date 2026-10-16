# OpenCML-Ext

VSCode extension for the [Camel](https://github.com/OpenCML/Camel) language, centered on two things:

- **GraphIR visualization** — an interactive graph view of your program's Graph IR
- **Debugging** — native DAP debugging of Camel scripts via `camel-db`

Language features (completion, navigation, rename, semantic highlighting, diagnostics and formatting) are served by the standardized Camel language server (`camel-ls`).

## Requirements

A Camel toolchain build (`camel.exe`, `camel-ls.exe`, `camel-format.exe`, `camel-db.exe`). Configure its location with `opencmlLanguageServer.camelPath` (point it at the `camel` executable or its `bin` directory); the other tools are auto-detected next to it. With the default `camel` setting, `CAMEL_HOME/bin` and then `PATH` are searched.

For a local Camel checkout, add this to VS Code settings:

```json
{
    "opencmlLanguageServer.camelPath": "D:\\Projects\\Camel\\out\\latest\\bin\\camel.exe"
}
```

Use the compiled executable or its `bin` directory, not the source repository root. Toolchain path changes restart the language server automatically; **Camel: Restart Language Server** also reloads it after rebuilding Camel. An independent server can be selected with `opencmlLanguageServer.camelLsPath`.

CML semantic highlighting is enabled by default. It uses the runtime's symbol resolution, so function values such as `[inc]` are highlighted as functions even without a call. An explicit user setting disabling semantic highlighting still takes precedence. On extension 1.2.0, enable `[cml].editor.semanticHighlighting.enabled` manually and reload the window after changing the toolchain path.

## Features

### GraphIR visualization

Open a `.cml` file and use the graph button in the editor title, the editor context menu, or **Ctrl+Shift+P → Camel: Visualize GraphIR**. The panel opens beside the source:

- **连线类型**: solid ordinary inputs, dashed context inputs, and dotted control dependencies, with directional arrows. Port indices appear on connected edges when hovering a node; type explanations remain in display options.
- **层级浏览 / 平铺视图**: hierarchical browsing opens with child-graph cards; double-click a FUNC node to enter its uniquely matched child graph, or use the card when no unambiguous reference exists; click breadcrumbs to return. Each level remembers its viewport and inspector selection until recompilation. Cross-level connections remain visible as boundary inputs/outputs.
- **搜索**: focus the graph and press Ctrl/Cmd+F (or click Search in the status bar) to search the entire module by node name, type or ID. Enter/Shift+Enter cycles matches across levels; use “返回搜索前位置” to restore your original view.
- **锁定高亮**: Shift-click a node to retain its neighborhood while moving the pointer. Status-bar controls select upstream/downstream/both and one/two hops; Escape unlocks.
- **连线筛选** in display options fades ordinary/context/control edges independently, or hides unchecked types entirely. Node positions stay fixed and the status bar indicates active filtering.
- **模块函数**: modules with an explicit entry show the entry flow first; other retained function graphs remain accessible in the expandable list beside breadcrumbs. Double-click FUNC or DATA function-value nodes to navigate to unambiguous local, cross-level or recursive targets, and use Back to return to the caller.
- **循环子图**: LOOP nodes provide separate condition/body buttons; double-click enters the body. Referenced loop subgraphs no longer appear as detached cards in hierarchy mode. The inspector lists initial state, iterated elements and captures; a compact subgraph bar explains the returned state and provides a return-to-LOOP action. LOOP breakpoints remain available in its inspector. Missing or ambiguous subgraphs keep their fallback cards and disable uncertain entry buttons.
- **图排列** in display options switches between vertical module-level graphs (default, preserving the original layout inside functions) and the original Graphviz layout. Vertical mode fits the width; use Fit to see the full graph.
- **图 / 文本** switches between the interactive graph and the same raw GIR output (JSON or DOT)
- **复制 GIR** copies the displayed GIR; **在编辑器打开** opens an editable document that can be saved
- current unsaved editor text is used; **刷新** recompiles it, and saving refreshes automatically
- compilation failures are displayed in the panel instead of leaving a blank or stale graph

- pan / zoom / node selection with attribute inspection
- pass picker: `std::jgir` (default, versioned JSON), `std::gir` (compact DOT), `std::rgir` (rich Graphviz DOT), `std::agir` (compact DOT with roles). The plugin requires `std::jgir` support for the default view; it does not silently substitute an older format.
- **per-pass compile snapshots**: while a debug session is active, a stage dropdown lists the GIR captured before and after each compiler pass (served by `camel-db`); node breakpoints, pause highlight and jump-to-source work in snapshot views too
- auto-refresh on save
- **double-click a node to set a node breakpoint** (used by the debugger)
- nested subgraphs (functions/closures) rendered as clusters; layout computed by Graphviz

### Debugging

The `camel` debug type launches `camel-db --dap`. Standard VS Code debug views expose
source and function breakpoints, source-line or GIR-node stepping, call stacks, scopes,
variables, expression inspection and exceptions. Output arrives in the Debug Console;
the native adapter owns session cleanup and the debuggee's exit status.

Double-click a GIR node to set an origin-based node breakpoint. The GraphIR panel uses
session-scoped DAP requests for per-pass snapshots and paused-node highlighting.
Launch configuration supports pass chains, main arguments, cwd/env, stopOnEntry and frame
presentation; see the example below. Native launch owns its worker and chooses a free port.
Attaching to the old HTTP gateway is no longer offered.

### Language features

Camel defaults to `"editor.inlayHints.enabled": "offUnlessPressed"`: hold **Ctrl+Alt** to show hints, then release to hide them. Existing explicit language settings take precedence. To choose another behavior, set this in VS Code settings:

```json
"[cml]": {
    "editor.inlayHints.enabled": "offUnlessPressed"
}
```

Use `on` for permanent hints, `onUnlessPressed` to hide them while holding Ctrl+Alt, or `off` to disable them. / 默认按住 Ctrl+Alt 临时显示类型和参数提示，松开隐藏；可在 `[cml]` 设置中调整。已有显式语言设置优先。

基础着色由 TextMate 规则提供，不依赖 LSP；语义高亮会进一步识别函数引用、参数、类型和导入符号。关闭 `editor.semanticHighlighting.enabled` 或语言服务尚未启动时，关键字、字符串、注释、数字、运算符、函数声明与明确的调用仍会着色。`let g = inc` 中 `inc` 的符号身份需要语义分析。

Grammar maintenance: run `npm run test:grammar` to exercise VS Code's TextMate/Oniguruma tokenizer. Run `node scripts/sync-grammar.mjs --check <Camel-source-directory>` to check the keyword/operator inventory against the runtime, or omit `--check` to update it.

Publishing: branch pushes run CI; version tags publish the tested VSIX to Marketplace using GitHub/Entra federation. See [the one-time identity setup and release steps](docs/publishing.md).

- Scope-aware completion, member completion and signature help
- Hover types and documentation, go to definition, references and symbol search
- Rename with runtime safety checks, document highlights and semantic tokens
- With the updated native server: workspace references (including unopened files), cross-file exported-function rename, incoming/outgoing call hierarchy, named type definitions, folding and selection expansion.
- Unsaved imported sources participate in analysis; changes, closes and external file updates invalidate dependent diagnostics.
- Inferred local types and unambiguous positional argument names appear as inlay hints. Parameter names precede the entire argument, including arrays, lambdas and expressions. A unique one-character unresolved-name correction is offered only after recompilation succeeds.
- Library editing does not require `main`: the entry-only missing-main diagnostic is omitted in the editor. Running a file still checks entry requirements.
- Diagnostics via `camel check`-equivalent pipeline (syntax + semantic errors with ranges and suggestions)
- Document formatting via `camel-format`
- `Camel: Run Camel` streams program output to an output channel

新增能力需要本次更新的 `camel-ls`，仅更新插件不会替旧运行时实现这些协议。跨文件重命名目前支持导出函数，会先验证整个修改快照；遇到歧义、别名或冲突会拒绝修改。字段、导出类型/变量的跨文件重命名以及移动文件后的 import 重写暂不支持。工作区最多扫描 5000 个源码文件，超过限制会报错，避免返回不完整的修改；取消请求在编译之间生效，不能中断一次正在执行的编译。

### Runtime status and diagnostic advice

When a Camel source editor is active, the status bar shows **Camel · LSP**, **备用模式**, or the current startup/failure state. Click it to inspect the runtime, restart the server or configure its path.

**Camel: Runtime Info and Health Check** writes the active executable paths, runtime/server versions, tool availability and Camel search-path environment to the Camel output channel. It also reports startup failures and mixed-installation paths.

Compiler suggestions appear below their diagnostic messages. Use the lightbulb's **查看 Camel 修复建议** action to open the full explanation beside the source. These are runtime-provided suggestions, not automatic source edits.

**Run Camel** saves the active file and other modified, open `.cml` buffers in the same workspace folder before execution, so open dependencies use their latest contents. It logs the files saved and cancels on a save failure. An untitled file must be saved first. A second run is ignored while the current run is still active.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `opencmlLanguageServer.camelPath` | `camel` | Path to the Camel executable; sibling tools are auto-detected next to it |
| `opencmlLanguageServer.camelLsPath` | `""` | Optional explicit `camel-ls` path |
| `opencmlLanguageServer.camelDbPath` | `""` | Path to `camel-db` (debugger); empty = resolve next to Camel |
| `opencmlLanguageServer.maxNumberOfProblems` | `100` | Max problems reported by the CLI fallback |
| `opencmlLanguageServer.trace.server` | `off` | LSP traffic tracing |

## Architecture

```
VSCode
├─ Language Client ──stdio──► camel-ls.exe        (standardized LSP, lives in Camel repo)
├─ Debug views ──────DAP────► camel-db.exe --dap ──► worker debug core
└─ GraphIR Webview ◄─postMessage─ extension ──CLI / session DAP──► Camel
```

- Language server: `camel-ls` is spawned directly when available; otherwise the bundled Node server shells out to the Camel CLI (fallback: diagnostics and formatting only; no placeholder completion or hover).
- Debug adapter: the native Camel adapter controls execution. The extension observes its events to synchronize GIR; it does not duplicate source mapping, breakpoints or runtime values.

## Development

```bash
npm install
npm run build        # client + server + webview
npm run pub          # build + package vsix into rollup/
node scripts/e2e/run.mjs           # E2E (needs CAMEL_EXE_PATH or a local Camel build)
E2E_MODE=fallback node scripts/e2e/run.mjs   # fallback-path E2E
E2E_MODE=experience node scripts/e2e/run.mjs # runtime status, advice, save-before-run
E2E_MODE=gir node scripts/e2e/run.mjs        # real webview UI; needs playwright or PLAYWRIGHT_PATH
E2E_MODE=lsp node scripts/e2e/run.mjs        # language features + inc tokens + restart
# Set CAMEL_HOME (installation root) or CAMEL_LS_PATH for the native server test.
# Set CAMEL_EXE_PATH to include real compiler/formatter fallback tests.
npm run test:lsp
```

E2E launches a real VSCode instance with a throwaway workspace and exercises hover, diagnostics, formatting, the GraphIR panel and a full debug session lifecycle.

### Runtime compatibility / 运行时兼容性

The supported and tested Camel baseline is **0.2.11** (`camelCompatibility` in package.json). Older, prerelease or unrecognized versions produce a warning and receive capability probes rather than a blanket refusal. A version number alone does not guarantee newer metadata. `camel-ls` and `camel-db` have independent versions and must not be compared to this runtime baseline.

Startup compiles disposable fixtures (never executes user code) to check CLI GIR, JSON diagnostics, PORT names, FILL types and source spans. LSP features use the server's initialize capabilities. Unsupported CLI diagnostics/formatting are not advertised by the fallback server; unavailable CLI GIR reports its probe failure. Missing metadata preserves legacy labels. Use **Camel: Runtime Info and Health Check** to refresh the report, which distinguishes available, unavailable and unknown features with reasons. Debugger endpoints are checked on use; unqueried debugger capabilities remain unknown.

最低已验证支持基线为 **Camel 0.2.11**。低于基线或无法识别版本时会提示，并逐项检测功能；不会仅凭版本号禁用全部功能。启动探测只编译临时样例，不执行用户代码。LSP 按服务器声明启用能力，缺少元数据时保留旧标签。运行“运行时详情与自检”可查看或刷新版本、能力与不可用原因。调试器使用独立版本号，接口在实际使用时检查。

### Language / 界面语言

The extension follows VS Code's display language: Chinese locales use Simplified Chinese, English and other locales use English. Change the editor display language and restart VS Code to apply it. Commands, settings, runtime/debugger messages and the GIR webview (including tooltips and accessible labels) are localized. Source identifiers, type names, raw GIR and diagnostics produced by Camel remain unchanged.

插件跟随 VS Code 的显示语言：中文区域使用简体中文，英语及其他语言回退到英文。切换编辑器显示语言并重启后生效。命令、设置、运行与调试提示、GIR 面板及无障碍标签均支持中英文；源码标识符、类型名、原始 GIR 和 Camel 输出的诊断保持原文。

Translation maintenance: `package.nls*.json` contains manifest strings; `client/src/messages.ts` contains runtime/webview translations, with English source keys and `{0}` placeholders. Run `node scripts/localization-test.mjs` to check coverage and placeholder consistency. GIR UI tests accept `E2E_LOCALE=en` or `zh-cn`; an isolated Chinese test profile also needs `E2E_LANGUAGEPACKS` pointing to an installed VS Code language-pack registry.

### GIR 源码跟随与函数目录

- PORT 优先显示参数或捕获变量名称；FILL 显示待组装的数据类型，底部保留 PORT / FILL 节点种类。悬停或点击节点可查看完整类型、参数类别和索引。完整信息需要支持 DOT 参数与类型元数据的新 Camel 构建；旧输出仍可正常浏览。

- 在 CML 编辑器按 **Ctrl+K Ctrl+G**（macOS：Cmd+K Cmd+G），或点击编辑器右上角图标，复用 GIR 面板显示当前文件。
- 面板右上角默认“跟随”：切换 CML 源码时自动更新。点击变为“已固定”，可保持原图对照其他文件；再次点击恢复跟随。显式打开 GIR 命令始终显示当前文件。
- 每个文件、每种 GIR 格式分别记住层级、返回历史和缩放位置，当前面板最多保留 30 组。关闭面板后清除浏览位置；跟随开关保存在工作区。
- 自动刷新控制保存后的更新；跟随控制文件切换。图内跳转源码不会触发换图。
- 层级模式的“函数目录”始终可见，包含 main 等模块顶层函数，并标出入口和当前所在函数。目录表示保留的函数图，不代表调用顺序。


### Editor and GIR preferences / 编辑器与 GIR 偏好

Search for `opencmlLanguageServer` in VS Code Settings. All new settings have English and Chinese descriptions. They apply to the window/workspace; no editor reload is needed. Diagnostic preference changes restart the language server automatically.

在 VS Code 设置中搜索 `opencmlLanguageServer`。以下配置提供中英文说明，作用于当前窗口/工作区，无需重新加载编辑器。诊断偏好修改后会自动重启语言服务器。

| Setting (prefix: `opencmlLanguageServer.`) | Default | Behavior / 行为 |
| --- | --- | --- |
| `diagnostics.trigger` | `onChange` | Update problems after edits or on save (`onSave`). / 输入后或保存时更新问题列表。 |
| `inlayHints.types` | `true` | Show inferred local types. / 显示推断的局部类型。 |
| `inlayHints.parameterNames` | `true` | Show names before unambiguous positional arguments. / 在明确的位置实参前显示参数名。 |
| `diagnostics.debounceMs` | `300` | Delay diagnostic requests, 0–5000 ms. / 诊断请求等待时间。 |
| `diagnostics.severityOverrides` | `{}` | Diagnostic code → `error`, `warning`, `information`, `hint`, `off`. / 按编号调整诊断级别。 |
| `gir.followActiveEditor` | `true` | Follow the active CML file. / 跟随当前源码。 |
| `gir.refreshOn` | `onSave` | `onSave` or `manual`. / 保存刷新或手动刷新。 |
| `gir.defaultView` | `hierarchy` | `hierarchy` or `flat`. / 层级浏览或平铺。 |
| `gir.edgeLabels` | `onHover` | `onHover`, `always`, `never`. / 按需显示、始终显示、隐藏连线编号。 |
| `gir.hoverNeighborhood` | `both` | `both`, `upstream`, `downstream`, `off`. / 双向、上游、下游或关闭悬停高亮。 |
| `gir.rememberViewport` | `true` | Restore zoom/position within the panel session. / 面板会话内恢复缩放与位置。 |
| `runtime.checkTimeoutMs` | `60000` | CLI diagnostics/GIR timeout, 1000–600000 ms. / CLI 诊断和 GIR 生成超时。 |

Toolbar choices for follow/pin, refresh-on-save and browse mode are remembered per workspace. Explicitly changing the corresponding setting resets that remembered choice. Other GIR settings take effect immediately. Source switching still generates the newly selected graph in manual refresh mode; manual mode disables automatic refresh on save.

工具栏中的跟随/固定、保存刷新和浏览模式会按工作区记忆；主动修改对应设置会覆盖记忆值。其他 GIR 设置即时生效。手动刷新模式仅关闭保存自动刷新，切换源码仍会生成新选中文件的图。

Saved-only diagnostics do not delay source synchronization, hover, completion or navigation. Native servers may still analyze source for these features. Severity overrides affect editor presentation only, never compiler exit status. CLI timeout does not kill running programs or limit native LSP/debugger requests. These settings do not add workspace indexing, entry-point discovery or inlay hints to an older runtime.

保存后诊断不会延迟源码同步、悬停、补全和跳转，原生服务仍可为这些功能分析源码。诊断级别覆盖只影响编辑器展示，不改变编译器退出状态。CLI 超时不限制程序运行、原生 LSP 或调试请求。这些配置不会为旧运行时凭空增加工作区索引、入口识别或类型提示能力。

### Debugger migration

The migration ledger is [docs/debugger-migration.md](docs/debugger-migration.md).
Debug sessions now use native `camel-db --dap`; there is no second HTTP-to-DAP adapter
inside the extension. Use a Camel build with the new DAP graph snapshot requests.
The native adapter launches and owns its worker; attaching to the old HTTP gateway is
not a supported launch mode. It selects its own worker port.

```json
{
    "type": "camel",
    "request": "launch",
    "name": "Debug Camel",
    "program": "${file}",
    "passes": ["std::macro", "std::inline", "std::nvm"],
    "args": { "n": 6 },
    "stopOnEntry": true,
    "stepBy": "line",
    "frames": "functions",
    "cwd": "${workspaceFolder}"
}
```

Passes and main arguments are passed to Camel unchanged. `stepBy: "node"` and
`frames: "subgraphs"` expose the lower-level execution view. VS Code's Variables,
Call Stack, function breakpoints and exception controls use the native adapter.

For compiler debugging, add `"stopOnPassEntry": true` to the launch configuration. The GIR
panel opens automatically with the actual initial graph. **Next pass** advances to macro,
inline and subsequent returned graphs, then hands off at runtime entry. To stop only at
specific results, use `"passBreakpoints": [1, 2]` (0 = initial graph). These work in Release.
The session strip separates the current execution position from the inspected snapshot;
selecting history does not run anything, and **Return to current stop** restores the live view.
Use **Source GIR** to leave session inspection. The selected VS Code session controls the panel.


Use **Camel: Inspect Debug Memory** from the command palette or the memory icon in a paused GIR
session to inspect region usage and paged bytes/objects. The view uses the selected debug
session; refresh explicitly after another stop. Release runtimes support inspection but
allocation breakpoints require a Debug build.

暂停调试时，可运行 **Camel：查看调试内存**，或点击 GIR 调试栏中的内存图标，查看区域用量、
字节和对象分页。面板跟随所选调试会话，下一次暂停后需手动刷新。Release 运行时支持
内存检查；分配断点需要 Debug 构建。
