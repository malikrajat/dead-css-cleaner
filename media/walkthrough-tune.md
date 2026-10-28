## Reduce noise in your project

| Situation | Setting |
| --- | --- |
| Classes built at runtime (`` `item-${size}` ``) | `unusedCssDetector.dynamicClassPatterns` = `["item-"]` |
| Utility/JS-hook classes that are never in markup | `unusedCssDetector.safelist` = `["^js-"]` |
| Legacy stylesheets you are not ready to touch | `unusedCssDetector.ignoreSelectors` = `["^legacy-"]` |
| Deeply nested component styles | `unusedCssDetector.analysisMode` = `"strict"` |
| One rule you know is fine | `/* dead-css-ignore */` above it |
| Reporting element selectors (`article {}`) | `unusedCssDetector.analyzeElements` = `true` |

Full reference: [doc/CONFIGURATION.md](https://github.com/malikrajat/dead-css-cleaner/blob/main/doc/CONFIGURATION.md)
