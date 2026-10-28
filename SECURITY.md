# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.2.x | Yes |
| 1.1.x | Security fixes only |
| 1.0.x and older | No |

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Email **mr.rajatmalik@gmail.com** with:

1. A description of the issue and its impact.
2. Steps to reproduce, or a minimal repository that demonstrates it.
3. The extension version, VS Code version and operating system.
4. Any suggested fix or mitigation.

You can expect an acknowledgement within a few days. Confirmed issues are fixed in a patch release, and reporters are credited in `CHANGELOG.md` unless they prefer otherwise.

## Security model of this extension

Dead CSS Cleaner is intentionally low-risk, and the following properties are part of its design:

- **No network access at runtime.** The extension never performs HTTP requests, and it has no telemetry or analytics.
- **Read-only by default.** It reads workspace files to build the usage index. Files are only modified when you explicitly invoke a quick fix or *Remove All Dead Selectors in This File*, or when you export a report.
- **No remote code execution.** The analysis pipeline is local parsing (PostCSS and Babel) plus pure functions.
- **Workspace trust.** `capabilities.untrustedWorkspaces` is set to `supported`: in a restricted workspace the extension still analyses files, but it never writes anything unless you ask it to.
- **Virtual workspaces.** `capabilities.virtualWorkspaces` is set to `false`, because the analyzer reads files directly from disk.
- **No secrets are read.** The extension only looks at files matching the configured style, component and markup extensions, and skips `node_modules`, build output and other configured exclusions.

If you find a case where any of these properties does not hold, please report it using the process above.
