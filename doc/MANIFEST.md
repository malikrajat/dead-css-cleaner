# The extension manifest

In VS Code, the manifest is `package.json` at the root of the extension - the direct equivalent of `manifest.json` in a Chrome extension. The Marketplace, `vsce` and the extension host all read it, so an invalid field can block a release or make the extension invisible in search.

This page documents every field this project uses, why it is set that way, and how to validate changes before publishing.

---

## Chrome manifest vs VS Code manifest

| Chrome (`manifest.json`) | VS Code (`package.json`) | Purpose |
| --- | --- | --- |
| `name`, `version` | `name`, `publisher`, `version` | Identity of the extension |
| `description` | `displayName`, `description` | Listing text used by search |
| `icons` | `icon` | Marketplace/extension icon (PNG, at least 128x128) |
| `permissions` | `capabilities` | Workspace trust and virtual workspace behaviour |
| `content_scripts`, `background` | `main`, `activationEvents` | Code entry point and when it loads |
| `action`, `commands` | `contributes.commands`, `contributes.menus`, `contributes.keybindings` | UI surface |
| `options_page` | `contributes.configuration` | Settings UI |
| `_locales/` | `package.nls.json`, `package.nls.<locale>.json` | Localised strings |

Everything the user can see or click is declared in the manifest; the TypeScript code only implements it.

---

## Field reference

### Identity

| Field | Value here | Notes |
| --- | --- | --- |
| `name` | `dead-css-cleaner` | Lowercase letters, digits and hyphens only, max 50 characters, no `vscode`/`visual-studio` in the name. The Marketplace ID is `<publisher>.<name>` = `RajatMalik.dead-css-cleaner`. Renaming it after publishing creates a new extension. |
| `publisher` | `RajatMalik` | Must match the publisher id created on the Marketplace. |
| `version` | `1.3.0` | Semver. `vsce publish minor` bumps the minor version for you. |
| `displayName` | `%displayName%` -> "Dead CSS Cleaner" | Shown in the Marketplace and the Extensions view. Keep it under about 45 characters. |
| `description` | `%description%` -> 181 characters | Used for search relevance; keep it rich in real keywords and under about 200 characters. |
| `license` | `MIT` | Must match a `LICENSE` file at the repository root. |
| `icon` | `icon.png` | PNG, at least 128x128 (256x256 recommended, under 1 MB). `npm run optimize:icon` regenerates it from `images/icon-source.png`. |
| `preview` | `false` | `true` would show a "Preview" badge. |

### Links and discovery

| Field | Notes |
| --- | --- |
| `repository.url` | Required by `vsce`, and validated as a real URL. |
| `homepage`, `bugs.url`, `bugs.email` | Surfaced on the Marketplace page. |
| `qna` | Points at GitHub Discussions so the Marketplace "Q & A" link works. |
| `sponsor.url` | Adds a "Sponsor" button. |
| `markdown` | `github` enables GitHub-flavoured Markdown (tables, task lists) in the README. |
| `galleryBanner` | Background colour and theme of the Marketplace header. |
| `badges` | Up to five shields shown near the title. |
| `keywords` | Up to 30 entries. This is the main ranking signal besides downloads and ratings. |
| `categories` | Must come from the Marketplace's fixed list; this project uses `Linters`, `Programming Languages` and `Other`. |

### Runtime

| Field | Notes |
| --- | --- |
| `engines.vscode` | `^1.90.0`. VS Code refuses to install on older versions, so raise this only when newer APIs are actually used. |
| `engines.node` | `>=18.0.0` for development. |
| `main` | `./dist/extension.js`, the webpack bundle produced by `npm run build`. |
| `extensionKind` | `["workspace"]` - the extension needs the real file system, so in remote scenarios it runs on the remote host. |
| `activationEvents` | The extension registers language providers from code without contributing a language, so VS Code cannot infer `onLanguage:*` events for it. The explicit list is therefore required, plus `workspaceContains:**/*.{css,scss,sass,less}` so the status bar appears as soon as a style-bearing workspace is opened. |

### Capabilities

`capabilities` tells VS Code how the extension behaves in restricted workspaces. Without it, users see an "unknown" warning.

```json
"capabilities": {
  "untrustedWorkspaces": { "supported": true, "description": "%capabilities.untrustedWorkspaces.description%" },
  "virtualWorkspaces": { "supported": false, "description": "%capabilities.virtualWorkspaces.description%" }
}
```

