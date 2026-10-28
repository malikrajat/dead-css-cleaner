/**
 * Orchestrates a full analysis run: discover files, parse them (with caching
 * and cancellation), then compare CSS declarations against real usages.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AnalysisCache, type CacheStats } from '../core/cache';
import type { ExtensionConfig } from '../core/config';
import { ErrorCollector, errorMessage } from '../core/errors';
import { logger } from '../core/logger';
import { looksBinary } from '../core/textUtils';
import type { AnalysisResult, AnalysisStats, CssFileResult, CssRuleInfo, Detection, UsageResult } from '../core/types';
import { type AngularParseResult, parseAngularFile } from '../parsers/angularParser';
import { maskToStyleBlocks, parseCssText, syntaxForFile } from '../parsers/cssParser';
import { parseJsUsage } from '../parsers/jsUsageParser';
import { type MarkupParseResult, parseMarkupText } from '../parsers/markupParser';
import { ComponentGraph } from './componentGraph';
import {
    type ComponentFileBundle,
    isComponentTag,
    resolveRelativeImport,
    toGraphInputs,
    toKnownFiles,
} from './graphBuilder';
import { computeUnused, computeUnusedElements, UsageIndex } from './usageIndex';

interface FileBundleResult {
    file: string;
    css?: CssFileResult;
    styleCss?: CssFileResult;
    script?: UsageResult;
    markup?: MarkupParseResult;
    angular?: AngularParseResult;
    skipped?: string;
}

export interface AnalyzeOptions {
    cancellationToken?: vscode.CancellationToken;
    onProgress?: (message: string, increment: number) => void;
    /** Restrict *reported* findings to these CSS files (usage is still global). */
    onlyCssFiles?: Set<string>;
}

export class CssAnalyzer {
    private cache: AnalysisCache<FileBundleResult>;
    private lastUsageIndex: UsageIndex | undefined;
    private lastComponentGraph: ComponentGraph | undefined;

    constructor(private config: ExtensionConfig) {
        this.cache = new AnalysisCache<FileBundleResult>(config.cacheTimeout, config.enableCaching);
    }

    updateConfig(config: ExtensionConfig): void {
        this.config = config;
        this.cache.configure(config.cacheTimeout, config.enableCaching);
    }

    clearCache(): void {
        this.cache.clear();
    }

    getCacheStats(): CacheStats {
        return this.cache.getStats();
    }

    invalidateFile(file: string): void {
        this.cache.invalidate(file);
    }

    /** Usage index produced by the most recent successful run. */
    getLastUsageIndex(): UsageIndex | undefined {
        return this.lastUsageIndex;
    }

    /** Component graph produced by the most recent successful run. */
    getLastComponentGraph(): ComponentGraph | undefined {
        return this.lastComponentGraph;
    }

    async analyze(options: AnalyzeOptions = {}): Promise<AnalysisResult> {
        const startedAt = Date.now();
        const statistics: AnalysisStats = {
            cssFiles: 0,
            jsFiles: 0,
            markupFiles: 0,
            angularFiles: 0,
            cacheHits: 0,
            cacheMisses: 0,
            parseErrors: 0,
            selectors: 0,
            uniqueTokens: 0,
            usages: 0,
            durationMs: 0,
            phases: { discoveryMs: 0, parseMs: 0, compareMs: 0 },
            cancelled: false,
        };

        const emptyResult: AnalysisResult = {
            findings: [],
            rules: [],
            stats: statistics,
            ignoredRuleCount: 0,
            elementFindings: [],
            outsideScope: [],
            components: [],
        };

        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            statistics.durationMs = Date.now() - startedAt;
            return emptyResult;
        }

        const discoveryStart = Date.now();
        let discovered: { css: string[]; script: string[]; markup: string[] };
        try {
            discovered = await this.discoverFiles();
        } catch (error) {
            ErrorCollector.from('file-access', 'Failed to scan workspace files', error, { recoverable: false });
            statistics.durationMs = Date.now() - startedAt;
            return emptyResult;
        }
        statistics.phases.discoveryMs = Date.now() - discoveryStart;

