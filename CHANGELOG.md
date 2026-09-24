# Changelog

All notable changes to **Dead CSS Cleaner** are documented here.
The project follows [Semantic Versioning](https://semver.org/) and the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [1.3.0] - 2026-09-22

Developer-experience release: Biome for linting and formatting, a `dist/` build
output, a much deeper unit-test suite, and one CI job per step and module.

### Added

- **Biome** (`@biomejs/biome`, pinned) replaces ESLint for linting, formatting and import
  organisation. Configuration lives in `biome.json` (4-space indent, single quotes, 120
  columns, LF). New scripts: `check`, `check:write`, `check:ci`, `lint`, `lint:fix`,
  `format`, `format:check`.
- **`dist/` build output.** `npm run build` now emits the shipped bundle to
  `dist/extension.js` and `package.json:main` points there; `out/` is reserved for the
  TypeScript output used by the tests and the standalone CLI. `npm run watch` watches the
  webpack bundle, and `npm run compile:watch` watches the test output.
- **49 new unit tests** (97 in total) covering the previously untested infrastructure:
  settings normalisation and validation, dynamic-pattern compilation, the parse cache
  (TTL, mtime invalidation, disabled mode, statistics), text utilities (`LineIndex`,
  token splitting, dynamic prefix detection, string literal scanning, `findMatches`),
  and the error collector with the safe-execution helpers.
- **Per-module test scripts**: `test:unit:infra`, `:css`, `:js`, `:markup`, `:analysis`,
  `:scenarios`, `:reports`.
- **Coverage reporting** with c8: `npm run test:coverage` writes text, LCOV and
  `json-summary` reports to `coverage/`.
- **`npm run typecheck`** as a standalone step, plus a `verify` script that chains
  manifest checks, Biome, the type check and the unit tests.
- **Expanded GitHub Actions.** `ci.yml` now runs one job per step - manifest, lint,
  format check, type check, a seven-way unit-test matrix, coverage, integration tests on
  Ubuntu and Windows, the `dist/` build, VSIX packaging - and finishes with a summary job
  that reports each step's result. New `codeql.yml` adds CodeQL analysis for
  `javascript-typescript` and the workflow definitions themselves.
- **VS Code workspace tooling**: labelled build/test tasks, a watch-mode launch
  configuration, a unit-test launch configuration, Biome as the default formatter with
  format-on-save, and `biomejs.biome` as a recommended extension.

### Changed

- `ErrorCollector` is a namespaced object instead of a class with only static members
  (same call sites, but it satisfies the linter and reads as a module-level singleton).
- Global regex iteration uses a new `findMatches()` helper, which removes the
  `while ((match = re.exec(text)))` pattern, resets `lastIndex` per call and cannot loop
  forever on zero-length matches.
- `prefixOf()` now also recognises bare prefixes such as `item-` in
  `dynamicClassPatterns`, so those entries are reported as prefix patterns in debug logs.
- `.vscodeignore` excludes `out/**` (compiled tests) and `biome.json`; `npm run
  verify:manifest` now fails if the `main` bundle would be excluded from the VSIX.
- Documentation updated throughout for Biome, `dist/`, the new scripts and the CI layout.
- Removed the ESLint configuration and dependencies.

## [1.2.0] - 2026-09-22

Manifest, packaging and documentation overhaul to meet current VS Code extension
standards and the VS Code Marketplace requirements.

### Added

- **Capabilities declaration** (`capabilities.untrustedWorkspaces`,
  `capabilities.virtualWorkspaces`) so VS Code shows accurate trust and virtual
  workspace behaviour instead of "unknown".
- **Localisation support**: manifest strings moved to `package.nls.json`
  (`%displayName%`, command titles, walkthrough copy). Translations can be added as
  `package.nls.<locale>.json` without touching `package.json`.
- **Walkthrough** ("Get started with Dead CSS Cleaner") with four steps: run an
  analysis, review findings, fix them, and tune the extension. Media lives in `media/`.
- **Settings quality**: every setting now declares `scope` (resource vs window),
  `order` for the Settings UI, and `markdownDescription` plus `tags`
  (`performance`, `debug`, `experimental`) where useful.
- **Keybinding**: `Ctrl+Alt+D` (`Cmd+Alt+D`) runs a workspace analysis.
- **Explorer context menu** entry to analyse from any folder.
- **`workspaceContains` activation** so the status bar and first analysis appear as soon
  as a style-bearing workspace is opened.
- **`npm run verify:manifest`** - a pre-flight script that validates every Marketplace
  and `vsce` requirement (name rules, keyword limits, categories, icon format/size,
  engine, localisation keys, walkthrough media, menu/command consistency, `.vscodeignore`).
- **`npm run optimize:icon`** - dependency-free icon resizer; the 1024x1024 source art is
  kept in `images/` and the shipped `icon.png` is 256x256 (1185 KB -> 56 KB).
- Community and developer documents: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, `SUPPORT.md`, `doc/ARCHITECTURE.md`, `doc/MANIFEST.md`,
  `doc/README.md`, refreshed `doc/CONFIGURATION.md`, `doc/TROUBLESHOOTING.md` and
  `doc/PUBLISHING.md`.
- Repository tooling: `.editorconfig`, `.gitattributes`, `.nvmrc`, recommended VS Code
  extensions/settings, GitHub issue forms, PR template, funding config and CI
  (`build`, `lint`, unit tests, integration tests, VSIX packaging).

### Changed

- **`engines.vscode` raised to `^1.90.0`** and `engines.node` to `>=18.0.0`.
- README rewritten for developers and for Marketplace search (framework matrix, settings
  reference, FAQ, architecture and contribution pointers).
- Keywords expanded to the full Marketplace allowance (30) and grouped around the terms
  people actually search for ("unused css", "dead css", "remove unused css",
  "unused css remover", "css cleanup", framework names, "bundle size", ...).
- `CHANGELOG.md` moved to the repository root, where the Marketplace reads it.
- `LICENSE` copyright now names the author and covers 2024-2026.
- `.vscodeignore` now excludes `node_modules/**` (dependencies are bundled by webpack),
  `src/**`, `scripts/**`, `test-files/**`, `out/test/**`, `doc/**` and CI files, so the
  VSIX contains only what it needs.
- `showStatusBar`, `showNotifications` and the watcher/caching settings are documented as
  window-scoped, while analysis/content settings are resource-scoped.

## [1.1.0] - 2026-09-22

Rebuilt detection engine. Fixes the reported false positives and false negatives, adds
real edge-case handling, and makes every failure path recoverable.

### Fixed

- Nested / nth-level child selectors. Conditional (`cond && 'x'`), ternary and nested
  template-literal classes were silently dropped, so child classes were reported dead.
- Angular inline templates. Backtick (`template: \`...\``) templates were ignored, which
  made whole components contribute zero usages.
- Plain SPA projects. `.html` files were never scanned, so `index.html` + `styles.css`
  projects reported every class as unused.
- `.js` files were skipped entirely; `[ngClass]` object/array/ternary values were
  shredded into invalid tokens.
- SCSS/LESS syntax (`#{$size}`, `//` comments, nesting) now uses `postcss-scss` /
  `postcss-less` with fallback chaining instead of a degraded scan.
- Diagnostics use exact token ranges; nested `&` expansion no longer duplicates the
  parent token.
- `showPerformanceStats` and `clearCache` are actually registered now (they previously
  failed with "command not found"), and six declared-but-ignored settings are implemented.

### Added

- `analysisMode` (`token` / `strict`), quick fixes (remove token, remove rule, ignore,
  remove all in file), hover explanations, related usage locations.
- Ignore comments, `ignoreSelectors`, `safelist`, `dynamicClassPatterns` and automatic
  dynamic-class detection.
- `<style>` block analysis inside HTML/Vue/Svelte/Astro files, Vue/Svelte/Astro bindings,
  DOM API detection, Angular host bindings, optional element-selector analysis.
- Report export (Markdown/JSON), performance and cache statistics, output channel,
  standalone CLI (`npm run analyze -- <folder>`), and 48 unit tests.

## [0.0.1] - 2024-10-31

### Added

- Initial release: React (`.jsx`/`.tsx`) and Angular (`.ts`) analysis, PostCSS selector
  parsing, Babel JSX parsing, Problems panel diagnostics, status bar count, hover tooltips
  and auto-analysis on save/open.

[1.2.0]: https://github.com/malikrajat/dead-css-cleaner/compare/v1.1.0...v1.2.0
[1.3.0]: https://github.com/malikrajat/dead-css-cleaner/compare/v1.2.0...v1.3.0
[1.1.0]: https://github.com/malikrajat/dead-css-cleaner/compare/v0.0.1...v1.1.0
[0.0.1]: https://github.com/malikrajat/dead-css-cleaner/releases/tag/v0.0.1
