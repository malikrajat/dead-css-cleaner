/**
 * Shared, editor-agnostic types.
 *
 * IMPORTANT: nothing in `src/core`, `src/parsers` or `src/analysis` may import
 * `vscode`. Those layers stay pure so they can be unit tested in plain Node.
 */

export type TokenType = 'class' | 'id' | 'element';

/** Where a class/id token was seen. Used for both CSS declarations and usages. */
export type UsageKind =
    | 'css-selector'
    | 'jsx-attribute'
    | 'js-object-key'
    | 'js-call-argument'
    | 'css-module-member'
    | 'dom-classlist'
    | 'dom-selector'
    | 'dom-id'
    | 'dom-class-attribute'
    | 'angular-template'
    | 'angular-binding'
    | 'angular-host-binding'
    | 'html-attribute'
    | 'html-binding'
    | 'variable'
    | 'unknown';

export interface Detection {
    /** Class or id name without the leading `.` / `#`. */
    name: string;
    type: TokenType;
    kind: UsageKind;
    /** Absolute file path. */
    file: string;
    /** 1-based line. */
    line: number;
    /** 1-based column. */
    column: number;
    length: number;
}

/** A single CSS rule (one comma-separated selector branch). */
export interface CssRuleInfo {
    file: string;
    /** Selector exactly as written in the source (may contain `&`). */
    selector: string;
    /** Selector with SCSS `&` nesting resolved (best effort). */
    resolvedSelector: string;
    line: number;
    column: number;
    startOffset: number;
    endOffset: number;
    /** Class/id tokens declared by this selector. */
    declarations: Detection[];
    parentAtRule?: string;
    ignored: boolean;
    ignoredReason?: string;
}

export interface CssFileResult {
    file: string;
    rules: CssRuleInfo[];
    /** Rule-level class/id tokens that are only a fragment (e.g. `[class*="btn-"]`). */
    dynamicPatterns: string[];
    /** Element-only selectors, only reported when `analyzeElements` is on. */
    elementSelectors: Array<{ name: string; rule: CssRuleInfo }>;
    ignoredRuleCount: number;
    parseErrors: number;
    parseError?: string;
    fromCache?: boolean;
}

export interface UsageResult {
    file: string;
    usages: Detection[];
    /** Prefix/wildcard patterns discovered from dynamic classes like `btn-${size}`. */
    dynamicPatterns: string[];
    /** Module specifiers imported by this file, used to build the component graph. */
    imports?: string[];
    /** Child components rendered by this file (`<Card />`, `<app-card>`, ...). */
    childComponents?: string[];
    error?: string;
}

/**
 * Which files were searched before a token was declared dead.
 *
 * `global` means the stylesheet has no owning component, so every scanned file
 * counts (the classic whole-workspace check). `component-tree` means the token
 * was checked against the owning component *and its child components*.
 */
export interface FindingScope {
    kind: 'global' | 'component-tree';
    /** Component files whose subtree was searched (owner first). */
    componentFiles: string[];
    /** Number of files inside the searched scope. */
    fileCount: number;
    /** Files where the token is used, but outside the searched scope. */
    usedOutsideScope: string[];
}

export interface UnusedFinding {
    declaration: Detection;
    rule: CssRuleInfo;
    usedTokensInRule: number;
    totalTokensInRule: number;
    /** `token`: a single unused class/id. `strict`: the whole rule is dead. */
    mode: 'token' | 'strict';
    isPartialSelector: boolean;
    /** Populated when the token was validated against a component subtree. */
    scope?: FindingScope;
}

export interface ComponentSummary {
    file: string;
    name: string;
    /** Stylesheets owned by this component (styleUrls, CSS imports, SFC styles). */
    styleFiles: string[];
    children: string[];
    descendantCount: number;
}

export interface AnalysisPhaseTimings {
    discoveryMs: number;
    parseMs: number;
    compareMs: number;
}

export interface AnalysisStats {
    cssFiles: number;
    jsFiles: number;
    markupFiles: number;
    angularFiles: number;
    cacheHits: number;
    cacheMisses: number;
    parseErrors: number;
    selectors: number;
    uniqueTokens: number;
    usages: number;
    durationMs: number;
    phases: AnalysisPhaseTimings;
    cancelled: boolean;
}

export interface UnusedSelectorReport {
    selector: string;
    token: string;
    type: TokenType;
    file: string;
    line: number;
    column: number;
    mode: 'token' | 'strict';
    partial: boolean;
    /** Up to N locations where the token IS used (empty when fully unused). */
    usedIn: Array<{ file: string; line: number; kind: UsageKind }>;
}

export interface AnalysisResult {
    findings: UnusedFinding[];
    rules: CssRuleInfo[];
    stats: AnalysisStats;
    ignoredRuleCount: number;
    /** Element-only selectors that no template uses (only when `analyzeElements` is on). */
    elementFindings: Array<{ name: string; element: Detection }>;
    /** Tokens that are used in the workspace, but only outside the declaring component's tree. */
    outsideScope: UnusedFinding[];
    /** Component graph summary used by the reports and the sidebar view. */
    components: ComponentSummary[];
}

export interface DynamicPattern {
    /** Human readable origin, e.g. `css:[class*="btn-"]`. */
    source: string;
    prefix?: string;
    regex?: RegExp;
}