        const styleBearingFiles =
            discovered.css.length +
            discovered.markup.filter((file) =>
                this.extensionsInclude(this.config.componentFileTypes, path.extname(file).toLowerCase()),
            ).length;

        if (styleBearingFiles < this.config.minFilesForAnalysis) {
            logger.info(
                `Skipping analysis: found ${styleBearingFiles} style-bearing file(s), minimum configured is ${this.config.minFilesForAnalysis}`,
            );
            statistics.cssFiles = styleBearingFiles;
            statistics.durationMs = Date.now() - startedAt;
            return emptyResult;
        }

        const allFiles = new Set<string>([...discovered.css, ...discovered.script, ...discovered.markup]);
        const orderedFiles = [...allFiles];

        logger.info(
            `Analysis started: ${discovered.css.length} CSS, ${discovered.script.length} script, ${discovered.markup.length} markup file(s)`,
        );

        if (orderedFiles.length === 0) {
            statistics.durationMs = Date.now() - startedAt;
            return emptyResult;
        }

        const basenameLookup = this.buildBasenameLookup(allFiles);
        const bundles: FileBundleResult[] = [];
        const _total = orderedFiles.length;
        let processed = 0;
        const chunkSize = Math.max(Math.min(this.config.maxConcurrentFiles, 64), 1);

        for (let i = 0; i < orderedFiles.length; i += chunkSize) {
            if (options.cancellationToken?.isCancellationRequested) {
                statistics.cancelled = true;
                break;
            }

            const chunk = orderedFiles.slice(i, i + chunkSize);
            const results = await Promise.all(
                chunk.map(async (file) => {
                    const bundle = await this.parseFile(file, basenameLookup);
                    processed++;
                    options.onProgress?.(`Analyzing ${path.basename(file)}`, 1);
                    return bundle;
                }),
            );
            bundles.push(...results);

            // Let the UI breathe on very large workspaces.
            if (processed % (chunkSize * 4) === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }

        const parsePhaseStart = Date.now();

        const rules: CssRuleInfo[] = [];
        const elementSelectors: Array<{ name: string; rule: CssRuleInfo }> = [];
        const dynamicPatterns: string[] = [];
        const index = new UsageIndex(this.config);

        for (const bundle of bundles) {
            if (!bundle) {
                continue;
            }

            const cssResults = [bundle.css, bundle.styleCss].filter(Boolean) as CssFileResult[];
            for (const cssResult of cssResults) {
                if (!cssResult) {
                    continue;
                }
                statistics.cssFiles += 1;
                statistics.parseErrors += cssResult.parseErrors;
                dynamicPatterns.push(...(cssResult.dynamicPatterns ?? []));
                if (options.onlyCssFiles && !options.onlyCssFiles.has(cssResult.file)) {
                    continue;
                }
                rules.push(...cssResult.rules);
                elementSelectors.push(...(cssResult.elementSelectors ?? []));
            }

            if (bundle.script) {
                statistics.jsFiles += 1;
                if (bundle.script.error) {
                    statistics.parseErrors += 1;
                }
                index.addMany(bundle.script.usages);
                dynamicPatterns.push(...(bundle.script.dynamicPatterns ?? []));
            }

            if (bundle.markup) {
                statistics.markupFiles += 1;
                index.addMany(bundle.markup.usages);
                dynamicPatterns.push(...(bundle.markup.dynamicPatterns ?? []));
                index.addElementTags(bundle.markup.tags);
            }

            if (bundle.angular) {
                statistics.angularFiles += 1;
                index.addMany(bundle.angular.usages);
                dynamicPatterns.push(...(bundle.angular.dynamicPatterns ?? []));
                index.addElementTags(bundle.angular.tags);
                index.addElementTags(bundle.angular.componentSelectors);
            }
        }

        statistics.phases.parseMs = Date.now() - parsePhaseStart;
        statistics.usages = index.usageCount;

        index.configurePatterns(dynamicPatterns);
        this.lastUsageIndex = index;

        const knownFiles = toKnownFiles(allFiles);
        const componentBundles = bundles
            .filter((bundle): bundle is FileBundleResult => Boolean(bundle))
            .map((bundle) => this.toComponentBundle(bundle, knownFiles));
        const graph = ComponentGraph.build(toGraphInputs(componentBundles), {
            mode: this.config.componentScope,
            resolveImport: (fromFile, specifier) => resolveRelativeImport(fromFile, specifier, knownFiles),
        });
        this.lastComponentGraph = graph;

        const compareStart = Date.now();
        const computation = computeUnused(
            rules.map((rule) => ({
                file: rule.file,
                selector: rule.resolvedSelector || rule.selector,
                declarations: rule.declarations,
                ignored: rule.ignored,
            })),
            index,
            this.config.analysisMode,
            { resolveScope: (styleFile) => graph.scopeFor(styleFile) },
        );

        const elementFindings = this.config.analyzeElements ? computeUnusedElements(elementSelectors, index) : [];
        statistics.selectors = rules.reduce((sum, rule) => sum + rule.declarations.length, 0);
        statistics.uniqueTokens = new Set(
            rules.flatMap((rule) => rule.declarations.map((d) => `${d.type}:${d.name}`)),
        ).size;
        statistics.phases.compareMs = Date.now() - compareStart;
        statistics.durationMs = Date.now() - startedAt;
        statistics.cacheHits = this.cache.getStats().hits;
        statistics.cacheMisses = this.cache.getStats().misses;

        logger.info(
            `Analysis finished in ${statistics.durationMs}ms: ${statistics.selectors} declarations, ` +
                `${computation.findings.length} unused token(s), ${statistics.parseErrors} parse error(s)`,
        );

        return {
            findings: computation.findings,
            rules,
            stats: statistics,
            ignoredRuleCount: computation.ignoredFindings + rules.filter((rule) => rule.ignored).length,
            elementFindings,
            outsideScope: computation.outsideScope,
            components: graph.summary(),
        };
    }

