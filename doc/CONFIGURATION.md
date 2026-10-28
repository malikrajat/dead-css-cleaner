# Configuration reference

Every setting lives under the `unusedCssDetector.` namespace. Open Settings (`Ctrl/Cmd + ,`), search for "dead css", or run *Dead CSS Cleaner: Open Settings*. Settings marked `scope: resource` can differ per workspace folder; `scope: window` settings are per window.

```jsonc
// .vscode/settings.json
{
  "unusedCssDetector.analysisMode": "token",
  "unusedCssDetector.autoAnalyze": true,
  "unusedCssDetector.safelist": ["^js-", "btn-*"],
  "unusedCssDetector.dynamicClassPatterns": ["item-", "col-"],
  "unusedCssDetector.excludePatterns": ["**/node_modules/**", "**/dist/**", "**/generated/**"]
}
```

---

## Analysis

### `unusedCssDetector.analysisMode`

- Type: `string`, enum `token` or `strict`
- Default: `token`
- Scope: resource

`token` reports every unused class/id and labels partially dead selectors (`.card .title` where `.card` is used but `.title` is not) as "partially dead". `strict` reports a selector only when **all** of its classes and ids are unused, which removes almost all nested-child noise at the cost of missing partially dead selectors.

```jsonc
{ "unusedCssDetector.analysisMode": "strict" }
```

### `unusedCssDetector.autoAnalyze`

- Type: `boolean`, default `true`, scope: window

Analyse after saving a relevant file, when switching files, when configuration changes, and when the file watcher notices creates or deletes. Turn it off to analyse only on demand.

### `unusedCssDetector.componentScope`

- Type: `string`, enum `tree`, `component` or `off`
- Default: `tree`
- Scope: resource

How far the "is this used?" check follows **child components**. Stylesheets are matched to the component that declares them (`styleUrls`, CSS imports, `.vue`/`.svelte`/`.astro` styles), and the classes are then validated against that component's tree.

| Value | Behaviour |
| --- | --- |
| `tree` (default) | Owner component + every descendant component + their templates. A parent class applied by a grandchild is not dead. |
| `component` | Owner component + direct children only. Deeper usage is reported as "used elsewhere" instead of dead. |
| `off` | Pre-1.4 behaviour: any usage anywhere in the workspace counts as used. |

Tokens that are used in the workspace but **only outside** the owner's tree are never diagnostics - they appear in the component report and the sidebar under "used elsewhere", which normally means the rule belongs to another component.

