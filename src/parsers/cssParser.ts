/**
 * CSS/SCSS/LESS parser.
 *
 * Produces, for every comma-separated selector branch, the class/id tokens it
 * declares together with an exact source position. Nested (SCSS/LESS) rules are
 * resolved so `&__title` inside `.card` yields `card__title`, and descendant
 * selectors such as `.card .title span` keep all of their tokens.
 */

import { type ChildNode, type Node, parse as parsePostCss, type Root, type Rule } from 'postcss';
import * as lessSyntax from 'postcss-less';
import * as scssSyntax from 'postcss-scss';
import selectorParser from 'postcss-selector-parser';
import { ErrorCollector, errorMessage } from '../core/errors';
import { logger } from '../core/logger';
import { extractDynamicPrefixes, findMatches, isValidClassToken, LineIndex } from '../core/textUtils';
import type { CssFileResult, CssRuleInfo, Detection, TokenType } from '../core/types';

export interface CssParseOptions {
    ignoreComment: string;
    analyzeElements: boolean;
    analyzeIds: boolean;
    /** Which syntax parser to try first. Defaults to `auto`. */
    syntax?: CssSyntax;
}

export type CssSyntax = 'css' | 'scss' | 'less' | 'auto';

/** Pick the syntax parser from a file extension. */
export function syntaxForFile(extension: string): CssSyntax {
    switch (extension.toLowerCase()) {
        case '.scss':
        case '.sass':
            return 'scss';
        case '.less':
            return 'less';
        default:
            return 'auto';
    }
}

interface ParserCandidate {
    name: string;
    parse: (text: string, options: { from: string }) => Root;
}

function parserCandidates(syntax: CssSyntax): ParserCandidate[] {
    const css: ParserCandidate = { name: 'css', parse: (text, options) => parsePostCss(text, options) };
    const scss: ParserCandidate = { name: 'scss', parse: (text, options) => scssSyntax.parse(text, options) };
    const less: ParserCandidate = { name: 'less', parse: (text, options) => lessSyntax.parse(text, options) };

    switch (syntax) {
        case 'scss':
            return [scss, css, less];
        case 'less':
            return [less, css, scss];
        default:
            return [css, scss, less];
    }
}

/** At-rules whose child rules are not normal selectors. */
const NON_SELECTOR_AT_RULES = new Set([
    'keyframes',
    '-webkit-keyframes',
    '-moz-keyframes',
    '-o-keyframes',
    'font-face',
    'page',
    'property',
    'counter-style',
    'viewport',
    'font-feature-values',
    'swash',
    'ornaments',
    'annotation',
    'stylistic',
    'styleset',
    'character-variant',
]);

/** Tags that always exist because the browser provides them. */
export const GLOBAL_TAGS = new Set([
    'html',
    'body',
    'head',
    'style',
    'script',
    'meta',
    'link',
    'title',
    'base',
    'noscript',
    'template',
    '*',
]);

interface Branch {
    text: string;
    /** Offset of the branch text, relative to the rule's selector start. */
    offset: number;
}

export function parseCssText(filePath: string, text: string, options: CssParseOptions): CssFileResult {
    const result: CssFileResult = {
        file: filePath,
        rules: [],
        dynamicPatterns: [],
        elementSelectors: [],
        ignoredRuleCount: 0,
        parseErrors: 0,
    };

    if (!text?.trim()) {
        return result;
    }

    const lineIndex = new LineIndex(text);
    const ignoreMarker = (options.ignoreComment || 'dead-css-ignore').toLowerCase();
    const ignoreInfo = collectIgnoreInfo(text, ignoreMarker);

    let root: Root | undefined;
    let lastError: unknown;
    for (const candidate of parserCandidates(options.syntax ?? 'auto')) {
        try {
            root = candidate.parse(text, { from: filePath });
            if (candidate.name !== 'css') {
                logger.debug(`Parsed ${filePath} with the ${candidate.name} syntax parser`);
            }
            break;
        } catch (error) {
            lastError = error;
            logger.debug(`${candidate.name} parser failed for ${filePath}`, errorMessage(error));
        }
    }

    if (!root) {
        const error = lastError;
        result.parseErrors++;
        result.parseError = errorMessage(error);
        ErrorCollector.from('css-parse', `Failed to parse CSS: ${filePath}`, error, {
            file: filePath,
            recoverable: true,
        });
        logger.warn(`CSS parse failed, falling back to tolerant scan: ${filePath}`, result.parseError);

        // Degraded mode: still try to find selectors so the user gets results.
        try {
            extractWithFallback(filePath, text, lineIndex, options, result, ignoreInfo);
        } catch (fallbackError) {
            logger.error(`Tolerant CSS scan failed: ${filePath}`, errorMessage(fallbackError));
        }
        return result;
    }

    const walk = (node: Node, ancestors: string[]): void => {
        if (node.type === 'rule') {
            const rule = node as Rule;
            try {
                processRule(rule, ancestors, filePath, text, lineIndex, options, result, ignoreInfo);
            } catch (error) {
                result.parseErrors++;
                logger.warn(`Failed to process CSS rule in ${filePath}`, errorMessage(error));
            }
        }

        const children = (node as Root | Rule | { nodes?: ChildNode[] }).nodes;
        if (!children) {
            return;
        }

        for (const child of children) {
            if (child.type === 'atrule') {
                const atName = (child as { name?: string }).name?.toLowerCase() ?? '';
                if (NON_SELECTOR_AT_RULES.has(atName)) {
                    continue;
                }
            }
            if (child.type === 'rule') {
                const nextAncestors = [...ancestors, (child as Rule).selector];
                walk(child, nextAncestors);
            } else {
                walk(child, ancestors);
            }
        }
    };

    try {
        walk(root, []);
    } catch (error) {
        result.parseErrors++;
        ErrorCollector.from('css-parse', `Failed while walking CSS AST: ${filePath}`, error, {
            file: filePath,
            recoverable: true,
        });
    }

    result.dynamicPatterns = [...new Set(result.dynamicPatterns)];
    return result;
}

