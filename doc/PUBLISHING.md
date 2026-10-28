# Publishing Dead CSS Cleaner

This page covers packaging and releasing to the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/vscode). For the manifest field rules behind these steps see [MANIFEST.md](MANIFEST.md).

---

## One-time setup

- **Publisher.** Create or sign in to a publisher at https://marketplace.visualstudio.com/manage and confirm that the `publisher` id in `package.json` (`RajatMalik`) matches it.
- **Personal Access Token (PAT).** In Azure DevOps (https://dev.azure.com) create a token with the **Marketplace: Manage** scope. Keep it out of the repository.
- **Tooling.** Run `npm install`; `@vscode/vsce` is already a dev dependency, or install it globally with `npm run install-vsce`.
- **Local VSIX install.** `code --install-extension dead-css-cleaner-<version>.vsix`.

---

## Pre-flight checks

Run these before every release:

```bash
npm ci
npm run verify            # manifest + Biome + type check + unit tests
npm run test:vscode       # integration tests in a real VS Code instance
npm run test:coverage     # optional: unit coverage report
npm run build             # production webpack bundle -> dist/extension.js
npm run verify:manifest   # Marketplace-specific rules (expect 0 failures)
```

`verify:manifest` checks the rules that would otherwise fail mid-publish: name and version format, `displayName` length, keyword count and duplicates, allowed categories, icon format and size, engine ranges, capabilities, localisation keys, walkthrough media, menu and command consistency, that `.vscodeignore` excludes sources and bundled dependencies, and that the `main` bundle is *not* excluded.

---

## Bumping the version

- Update `version` in `package.json`.
- Add a matching section to `CHANGELOG.md`; the Marketplace renders it on the *Changelog* tab.
- Update the README when commands, settings or supported frameworks change.

Alternatively, let `vsce` bump it:

```bash
npx vsce publish patch
npx vsce publish minor
npx vsce publish major
```

---

## Packaging and inspecting

```bash
npm run package            # build + vsce package -> dead-css-cleaner-<version>.vsix
npx vsce ls                # list exactly what will be inside the VSIX
```

Expected contents: `dist/extension.js`, `media/`, `icon.png`, `package.json`, `package.nls.json`, `README.md`, `CHANGELOG.md`, `LICENSE` and `extension.vsixmanifest`.

If development files appear in that list, `.vscodeignore` needs attention. `node_modules/**` must stay excluded because webpack bundles the runtime dependencies.

Install the VSIX locally and walk through the contributed walkthrough once before publishing.

---

## Publishing

```bash
# interactive: paste the PAT when prompted
npx vsce publish

# non-interactive
npx vsce publish -p <PAT>

# via npm scripts
npm run publish          # build + publish
npm run publish:minor    # build + bump minor + publish
```

Never commit the PAT. Prefer an environment variable or a CI secret.

---

## Publishing from CI

`.github/workflows/release.yml` publishes on a `v*` tag. It runs the same checks as CI (manifest, Biome, type check, unit tests) before building, packaging and publishing. The VSIX is published to the Marketplace and then discarded - release runs store no artifacts and attach no binaries to the GitHub release:

```bash
git tag v1.3.0
git push origin v1.3.0
```

Requirements:

- Add a repository secret named `VSCE_PAT` (Settings, Secrets and variables, Actions).
- The workflow needs write access to create releases (`permissions: contents: write`, already configured).

The workflow verifies the manifest, lints, runs the unit tests, packages the VSIX, publishes it, and attaches the VSIX to a generated GitHub release. Manual runs (`workflow_dispatch`) default to `dry-run: true`, so they build and upload the VSIX without publishing.

`.github/workflows/ci.yml` runs on every push and pull request with one job per step: manifest verification, Biome lint, Biome format check, type check, unit tests (a seven-way matrix that runs one module per job), coverage, integration tests on Ubuntu and Windows, the `dist/` build, VSIX packaging, and a summary job that reports the status of each step. `.github/workflows/codeql.yml` adds CodeQL analysis for `javascript-typescript` and the GitHub Actions workflows.

---

## After publishing

- Check the Marketplace page: description, icon, README rendering (tables, code blocks), badges, keywords and categories.
- Verify search placement for "unused css", "dead css" and "remove unused css".
- Update the generated GitHub release notes if you want more detail.
- Reply to Marketplace Q and A and GitHub Discussions; engagement improves both the extension and its ranking.

---

## Common vsce errors

| Error | Cause and fix |
| --- | --- |
| `Missing publisher name` | `publisher` is missing from `package.json` or does not match your Marketplace publisher id. |
| `Invalid package.json: %key% is not defined` | A `%key%` in the manifest has no entry in `package.nls.json`. `npm run verify:manifest` catches this. |
| `A 'repository' field is missing` | Add `repository.url` pointing at the GitHub repository. |
| `The specified icon wasn't found` | `icon` points at a file excluded by `.vscodeignore`, or the file is missing. |
| `SVGs can't be used as icons` | Use a PNG, at least 128x128; `npm run optimize:icon` produces a 256x256 one. |
| `Extension entrypoint(s) missing` | `main` points at a file that is not packaged. Run `npm run build` first and make sure `out/**` is not ignored. |
| `You're using an old version of vsce` | Update it: `npm install --save-dev @vscode/vsce@latest`. |
| `The extension 'x' already exists` | The `<publisher>.<name>` pair is taken; you need your own publisher id. Renaming after publishing creates a new extension. |

---

## Unpublishing or hiding a release

```bash
npx vsce unpublish RajatMalik.dead-css-cleaner            # remove the whole extension (asks for confirmation)
npx vsce unpublish RajatMalik.dead-css-cleaner@1.3.0      # remove one version
```

Prefer publishing a fixed patch release over unpublishing: users keep receiving updates, and version history stays intact.
