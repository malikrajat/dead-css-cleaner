# Architecture

This page explains how the extension is put together, which rules the code follows, and where to add new behaviour. It is aimed at contributors; user-facing documentation lives in [CONFIGURATION.md](CONFIGURATION.md) and [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

## Layers

```text
                 +-------------------------------+
                 |        VS Code host           |
                 |  commands, providers, events  |
                 +---------------+---------------+
                                 |
                      extension.ts / state.ts
                                 |
                 +---------------v---------------+
                 |          analysis/            |
                 |  analyzer.ts   usageIndex.ts  |
                 +---+-----------------------+---+
                     |                       |
        +------------v-----------+   +-------v-------------------+
        |       parsers/         |   |        features/          |
        | css  js  markup        |   | diagnostics  codeActions  |
        | angular                |   | hover  statusBar  report  |
        +------------+-----------+   +---------------------------+
                     |
        +------------v-----------+
        |         core/          |
        | config types errors    |
        | logger cache textUtils |
        +------------------------+
```

### `src/core` - infrastructure, no VS Code dependency

| Module | Responsibility |
| --- | --- |
| `config.ts` | The `ExtensionConfig` type, defaults, `normalizeConfig()` (coerce, clamp, validate), dynamic pattern compilation. |
| `types.ts` | Shared data types: `Detection`, `CssRuleInfo`, `UsageResult`, `AnalysisResult`, statistics. |
| `errors.ts` | `ErrorCollector` (a namespaced object: bounded log of 200 entries, subscribable) plus `safeSync`/`safeAsync`. |
| `logger.ts` | Tiny logger with pluggable sinks. In VS Code the sink is an `OutputChannel`; elsewhere it buffers to the console. |
| `cache.ts` | `AnalysisCache<T>`: mtime and size keyed per-file parse results, with hit/miss statistics. |
| `textUtils.ts` | `LineIndex` (offset to line/column and back), `findMatches` (safe global regex iteration), token splitting, dynamic prefix detection, string literal scanning, binary sniffing. |
| `errorReporter.ts` | The only place that turns collected errors into VS Code notifications and documents. |

### `src/parsers` - pure parsing, no VS Code dependency

| Parser | Input | Output |
| --- | --- | --- |
| `cssParser.ts` | CSS/SCSS/LESS/SASS text, or a masked file containing only `<style>` blocks | `CssRuleInfo[]` with every class/id token and its exact position, dynamic patterns, element selectors, ignored rules |
| `jsUsageParser.ts` | JS/TS/JSX/TSX/Vue/Svelte/Astro script text | Usages from JSX attributes, expressions, calls, CSS modules and DOM APIs; a regex text pass always also runs |
| `markupParser.ts` | HTML and template files | Usages from `class`/`className`/`id`, Angular `[class.x]` and `[ngClass]`, Vue `:class`, Svelte `class:x`, Astro `class:list`, plus tag names |
| `angularParser.ts` | Angular component TypeScript | Template usages (string, backtick and concatenated templates), `templateUrl` resolution, `host` bindings, `@HostBinding`, component selectors |

### `src/analysis`

| Module | Responsibility |
| --- | --- |
| `analyzer.ts` | File discovery, per-file parse planning, batching (`maxConcurrentFiles`), cache use, cancellation of stale runs, statistics, result assembly. |
| `usageIndex.ts` | `UsageIndex` (fast token lookup with exact, cross-type, dynamic, safelist and element matching), `computeUnused()` (token versus strict mode) and element comparison. |

### Activation layer and `src/features`

| Module | Responsibility |
| --- | --- |
| `extension.ts` | Activation: registers commands, the code action and hover providers, and the listeners (save, editor change, configuration change, file watcher). |
| `state.ts` | `ExtensionState`: owns the analyzer, diagnostics collection, status bar and last result; runs analyses and discards stale ones. |
| `diagnostics.ts` | Builds `vscode.Diagnostic`s with exact ranges, explanations and related usage locations. |
| `codeActions.ts` | Quick fixes: remove token, remove rule, add ignore comment, remove all in file (choosing safely between rule and token removal). |
| `hoverProvider.ts` | Explains why a selector was flagged, including partial-selector details. |
| `statusBar.ts` | Status bar states (idle, analysing, failed) and tooltips with scan statistics. |
| `reportText.ts`, `report.ts` | Pure Markdown/JSON report builders, plus the VS Code code that writes and opens them. |

---

## Data flow of one analysis

- `extension.ts` triggers `ExtensionState.run(reason)` from a command, a save, an editor change, the file watcher, or activation.
- `CssAnalyzer.discoverFiles()` asks VS Code for files matching the three extension lists, minus `excludePatterns`.
- Files are processed in batches. For each file the analyzer decides what to run based on its extension: CSS parse, style-block parse, JS usage parse, markup parse, Angular parse - or several of them for single-file components.
- Results are cached per file by modification time and size, so unchanged files are not re-parsed.
- All usages go into a `UsageIndex`; dynamic prefixes gathered from CSS, templates and scripts configure the pattern matcher.
- `computeUnused()` compares each selector token against the index. In `token` mode a partially used selector produces findings only for its dead tokens; in `strict` mode the selector is skipped unless everything is dead.
- `ExtensionState` converts findings into diagnostics, updates the status bar and shows a notification; `features/report.ts` can export the same data.

---

## Invariants

- **`core/`, `parsers/` and `analysis/` must not import `vscode`.** This is what lets `src/test/unit` run in plain Node (48 tests, well under a second).
- **Parsers never throw.** Every rule, selector, JSX attribute and binding is processed inside a try/catch; failures are recorded with `ErrorCollector` and the run continues with whatever was parsed.
- **Prefer false negatives over false positives.** When a class name cannot be resolved statically, register a dynamic prefix and stop reporting that family instead of guessing.
- **Every detection carries a real position.** Diagnostics must underline the exact token, not the start of the rule. `LineIndex`, PostCSS `source.start.offset` and Babel `loc` provide the mapping; masked-file tricks keep positions valid for `<style>` blocks and inline templates.
- **Findings are explainable.** A diagnostic states the token, the selector, whether the selector is partially or fully dead, how many files were scanned, and where the token is still used when applicable.
- **Runs are isolated.** Analyses are numbered; a run that finishes after a newer one started is discarded instead of overwriting fresher diagnostics.

---

## Extension points

| I want to... | Touch |
| --- | --- |
| Support a new stylesheet syntax | `parserCandidates()` and `syntaxForFile()` in `cssParser.ts` |
| Support a new template language | `DEFAULT_MARKUP_EXTENSIONS` in `core/config.ts`, `handleAttribute()` in `markupParser.ts`, `markupFileTypes` in `package.json` |
| Support a new script flavour or binding API | `collectClassTokensFromNode()` and the `CallExpression` visitor in `jsUsageParser.ts` |
| Support new component metadata | `angularParser.ts` is the reference implementation: it shows how to mask a template region so positions stay correct |
| Add a setting | `ExtensionConfig`, `DEFAULT_CONFIG` and `normalizeConfig()` in `core/config.ts`, then `package.json` (`scope`, `order`, description) and `doc/CONFIGURATION.md` |
| Add a command | Register it in `extension.ts`, add it to `contributes.commands`/`menus` in `package.json`, add an `onCommand` activation event, document it in the README |
| Improve diagnostics or hover text | `features/diagnostics.ts` and `features/hoverProvider.ts` |

Any new parser needs at least one fixture in `test-files/` and one unit test. New end-to-end behaviour needs a case in `src/test/unit/spaScenario.test.ts`. Run `npm run check:write` before committing: Biome owns formatting, linting and import order.

---

## Performance model

- **Cache**: `AnalysisCache` stores parse results per file, keyed by modification time and size, with a configurable TTL. Editing a file invalidates only that file.
- **Batching**: files are processed `maxConcurrentFiles` (default 12) at a time, yielding to the event loop so the UI stays responsive.
- **Size guards**: `maxCssFileSizeKb` and `maxSourceFileSizeKb` skip oversized files; empty and binary files are ignored.
- **Cancellation**: a newer run supersedes an older one, and the stale result is dropped before it can touch diagnostics.
- **Debouncing**: saves wait `debounceDelay` ms; watcher events wait `watcherThrottleDelay` ms.
- **Regex iteration**: `findMatches()` creates a fresh regex per call, so shared `lastIndex` state cannot leak between files, and zero-length matches cannot spin forever.
- **Measurement**: *Show Performance Statistics* reports discovery, parsing and comparison timings plus cache hits and misses; `debugLogging` writes per-file decisions to the output channel.

---

## Testing strategy

| Layer | Location | Runs in |
| --- | --- | --- |
| Infrastructure unit tests (config, cache, text utils, errors) | `src/test/unit/{config,cache,textUtils,errors}.test.ts` | Plain Node (`npm run test:unit:infra`) |
| Parser unit tests (CSS, JS/JSX, markup, Angular) | `src/test/unit/{cssParser,jsUsageParser,markupAndAngular}.test.ts` | Plain Node (`npm run test:unit:css`, `:js`, `:markup`) |
| Comparison and end-to-end unit tests | `src/test/unit/{usageIndex,spaScenario}.test.ts` | Plain Node (`npm run test:unit:analysis`, `:scenarios`) |
| Report builders | `src/test/unit/reportText.test.ts` | Plain Node (`npm run test:unit:reports`) |
| Coverage | c8 over `src/core`, `src/parsers`, `src/analysis`, `src/features` | Plain Node (`npm run test:coverage`) |
| VS Code integration tests (activation, commands, diagnostics on `test-files/`) | `src/test/suite/extension.test.ts` | Downloaded VS Code (`npm run test:vscode`) |
| CLI smoke run using the production pipeline | `npm run analyze -- test-files/spa` | Plain Node |
| Manifest and Marketplace pre-flight | `scripts/verify-manifest.js` | Plain Node (`npm run verify:manifest`) |

CI (`.github/workflows/ci.yml`) runs one job per step: manifest, lint, format, type check, a seven-way unit-test matrix, coverage, integration tests on Ubuntu and Windows, the `dist/` build, VSIX packaging, and a summary job. `.github/workflows/codeql.yml` adds static security analysis.

---

## Build outputs

| Output | Produced by | Purpose |
| --- | --- | --- |
| `dist/extension.js` | `npm run build` (webpack, production) | The shipped bundle; `package.json:main` points at it and it is the only code inside the VSIX |
| `out/**` | `npm run compile` (tsc) | Compiled tests (`out/test/**`) and the shared pipeline for the CLI |
| `out-cli/**` | `npm run build:cli` | Same pipeline, compiled separately so `npm run analyze` never interferes with the packaged bundle |
| `coverage/` | `npm run test:coverage` (c8) | HTML and LCOV coverage reports |
