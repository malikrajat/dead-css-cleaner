# Troubleshooting

Everything here is written as symptom, cause, fix. If you cannot solve it, jump to [Collecting diagnostics](#collecting-diagnostics) and open an issue with that output.

---

## The extension does not seem to do anything

- **Is it installed and enabled?** Extensions view (`Ctrl/Cmd + Shift + X`), search "Dead CSS Cleaner", and check the button says *Disable* rather than *Install*.
- **Is VS Code new enough?** The extension requires 1.90.0 or newer (`Help > About`).
- **Is a folder open?** Files opened without a folder are not analysed. Use *File > Open Folder*.
- **Is the status bar item missing?** `unusedCssDetector.showStatusBar` may be off, or the window is too narrow to show every item. Use the Command Palette instead.
- **Was the window opened somewhere else?** Activation happens for workspaces that contain CSS/SCSS/SASS/LESS files, or when such a file is opened.

---

## A class I use is reported as dead (false positive)

Turn on `unusedCssDetector.debugLogging`, run *Show Output Log*, and look for the file and token. The log reports which parser handled each file, which dynamic prefixes were detected, and which bindings could not be resolved.

| Reason | Fix |
| --- | --- |
| The class is built at runtime (`` `item-${size}` ``) | Add the prefix: `unusedCssDetector.dynamicClassPatterns: ["item-"]` |
| The class only exists in a file type that is not scanned | Add the extension to `componentFileTypes` or `markupFileTypes` |
| The class is applied by a third-party script at runtime | `unusedCssDetector.safelist: ["^their-"]` |
| The class is intentionally kept for external consumers | `unusedCssDetector.safelist` or `ignoreSelectors` |
| One specific rule is fine to keep | Add `/* dead-css-ignore */` above it |
| The value comes from a variable resolved elsewhere (`className={themeClass}`) | Give the variable a class-ish name (`buttonClass`) so it is tracked, or safelist the affected classes |

If none of these apply, it is a bug. Please report it with the CSS rule, the component snippet and the debug log.

---

## Every class in my project is reported as dead

No usages were found at all. The usual causes:

- **Templates use an extension that is not scanned.** Add it to `unusedCssDetector.markupFileTypes`.
- **`excludePatterns` excludes your source folder.** Narrow the patterns, for example `"**/build/**"` to `"**/dist/build/**"`.
- **Classes are applied by a framework the extension does not understand.** Check the debug log and report the framework so support can be added.
- **`minFilesForAnalysis` is higher than your project has.** Set it back to `1`.

---

## Results look noisy in a large codebase

- Switch to `"unusedCssDetector.analysisMode": "strict"` so only fully dead selectors are reported.
- Exclude generated folders such as `storybook-static`, `generated`, `__snapshots__` and vendored CSS.
- Safelist runtime families: `"unusedCssDetector.dynamicClassPatterns": ["is-", "has-", "js-"]`.
- Use *Analyze Current File Only* while working through one stylesheet at a time.

---

## Analysis feels slow

| Observation | Action |
| --- | --- |
| Analysis runs on every keystroke | It should only run on save, open and change. Raise `unusedCssDetector.debounceDelay` to 1000-2000 ms, or turn `autoAnalyze` off. |
| Large CSS bundles are parsed every time | Exclude generated bundles, or lower `maxCssFileSizeKb`. Caching is on by default and invalidates per changed file. |
| Many files are scanned | Raise `maxConcurrentFiles` (up to 64 on strong machines) and review `largeProjectThreshold`. |
| Repeated runs redo the same work | Run *Show Performance Statistics*; low cache hits usually mean a build step or watcher keeps rewriting files. |

---

## Problems panel behaves unexpectedly

| Symptom | Explanation |
| --- | --- |
| The squiggle is under the wrong text | Positions come from the parser; please report the file, line and debug log entry. |
| A finding disappears while typing | Diagnostics are recomputed on save; unsaved edits are not analysed. |
| "partially dead" instead of "fully dead" | Some tokens in that selector are still used; the message names the dead token. |
| Element selectors are reported | `unusedCssDetector.analyzeElements` is enabled; set it to `false`. |
| No related-usage links | The token genuinely has no usage, or `maxUsageLocations` is very low. |

---

## Quick fixes are missing

- The lightbulb (`Ctrl/Cmd + .`) only appears on `.css`, `.scss`, `.sass` and `.less` files, at the exact position of a reported token.
- Open the Problems panel, place the cursor on the squiggled text, then press `Ctrl/Cmd + .`.
- The quick fix list is rebuilt after each analysis; if you just edited the file, save it and wait for the re-run.

---

## Commands fail or do nothing

| Symptom | Fix |
| --- | --- |
| "command not found" | The extension is disabled or failed to activate; check the Developer Tools console and the output channel. |
| *Remove All Dead Selectors* does nothing | It needs existing findings for that file: run an analysis first, then confirm the modal dialog. |
| *Export Dead CSS Report* says "Run an analysis first" | Run *Analyze Workspace for Dead CSS* first. |
| *Show Performance Statistics* is empty | No analysis has run yet in this window. |

---

## Collecting diagnostics

```jsonc
// settings.json (temporarily)
{
  "unusedCssDetector.debugLogging": true
}
```

- Run *Analyze Workspace for Dead CSS*.
- Run *Dead CSS Cleaner: Show Output Log* and copy the relevant lines.
- Run *Show Analysis Diagnostics Log* for recovered errors such as parse failures or missing template files.
- Optionally export a machine-readable result with *Export Dead CSS Report* and choose JSON.

Reproduce the detection part without VS Code whenever possible. This isolates the analyzer from the editor and gives maintainers an exact case:

```bash
npm run analyze -- path/to/minimal-project --json
npm run analyze -- path/to/minimal-project --strict
```

Then open an issue with the [bug report form](https://github.com/malikrajat/dead-css-cleaner/issues/new/choose) and attach the CSS rule, the component snippet, the framework and version, the analysis mode, and the log or JSON output.

---

## Reporting a false negative (dead CSS that is not reported)

The most common explanations:

- The rule is covered by an ignore comment, `ignoreSelectors`, `safelist` or a dynamic pattern.
- `analysisMode` is `strict` and part of the selector is still used.
- The selector is a CSS custom property, or an at-rule the extension deliberately skips (`@keyframes`, `@font-face`, `@page`, `@property`).
- The token matched cross-type (a class with the same name as an id). This is intentional, to avoid false positives.

If none apply, report it with the same information as a false positive.
