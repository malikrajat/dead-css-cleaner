# Contributing to Dead CSS Cleaner

Thanks for taking the time to improve the extension. Bug reports, false-positive reports, new framework support and documentation fixes are all welcome.

This guide covers how to get the project running, how the code is organised, how to add support for a new framework or file type, and what a pull request should look like.

---

## Quick links

- [Reporting a bug](#reporting-a-bug)
- [Development setup](#development-setup)
- [Project layout](#project-layout)
- [The rules of the codebase](#the-rules-of-the-codebase)
- [Adding support for a new framework](#adding-support-for-a-new-framework)
- [Testing](#testing)
- [Manifest and Marketplace checks](#manifest-and-marketplace-checks)
- [Pull request checklist](#pull-request-checklist)
- [Release process](#release-process)

---

## Reporting a bug

False positives are treated as bugs - please include:

1. The CSS rule (exact selector and file extension).
2. The markup or component snippet that uses the class.
3. The framework and its major version.
4. Whether `unusedCssDetector.analysisMode` is `token` or `strict`.
5. The output of `npm run analyze -- <folder> --json` if you can run the CLI on a minimal reproduction.

Turning on `unusedCssDetector.debugLogging` prints the parse decisions ("Parsed `x.scss` with the scss syntax parser", unresolved bindings, dynamic prefixes, cache hits) to the **Dead CSS Cleaner** output channel, which is usually enough to pinpoint the cause.

Use the issue forms in `.github/ISSUE_TEMPLATE/` so the right information is captured.

---

## Development setup

**Prerequisites**

- VS Code **1.90.0** or newer
- Node.js **18+** and npm 9+
- Git

```bash
git clone https://github.com/malikrajat/dead-css-cleaner.git
cd dead-css-cleaner
npm install
```

**Run the extension**

Open the folder in VS Code and press `F5`. This launches an Extension Development Host with the extension loaded; the `Run Extension` launch configuration runs `npm: build:dev` first, so the webpack bundle in `dist/` is always current. Use `Run Extension (watch)` for continuous rebuilds.

**Where things are written**

| Folder | Contents | Shipped? |
| --- | --- | --- |
| `dist/` | The production webpack bundle (`dist/extension.js`) that `package.json:main` points at | Yes, inside the VSIX |
| `out/` | `tsc` output: compiled tests (`out/test/**`) and the CLI pipeline (`out-cli/` is the same idea) | No |
| `coverage/` | c8 HTML/LCOV coverage reports | No |

**Useful scripts**

| Script | What it does |
| --- | --- |
| `npm run check` | Biome: lint + format + import checks (read-only) |
| `npm run check:write` | Biome: apply safe lint fixes, formatting and import organisation |
| `npm run check:ci` | Same as `check`, with CI-friendly output |
| `npm run lint` / `npm run lint:fix` | Biome lint only |
| `npm run format` / `npm run format:check` | Biome formatter |
| `npm run typecheck` | `tsc --noEmit` with strict mode |
| `npm run compile` / `npm run compile:watch` | Emit JavaScript to `out/` (tests, CLI) |
| `npm run build` | Clean production bundle into `dist/extension.js` |
| `npm run build:dev` | Unminified bundle for debugging |
| `npm run watch` | Webpack watch mode |
| `npm test` | Compile and run all 97 unit tests |
| `npm run test:unit:<module>` | One module only: `infra`, `css`, `js`, `markup`, `analysis`, `scenarios`, `reports` |
| `npm run test:coverage` | Unit tests with a c8 coverage report in `coverage/` |
| `npm run test:vscode` | Integration tests in a downloaded VS Code instance |
| `npm run verify` | Manifest + Biome + type check + unit tests (run this before pushing) |
| `npm run verify:manifest` | Marketplace and manifest pre-flight checks |
| `npm run analyze -- <folder>` | Standalone CLI using the real pipeline |
| `npm run package` | Build a `.vsix` |
| `npm run optimize:icon` | Re-generate `icon.png` from `images/icon-source.png` |

---

## Project layout

```text
src/
  extension.ts              activation: commands, providers, listeners
  state.ts                  ExtensionState - one analysis session
  core/
    config.ts               typed settings, defaults, normalisation, validation
    types.ts                shared data types (no runtime code)
    errors.ts               ErrorCollector + safeSync/safeAsync
    logger.ts               dependency-free logger with pluggable sinks
    cache.ts                mtime-based parse cache with statistics
    textUtils.ts            LineIndex, token splitting, dynamic prefix detection
    errorReporter.ts        output channel + VS Code notifications
  parsers/
    cssParser.ts            PostCSS (+ scss/less) -> selector tokens with positions
    jsUsageParser.ts        Babel AST + text fallback -> class/id usages
    markupParser.ts         HTML/Vue/Svelte/Astro/Angular templates -> usages
    angularParser.ts        @Component/@Directive, templates, host bindings
  analysis/
    analyzer.ts             discovery, batching, caching, cancellation
    usageIndex.ts           usage lookup + dead-selector comparison + reports
  features/
    diagnostics.ts          Problems panel entries, related information
    codeActions.ts          quick fixes
    hoverProvider.ts        "why was this flagged" hover
    statusBar.ts            status bar controller
    reportText.ts           pure Markdown/JSON report builders
    report.ts               writes and opens reports
scripts/
  analyze-folder.js         standalone CLI
  verify-manifest.js         Marketplace pre-flight checks
  optimize-icon.js          icon resizer (no image dependencies)
test-files/                 fixtures used by the CLI and the integration tests
media/                      walkthrough content shown in the VS Code welcome page
doc/                        user and developer documentation
```

---

## Code style

Formatting and linting are handled by [Biome](https://biomejs.dev) through `biome.json`:

- 4-space indentation, single quotes, semicolons, 120-column lines, LF endings.
- Imports are sorted and unused imports are removed by `npm run check:write`.
- The recommended rule set applies, with a few deliberate exceptions documented in `biome.json`:
  - `noExplicitAny` is off because Babel and PostCSS AST nodes are typed as `any` in several visitors.
  - `useIterableCallbackReturn` is off: `xs.forEach(x => target.push(x))` is used intentionally throughout the parsers.
  - `noTemplateCurlyInString` is off because tests build fixture strings that *contain* `${...}` on purpose.
  - `noNonNullAssertion` and `noCommonJs` are off for the same practical reasons.
- Install the Biome VS Code extension (`biomejs.biome`); it is already recommended in `.vscode/extensions.json`, and the workspace settings format on save.

## The rules of the codebase

1. **`core/`, `parsers/` and `analysis/` must not import `vscode`.** That boundary is what allows fast, dependency-free unit tests. VS Code APIs belong in `extension.ts`, `state.ts` and `features/`.
2. **Never throw out of a parser.** Parse failures are recorded through `ErrorCollector` and the function returns whatever it managed to extract. A single broken file must not break the run.
3. **Prefer false negatives over false positives.** If a class name cannot be resolved statically, register a dynamic prefix and stop reporting that family rather than guessing.
4. **TypeScript strict mode is on.** No `any` unless interfacing with a third-party AST, and prefer narrowing helpers such as `isStringLiteral(node)`.
5. **Positions matter.** New detections must carry a real 1-based line and column so diagnostics underline the exact token.
6. **No new runtime dependency without discussion.** The extension is webpack-bundled, so every dependency ships to users.

---

## Adding support for a new framework

Most new frameworks need only two things.

**1. Template markup** (for example Pug, Liquid, Blade):

Add the extension to `DEFAULT_MARKUP_EXTENSIONS` in `src/core/config.ts` and to `markupFileTypes` in `package.json`. If the syntax is close to HTML, `parseMarkupText` in `src/parsers/markupParser.ts` already handles it. If not, add the binding syntax to `handleAttribute` and test it in `src/test/unit/markupAndAngular.test.ts`.

**2. Script/component files**:

Add the extension to `DEFAULT_COMPONENT_EXTENSIONS`. If the file is a single-file component containing both markup and script (like `.vue`), it is already handled by the analyzer, which runs the markup parser and the style-block parser on the same file.

**3. Framework-specific bindings** (for example Angular's `[ngClass]`):

Extend `handleAttribute` (markup) or `collectClassTokensFromNode` (scripts) and add a case to `src/test/unit/markupAndAngular.test.ts` or `src/test/unit/jsUsageParser.test.ts`. Then add a row to the "What gets scanned" table in `README.md` and to `doc/ENHANCEMENT-NOTES.md`.

Every new framework needs at least one fixture in `test-files/` and one end-to-end case in `src/test/unit/spaScenario.test.ts`.

---

## Testing

**Unit tests** (`src/test/unit/`) run in plain Node and are the fastest feedback loop:

```bash
npm test
```

`src/test/unit/helpers.ts` exposes `analyzeFixture()`, which runs the real parsers, the real usage index and the real comparison logic on in-memory files, so a test can assert on the exact set of dead selectors.

The 97 tests are split into modules so CI can report on each one separately, and so you can focus on the part you are changing:

| Script | Test file(s) | Covers |
| --- | --- | --- |
| `npm run test:unit:infra` | `config`, `cache`, `textUtils`, `errors` | Settings normalisation, parse cache, text/position helpers, error collector |
| `npm run test:unit:css` | `cssParser` | Selector tokens, positions, SCSS nesting, at-rules, ignore comments, dynamic patterns |
| `npm run test:unit:js` | `jsUsageParser` | JSX, expressions, CSS modules, DOM APIs, dynamic class prefixes |
| `npm run test:unit:markup` | `markupAndAngular` | HTML/Vue/Svelte/Astro bindings, Angular templates and host bindings |
| `npm run test:unit:analysis` | `usageIndex` | Token vs strict reporting, cross-type matching, safelist, element analysis |
| `npm run test:unit:scenarios` | `spaScenario` | End-to-end SPA, Angular, React CSS modules, Vue SFC and broken files |
| `npm run test:unit:reports` | `reportText` | Markdown and JSON report output |

```bash
npm run test:unit:css        # one module
npm run test:coverage        # everything, with a coverage report in coverage/
```

**Integration tests** (`src/test/suite/`) run inside a real VS Code instance, open `test-files/` as the workspace and assert that the extension activates, registers every contributed command, and produces the expected diagnostics:

```bash
npm run test:vscode
```

**CLI smoke test**:

```bash
npm run analyze -- test-files/spa
```

When you fix a false positive, add a regression test that fails before your change.

---

## Manifest and Marketplace checks

`package.json` is the extension manifest (the VS Code equivalent of Chrome's `manifest.json`), and `package.nls.json` holds the user-visible strings.

Before pushing changes that touch either file:

```bash
npm run verify:manifest   # name/version rules, keyword limits, icon, capabilities, l10n keys, walkthrough media
npm run package           # produces dead-css-cleaner-<version>.vsix
```

Install the produced VSIX (`code --install-extension dead-css-cleaner-<version>.vsix`) and click through the extension once before releasing. [doc/MANIFEST.md](doc/MANIFEST.md) documents every manifest field and the Marketplace rules that matter.

Continuous integration (`.github/workflows/ci.yml`) runs one job per step, so a failure points at exactly one concern:

| Job | Command |
| --- | --- |
| Manifest and Marketplace rules | `npm run verify:manifest` |
| Lint | `npm run lint` |
| Format check | `npm run format:check` |
| Type check | `npm run typecheck` |
| Unit tests (7-way matrix, one job per module) | `npm run test:unit:<module>` |
| Coverage | `npm run test:coverage` |
| Integration tests (Ubuntu + Windows matrix) | `npm run test:vscode` |
| Build | `npm run build` (uploads the `dist/` artifact) |
| Package | `npm run package` (uploads the VSIX artifact) |
| CodeQL (separate workflow) | `javascript-typescript` and `actions` analysis |

---

## Pull request checklist

- [ ] `npm run verify` passes (manifest, Biome, type check, unit tests).
- [ ] `npm run test:vscode` passes if you touched activation, commands, providers or diagnostics.
- [ ] `npm run check:write` was run, so formatting matches `biome.json`.
- [ ] New behaviour has a unit test, and bug fixes have a regression test.
- [ ] `README.md`, `CHANGELOG.md` and the relevant file in `doc/` are updated.
- [ ] New settings are added to `src/core/config.ts`, `package.json` and `doc/CONFIGURATION.md`.
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `fix(parser): ...`, `feat(markup): ...`, `docs: ...`.
- [ ] No `vscode` import leaked into `core/`, `parsers/` or `analysis/`.

---

## Release process

1. Update `CHANGELOG.md` and bump `version` in `package.json` (semver).
2. Run `npm run verify && npm run test:vscode && npm run build`.
3. Package and inspect: `npm run package && npx vsce ls` (expect `dist/extension.js` inside the VSIX).
4. Publish with `npm run publish` (requires a Personal Access Token, see [doc/PUBLISHING.md](doc/PUBLISHING.md)) or let the `release` workflow publish from a `v*` tag.
5. Tag the release: `git tag v1.3.0 && git push --tags`.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to uphold it.