Stylesheets that no component owns (a global `styles.css`, a plain SPA's `index.html` styles) always use whole-workspace matching.

```jsonc
{ "unusedCssDetector.componentScope": "tree" }
```

### Reporting the results per component

- **Dead CSS by component** (activity bar) lists component → dead class with the nested selector chain and the scope that was checked.
- *Dead CSS Cleaner: Show Dead CSS Report (grouped by component)* writes the same information as Markdown, including a "used elsewhere" section and the component graph.
- *Dead CSS Cleaner: Copy Dead CSS List* copies `file:line  .class  (selector: ...)` lines.

### `unusedCssDetector.analyzeIds`

- Type: `boolean`, default `true`, scope: resource

Include `#id` selectors. Ids are matched per type, with a cross-type safety net: `#nav` is also considered used when code contains `class="nav"`.

### `unusedCssDetector.analyzeElements`

- Type: `boolean`, default `false`, scope: resource, tag: experimental

Also report element-only selectors such as `article {}` when the tag never appears in any scanned template. Off by default because global element styling is normal.

### `unusedCssDetector.severity`

- Type: `string`, enum `information`, `warning` or `error`, default `warning`, scope: resource

Problems panel severity for findings.

### `unusedCssDetector.tagUnnecessary`

- Type: `boolean`, default `false`, scope: resource

Tag findings as "unnecessary" (dimmed) instead of a plain warning.

### `unusedCssDetector.maxUsageLocations`

- Type: `number`, default `5`, range 1-50, scope: resource

How many usage locations to keep per token. They appear as clickable related information in the Problems panel.

---

## Files

### `unusedCssDetector.includeFileTypes`

- Type: `string[]`, default `[".css", ".scss", ".less", ".sass"]`, scope: resource

Stylesheet extensions to analyse. `<style>` blocks inside template files are analysed even when their extension is not listed here.

### `unusedCssDetector.componentFileTypes`

- Type: `string[]`, default `[".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".astro"]`, scope: resource

Files scanned for class usage. Single-file components such as `.vue` are parsed as both script and markup.

### `unusedCssDetector.markupFileTypes`

- Type: `string[]`, default `[".html", ".htm", ".vue", ".svelte", ".astro", ".php", ".erb", ".hbs", ".handlebars", ".twig", ".ejs", ".cshtml", ".razor", ".mdx", ".aspx", ".jsp"]`, scope: resource

Template files scanned for `class`, `className`, `id` and framework bindings.

### `unusedCssDetector.excludePatterns`

- Type: `string[]`, default `["**/node_modules/**", "**/dist/**", "**/build/**", "**/out/**", "**/.git/**", "**/coverage/**", "**/.next/**", "**/.nuxt/**", "**/.angular/**", "**/.svelte-kit/**", "**/vendor/**", "**/*.min.css", "**/*.d.ts"]`, scope: resource

Glob patterns for files and folders to skip entirely. Narrow these rather than disabling them: excluding a source folder makes every class in it look unused.

### `unusedCssDetector.minFilesForAnalysis`

- Type: `number`, default `1`, minimum 1, scope: resource

Minimum number of style-bearing files before an analysis runs. Raise it to avoid analysing tiny folders.

---

## False-positive control

### `unusedCssDetector.ignoreSelectors`

- Type: `string[]` of regular expressions, default `[]`, scope: resource

Selectors or token names matching any pattern are never reported. Useful for legacy or theme styles.

```jsonc
{ "unusedCssDetector.ignoreSelectors": ["^legacy-", "^theme-", "\\.old-"] }
```

### `unusedCssDetector.safelist`

- Type: `string[]` of regular expressions or `prefix*` patterns, default `[]`, scope: resource

Classes matching any pattern are always treated as used.

```jsonc
{ "unusedCssDetector.safelist": ["^js-", "btn-*", "^animate-"] }
```

### `unusedCssDetector.dynamicClassPatterns`

- Type: `string[]` of prefixes or regular expressions, default `[]`, scope: resource

Extra prefixes for classes assembled at runtime. The extension already detects `` `item-${size}` ``, `'btn-' + size`, `[class*="col-"]` and `class="chip chip--{{ size }}"` automatically; add this when a name is built in a way the parser cannot see, for example inside a helper library.

```jsonc
{ "unusedCssDetector.dynamicClassPatterns": ["item-", "col-", "is-", "has-"] }
```

### `unusedCssDetector.ignoreComment`

- Type: `string`, default `dead-css-ignore`, scope: resource

Change the comment marker if `dead-css-ignore` collides with another tool.

```css
/* dead-css-ignore */
.kept-on-purpose { color: red; }

/* dead-css-ignore-file */
```

---

## Performance

| Setting | Default | Range | Purpose |
| --- | --- | --- | --- |
| `unusedCssDetector.enableCaching` | `true` | - | Cache parse results per file, invalidated on change |
| `unusedCssDetector.cacheTimeout` | `300000` | 0-1800000 | Cache TTL in ms; `0` disables time-based expiry |
| `unusedCssDetector.debounceDelay` | `600` | 0-10000 | Wait after a file change before analysing |
| `unusedCssDetector.maxConcurrentFiles` | `12` | 1-64 | Files per processing batch |
| `unusedCssDetector.largeProjectThreshold` | `150` | 10-5000 | File count above which progress notices appear |
| `unusedCssDetector.enableFileWatcher` | `true` | - | React to created, changed and deleted files |
| `unusedCssDetector.watcherThrottleDelay` | `2000` | 200-60000 | Watcher throttle in ms |
| `unusedCssDetector.maxCssFileSizeKb` | `5120` | 64-51200 | Skip larger stylesheets |
| `unusedCssDetector.maxSourceFileSizeKb` | `2048` | 64-51200 | Skip larger source files |
| `unusedCssDetector.debugLogging` | `false` | - | Verbose output channel logging |

---

## Interface

| Setting | Default | Purpose |
| --- | --- | --- |
| `unusedCssDetector.showStatusBar` | `true` | Show the dead selector count in the status bar |
| `unusedCssDetector.showNotifications` | `true` | Notify when analysis finishes |

---

## Recipes

### Large monorepo (fast and quiet)

```jsonc
{
  "unusedCssDetector.analysisMode": "strict",
  "unusedCssDetector.autoAnalyze": false,
  "unusedCssDetector.excludePatterns": [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/storybook-static/**",
    "**/generated/**"
  ],
  "unusedCssDetector.maxConcurrentFiles": 24
}
```

Run *Analyze Workspace for Dead CSS* when you want a report. Stale runs are cancelled automatically, so repeated runs stay cheap.

### Angular with SCSS and dynamic classes

```jsonc
{
  "unusedCssDetector.analysisMode": "strict",
  "unusedCssDetector.dynamicClassPatterns": ["is-", "has-", "theme-"],
  "unusedCssDetector.ignoreSelectors": ["^ng-", "^cdk-"]
}
```

Backtick inline templates, `templateUrl`, `host` bindings and `@HostBinding('class.x')` are handled automatically.

### React with CSS modules and clsx

```jsonc
{
  "unusedCssDetector.analysisMode": "token",
  "unusedCssDetector.safelist": ["^js-"]
}
```

`styles.foo`, `styles['foo']`, `clsx`, `cx`, `classnames`, ternaries, `&&`, arrays and objects are understood.

### Plain SPA (index.html plus styles.css)

No configuration is required. Add more template extensions if your markup uses a different suffix:

```jsonc
{ "unusedCssDetector.markupFileTypes": [".html", ".htm", ".njk", ".liquid"] }
```

### Styles kept for external consumers

```jsonc
{
  "unusedCssDetector.safelist": ["^public-", "^embed-"],
  "unusedCssDetector.ignoreSelectors": ["^\\.legacy-"]
}
```

### Vue, Svelte and Astro single-file components

Nothing to configure. The analyzer parses the markup, the script block and the `<style>` block of the same file, and positions inside `<style>` stay correct.

### Suppress an entire file

```css
/* dead-css-ignore-file */
```

Place it anywhere in the stylesheet, for example as the first line of a vendor override file.
