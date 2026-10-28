/**
 * Shared test helper: runs the real parsing + comparison pipeline without VS Code.
 *
 * It mirrors the analyzer: same parsers, same usage index, same component graph
 * and same scope resolution, so a test can assert on the exact set of dead
 * selectors *and* on what happened to tokens used only outside a component.
 */

import * as path from 'node:path';
import { ComponentGraph, type ComponentScopeMode } from '../../analysis/componentGraph';
import {
    type ComponentFileBundle,
    isComponentTag,
    resolveRelativeImport,
    toGraphInputs,
    toKnownFiles,
} from '../../analysis/graphBuilder';
import { computeUnused, computeUnusedElements, UsageIndex } from '../../analysis/usageIndex';
import { DEFAULT_CONFIG, type ExtensionConfig, normalizeConfig } from '../../core/config';
import type { ComponentSummary, Detection } from '../../core/types';
import { parseAngularFile } from '../../parsers/angularParser';
import { maskToStyleBlocks, parseCssText, syntaxForFile } from '../../parsers/cssParser';
import { parseJsUsage } from '../../parsers/jsUsageParser';
import { parseMarkupText } from '../../parsers/markupParser';

export interface Fixture {
    css?: Array<{ file: string; text: string }>;
    scripts?: Array<{ file: string; text: string }>;
    markup?: Array<{ file: string; text: string }>;
    angular?: Array<{ file: string; text: string }>;
    /** Component metadata that cannot be inferred from file contents. */
    components?: Array<{
        file: string;
        styleFiles?: string[];
        templateFiles?: string[];
        selectors?: string[];
        renderedTags?: string[];
        imports?: string[];
    }>;
}

/**
 * Absolute, platform-native path for a fixture file.
 *
 * Fixtures are written with readable POSIX paths (`/tmp/src/app/card.ts`), but
 * the parsers resolve relative imports with `path.resolve`, so on Windows the
 * two would never match. Resolving every fixture path up front mirrors what the
 * analyzer sees in a real workspace.
 */
export function fixturePath(file: string): string {
    return path.resolve(file);
}

export interface FixtureResult {
    /** Dead tokens, e.g. `['.title', '#legacy']`. */
    dead: string[];
    deadNames: string[];
    /** Dead element selectors when `analyzeElements` is on. */
    deadElements: string[];
    partial: string[];
    /** Tokens used in the workspace, but only outside the owning component's tree. */
    usedElsewhere: string[];
    index: UsageIndex;
    config: ExtensionConfig;
    components: ComponentSummary[];
}