    /**
     * Describe one parsed file for the component graph: which stylesheets it
     * owns, which components it renders, and what it imports.
     */
    private toComponentBundle(bundle: FileBundleResult, knownFiles: Map<string, string>): ComponentFileBundle {
        const extension = path.extname(bundle.file).toLowerCase();
        const imports = bundle.script?.imports ?? [];
        const styleFiles: string[] = [];

        imports.forEach((specifier) => {
            if (!/\.(css|scss|sass|less|styl)$/i.test(specifier)) {
                return;
            }
            const resolved = resolveRelativeImport(bundle.file, specifier, knownFiles);
            if (resolved) {
                styleFiles.push(resolved);
            }
        });

        return {
            file: bundle.file,
            styleFiles,
            templateFiles: (bundle.angular?.components ?? [])
                .map((component) => component.resolvedTemplatePath)
                .filter((template): template is string => typeof template === 'string' && template.length > 0),
            angularComponents: (bundle.angular?.components ?? []).map((component) => ({
                selector: component.selector,
                styleFiles: component.styleFiles,
            })),
            renderedTags: [
                ...(bundle.markup?.tags ?? []),
                ...(bundle.angular?.tags ?? []),
                ...(bundle.script?.childComponents ?? []).filter(isComponentTag),
            ],
            imports,
            // Only single-file components own their inline styles. A plain
            // `index.html` + `styles.css` project stays global on purpose.
            ownsInlineStyles: Boolean(bundle.styleCss) && ['.vue', '.svelte', '.astro'].includes(extension),
        };
    }

