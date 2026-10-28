# Dead CSS Cleaner 1.1.0 - enhancement notes

This note answers the questions that started this work ("does it scan nested child
classes?", "does it really work for Angular and React?", "what about a plain SPA with
`index.html` and CSS and nothing else?") and records what was wrong, what changed, and how
each claim is verified.

> **Version note.** These notes describe the 1.1.0 detection engine, which is still the
> engine in 1.2.0. Release 1.2.0 added the manifest, packaging, documentation and
> Marketplace work - see [../CHANGELOG.md](../CHANGELOG.md), [MANIFEST.md](MANIFEST.md)
> and [ARCHITECTURE.md](ARCHITECTURE.md) for that part.

---

## 1. What was checked first

The previous implementation (`src/extension.ts`, 1293 lines) was read line by line and the
reported symptoms were traced through it.

### Finding 1 - nested / nth-level child classes (React)

`extractClassesFromExpression` handled string literals, template-literal *quasis*, member
expressions (`styles.x`), calls, arrays and objects. It did **not** handle:

```jsx
className={isOpen && 'card--open'}                 // LogicalExpression -> dropped
className={`item ${size === 'lg' ? 'item--lg' : ''}`} // string inside ${} -> dropped
className={clsx('card', isOpen && 'card--open')}  // nested logical in a call -> dropped
```

Every class that appeared only in those positions looked unused - exactly the reported
"direct classes work, child classes do not" behaviour.

### Finding 2 - "sometimes it does not work in Angular"

`parseComponentDecorator` read `template` with `t.isStringLiteral(property.value)` only.
Angular projects overwhelmingly write inline templates with backticks, for example:

```ts
@Component({ template: `<div class="card"><p class="card__text">x</p></div>` })
```

A `TemplateLiteral` failed that check, so the decorator produced no template at all, the
component contributed **zero** usages, and every class in that component's stylesheet was
reported dead. The repository's own fixture `test-files/inline.component.ts` proves it.

`[ngClass]` was also mishandled: a regex turned `{'active': isActive}` into the nonsense
tokens `{'active':` and `isActive}`.

### Finding 3 - plain SPA (`index.html` + `styles.css`)

`componentFileTypes` defaulted to `['.jsx','.tsx','.ts','.js']`, and the analyzer then split
files into `reactFiles = .jsx/.tsx` and `angularFiles = .ts`. Consequences:

* `.html` files were never read, so a framework-free SPA reported **every** class as unused.
* `.js` files were collected and then dropped by both filters, so plain JS projects were
  invisible.
* `<style>` blocks inside an HTML file were never analysed either.

### Finding 4 - React support in general

React worked only for the simplest cases. Missing: `.js`/`.mjs`/`.cjs`/`.mts`/`.cts` files,
`React.createElement` props, `classList` / `querySelector` / `setAttribute`, jQuery
selectors, variables holding class strings, and `styles['child-item']` computed access.

### Finding 5 - declared but dead code paths

* `unusedCssDetector.showPerformanceStats` and `unusedCssDetector.clearCache` existed in
  `package.json` but were never registered in `activate()`, so invoking them failed with
  "command not found".
* `enableCaching`, `cacheTimeout`, `maxConcurrentFiles`, `largeProjectThreshold`,
  `enableFileWatcher` and `watcherThrottleDelay` were declared in settings and never read.
* Older documents (now in `doc/archive/`, for example `ADVANCED-FEATURES-STATUS.md`)
  claimed caching, batching and performance statistics that did not exist in the code.
  Those documents are historical; the notes here describe what is actually implemented.

---

## 2. What the extension does now

### 2.1 Architecture

The single 1293-line file was split so that the parsing logic is testable without VS Code:

```text
src/
  extension.ts              activation, commands, providers, listeners
  state.ts                  config + analyzer + diagnostics + status bar for one session
  core/
    config.ts               typed settings, defaults, normalisation and validation
    types.ts                shared data types
    errors.ts               error collection + safeSync / safeAsync helpers
    logger.ts               dependency-free logger (output channel attached in VS Code)
    cache.ts                mtime-based parse cache with hit/miss statistics
    textUtils.ts            line index, token splitting, dynamic-prefix detection
    errorReporter.ts        output channel + user-facing notices
  parsers/
    cssParser.ts            PostCSS (+scss/less) -> selector tokens with exact positions
    jsUsageParser.ts        Babel AST + text fallback -> class/id usages
    markupParser.ts         HTML/Vue/Svelte/Astro/Angular template -> class/id usages
    angularParser.ts        @Component/@Directive, templates, host bindings
  analysis/
    analyzer.ts             discovery, batching, caching, cancellation, result assembly
    usageIndex.ts           usage lookup + dead-selector comparison (token/strict)
  features/
    diagnostics.ts          Problems panel entries with related information
    codeActions.ts          quick fixes (remove token/rule, ignore, remove all)
    hoverProvider.ts        "why was this flagged" hover
    statusBar.ts            status bar controller
    reportText.ts           pure Markdown/JSON report builders
    report.ts               writes and opens the report
```

Nothing under `core/`, `parsers/` or `analysis/` imports `vscode`, which is what makes the
unit suite in `src/test/unit/` possible.

### 2.2 Nested and nth-level child selectors

* Every comma-separated branch is parsed separately, and every class/id in a descendant
  chain (`.a .b .c .d .e`) or compound selector (`.a.b.c`) is registered with its own
  line and column.
* SCSS/LESS nesting is resolved, including `&__title`, `&--modifier`, `@{var}` and
  `#{$var}` interpolation.
* Fragment-only selectors such as `[class*="btn-"]` and interpolation-truncated names such
  as `col-` become *dynamic prefix patterns* instead of bogus selectors.
* `:is()`, `:where()`, `:not()`, `:has()`, pseudo-elements and attribute selectors are
  walked recursively.
* `@keyframes`, `@font-face`, `@page`, `@property` and `@counter-style` blocks are skipped.
* Markup is scanned element by element, so template nesting depth is irrelevant - only the
  class list matters.
* Comparison is per token, and partial results are explicit: `.card .title` where only
  `.card` is used yields one finding for `.title` marked "partially dead (1 of 2 tokens
  still used)", plus related information pointing at where `.card` is used.