interface IgnoreInfo {
    fileIgnored: boolean;
    lines: Set<number>;
}

function collectIgnoreInfo(text: string, marker: string): IgnoreInfo {
    const info: IgnoreInfo = { fileIgnored: false, lines: new Set<number>() };
    if (!marker) {
        return info;
    }

    const lines = text.split(/\r?\n/);
    const nextLinePattern = new RegExp(`${escapeForRegex(marker)}\\s*-?\\s*next`, 'i');
    const filePattern = new RegExp(`${escapeForRegex(marker)}\\s*-?\\s*file`, 'i');
    const anyPattern = new RegExp(escapeForRegex(marker), 'i');

    lines.forEach((line, index) => {
        if (!anyPattern.test(line)) {
            return;
        }
        if (filePattern.test(line)) {
            info.fileIgnored = true;
            return;
        }
        // Marker on the selector line itself, or directly above the selector.
        info.lines.add(index + 1);
        info.lines.add(index + 2);
        if (nextLinePattern.test(line)) {
            info.lines.add(index + 2);
        }
    });

    return info;
}

function processRule(
    rule: Rule,
    ancestors: string[],
    filePath: string,
    text: string,
    lineIndex: LineIndex,
    options: CssParseOptions,
    result: CssFileResult,
    ignoreInfo: IgnoreInfo,
): void {
    const startLine = rule.source?.start?.line ?? 0;
    const startColumn = rule.source?.start?.column ?? 1;
    const selectorStartOffset =
        rule.source?.start?.offset !== undefined
            ? rule.source.start.offset
            : lineIndex.offsetOf(startLine, startColumn);
    const ruleEndOffset = rule.source?.end?.offset ?? selectorStartOffset + rule.selector.length;

    const parentAncestors = ancestors.slice(0, -1);
    const resolvedAncestors = resolveChain(parentAncestors);

    const branches = splitBranches(rule.selector);
    if (branches.length === 0) {
        return;
    }

    for (const branch of branches) {
        const branchOffset = selectorStartOffset + branch.offset;
        const branchLine = lineIndex.positionAt(branchOffset);

        const ignored =
            ignoreInfo.fileIgnored ||
            ignoreInfo.lines.has(branchLine.line) ||
            ignoreInfo.lines.has(branchLine.line - 1);

        const declarations: Detection[] = [];
        const dynamicPatterns: string[] = [];
        const tags: string[] = [];
        let hasPseudoOnlySelector = false;

        const collect = (
            selectorText: string,
            baseOffset: number,
            lengthLimit: number,
            target: Detection[] = declarations,
        ) => {
            parseSelectorTokens(selectorText, {
                file: filePath,
                lineIndex,
                baseOffset,
                maxIndex: lengthLimit,
                options,
                declarations: target,
                dynamicPatterns,
                tags,
                onPseudoOnly: () => {
                    hasPseudoOnlySelector = true;
                },
            });
        };

        try {
            collect(branch.text, branchOffset, branch.text.length);

            // Resolve `&` nesting (SCSS/LESS) to discover generated class names.
            if (branch.text.includes('&') || resolvedAncestors.length > 0) {
                const resolvedBranches = resolveBranch(branch.text, resolvedAncestors);
                const alreadyKnown = new Set(declarations.map((declaration) => declaration.name));
                // Ancestor tokens are declared by their own rule; only keep the
                // names this nested rule actually introduces (e.g. `&__title`).
                collectNames(resolvedAncestors).forEach((name) => alreadyKnown.add(name));

                resolvedBranches.forEach((resolved) => {
                    if (resolved === branch.text) {
                        return;
                    }
                    const nestedDeclarations: Detection[] = [];
                    collect(resolved, branchOffset, branch.text.length, nestedDeclarations);
                    nestedDeclarations.forEach((declaration) => {
                        if (!alreadyKnown.has(declaration.name)) {
                            alreadyKnown.add(declaration.name);
                            declarations.push(declaration);
                        }
                    });
                });
            }
        } catch (error) {
            ErrorCollector.from('css-parse', `Failed to parse selector "${branch.text}"`, error, {
                file: filePath,
                recoverable: true,
            });
        }

        // De-duplicate tokens that came from the same source position.
        const uniqueDeclarations = dedupeDetections(declarations);

        const ruleInfo: CssRuleInfo = {
            file: filePath,
            selector: branch.text,
            resolvedSelector: resolveBranch(branch.text, resolvedAncestors).join(', ') || branch.text,
            line: branchLine.line,
            column: branchLine.column,
            startOffset: branchOffset,
            endOffset: Math.max(ruleEndOffset, branchOffset + branch.text.length),
            declarations: uniqueDeclarations,
            parentAtRule: findParentAtRule(rule),
            ignored,
            ignoredReason: ignored
                ? ignoreInfo.fileIgnored
                    ? 'file-level ignore comment'
                    : 'ignore comment'
                : undefined,
        };

        if (ignored) {
            result.ignoredRuleCount++;
        }

        dynamicPatterns.forEach((pattern) => {
            if (!result.dynamicPatterns.includes(pattern)) {
                result.dynamicPatterns.push(pattern);
            }
        });

        if (uniqueDeclarations.length === 0 && options.analyzeElements && tags.length > 0 && !hasPseudoOnlySelector) {
            tags.forEach((tag) => {
                if (!GLOBAL_TAGS.has(tag.toLowerCase())) {
                    result.elementSelectors.push({ name: tag, rule: ruleInfo });
                }
            });
        }

        result.rules.push(ruleInfo);
    }

    // Keep the source text referenced so callers can compute ranges later.
    void text;
}