    private async discoverFiles(): Promise<{ css: string[]; script: string[]; markup: string[] }> {
        const exclude = `{${this.config.excludePatterns.join(',')}}`;
        const find = async (extensions: string[]): Promise<string[]> => {
            const normalized = extensions
                .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`))
                .filter((ext) => ext.length > 1);
            if (normalized.length === 0) {
                return [];
            }
            const pattern = `**/*{${normalized.join(',')}}`;
            const uris = await vscode.workspace.findFiles(pattern, exclude, 20000);
            return uris.map((uri) => uri.fsPath);
        };

        const [css, script, markup] = await Promise.all([
            find(this.config.includeFileTypes),
            find(this.config.componentFileTypes),
            find(this.config.markupFileTypes),
        ]);

        return {
            css: dedupePaths(css),
            script: dedupePaths(script),
            markup: dedupePaths(markup),
        };
    }

    private buildBasenameLookup(files: Set<string>): Map<string, string> {
        const lookup = new Map<string, string>();
        files.forEach((file) => {
            const base = path.basename(file).toLowerCase();
            if (!lookup.has(base)) {
                lookup.set(base, file);
            }
        });
        return lookup;
    }

    private async parseFile(file: string, basenameLookup: Map<string, string>): Promise<FileBundleResult> {
        const cached = this.cache.get(file);
        if (cached) {
            logger.debug(`Cache hit: ${file}`);
            return cached;
        }

        const bundle: FileBundleResult = { file };

        try {
            const stats = await fs.promises.stat(file);
            const extension = path.extname(file).toLowerCase();
            const isCss = this.extensionsInclude(this.config.includeFileTypes, extension);
            const limitKb = isCss ? this.config.maxCssFileSizeKb : this.config.maxSourceFileSizeKb;

            if (stats.isDirectory()) {
                bundle.skipped = 'directory';
                return bundle;
            }
            if (stats.size > limitKb * 1024) {
                bundle.skipped = `larger than ${limitKb}KB`;
                logger.warn(`Skipping ${file}: ${bundle.skipped}`);
                return bundle;
            }

            const text = await fs.promises.readFile(file, 'utf8');
            if (!text.trim() || looksBinary(text)) {
                bundle.skipped = 'empty or binary';
                return bundle;
            }

            if (isCss) {
                bundle.css = parseCssText(file, text, {
                    ignoreComment: this.config.ignoreComment,
                    analyzeElements: this.config.analyzeElements,
                    analyzeIds: this.config.analyzeIds,
                    syntax: syntaxForFile(extension),
                });
            }

            const isScript = this.extensionsInclude(this.config.componentFileTypes, extension);
            const isMarkup = this.extensionsInclude(this.config.markupFileTypes, extension);
            const isAngularCandidate = extension === '.ts' || extension === '.js';

            if (isMarkup) {
                bundle.markup = parseMarkupText(file, text);

                // SFC / inline <style> blocks.
                const styleBlocks = maskToStyleBlocks(text);
                if (styleBlocks.found > 0) {
                    bundle.styleCss = parseCssText(file, styleBlocks.text, {
                        ignoreComment: this.config.ignoreComment,
                        analyzeElements: this.config.analyzeElements,
                        analyzeIds: this.config.analyzeIds,
                        syntax: 'auto',
                    });
                }
            }

            if (isScript || isMarkup) {
                bundle.script = parseJsUsage(file, text, {
                    maxSourceFileSizeKb: this.config.maxSourceFileSizeKb,
                    analyzeIds: this.config.analyzeIds,
                });
            }

            if (isAngularCandidate) {
                bundle.angular = parseAngularFile(file, text, {
                    findFileByBasename: (basename) => basenameLookup.get(basename.toLowerCase()),
                });
            }
        } catch (error) {
            ErrorCollector.from('file-access', `Failed to read/parse ${file}`, error, { file, recoverable: true });
            bundle.skipped = errorMessage(error);
        }

        this.cache.set(file, bundle);
        return bundle;
    }

    private extensionsInclude(extensions: string[], extension: string): boolean {
        return extensions
            .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`).toLowerCase())
            .includes(extension.toLowerCase());
    }
}

export function collectUnusedTokens(result: AnalysisResult): Detection[] {
    return result.findings.map((finding) => finding.declaration);
}

function dedupePaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    paths.forEach((file) => {
        const key = file.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(file);
        }
    });
    return unique;
}