### 2.3 React usage that is recognised

| Source | Examples |
| --- | --- |
| JSX attributes | `className`, `class`, `id`, `ngClass` on any element or component |
| Expressions | ternary, `&&`, `||`, arrays, objects (string and identifier keys), calls, template literals (quasis and nested expressions) |
| Calls | `clsx`, `classnames`, `classNames`, `cx`, `cn`, `twMerge`, `twJoin`, `cva`, `styled`, tagged template helpers |
| CSS modules | `import styles from './x.module.css'` plus `styles.foo` and `styles['foo']` |
| DOM APIs | `classList.add/remove/toggle/contains/replace`, `setAttribute`, `querySelector(All)`, `matches`, `closest`, `getElementById`, `getElementsByClassName`, jQuery, `element.className =`, `element.id =` |
| Variables | class-ish names (for example `buttonClass`, `variantClass`) resolved wherever they are referenced |
| Files | `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.vue`, `.svelte`, `.astro` |

Deliberately *not* treated as usage: arbitrary string literals in unrelated code, so
`const greeting = 'Hello World'` does not mark `.Hello` or `.World` as used. This is what
keeps detection precise instead of "everything is used".

### 2.4 Angular usage that is recognised

* `template` as a string, a backtick template literal, or `'a' + b + 'c'` concatenation.
* String literals inside `${...}` of a backtick template.
* `templateUrl` resolved relative to the component, with a workspace-wide
  case-insensitive basename fallback and a clear log entry when it cannot be found.
* `styleUrls` and `styles` recorded per component.
* `[class.x]`, `[class]`, `[attr.class]`, `ngClass`, and `[ngClass]` with string, object,
  array and ternary values, plus `class="a {{b}} c"` interpolation.
* `host: { '[class.open]': '...', class: '...' }` and `@HostBinding('class.x')`.
* Component selectors (`selector: 'app-card'`) count as element tags for element analysis.

### 2.5 Vue, Svelte and Astro

`:class="{ active: isActive }"`, `:class="['a', cond && 'b']"`, `v-bind:class`,
`class:name`, `class:name={cond}`, `class:list={[...]}`, and `class={...}` expressions, plus
the `<style>` block of the SFC (masked so every position still maps to the real file).

### 2.6 SPA and non-SPA projects

`index.html` + `styles.css` with nothing else now works end to end (see the fixture
`test-files/spa/` and the sample output in the README). Non-SPA projects behave the same
way they always did: external stylesheets are matched against every script and template in
the workspace, so it does not matter whether the CSS sits next to the component, in
`src/styles`, or in one global bundle.

### 2.7 Edge cases handled

| Case | Behaviour |
| --- | --- |
| `@keyframes`, `@font-face`, `@page`, `@property` | skipped, never reported |
| `:root { --var: ... }`, `* { box-sizing: ... }` | no class/id tokens, so nothing is reported |
| `:is()`, `:not()`, `:has()`, `:where()`, `::before`, attribute selectors | parsed recursively |
| SCSS `#{}`, LESS `@{}`, `//` comments, nesting | parsed with the matching syntax parser |
| CSS modules `:global(...)` / `:local(...)` | inner selectors are still counted |
| interpolated or truncated class names | treated as dynamic prefixes |
| `id` and `class` with the same name | matched per type, with a cross-type safety net that avoids false positives |
| broken or unparseable CSS | tolerant scan still extracts selectors; the problem is logged |
| broken JS/TS | Babel is retried with several plugin sets, then a text scan is used |
| very large files | skipped above `maxCssFileSizeKb` / `maxSourceFileSizeKb`, with a log entry |
| empty or binary files | skipped silently |
| missing `templateUrl` target | logged; the rest of the component still analyses |
| an edit landing while analysis runs | the stale run is discarded, the newest result wins |
| `node_modules`, `dist`, `build`, `out`, `.next`, `.nuxt`, `.angular`, `.svelte-kit`, `vendor`, `*.min.css`, `*.d.ts` | excluded by default |
| component-scoped or global styles you intentionally keep | `safelist`, `ignoreSelectors`, `/* dead-css-ignore */`, `/* dead-css-ignore-file */` |

