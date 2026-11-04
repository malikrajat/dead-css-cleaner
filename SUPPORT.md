# Support

Thanks for using **Dead CSS Cleaner**. Here is where to get help.

## Documentation first

- [README.md](README.md) - features, quick start, settings overview
- [doc/CONFIGURATION.md](doc/CONFIGURATION.md) - every setting with recipes
- [doc/TROUBLESHOOTING.md](doc/TROUBLESHOOTING.md) - common problems and fixes
- [doc/ENHANCEMENT-NOTES.md](doc/ENHANCEMENT-NOTES.md) - how detection works and its known limits

## Asking a question

Use [GitHub Discussions](https://github.com/malikrajat/dead-css-cleaner/discussions) for usage questions, configuration help and ideas. For anything private, email **support@rajatmalik.dev**.

## Reporting a bug

Open an issue with the [bug report form](https://github.com/malikrajat/dead-css-cleaner/issues/new/choose). False positives are treated as bugs, so please include:

1. The CSS rule, for example `.card .card__title { ... }` and the file type (`.css`, `.scss`, ...).
2. The component or template snippet that uses the class, and the framework plus version.
3. Your `unusedCssDetector.analysisMode` (`token` or `strict`).
4. The extension version (Extensions view, or `code --list-extensions --show-versions`).
5. The diagnostics bundle described below, or a minimal reproduction / CLI output:

   ```bash
   npm run analyze -- path/to/minimal-project --json
   ```

## Sending logs and diagnostics

When an error notification appears, choose **Download Log**. The extension writes a ZIP file to your `Downloads` folder (or the system temp folder if `Downloads` is not writable) and shows the path with **Show in Folder**, **Open GitHub Issue** and **Copy Path** actions.

The bundle contains the session log, error stack traces, your `unusedCssDetector.*` settings, and the extension, VS Code, OS and Node/Electron versions. Home-directory paths are replaced with `<home>`, workspace roots with `<workspace>` and the working directory with `<cwd>`; no source files are included. Review the text files before sharing if project names are sensitive.

Attach the ZIP to the issue, or email it to **support@rajatmalik.dev** with a short description of what happened.

## Before you report

Turn on `unusedCssDetector.debugLogging` and open the **Dead CSS Cleaner** output channel (`Dead CSS Cleaner: Show Output Log`). The log shows which parser handled each file, which dynamic prefixes were detected, and any unresolved bindings - that detail usually identifies the cause immediately.

If a runtime-generated class is being reported, the quickest fix is to add its prefix to `unusedCssDetector.dynamicClassPatterns`, or mark the rule with `/* dead-css-ignore */`. See [Avoiding false positives](README.md#avoiding-false-positives).

## Feature requests

New framework or syntax support is very welcome. Open a [feature request](https://github.com/malikrajat/dead-css-cleaner/issues/new/choose) describing the framework, the file extension and an example of how classes are applied. If you would like to implement it yourself, [CONTRIBUTING.md](CONTRIBUTING.md#adding-support-for-a-new-framework) walks through the exact code path.

## Security issues

Please do not report security problems publicly - see [SECURITY.md](SECURITY.md).