- **Untrusted workspaces**: supported. Analysis is read-only, and no file is written unless the user explicitly applies a fix or exports a report.
- **Virtual workspaces**: not supported, because the analyzer reads files directly from disk to build its usage index.

### Contributions

| Contribution | Used for |
| --- | --- |
| `commands` | 11 commands; `unusedCssDetector.afterEdit` is internal and hidden from the palette. |
| `keybindings` | `Ctrl+Alt+D` / `Cmd+Alt+D` runs a workspace analysis. |
| `menus.commandPalette` | Shows or hides each command; `when` clauses keep CSS-only commands out of unrelated editors. |
| `menus.editor/title`, `menus.editor/context` | Buttons and right-click actions for stylesheets. |
| `menus.explorer/context` | Analyse from a folder in the Explorer. |
| `walkthroughs` | The four-step "Get started" experience; media lives in `media/` and the copy is localised. |
| `viewsContainers` + `views` | The "Dead CSS by component" sidebar: an activity-bar container (icon `media/dead-css-icon.svg`) with one tree view whose contents are described per component. |
| `configuration` | All settings, each with `type`, `default`, `scope`, `order`, `markdownDescription` and `tags`. |

---

## Localisation (`package.nls.json`)

Any string in the manifest that looks like `%key%` is looked up in `package.nls.json`. This keeps the manifest free of hard-coded English and lets contributors add `package.nls.<locale>.json` files without touching `package.json`.

```json
{
  "command.analyze.title": "Analyze Workspace for Dead CSS"
}
```

Rules:

- Every `%key%` must exist, otherwise `vsce package` fails with "Invalid package.json: key is missing".
- Unused keys are allowed but are reported as warnings by `npm run verify:manifest`.
- Only the manifest is localised this way. Runtime strings (diagnostic and notification text) would use the separate `vscode.l10n` API with an `l10n/` folder and `"l10n": "./l10n"` - a good next step if translations are requested.

---

## Marketplace search and ranking

Search ranks extensions by keyword match plus popularity signals. What is under our control:

- **`displayName`** - exact and memorable, with no filler words.
- **`description`** - the first ~130 characters appear in the results list and should contain the terms people type: "unused CSS", "dead CSS", framework names.
- **`keywords`** - 30 slots, all used, including multi-word phrases ("unused css remover", "remove unused css", "dead css") and framework names (react, angular, vue, svelte, astro).
- **`categories`** - three relevant categories instead of one broad one.
- **README** - the first paragraph matters for readers and for search; keep framework names and the exact phrase "unused CSS" near the top.
- **Popularity signals** - installs, ratings and recency. A handful of genuine reviews moves an extension up far more than any keyword tweak.

Validate the manifest at any time:

```bash
npm run verify:manifest
```

The script checks name and version rules, keyword limits and duplicates, allowed categories, icon format and size, engine ranges, capabilities, localisation keys, walkthrough media, menu/command consistency and `.vscodeignore` contents, then prints a pass/warn/fail summary.

---

## Packaging rules

- Dependencies are bundled by webpack into `dist/extension.js`, so `.vscodeignore` excludes `node_modules/**`. If bundling is ever dropped, remove that line and let `vsce` include the runtime dependencies.
- `dist/**` must stay in the package: it is the entry point the manifest points at. `npm run verify:manifest` fails if `.vscodeignore` would exclude it.
- `src/**`, `scripts/**`, `test-files/**`, `out/**` (compiled tests), `doc/**` and CI files are excluded to keep the VSIX small.
- `README.md`, `CHANGELOG.md`, `LICENSE`, `package.nls.json`, `icon.png` and `media/**` must stay included: the Marketplace and the walkthrough need them.
- Inspect exactly what will ship:

```bash
npm run build
npx vsce ls
npm run package
```

---

## Release checklist for the manifest

- `version` bumped in `package.json` with a matching `CHANGELOG.md` section.
- `npm run verify:manifest` reports 0 failures.
- New settings or commands are reflected in `description`, `keywords` and the README where relevant.
- `npx vsce ls` lists only `dist/`, `media/`, the manifest files, the icon and the three root documents.
- `npm run package`, install the produced VSIX, and click through the walkthrough once.