### 2.8 Error handling

* Every stage is wrapped: per file, per rule, per selector, per JSX attribute, per binding.
* `ErrorCollector` keeps the last 200 problems. Recoverable ones go to the logger; fatal
  ones and configuration mistakes surface as a warning with *Show Log*, *Show Errors* and
  *Open Settings* actions.
* Settings are normalised and clamped (`normalizeConfig`): wrong types, out-of-range
  numbers and empty arrays fall back to defaults with a logged warning instead of breaking
  the analysis.
* Logging itself cannot throw, and the log sink is detached on deactivate.
* Analysis runs are numbered; an older run that finishes after a newer one has started is
  discarded instead of overwriting fresher diagnostics.

---

## 3. How each claim is verified

```bash
npm install
npm test        # 48 unit tests, no VS Code download required
npm run build   # type check + production bundle
```

| Test file | What it proves |
| --- | --- |
| `src/test/unit/cssParser.test.ts` | descendant chains up to six levels, exact line and column, SCSS `&` nesting, `:is/:not/:has`, comma lists, `@keyframes` skipping, ignore comments, dynamic prefixes, element selectors, broken-CSS recovery |
| `src/test/unit/jsUsageParser.test.ts` | static, conditional and logical class names, template literals with nested ternaries, CSS modules, arrays/objects/variables, DOM APIs, `createElement`, dynamic prefixes, text fallback, precision guard against prose strings |
| `src/test/unit/markupAndAngular.test.ts` | SPA HTML, multi-line attributes, interpolation, `[class.x]`, `[ngClass]` object/array/ternary, Vue, Svelte, script/style masking, Angular backtick templates, `${...}` expressions, host bindings, string templates |
| `src/test/unit/usageIndex.test.ts` | partial versus fully dead findings, deep-child false-positive regression, token/strict modes, dynamic patterns, safelist/ignore, id/class separation, element analysis |
| `src/test/unit/spaScenario.test.ts` | end to end: SPA `index.html` + `styles.css`, inline `<style>`, Angular component with nested SCSS, React CSS-module component, Vue SFC, broken file |
| `src/test/unit/reportText.test.ts` | Markdown and JSON report builders |

Manual verification on the bundled fixtures:

```bash
npm run analyze -- test-files/spa       # finds .dead-widget, #dead-anchor, .hero__subtitle, .inline-dead
npm run analyze -- test-files --strict  # quiet mode: partially dead selectors are not listed
```

`test-files/nth-level.scss` and `test-files/nth-level.tsx` reproduce the original bug
report: `.card__body .card__legacy-note` is reported, while `card`, `card__header`,
`card__title`, `card__body`, `card__text`, `card__icon` and `card--compact` (built with
`clsx` and conditionals) are correctly recognised as used.

---

## 4. Known limits (deliberate)

* Runtime-generated names (`styles[`item-${i}`]`, `data-${Date.now()}`) cannot be resolved
  statically. The extension detects the *pattern* and stops reporting that family of
  classes rather than guessing; use `dynamicClassPatterns` or `safelist` for anything
  exotic.
* A class passed through props (`<Child cls={x} />` and later `className={props.cls}`)
  resolves only when the value is a literal at the call site. Unknown values are ignored
  and recorded as unresolved bindings in the debug log.
* CSS-in-JS (`styled.div`, Emotion) has no stylesheet to compare against, so only real
  `.css/.scss/.less/.sass` files and `<style>` blocks are analysed.
* Framework runtime directives such as `@HostBinding('attr.class')` are marked as unknown
  and skipped rather than reported.
* `analyzeElements` is off by default because element selectors such as `article {}` are
  frequently styled globally on purpose.

---

## 5. Migration notes

* Version bumped to **1.1.0**. Two new runtime dependencies: `postcss-scss` and
  `postcss-less`.
* Existing settings keep working. Defaults changed for `includeFileTypes` (added `.sass`),
  `componentFileTypes` (added `.js`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.vue`, `.svelte`,
  `.astro`), `excludePatterns` (added `out`, `.next`, `.nuxt`, `.angular`, `.svelte-kit`,
  `vendor`, `*.min.css`, `*.d.ts`) and `debounceDelay` (500 ms to 600 ms).
* `npm test` now runs the fast unit suite; the VS Code integration test moved to
  `npm run test:vscode`.
