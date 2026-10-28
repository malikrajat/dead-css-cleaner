# Dead CSS Cleaner

**Find and remove unused CSS selectors in React, Angular, Vue, Svelte, Astro and plain HTML/CSS projects** - including nested child selectors, framework class bindings and single-page `index.html` + `styles.css` setups with no framework at all.

[![License](https://img.shields.io/github/license/malikrajat/dead-css-cleaner)](https://github.com/malikrajat/dead-css-cleaner/blob/main/LICENSE)
[![Latest release](https://img.shields.io/github/v/release/malikrajat/dead-css-cleaner)](https://github.com/malikrajat/dead-css-cleaner/releases)
[![Issues](https://img.shields.io/github/issues/malikrajat/dead-css-cleaner)](https://github.com/malikrajat/dead-css-cleaner/issues)
[![CI](https://github.com/malikrajat/dead-css-cleaner/actions/workflows/ci.yml/badge.svg)](https://github.com/malikrajat/dead-css-cleaner/actions/workflows/ci.yml)

Dead CSS Cleaner analyses your stylesheets, works out which class and id selectors are never referenced anywhere in your components or templates, and reports them in the Problems panel with a one-click fix. Less dead CSS means a smaller stylesheet, a smaller bundle and less code to maintain.

---

## Table of contents

- [Why this extension](#why-this-extension)
- [Dead CSS per component](#dead-css-per-component)
- [Install](#install)
- [Quick start](#quick-start)
- [What gets scanned](#what-gets-scanned)
- [How detection works](#how-detection-works)
- [Commands](#commands)
- [Settings](#settings)
- [Avoiding false positives](#avoiding-false-positives)
- [Use it without VS Code (CLI)](#use-it-without-vs-code-cli)
- [Troubleshooting and FAQ](#troubleshooting-and-faq)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [License](#license)

---

## Why this extension

Most unused-CSS tools only understand simple class strings, which produces two kinds of wrong answers: deeply nested "child of a child" selectors get flagged even though they are used, and framework bindings such as `[ngClass]="{ open: isOpen }"` are not understood at all. Dead CSS Cleaner was rebuilt around those cases.

| Problem | How Dead CSS Cleaner handles it |
| --- | --- |
| Nested / nth-level child selectors (`.card .body .title span`) | Every token in the chain is checked independently, and partial results are labelled as *partially dead* |
| Conditional and dynamic classes in React | `clsx`, `cx`, `classnames`, ternaries, `&&`, arrays, objects, template literals and CSS-module members are all read |
| Angular inline templates | Backtick templates, `${...}` expressions, `templateUrl`, `host` bindings and `@HostBinding('class.x')` are understood |
| Plain SPA with `index.html` + CSS only | HTML, Vue, Svelte, Astro, PHP, ERB, Twig, Handlebars, EJS, Razor and MDX templates are scanned, including inline `<style>` blocks |
| SCSS/LESS nesting and interpolation | Real `postcss-scss` / `postcss-less` parsers, so `&__title`, `#{$size}` and `@{}` work |
| Runtime-built class names | Detected as *dynamic patterns* (`item-${size}`, `[class*="col-"]`) so they are never reported as dead |

---

## Dead CSS per component

A count is not enough when you have to decide what to delete. Dead CSS Cleaner reports the
**actual classes**, grouped by the component that owns the stylesheet, and validates each
one against that component **and its child components** first.

### Where to see it

| Surface | What it gives you |
| --- | --- |
| **Sidebar** - "Dead CSS by component" (activity bar) | Component → dead class, with the nested selector chain, the checked scope and where a token is used elsewhere. Row actions: reveal, remove, ignore. |
| **Report** - *Show Dead CSS Report (grouped by component)* | Markdown report with a summary, a per-component table (`line | selector chain | dead token | fully/partially dead`), a "used elsewhere" section and the component graph. |
| **Copy list** - *Copy Dead CSS List* | Flat text for tickets or commits: `src/app/card.component.scss:26  .card__legacy-note  (selector: .card .card__body .card__legacy-note)`. |
| **Problems panel** | One diagnostic per dead token, stating the validated scope, with a lightbulb to remove the token, remove the rule or ignore it. |

### Parent styles validated against child components

This matters most in component frameworks: a class declared in a parent stylesheet is often
rendered by a **child** component. Dead CSS Cleaner builds a component graph first:

```
stylesheets  --> owners        CardComponent.scss -> CardComponent
components   --> children      CardComponent renders <app-card-body>, <CardBody />
scope        --> files         CardComponent + CardBodyComponent + their templates
```

Children are resolved from Angular component selectors (`<app-card-body>`), React/Vue/Svelte
JSX or template usage, and relative imports - so it works however you name things
(`CardBody`, `card-body`, `app-card-body`, `card-body.component.ts`).

Then each class is judged with three possible outcomes:

| Outcome | Meaning | Where it shows up |
| --- | --- | --- |
| **Dead** | Nothing in the owning component's tree uses it | Problems panel + report |
| **Used elsewhere** | Used in the workspace, but only outside the owning component's tree - not dead, but probably should move | Report + sidebar (never a diagnostic) |
| **Used** | Used inside the owning component, its children, or their templates | Not reported |

```text
CardComponent
  2 dead · 1 used elsewhere
  .card__legacy-note     card.component.scss:26 · partially dead
     Selector chain: .card .card__body .card__legacy-note
     Checked 5 file(s) in this component's tree
  .card__shared-badge    card.component.scss:31 · used elsewhere
     Used in ChildBadgeComponent.tsx
```

Control how far the check follows children with
[`unusedCssDetector.componentScope`](#settings): `tree` (default), `component` (direct
children only) or `off` (any usage anywhere counts, the pre-1.4 behaviour). Stylesheets that
no component claims - a global `styles.css`, a plain SPA's `index.html` styles - stay
whole-workspace, exactly as before.

---

## Install

**From the Marketplace**

1. Open VS Code and press `Ctrl/Cmd + Shift + X`.
2. Search for **Dead CSS Cleaner**.
3. Click **Install**, then reload if prompted.

**From a VSIX**

```bash
code --install-extension dead-css-cleaner-<version>.vsix
```

**Requirements**

- VS Code **1.90.0** or newer
- Node.js 18+ only if you build the extension yourself

---

## Quick start

1. Open a project that contains stylesheets.
2. Press `Ctrl/Cmd + Alt + D`, click **Dead CSS Cleaner** in the status bar, or run *Dead CSS Cleaner: Analyze Workspace for Dead CSS* from the Command Palette.
3. Open the **Problems** panel (`Ctrl/Cmd + Shift + M`). Each finding squiggles the exact class or id and explains why it was flagged.
4. Put the cursor on a finding, press `Ctrl/Cmd + .` and choose a fix: remove the token, remove the whole rule, add an ignore comment, or clean the entire file.

Analysis also runs automatically after you save a file, when you switch files, and when the file watcher sees a new or removed file.

```text
$(sync~spin) Analysing CSS...      ->      $(warning) 12 dead CSS selectors
```

---

## What gets scanned

| Group | Default extensions |
| --- | --- |
| Stylesheets | `.css`, `.scss`, `.less`, `.sass` plus `<style>` blocks inside any template file |
| Components / scripts | `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.vue`, `.svelte`, `.astro` |
| Markup / templates | `.html`, `.htm`, `.vue`, `.svelte`, `.astro`, `.php`, `.erb`, `.hbs`, `.handlebars`, `.twig`, `.ejs`, `.cshtml`, `.razor`, `.mdx`, `.aspx`, `.jsp` |

All three lists are configurable. `excludePatterns` skips `node_modules`, `dist`, `build`, `out`, `.next`, `.nuxt`, `.angular`, `.svelte-kit`, `vendor`, `*.min.css` and `*.d.ts` by default.

### Class and id usage that is recognised

**React / Preact / JSX / TSX**

```jsx
<div className="btn primary" />
<div className={styles.card__body} />
<div className={clsx('card', isOpen && 'card--open', size === 'lg' ? 'card--lg' : '')} />
<div className={`item item--${size}`} />
<div className={['flex', { 'is-active': active }]} />
React.createElement('div', { className: 'box box--wide' })

element.classList.add('is-visible');
document.querySelector('.wrapper .panel');   // both tokens count
element.setAttribute('class', 'legacy');
document.getElementById('main-app');
```

**Angular**

```ts
@Component({
  selector: 'app-card',
  template: `<div class="card"><p class="card__text">{{ t }}</p></div>`,  // backticks supported
  templateUrl: './card.component.html',
  styleUrls: ['./card.component.scss'],
  host: { '[class.host-open]': 'isOpen', class: 'host-base' }
})
export class CardComponent {
  @HostBinding('class.is-collapsed') collapsed = false;
}
```

```html
<div class="card card--wide" id="hero">
  <div [class.active]="isActive" [ngClass]="{ open: isOpen, 'is-large': isLarge }"></div>
  <span [ngClass]="['chip', isNew && 'chip--new']"></span>
  <i [ngClass]="isHot ? 'hot' : 'cold'"></i>
  <b ngClass="static-one static-two"></b>
  <em class="prefix {{ dynamic }} suffix"></em>
</div>
```

**Vue / Svelte / Astro**

```html
<!-- Vue -->
<div :class="{ active: isActive, disabled: isDisabled }"></div>
<div :class="['tag', isNew && 'tag--new']"></div>

<!-- Svelte -->
<div class="base" class:active={isActive} class:list={["a", "b"]}></div>

<!-- Astro -->
<div class:list={["card", condensed && "card--condensed"]}></div>
```

**Plain SPA (no framework)**

```html
<div id="app" class="app-shell">
  <header class="site-header"><nav class="nav"><ul class="nav-list">
    <li class="nav-item nav-item--active"><a class="nav-link">Home</a></li>
  </ul></nav></header>
</div>
<style>.inline-used { color: rebeccapurple; }</style>
```

```css
/* five levels deep - every token is checked */
.app-shell .site-header .nav .nav-list .nav-item .nav-link { color: var(--brand); }
```

---

## How detection works

Dead CSS Cleaner parses your stylesheets into class/id tokens with exact source positions, collects every class/id usage from your code, and compares the two. Findings become Problems panel diagnostics and status bar counts.

### Two reporting modes

`unusedCssDetector.analysisMode` controls how loud the extension is.

- **`token` (default)** - reports each unused class/id. If a selector is only *partially* dead (`.card .title` where `.card` is used but `.title` is not), the diagnostic says so and tells you which tokens are still used.
- **`strict`** - reports a selector only when **all** of its classes/ids are unused. Nothing partial is reported, which is ideal for deeply nested component styles.

### What is deliberately ignored

- `@keyframes`, `@font-face`, `@page`, `@property` and `@counter-style` blocks.
- Rules with no class or id tokens, such as `:root { --x: 1 }` or `* { box-sizing: border-box }`.
- Element-only selectors unless `analyzeElements` is enabled.
- Anything matching `ignoreSelectors`, `safelist`, a dynamic pattern, or an ignore comment.
- Unrelated string literals: `const greeting = 'Hello World'` does **not** mark `.Hello` or `.World` as used.

---

## Commands

| Command | Description | Default binding |
| --- | --- | --- |
| **Analyze Workspace for Dead CSS** | Full workspace analysis | `Ctrl/Cmd + Alt + D` |
| **Analyze Current File Only** | Fast check of the open stylesheet | - |
| **Show Dead CSS Report (grouped by component)** | Per-component report with nested selector chains | - |
| **Copy Dead CSS List** | Flat list for tickets and commits | - |
| **Refresh Dead CSS View** | Re-runs the analysis for the sidebar | - |
| **Remove All Dead Selectors in This File** | Bulk cleanup with a confirmation prompt | - |
| **Export Dead CSS Report** | Writes `.dead-css-report.md` or `.dead-css-report.json` | - |
| **Show Performance Statistics** | Timing per phase, cache hits and misses | - |
| **Clear Analysis Cache** | Forces a full re-parse | - |
| **Show Analysis Diagnostics Log** | Recovered parse problems and warnings | - |
| **Clear Diagnostics Log** | Empties the diagnostics log | - |
| **Show Output Log** | Opens the output channel (`debugLogging`) | - |
| **Open Settings** | Filters Settings to this extension | - |

---

## Settings

### Analysis

| Setting | Default | Description |
| --- | --- | --- |
| `unusedCssDetector.analysisMode` | `token` | `token` or `strict` reporting |
| `unusedCssDetector.componentScope` | `tree` | Follow child components when checking usage: `tree`, `component` or `off` |
| `unusedCssDetector.autoAnalyze` | `true` | Analyse on save, open and change |
| `unusedCssDetector.analyzeIds` | `true` | Report unused `#id` selectors |
| `unusedCssDetector.analyzeElements` | `false` | Report unused element selectors like `article {}` |
| `unusedCssDetector.severity` | `warning` | Problems panel severity |
| `unusedCssDetector.tagUnnecessary` | `false` | Dim findings instead of warning |
| `unusedCssDetector.maxUsageLocations` | `5` | Usage locations kept per token |

### Files

| Setting | Default | Description |
| --- | --- | --- |
| `unusedCssDetector.includeFileTypes` | `.css .scss .less .sass` | Stylesheet extensions |
| `unusedCssDetector.componentFileTypes` | `.js .jsx .ts .tsx .mjs .cjs .mts .cts .vue .svelte .astro` | Component and script extensions |
| `unusedCssDetector.markupFileTypes` | `.html .htm .vue .svelte .astro ...` | Template extensions |
| `unusedCssDetector.excludePatterns` | node_modules, dist, build, out, ... | Skipped glob patterns |
| `unusedCssDetector.minFilesForAnalysis` | `1` | Minimum style files before analysing |

### False-positive control

| Setting | Default | Description |
| --- | --- | --- |
| `unusedCssDetector.ignoreSelectors` | `[]` | Regexes that are never reported |
| `unusedCssDetector.safelist` | `[]` | Regexes or prefixes always treated as used |
| `unusedCssDetector.dynamicClassPatterns` | `[]` | Extra dynamic class prefixes |
| `unusedCssDetector.ignoreComment` | `dead-css-ignore` | Comment marker that skips a rule |

### Performance

| Setting | Default | Description |
| --- | --- | --- |
| `unusedCssDetector.enableCaching` | `true` | Per-file parse cache |
| `unusedCssDetector.cacheTimeout` | `300000` | Cache lifetime in milliseconds |
| `unusedCssDetector.debounceDelay` | `600` | Delay before auto-analysis |
| `unusedCssDetector.maxConcurrentFiles` | `12` | Files processed per batch |
| `unusedCssDetector.largeProjectThreshold` | `150` | When progress notices start |
| `unusedCssDetector.enableFileWatcher` | `true` | React to file create and delete |
| `unusedCssDetector.watcherThrottleDelay` | `2000` | Watcher throttle in milliseconds |
| `unusedCssDetector.maxCssFileSizeKb` | `5120` | Skip larger stylesheets |
| `unusedCssDetector.maxSourceFileSizeKb` | `2048` | Skip larger source files |
| `unusedCssDetector.debugLogging` | `false` | Verbose output channel logging |

Full reference with recipes: [doc/CONFIGURATION.md](doc/CONFIGURATION.md).

---

## Avoiding false positives

Dead CSS detection is static analysis: if a class name is assembled at runtime, no tool can see it. This extension detects dynamic patterns and stays quiet instead of guessing, and gives you four explicit escape hatches.

1. **Automatic detection** - `` `item-${size}` ``, `'btn-' + size`, `[class*="col-"]` and `class="chip chip--{{ size }}"` register a prefix, so every `item-*`, `btn-*` or `col-*` class counts as used.
2. **`dynamicClassPatterns`** - add your own prefixes or regular expressions.
3. **`safelist`** - for example `["^js-", "btn-*"]`.
4. **Ignore comments** - `/* dead-css-ignore */` above a rule, or `/* dead-css-ignore-file */` at the top of a file. `ignoreSelectors` covers everything else.

```css
/* dead-css-ignore */
.legacy-theme .button { background: rebeccapurple; }
```

---

## Use it without VS Code (CLI)

The exact same pipeline ships as a small CLI. It is useful in CI, and for reproducing a false positive before filing an issue.

```bash
npm install
npm run analyze -- path/to/project
npm run analyze -- path/to/project --strict      # only fully dead selectors
npm run analyze -- path/to/project --elements    # include element selectors
npm run analyze -- path/to/project --json        # machine readable
npm run analyze -- path/to/project --report      # per-component report (same as the command)
```

```text
Dead CSS Cleaner - standalone analysis
Folder: /home/me/site
Mode:   token
Files:  2 style, 1 script, 1 markup, 0 Angular component(s)
Usages indexed: 28 in 14 unique token(s)

styles.css
     27  .dead-widget        fully dead      (.dead-widget)
     32  .hero__subtitle     partially dead  (.hero .hero__subtitle)
     36  #dead-anchor        fully dead      (#dead-anchor)
```

---

## Troubleshooting and FAQ

**A class that I use is reported as dead.** Turn on `unusedCssDetector.debugLogging`, open the Dead CSS Cleaner output channel, and check whether the class appears in the usage list. If it is built dynamically, add its prefix to `dynamicClassPatterns`. If it lives in a file type that is not scanned, add that extension to `componentFileTypes` or `markupFileTypes`.

**Every class in my project is reported as dead.** That means no usages were found at all. Check that your template and component extensions are covered by `componentFileTypes` and `markupFileTypes`, and that `excludePatterns` is not excluding your source folder.

**Why is a selector marked "partially dead"?** Only some of its tokens are unused, for example `.card .title` where `.card` is used. Removing the dead token keeps the rest of the selector valid, and the related information links to where the used tokens appear.

**Can it run on a large monorepo?** Yes. Parsing is cached per file, files are processed in batches, oversized files are skipped, and a newer analysis cancels an older one. Use `excludePatterns` to skip generated or vendored folders.

**Does it change my files on its own?** No. Nothing is written unless you pick a quick fix, run *Remove All Dead Selectors*, or export a report.

**Does it send telemetry?** No. There is no runtime network access, no telemetry and no uploads.

More help: [doc/TROUBLESHOOTING.md](doc/TROUBLESHOOTING.md) and [doc/ENHANCEMENT-NOTES.md](doc/ENHANCEMENT-NOTES.md).

---

## Architecture

```text
src/
  extension.ts        activation, commands, providers, listeners
  state.ts            one analysis session (config + analyzer + diagnostics + status bar)
  core/               config, types, errors, logger, cache, text utilities
  parsers/            cssParser, jsUsageParser, markupParser, angularParser
  analysis/           analyzer, componentGraph + graphBuilder (parent/child validation),
                      usageIndex (scope-aware comparison)
  features/           diagnostics, code actions, hover, status bar, reports,
                      componentReport (per-component listing), deadCssTreeView (sidebar)
  test/unit/          119 dependency-free unit tests
  test/suite/         VS Code integration tests
dist/                 production bundle (ships in the VSIX)
out/                  tsc output used by tests and the CLI
```

`core/`, `parsers/` and `analysis/` never import `vscode`, which is what keeps them unit-testable in plain Node. See [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md) for the extension points and [doc/MANIFEST.md](doc/MANIFEST.md) for what every manifest field does.

### Development

```bash
npm install
npm run check:write  # Biome: lint + format + import organisation
npm run verify       # manifest + Biome + type check + 119 unit tests
npm test             # unit tests only
npm run test:coverage   # unit tests with a coverage report
npm run test:vscode     # integration tests in a real VS Code instance
npm run build           # production bundle -> dist/extension.js
npm run watch           # webpack watch mode
npm run package         # build a .vsix for the Marketplace
```

Press `F5` in VS Code to launch the Extension Development Host.

### Tooling

| Concern | Tool | Where |
| --- | --- | --- |
| Linting and formatting | [Biome](https://biomejs.dev) | `biome.json` |
| Type checking | TypeScript, strict mode | `tsconfig.json` |
| Unit tests | Mocha (TDD UI), 119 tests | `src/test/unit/` |
| Integration tests | `@vscode/test-electron` | `src/test/suite/` |
| Coverage | c8 | `npm run test:coverage` |
| Bundling | webpack | `dist/extension.js` |
| Manifest checks | `scripts/verify-manifest.js` | `npm run verify:manifest` |
| CI | GitHub Actions | `.github/workflows/` |

---

## Contributing

Contributions are welcome: bug reports, false-positive reports, new framework support and documentation fixes alike.

- [CONTRIBUTING.md](CONTRIBUTING.md) - setup, project layout, how to add a parser, PR checklist
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) - community expectations
- [SECURITY.md](SECURITY.md) - how to report a vulnerability
- [SUPPORT.md](SUPPORT.md) - where to ask questions
- [doc/README.md](doc/README.md) - full documentation index
- [GITHUB-ACTIONS.md](GITHUB-ACTIONS.md) - which branch runs CI, and how to change it

## License

[MIT](LICENSE) (c) Rajat Malik