/** Names of every class/id token appearing in the given selector strings. */
export function collectNames(selectors: string[]): Set<string> {
    const names = new Set<string>();
    selectors.forEach((selectorText) => {
        try {
            selectorParser((root) => {
                root.walkClasses((node) => {
                    names.add(node.value);
                });
                root.walkIds((node) => {
                    names.add(node.value);
                });
            }).processSync(selectorText);
        } catch {
            /* ignore malformed ancestor selectors */
        }
    });
    return names;
}

interface TokenCollectionContext {
    file: string;
    lineIndex: LineIndex;
    baseOffset: number;
    maxIndex: number;
    options: CssParseOptions;
    declarations: Detection[];
    dynamicPatterns: string[];
    tags: string[];
    onPseudoOnly: () => void;
}

function parseSelectorTokens(selectorText: string, context: TokenCollectionContext): void {
    const trimmed = selectorText.trim();
    if (!trimmed) {
        return;
    }
    if (trimmed.startsWith('%') || trimmed === 'from' || trimmed === 'to' || /^\d+(\.\d+)?%$/.test(trimmed)) {
        return;
    }

    // `btn-${size}`, `col-#{$size}` etc. tell us a family of classes is in play.
    extractDynamicPrefixes(selectorText).forEach((prefix) => context.dynamicPatterns.push(prefix));

    // Blank out interpolation so the selector parser can still run, keeping
    // every character index (and therefore every position) intact.
    const sanitized = sanitizeInterpolation(selectorText);

    let sawCompound = false;

    selectorParser((selectorRoot) => {
        selectorRoot.walkClasses((node) => {
            sawCompound = true;
            pushToken(node.value, 'class', node.sourceIndex ?? 0, context);
        });

        if (context.options.analyzeIds) {
            selectorRoot.walkIds((node) => {
                sawCompound = true;
                pushToken(node.value, 'id', node.sourceIndex ?? 0, context);
            });
        }

        selectorRoot.walkTags((node) => {
            context.tags.push(node.value);
            sawCompound = true;
        });

        selectorRoot.walkAttributes((node) => {
            const attribute = node.attribute?.toLowerCase();
            const operator = node.operator;
            const rawValue = node.value ?? '';
            if (attribute === 'class' || attribute === 'id') {
                sawCompound = true;
                const type: TokenType = attribute === 'class' ? 'class' : 'id';
                if (operator === '~=' || operator === '=') {
                    splitValue(rawValue).forEach((value) => {
                        pushToken(value, type, node.sourceIndex ?? 0, context);
                    });
                } else if (operator === '*=' || operator === '^=' || operator === '|=' || operator === '$=') {
                    // `[class*="btn-"]` -> treat every class starting with btn- as used.
                    const value = rawValue.replace(/["']/g, '');
                    if (value) {
                        context.dynamicPatterns.push(value);
                    }
                }
            }
        });

        selectorRoot.walkPseudos((node) => {
            const name = node.value.toLowerCase();
            if (name === ':root' || name === ':host' || name === ':host-context') {
                sawCompound = true;
            }
            if (name === ':global' || name === ':local') {
                // CSS-modules wrappers: the inner selector is already walked.
                sawCompound = true;
            }
        });
    }).processSync(sanitized);

    if (!sawCompound) {
        context.onPseudoOnly();
    }
}

function pushToken(rawName: string, type: TokenType, sourceIndex: number, context: TokenCollectionContext): void {
    const name = (rawName ?? '').replace(/\\/g, '');
    if (!name) {
        return;
    }

    // A name ending in `-`/`_` is a truncated interpolation (`col-`): remember
    // the prefix so every `col-*` class is treated as used, and never report it.
    if (/[-_]$/.test(name)) {
        context.dynamicPatterns.push(name);
        return;
    }

    // Interpolated / wildcard class names (`btn-${x}`, `#{$size}`) are dynamic.
    if (/[${}*#]/.test(name)) {
        extractDynamicPrefixes(name).forEach((prefix) => context.dynamicPatterns.push(prefix));
        const directPrefix = name.split(/[${*#]/)[0];
        if (directPrefix && directPrefix.length >= 2) {
            context.dynamicPatterns.push(directPrefix);
        }
        return;
    }

    if (type === 'id' && !context.options.analyzeIds) {
        return;
    }
    if (!isValidClassToken(name)) {
        return;
    }

    const indexWithinBranch = Math.max(Math.min(sourceIndex, Math.max(context.maxIndex - 1, 0)), 0);
    const absolute = context.baseOffset + indexWithinBranch;
    const position = context.lineIndex.positionAt(absolute);

    context.declarations.push({
        name,
        type,
        kind: 'css-selector',
        file: context.file,
        line: position.line,
        column: position.column,
        length: name.length + 1,
    });
}

/** Replace SCSS/LESS interpolation and variables with spaces (length preserving). */
export function sanitizeInterpolation(selectorText: string): string {
    return selectorText
        .replace(/#\{[^}]*\}/g, (match) => ' '.repeat(match.length))
        .replace(/@\{[^}]*\}/g, (match) => ' '.repeat(match.length))
        .replace(/@[A-Za-z_][\w-]*/g, (match) => ' '.repeat(match.length))
        .replace(/\$\{?[A-Za-z_][\w-]*\}?/g, (match) => ' '.repeat(match.length));
}

export function splitBranches(selector: string): Branch[] {
    const branches: Branch[] = [];
    let depth = 0;
    let quote: string | null = null;
    let start = 0;

    const push = (from: number, to: number) => {
        const raw = selector.slice(from, to);
        const text = raw.trim();
        if (!text) {
            return;
        }
        const leading = raw.length - raw.replace(/^\s+/, '').length;
        branches.push({ text, offset: from + leading });
    };

    for (let i = 0; i < selector.length; i++) {
        const char = selector[i];

        if (quote) {
            if (char === '\\') {
                i++;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === '(' || char === '[') {
            depth++;
            continue;
        }
        if (char === ')' || char === ']') {
            depth = Math.max(depth - 1, 0);
            continue;
        }
        if (char === ',' && depth === 0) {
            push(start, i);
            start = i + 1;
        }
    }

    push(start, selector.length);
    return branches;
}

/** Resolve a list of nested selector levels into concrete selector strings. */
export function resolveChain(levels: string[]): string[] {
    let resolved: string[] = [''];
    for (const level of levels) {
        resolved = resolveBranch(level, resolved);
    }
    return resolved.filter(Boolean);
}

export function resolveBranch(branch: string, ancestors: string[]): string[] {
    const parts = splitBranches(branch).map((item) => item.text);
    if (ancestors.length === 0) {
        return parts.length > 0 ? parts : [branch];
    }
    const results: string[] = [];
    parts.forEach((part) => {
        ancestors.forEach((ancestor) => {
            if (part.includes('&')) {
                results.push(part.replace(/&/g, ancestor).trim());
            } else {
                results.push(`${ancestor} ${part}`.trim());
            }
        });
    });
    return results;
}

function dedupeDetections(detections: Detection[]): Detection[] {
    const seen = new Set<string>();
    const unique: Detection[] = [];
    for (const detection of detections) {
        const key = `${detection.type}:${detection.name}:${detection.line}:${detection.column}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(detection);
        }
    }
    return unique;
}

function findParentAtRule(rule: Rule): string | undefined {
    let parent = rule.parent as Node | undefined;
    while (parent) {
        if (parent.type === 'atrule') {
            const atRule = parent as unknown as { name?: string; params?: string };
            return `@${atRule.name ?? ''} ${atRule.params ?? ''}`.trim();
        }
        parent = (parent as { parent?: Node }).parent;
    }
    return undefined;
}

function splitValue(value: string): string[] {
    return value.replace(/["']/g, '').split(/\s+/).filter(Boolean);
}

/**
 * Last-resort extraction for files PostCSS cannot parse at all.
 * Deliberately conservative: only obvious `selector { ... }` shapes.
 */
function extractWithFallback(
    filePath: string,
    text: string,
    lineIndex: LineIndex,
    options: CssParseOptions,
    result: CssFileResult,
    ignoreInfo: IgnoreInfo,
): void {
    const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
    let buffer = '';
    let bufferStart = 0;

    for (let i = 0; i < withoutComments.length; i++) {
        const char = withoutComments[i];
        if (char === ';' || char === '}') {
            buffer = '';
            bufferStart = i + 1;
            continue;
        }
        if (char === '{') {
            const candidate = buffer.trim();
            const offset = bufferStart + (buffer.length - buffer.replace(/^\s+/, '').length);
            buffer = '';
            bufferStart = i + 1;
            if (!candidate || candidate.length > 500 || !/[.#]/.test(candidate)) {
                continue;
            }
            const position = lineIndex.positionAt(offset);
            const ignored = ignoreInfo.fileIgnored || ignoreInfo.lines.has(position.line);
            const branches = splitBranches(candidate);
            branches.forEach((branch) => {
                const branchOffset = offset + branch.offset;
                const branchPosition = lineIndex.positionAt(branchOffset);
                const declarations: Detection[] = [];
                const dynamicPatterns: string[] = [];
                const tags: string[] = [];
                try {
                    parseSelectorTokens(branch.text, {
                        file: filePath,
                        lineIndex,
                        baseOffset: branchOffset,
                        maxIndex: branch.text.length,
                        options,
                        declarations,
                        dynamicPatterns,
                        tags,
                        onPseudoOnly: () => undefined,
                    });
                } catch {
                    /* ignore */
                }
                result.rules.push({
                    file: filePath,
                    selector: branch.text,
                    resolvedSelector: branch.text,
                    line: branchPosition.line,
                    column: branchPosition.column,
                    startOffset: branchOffset,
                    endOffset: branchOffset + branch.text.length,
                    declarations: dedupeDetections(declarations),
                    ignored,
                    ignoredReason: ignored ? 'ignore comment' : undefined,
                    parentAtRule: undefined,
                });
                dynamicPatterns.forEach((pattern) => {
                    if (!result.dynamicPatterns.includes(pattern)) {
                        result.dynamicPatterns.push(pattern);
                    }
                });
            });
            continue;
        }
        buffer += char;
    }
}

function escapeForRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Produce a copy of `text` that keeps only the contents of `<style>` blocks
 * (everything else becomes spaces). Used for SFCs such as `.vue`, `.svelte`,
 * `.astro` and for `<style>` blocks inside plain HTML files. Because the copy
 * has the same length, every line/offset stays valid for diagnostics.
 */
export function maskToStyleBlocks(text: string): { text: string; found: number } {
    const chars = text.split('');
    for (let i = 0; i < chars.length; i++) {
        if (chars[i] !== '\n' && chars[i] !== '\r') {
            chars[i] = ' ';
        }
    }

    let found = 0;
    const pattern = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
    for (const match of findMatches(pattern, text)) {
        found++;
        const innerStart = match.index + match[0].indexOf('>') + 1;
        for (let i = innerStart; i < innerStart + match[1].length && i < chars.length; i++) {
            chars[i] = text[i];
        }
    }

    return { text: chars.join(''), found };
}