export function analyzeFixture(fixture: Fixture, overrides: Partial<ExtensionConfig> = {}): FixtureResult {
    const { config } = normalizeConfig({ ...DEFAULT_CONFIG, ...overrides });
    const index = new UsageIndex(config);
    const rules: Array<{ file: string; selector: string; declarations: Detection[]; ignored: boolean }> = [];
    const elementSelectors: Array<{ name: string; rule: any }> = [];
    const dynamicPatterns: string[] = [];

    const cssEntries = (fixture.css ?? []).map((entry) => ({ ...entry, file: fixturePath(entry.file) }));
    const scriptEntries = (fixture.scripts ?? []).map((entry) => ({ ...entry, file: fixturePath(entry.file) }));
    const markupEntries = (fixture.markup ?? []).map((entry) => ({ ...entry, file: fixturePath(entry.file) }));
    const angularEntries = (fixture.angular ?? []).map((entry) => ({ ...entry, file: fixturePath(entry.file) }));
    const componentEntries = (fixture.components ?? []).map((entry) => ({
        ...entry,
        file: fixturePath(entry.file),
        styleFiles: (entry.styleFiles ?? []).map(fixturePath),
        templateFiles: (entry.templateFiles ?? []).map(fixturePath),
    }));

    const bundles = new Map<string, ComponentFileBundle>();
    const knownFiles = toKnownFiles([
        ...cssEntries.map((entry) => entry.file),
        ...scriptEntries.map((entry) => entry.file),
        ...markupEntries.map((entry) => entry.file),
        ...angularEntries.map((entry) => entry.file),
        ...componentEntries.map((entry) => entry.file),
    ]);

    const bundleFor = (file: string): ComponentFileBundle => {
        const existing = bundles.get(file);
        if (existing) {
            return existing;
        }
        const created: ComponentFileBundle = {
            file,
            styleFiles: [],
            templateFiles: [],
            angularComponents: [],
            renderedTags: [],
            imports: [],
            ownsInlineStyles: false,
        };
        bundles.set(file, created);
        return created;
    };

    const resolveStyleImports = (file: string, imports: string[]): string[] =>
        imports
            .filter((specifier) => /\.(css|scss|sass|less|styl)$/i.test(specifier))
            .map((specifier) => resolveRelativeImport(file, specifier, knownFiles))
            .filter((resolved): resolved is string => Boolean(resolved));

    cssEntries.forEach((entry) => {
        // Mirrors the analyzer: files that are not CSS (HTML/Vue/Svelte/Astro)
        // only contribute their `<style>` blocks.
        const extension = path.extname(entry.file).toLowerCase();
        const isCssFile = ['.css', '.scss', '.sass', '.less'].includes(extension);
        let text = entry.text;
        if (!isCssFile) {
            const masked = maskToStyleBlocks(entry.text);
            if (masked.found === 0) {
                return;
            }
            text = masked.text;
        }

        const parsed = parseCssText(entry.file, text, {
            ignoreComment: config.ignoreComment,
            analyzeElements: config.analyzeElements,
            analyzeIds: config.analyzeIds,
            syntax: isCssFile ? syntaxForFile(extension) : 'auto',
        });
        parsed.rules.forEach((rule) =>
            rules.push({
                file: rule.file,
                selector: rule.resolvedSelector || rule.selector,
                declarations: rule.declarations,
                ignored: rule.ignored,
            }),
        );
        elementSelectors.push(...parsed.elementSelectors);
        dynamicPatterns.push(...parsed.dynamicPatterns);

        if (!isCssFile && ['.vue', '.svelte', '.astro'].includes(extension)) {
            bundleFor(entry.file).ownsInlineStyles = true;
        }
    });

    scriptEntries.forEach((entry) => {
        const parsed = parseJsUsage(entry.file, entry.text, { maxSourceFileSizeKb: 2048, analyzeIds: true });
        index.addMany(parsed.usages);
        dynamicPatterns.push(...parsed.dynamicPatterns);

        const bundle = bundleFor(entry.file);
        bundle.imports.push(...(parsed.imports ?? []));
        bundle.renderedTags.push(...(parsed.childComponents ?? []).filter(isComponentTag));
        bundle.styleFiles.push(...resolveStyleImports(entry.file, parsed.imports ?? []));
    });

    markupEntries.forEach((entry) => {
        const parsed = parseMarkupText(entry.file, entry.text);
        index.addMany(parsed.usages);
        index.addElementTags(parsed.tags);
        dynamicPatterns.push(...parsed.dynamicPatterns);

        const bundle = bundleFor(entry.file);
        bundle.renderedTags.push(...parsed.tags);
        if (/\.(vue|svelte|astro)$/i.test(entry.file)) {
            bundle.ownsInlineStyles = true;
        }
    });

    angularEntries.forEach((entry) => {
        const parsed = parseAngularFile(entry.file, entry.text);
        index.addMany(parsed.usages);
        index.addElementTags(parsed.tags);
        index.addElementTags(parsed.componentSelectors);
        dynamicPatterns.push(...parsed.dynamicPatterns);

        const bundle = bundleFor(entry.file);
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
                .filter((template): template is string => typeof template === 'string' && template.length > 0),
        );
    });

    componentEntries.forEach((entry) => {
        const bundle = bundleFor(entry.file);
        bundle.styleFiles.push(...(entry.styleFiles ?? []));
        bundle.templateFiles.push(...(entry.templateFiles ?? []));
        bundle.renderedTags.push(...(entry.renderedTags ?? []));
        bundle.imports.push(...(entry.imports ?? []));
        bundle.angularComponents.push(
            ...(entry.selectors ?? []).map((selector) => ({ selector, styleFiles: entry.styleFiles ?? [] })),
        );
    });

    index.configurePatterns(dynamicPatterns);

    const graph = ComponentGraph.build(toGraphInputs([...bundles.values()]), {
        mode: config.componentScope as ComponentScopeMode,
        resolveImport: (fromFile, specifier) => resolveRelativeImport(fromFile, specifier, knownFiles),
    });

    const computation = computeUnused(rules, index, config.analysisMode, {
        resolveScope: (styleFile) => graph.scopeFor(styleFile),
    });

    const dead = computation.findings.map(labelOf);
    const deadNames = computation.findings.map((finding) => finding.declaration.name);
    const partial = computation.findings
        .filter((finding) => finding.isPartialSelector)
        .map((finding) => finding.declaration.name);
    const usedElsewhere = computation.outsideScope.map(labelOf);
    const deadElements = config.analyzeElements
        ? computeUnusedElements(elementSelectors, index).map((entry) => entry.name)
        : [];

    return {
        dead,
        deadNames,
        partial,
        deadElements,
        usedElsewhere,
        index,
        config,
        components: graph.summary(),
    };
}

export function unique<T>(values: T[]): T[] {
    return [...new Set(values)];
}

function labelOf(finding: { declaration: Detection }): string {
    const prefix = finding.declaration.type === 'id' ? '#' : '.';
    return `${prefix}${finding.declaration.name}`;
}
