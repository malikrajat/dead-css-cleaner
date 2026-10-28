/**
 * Turns "everything we found in the code" into a fast lookup and then decides
 * which CSS selectors are dead.
 */

import { type AnalysisMode, buildDynamicPatterns, compileRegexList, type ExtensionConfig } from '../core/config';
import { logger } from '../core/logger';
import type { Detection, DynamicPattern, TokenType, UnusedFinding } from '../core/types';
import type { ScopeInfo } from './componentGraph';

export interface MatchResult {
    used: boolean;
    locations: Detection[];
    /** How the token was matched, for transparent tooltips. */
    reason: 'exact' | 'cross-type' | 'dynamic-pattern' | 'safelist' | 'element-tag' | 'none';
}

export interface UsageEvaluation {
    /** Used *inside the requested scope* (or anywhere when no scope is given). */
    used: boolean;
    reason: MatchResult['reason'];
    /** Every file the token appears in (empty for pattern/safelist matches). */
    files: string[];
    /** Files that fall outside the requested scope. */
    outsideScope: string[];
    inScope: boolean;
}

export class UsageIndex {
    private byName = new Map<string, Detection[]>();
    /** Every file a token appears in (uncapped, unlike `byName`). */
    private filesByName = new Map<string, Set<string>>();
    private elements = new Set<string>();
    private totalUsages = 0;
    private dynamicPatterns: DynamicPattern[] = [];
    private safelistRegexes: RegExp[] = [];
    private ignoreRegexes: RegExp[] = [];
    private maxLocations: number;
    /** Normalised lookup for a scope's files, built once per scope. */
    private scopeKeys = new WeakMap<ScopeInfo, Set<string>>();

    constructor(private config: ExtensionConfig) {
        this.maxLocations = Math.max(config.maxUsageLocations, 1);
    }

    add(detection: Detection): void {
        if (!detection.name) {
            return;
        }
        this.totalUsages++;
        const key = this.keyFor(detection.type, detection.name);

        const files = this.filesByName.get(key) ?? new Set<string>();
        files.add(detection.file);
        this.filesByName.set(key, files);

        const existing = this.byName.get(key);
        if (existing) {
            if (existing.length < this.maxLocations) {
                if (!existing.some((item) => item.file === detection.file && item.line === detection.line)) {
                    existing.push(detection);
                }
            }
            return;
        }
        this.byName.set(key, [detection]);
    }

    addMany(detections: Iterable<Detection>): void {
        for (const detection of detections) {
            this.add(detection);
        }
    }

    addElementTag(tag: string): void {
        if (tag) {
            this.elements.add(tag.toLowerCase());
        }
    }

    addElementTags(tags: Iterable<string>): void {
        for (const tag of tags) {
            this.addElementTag(tag);
        }
    }

    hasElementTag(tag: string): boolean {
        return this.elements.has(tag.toLowerCase());
    }

    configurePatterns(discoveredDynamic: string[]): void {
        this.dynamicPatterns = buildDynamicPatterns(this.config, [...new Set(discoveredDynamic)]);
        this.safelistRegexes = compileRegexList(this.config.safelist);
        this.ignoreRegexes = compileRegexList(this.config.ignoreSelectors);

        if (this.dynamicPatterns.length > 0) {
            logger.debug(
                `Dynamic class patterns in play: ${this.dynamicPatterns
                    .map((pattern) => pattern.source)
                    .slice(0, 20)
                    .join(', ')}`,
            );
        }
    }

    isIgnored(selector: string, tokenName: string): boolean {
        return this.ignoreRegexes.some((regex) => {
            try {
                regex.lastIndex = 0;
                return regex.test(selector) || regex.test(tokenName);
            } catch {
                return false;
            }
        });
    }

    lookup(name: string, type: TokenType): MatchResult {
        const evaluation = this.evaluateUsage(name, type);
        return {
            used: evaluation.used,
            locations: evaluation.files.flatMap((file) => this.locationsFor(name, type, file)),
            reason: evaluation.reason,
        };
    }

