## What does this PR do?

<!-- A short description, and the issue it fixes (`Fixes #123`). -->

## Type of change

- [ ] Bug fix (false positive / false negative)
- [ ] New feature (framework, syntax or setting)
- [ ] Documentation only
- [ ] Refactor / performance
- [ ] Chore (CI, tooling, dependencies)

## How was it verified?

- [ ] `npm run verify` passes (manifest, lint, unit tests)
- [ ] `npm run test:vscode` passes (required for activation, commands, providers, diagnostics)
- [ ] Added or updated a regression test for the reported case
- [ ] Manually checked the CLI: `npm run analyze -- test-files/...`

## Checklist

- [ ] No `vscode` import was added to `src/core`, `src/parsers` or `src/analysis`
- [ ] Parsers still fail soft (try/catch + `ErrorCollector`, never throw)
- [ ] New detections carry a real line/column position
- [ ] New settings were added to `src/core/config.ts`, `package.json` and `doc/CONFIGURATION.md`
- [ ] `README.md`, `CHANGELOG.md` and the relevant `doc/` page are updated
