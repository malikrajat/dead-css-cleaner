#!/usr/bin/env node
/**
 * Dead CSS Cleaner - standalone CLI (no VS Code required).
 *
 * Usage:
 *   npm run analyze -- <folder> [--strict] [--elements] [--json] [--report]
 *
 * It runs exactly the same parsing + comparison pipeline the extension uses, so
 * you can verify behaviour on a real project before/without installing it.
 *
 *   --report   print the per-component Markdown report (same as the extension's
 *              "Show Dead CSS Report" command, including child-component scopes)
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

/**
 * `npm run analyze` compiles the extension sources into `out-cli` first, so the
 * CLI always uses exactly the same code as the extension.
 */
function loadPipeline() {
    const compiledRoot = fs.existsSync(path.join(root, 'out-cli/parsers/cssParser.js'))
        ? path.join(root, 'out-cli')
        : path.join(root, 'out');

    return {
        css: require(path.join(compiledRoot, 'parsers/cssParser')),
        js: require(path.join(compiledRoot, 'parsers/jsUsageParser')),
        markup: require(path.join(compiledRoot, 'parsers/markupParser')),
        angular: require(path.join(compiledRoot, 'parsers/angularParser')),
        usage: require(path.join(compiledRoot, 'analysis/usageIndex')),
        config: require(path.join(compiledRoot, 'core/config')),
        graph: require(path.join(compiledRoot, 'analysis/componentGraph')),
        graphBuilder: require(path.join(compiledRoot, 'analysis/graphBuilder')),
        componentReport: require(path.join(compiledRoot, 'features/componentReport')),
    };
}

let pipeline;
try {
    pipeline = loadPipeline();
} catch (error) {
    console.error(
        'Compiled sources not found. Run `npm run analyze -- <folder>` (it compiles first) or `npm run build:cli`.',
    );
    console.error(String(error));
    process.exit(1);
}

const { parseCssText, maskToStyleBlocks, syntaxForFile } = pipeline.css;
const { parseJsUsage } = pipeline.js;
const { parseMarkupText } = pipeline.markup;
const { parseAngularFile } = pipeline.angular;
const { UsageIndex, computeUnused, computeUnusedElements } = pipeline.usage;
const { normalizeConfig, DEFAULT_CONFIG } = pipeline.config;
const { ComponentGraph } = pipeline.graph;
const { isComponentTag, resolveRelativeImport, toGraphInputs, toKnownFiles } = pipeline.graphBuilder;
const { buildComponentReportMarkdown } = pipeline.componentReport;

const CSS_EXT = ['.css', '.scss', '.sass', '.less'];
const SCRIPT_EXT = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.astro'];
const MARKUP_EXT = [
    '.html',
    '.htm',
    '.vue',
    '.svelte',
    '.astro',
    '.php',
    '.erb',
    '.hbs',
    '.handlebars',
    '.twig',
    '.ejs',
    '.cshtml',
    '.razor',
    '.mdx',
    '.aspx',
    '.jsp',
];
const EXCLUDED_DIRS = new Set([
    'node_modules',
    'dist',
    'build',
    'out',
    '.git',
    'coverage',
    '.next',
    '.nuxt',
    '.angular',
    '.svelte-kit',
    'vendor',
]);

function walk(directory, files = []) {
    let entries;
    try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
        return files;
    }
    for (const entry of entries) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (!EXCLUDED_DIRS.has(entry.name)) {
                walk(full, files);
            }
        } else if (entry.isFile()) {
            files.push(full);
        }
    }
    return files;
}