    /**
     * Decide whether a token is used, optionally restricted to a component
     * scope. `outsideScope` lists the files where the token is used but which
     * fall outside that scope (a parent stylesheet used by a child component,
     * for example).
     */
    evaluateUsage(name: string, type: TokenType, scope?: ScopeInfo): UsageEvaluation {
        if (type === 'element') {
            return this.elements.has(name.toLowerCase())
                ? { used: true, reason: 'element-tag', files: [], outsideScope: [], inScope: true }
                : { used: false, reason: 'none', files: [], outsideScope: [], inScope: false };
        }

        const exact = this.filesFor(this.keyFor(type, name));
        if (exact.length > 0) {
            return this.classify(exact, scope, 'exact');
        }

        // Safety net: `id="foo"` + `#foo` mismatches (and vice versa) are common
        // enough that we prefer a false negative over a false positive.
        const otherType: TokenType = type === 'class' ? 'id' : 'class';
        const cross = this.filesFor(this.keyFor(otherType, name));
        if (cross.length > 0) {
            return this.classify(cross, scope, 'cross-type');
        }

        if (this.matchesDynamicPattern(name)) {
            return { used: true, reason: 'dynamic-pattern', files: [], outsideScope: [], inScope: true };
        }

        if (this.matchesSafelist(name)) {
            return { used: true, reason: 'safelist', files: [], outsideScope: [], inScope: true };
        }

        return { used: false, reason: 'none', files: [], outsideScope: [], inScope: false };
    }

    private classify(files: string[], scope: ScopeInfo | undefined, reason: MatchResult['reason']): UsageEvaluation {
        if (!scope || scope.kind === 'global') {
            return { used: true, reason, files, outsideScope: [], inScope: true };
        }

        const inside: string[] = [];
        const outside: string[] = [];
        const scopeKeys = this.scopeKeysFor(scope);
        files.forEach((file) => {
            if (scopeKeys.has(normalizePath(file))) {
                inside.push(file);
            } else {
                outside.push(file);
            }
        });

        return {
            used: inside.length > 0,
            reason,
            files,
            outsideScope: outside,
            inScope: inside.length > 0,
        };
    }

    private filesFor(key: string): string[] {
        return [...(this.filesByName.get(key) ?? [])];
    }

    private scopeKeysFor(scope: ScopeInfo): Set<string> {
        const cached = this.scopeKeys.get(scope);
        if (cached) {
            return cached;
        }
        const keys = new Set<string>();
        scope.files.forEach((file) => keys.add(normalizePath(file)));
        this.scopeKeys.set(scope, keys);
        return keys;
    }

    private locationsFor(name: string, type: TokenType, file: string): Detection[] {
        const other: TokenType = type === 'class' ? 'id' : 'class';
        const exact = this.byName.get(this.keyFor(type, name)) ?? [];
        const cross = exact.length > 0 ? [] : (this.byName.get(this.keyFor(other, name)) ?? []);
        return [...exact, ...cross].filter((detection) => detection.file === file);
    }

    private matchesDynamicPattern(name: string): boolean {
        return this.dynamicPatterns.some((pattern) => {
            try {
                if (pattern.prefix && name.startsWith(pattern.prefix)) {
                    return true;
                }
                if (pattern.regex) {
                    pattern.regex.lastIndex = 0;
                    return pattern.regex.test(name);
                }
            } catch {
                return false;
            }
            return false;
        });
    }

    private matchesSafelist(name: string): boolean {
        return this.safelistRegexes.some((regex) => {
            try {
                regex.lastIndex = 0;
                return regex.test(name);
            } catch {
                return false;
            }
        });
    }

    private keyFor(type: TokenType, name: string): string {
        return `${type === 'id' ? 'i' : 'c'}:${name}`;
    }

    get size(): number {
        return this.byName.size;
    }

    get usageCount(): number {
        return this.totalUsages;
    }
}

export interface UnusedComputation {
    findings: UnusedFinding[];
    /**
     * Tokens that are used in the workspace but only *outside* the declaring
     * component's scope. They are not dead code, so they are never diagnostics;
     * the component report lists them as "used elsewhere".
     */
    outsideScope: UnusedFinding[];
    ignoredFindings: number;
    elementFindings: Array<{ name: string; element: Detection }>;
}

