# Dead CSS Cleaner documentation

This folder holds the long-form documentation. The [README](../README.md) is the Marketplace page and the quick start; everything deeper lives here.

## Which document do I need?

| I want to... | Read |
| --- | --- |
| Install, run the extension and understand the basics | [../README.md](../README.md) |
| Configure the extension, or fix noisy/false results | [CONFIGURATION.md](CONFIGURATION.md) |
| Fix a problem (nothing happens, wrong results, slow analysis) | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |
| Understand how detection works and what its limits are | [ENHANCEMENT-NOTES.md](ENHANCEMENT-NOTES.md) |
| Contribute code, add a framework or run the tests | [../CONTRIBUTING.md](../CONTRIBUTING.md) |
| Work on the codebase internals | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Change or validate `package.json` before publishing | [MANIFEST.md](MANIFEST.md) |
| Publish a release to the Marketplace | [PUBLISHING.md](PUBLISHING.md) |
| Change which branch runs CI, or how tags are validated | [../GITHUB-ACTIONS.md](../GITHUB-ACTIONS.md) |

## Reference

### User documentation

- [CONFIGURATION.md](CONFIGURATION.md) - every setting, with scope, defaults and recipes for monorepos, Angular, Vue, SPAs and noisy codebases.
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - symptom-to-fix guide plus how to collect logs and reproduce problems with the CLI.
- [ENHANCEMENT-NOTES.md](ENHANCEMENT-NOTES.md) - the 1.1.0 detection-engine deep dive: what was broken, what is supported now, the edge-case table, verification and known limits.

### Developer documentation

- [../CONTRIBUTING.md](../CONTRIBUTING.md) - setup, project layout, coding rules, adding a framework, PR and release process.
- [ARCHITECTURE.md](ARCHITECTURE.md) - module responsibilities, data flow, invariants, extension points and performance model.
- [MANIFEST.md](MANIFEST.md) - `package.json` field reference, `package.nls.json` localisation, capabilities, Marketplace search rules and packaging.
- [PUBLISHING.md](PUBLISHING.md) - the release checklist, PAT setup, CI publishing and common vsce errors.
- [../GITHUB-ACTIONS.md](../GITHUB-ACTIONS.md) - the branch policy for every workflow, the reusable guard, and exactly what to edit to allow another branch.

### Community

- [../CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)
- [../SECURITY.md](../SECURITY.md)
- [../SUPPORT.md](../SUPPORT.md)
- [../CHANGELOG.md](../CHANGELOG.md)

## archive/

The files in [archive/](archive) are historical status notes written during the 1.0.x era, when the extension was called "Unused CSS Detector". They are kept only for reference and **contradict the current behaviour** in places (for example they describe caching and performance statistics that were declared but not implemented until 1.1.0). Do not use them as documentation.