function main() {
    const args = process.argv.slice(2);
    const target = args.find((arg) => !arg.startsWith('--'));
    const flags = new Set(args.filter((arg) => arg.startsWith('--')));

    if (!target) {
        console.error('Usage: npm run analyze -- <folder> [--strict] [--elements] [--json]');
        process.exitCode = 1;
        return;
    }

    const folder = path.resolve(target);
    if (!fs.existsSync(folder)) {
        console.error(`Folder not found: ${folder}`);
        process.exitCode = 1;
        return;
    }

    const { config } = normalizeConfig({
        ...DEFAULT_CONFIG,
        analysisMode: flags.has('--strict') ? 'strict' : 'token',
        analyzeElements: flags.has('--elements'),
    });

    const files = walk(folder);
    const index = new UsageIndex(config);
    const rules = [];
    const dynamicPatterns = [];
    const elementSelectors = [];
    const counts = { css: 0, script: 0, markup: 0, angular: 0, parseErrors: 0 };
    const basenameLookup = new Map(files.map((file) => [path.basename(file).toLowerCase(), file]));
    const knownFiles = toKnownFiles(files);
    const bundles = new Map();

    const bundleFor = (file) => {
        if (!bundles.has(file)) {
            bundles.set(file, {
                file,
                styleFiles: [],
                templateFiles: [],
                angularComponents: [],
                renderedTags: [],
                imports: [],
                ownsInlineStyles: false,
            });
        }
        return bundles.get(file);
    };

    for (const file of files) {
        const extension = path.extname(file).toLowerCase();
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        if (!text.trim()) {
            continue;
        }

        const isCss = CSS_EXT.includes(extension);
        const isScript = SCRIPT_EXT.includes(extension);
        const isMarkup = MARKUP_EXT.includes(extension);

        if (isCss) {
            const parsed = parseCssText(file, text, {
                ignoreComment: config.ignoreComment,
                analyzeElements: config.analyzeElements,
                analyzeIds: config.analyzeIds,
                syntax: syntaxForFile(extension),
            });
            counts.css++;
            counts.parseErrors += parsed.parseErrors;
            rules.push(...parsed.rules);
            elementSelectors.push(...parsed.elementSelectors);
            dynamicPatterns.push(...parsed.dynamicPatterns);
        }

        if (isMarkup) {
            const parsed = parseMarkupText(file, text);
            counts.markup++;
            index.addMany(parsed.usages);
            index.addElementTags(parsed.tags);
            dynamicPatterns.push(...parsed.dynamicPatterns);

            const bundle = bundleFor(file);
            bundle.renderedTags.push(...parsed.tags);
            if (['.vue', '.svelte', '.astro'].includes(extension)) {
                bundle.ownsInlineStyles = true;
            }

            const masked = maskToStyleBlocks(text);
            if (masked.found > 0) {
                const parsedStyle = parseCssText(file, masked.text, {
                    ignoreComment: config.ignoreComment,
                    analyzeElements: config.analyzeElements,
                    analyzeIds: config.analyzeIds,
                    syntax: 'auto',
                });
                counts.css++;
                counts.parseErrors += parsedStyle.parseErrors;
                rules.push(...parsedStyle.rules);
                elementSelectors.push(...parsedStyle.elementSelectors);
                dynamicPatterns.push(...parsedStyle.dynamicPatterns);
            }
        }

        if (isScript || isMarkup) {
            const parsed = parseJsUsage(file, text, { maxSourceFileSizeKb: 2048, analyzeIds: true });
            counts.script++;
            index.addMany(parsed.usages);
            dynamicPatterns.push(...parsed.dynamicPatterns);

            const bundle = bundleFor(file);
            bundle.imports.push(...(parsed.imports ?? []));
            bundle.renderedTags.push(...(parsed.childComponents ?? []).filter(isComponentTag));
            (parsed.imports ?? [])
                .filter((specifier) => /\.(css|scss|sass|less|styl)$/i.test(specifier))
                .forEach((specifier) => {
                    const resolved = resolveRelativeImport(file, specifier, knownFiles);
                    if (resolved) {
                        bundle.styleFiles.push(resolved);
                    }
                });
        }

        if (extension === '.ts' || extension === '.js') {
            const parsed = parseAngularFile(file, text, {
                findFileByBasename: (basename) => basenameLookup.get(basename.toLowerCase()),
            });
            if (parsed.components.length > 0) {
                counts.angular++;
            }
            index.addMany(parsed.usages);
            index.addElementTags(parsed.tags);
            index.addElementTags(parsed.componentSelectors);
            dynamicPatterns.push(...parsed.dynamicPatterns);

            const bundle = bundleFor(file);
            bundle.renderedTags.push(...parsed.tags);
            bundle.angularComponents.push(
                ...parsed.components.map((component) => ({
                    selector: component.selector,
                    styleFiles: component.styleFiles,
                })),
            );
            bundle.templateFiles.push(
                ...parsed.components
                    .map((component) => component.resolvedTemplatePath)
                    .filter((template) => typeof template === 'string' && template.length > 0),
            );
        }
    }

    index.configurePatterns(dynamicPatterns);

    const graph = ComponentGraph.build(toGraphInputs([...bundles.values()]), {
        mode: config.componentScope,
        resolveImport: (fromFile, specifier) => resolveRelativeImport(fromFile, specifier, knownFiles),
    });

    const computation = computeUnused(
        rules.map((rule) => ({
            file: rule.file,
            selector: rule.resolvedSelector || rule.selector,
            declarations: rule.declarations,
            ignored: rule.ignored,
        })),
        index,
        config.analysisMode,
        { resolveScope: (styleFile) => graph.scopeFor(styleFile) },
    );
    const elementFindings = config.analyzeElements ? computeUnusedElements(elementSelectors, index) : [];

    const analysisResult = {
        findings: computation.findings,
        rules,
        stats: {
            cssFiles: counts.css,
            jsFiles: counts.script,
            markupFiles: counts.markup,
            angularFiles: counts.angular,
            cacheHits: 0,
            cacheMisses: 0,
            parseErrors: counts.parseErrors,
            selectors: rules.reduce((sum, rule) => sum + rule.declarations.length, 0),
            uniqueTokens: index.size,
            usages: index.usageCount,
            durationMs: 0,
            phases: { discoveryMs: 0, parseMs: 0, compareMs: 0 },
            cancelled: false,
        },
        ignoredRuleCount: rules.filter((rule) => rule.ignored).length,
        elementFindings,
        outsideScope: computation.outsideScope,
        components: graph.summary(),
    };

    if (flags.has('--report')) {
        console.log(
            buildComponentReportMarkdown(analysisResult, {
                workspaceName: path.basename(folder),
                analysisMode: config.analysisMode,
                scopeMode: config.componentScope,
            }),
        );
        return;
    }

    if (flags.has('--json')) {
        console.log(
            JSON.stringify(
                {
                    folder,
                    mode: config.analysisMode,
                    counts,
                    dead: computation.findings.map((finding) => ({
                        token: `${finding.declaration.type === 'id' ? '#' : '.'}${finding.declaration.name}`,
                        selector: finding.rule.resolvedSelector || finding.rule.selector,
                        file: finding.declaration.file,
                        line: finding.declaration.line,
                        partial: finding.isPartialSelector,
                    })),
                    deadElements: elementFindings.map((entry) => entry.name),
                },
                null,
                2,
            ),
        );
        return;
    }

    const relative = (file) => path.relative(folder, file) || file;

    console.log(`Dead CSS Cleaner - standalone analysis`);
    console.log(`Folder: ${folder}`);
    console.log(`Mode:   ${config.analysisMode}${config.analyzeElements ? ' (+ element selectors)' : ''}`);
    console.log(
        `Files:  ${counts.css} style, ${counts.script} script, ${counts.markup} markup, ${counts.angular} Angular component(s)`,
    );
    console.log(`Usages indexed: ${index.usageCount} in ${index.size} unique token(s)`);
    if (counts.parseErrors > 0) {
        console.log(`Recovered parse issues: ${counts.parseErrors}`);
    }
    console.log('');

    if (computation.findings.length === 0 && elementFindings.length === 0) {
        console.log('No dead CSS found.');
        return;
    }

    const grouped = new Map();
    computation.findings.forEach((finding) => {
        const list = grouped.get(finding.declaration.file) || [];
        list.push(finding);
        grouped.set(finding.declaration.file, list);
    });

    for (const [file, findings] of [...grouped.entries()].sort()) {
        console.log(`${relative(file)}`);
        findings
            .sort((a, b) => a.declaration.line - b.declaration.line)
            .forEach((finding) => {
                const token = `${finding.declaration.type === 'id' ? '#' : '.'}${finding.declaration.name}`;
                const scope = finding.isPartialSelector ? 'partially dead' : 'fully dead';
                console.log(
                    `  ${String(finding.declaration.line).padStart(5)}  ${token.padEnd(28)} ${scope}  (${finding.rule.resolvedSelector || finding.rule.selector})`,
                );
            });
        console.log('');
    }

    if (elementFindings.length > 0) {
        console.log('Unused element selectors:');
        elementFindings.forEach((entry) => {
            console.log(`  ${relative(entry.element.file)}:${entry.element.line}  <${entry.name}>`);
        });
    }

    console.log(`Total dead selector tokens: ${computation.findings.length}`);
}

main();