export interface ComputeUnusedOptions {
    /** Files that may legitimately use the classes of a stylesheet. */
    resolveScope?: (styleFile: string) => ScopeInfo | undefined;
}

/**
 * Decide which selectors are dead.
 *
 * `token` mode  - report each unused class/id, and flag when the containing
 *                 selector is only *partially* dead (e.g. `.card .title` where
 *                 `.card` is used but `.title` is not).
 * `strict` mode - only report a selector when *none* of its tokens are used.
 *                 Much quieter; ideal for deeply nested component styles.
 *
 * When `resolveScope` is provided, "used" means "used inside the declaring
 * component's subtree", so a parent stylesheet that is applied by a child
 * component is not reported as dead. Tokens used only outside that subtree are
 * returned separately in `outsideScope`.
 */
export function computeUnused(
    rules: Array<{ file: string; selector: string; declarations: Detection[]; ignored: boolean }>,
    index: UsageIndex,
    mode: AnalysisMode,
    options: ComputeUnusedOptions = {},
): UnusedComputation {
    const findings: UnusedFinding[] = [];
    const outsideScope: UnusedFinding[] = [];
    const elementFindings: Array<{ name: string; element: Detection }> = [];
    let ignoredFindings = 0;
    const seen = new Set<string>();

    for (const rule of rules) {
        if (rule.ignored || rule.declarations.length === 0) {
            continue;
        }

        if (index.isIgnored(rule.selector, rule.declarations[0]?.name ?? '')) {
            ignoredFindings++;
            continue;
        }

        const scope = options.resolveScope?.(rule.file);

        const evaluations = rule.declarations.map((declaration) => {
            const evaluation = index.evaluateUsage(declaration.name, declaration.type, scope);
            return {
                declaration,
                evaluation,
                usedOutsideOnly: !evaluation.used && evaluation.files.length > 0,
            };
        });

        const usedCount = evaluations.filter((item) => item.evaluation.used).length;
        const total = evaluations.length;
        const isPartial = usedCount > 0 && usedCount < total;

        if (mode === 'strict' && usedCount > 0) {
            continue;
        }

        for (const evaluation of evaluations) {
            if (evaluation.evaluation.used && !evaluation.usedOutsideOnly) {
                continue;
            }
            const key = `${evaluation.declaration.type}:${evaluation.declaration.name}:${evaluation.declaration.file}:${evaluation.declaration.line}:${evaluation.declaration.column}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);

            const finding: UnusedFinding = {
                declaration: evaluation.declaration,
                rule: rule as UnusedFinding['rule'],
                usedTokensInRule: usedCount,
                totalTokensInRule: total,
                mode,
                isPartialSelector: isPartial,
                scope: scope
                    ? {
                          kind: scope.kind,
                          componentFiles: scope.componentFiles,
                          fileCount: scope.files.size,
                          usedOutsideScope: evaluation.evaluation.outsideScope,
                      }
                    : {
                          kind: 'global',
                          componentFiles: [],
                          fileCount: 0,
                          usedOutsideScope: [],
                      },
            };

            if (evaluation.usedOutsideOnly) {
                outsideScope.push(finding);
            } else {
                findings.push(finding);
            }
        }
    }

    return { findings, outsideScope, ignoredFindings, elementFindings };
}

export function computeUnusedElements(
    elementSelectors: Array<{ name: string; rule: { file: string; selector: string; line: number; column: number } }>,
    index: UsageIndex,
): Array<{ name: string; element: Detection }> {
    const findings: Array<{ name: string; element: Detection }> = [];
    const seen = new Set<string>();

    elementSelectors.forEach((entry) => {
        if (index.hasElementTag(entry.name)) {
            return;
        }
        const key = `${entry.name}:${entry.rule.file}:${entry.rule.line}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        findings.push({
            name: entry.name,
            element: {
                name: entry.name,
                type: 'element',
                kind: 'css-selector',
                file: entry.rule.file,
                line: entry.rule.line,
                column: entry.rule.column,
                length: entry.name.length,
            },
        });
    });

    return findings;
}

/** Absolute path comparison is case- and separator-insensitive on Windows. */
function normalizePath(file: string): string {
    return file.replace(/\\/g, '/').toLowerCase();
}
