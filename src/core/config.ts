import type { DynamicPattern } from './types';

export type AnalysisMode = 'token' | 'strict';
export type DiagnosticSeveritySetting = 'information' | 'warning' | 'error';
export type ComponentScopeSetting = 'off' | 'component' | 'tree';

export interface ExtensionConfig {
    autoAnalyze: boolean;
    excludePatterns: string[];
    includeFileTypes: string[];
    componentFileTypes: string[];
    markupFileTypes: string[];
    showStatusBar: boolean;
    showNotifications: boolean;
    minFilesForAnalysis: number;
    debounceDelay: number;

    analysisMode: AnalysisMode;
    /**
     * How far the "is this class used?" check follows child components.
     *
     * - `off`: whole-workspace matching (a class used anywhere counts as used).
     * - `component`: owner component + its direct children.
     * - `tree`: owner component + every descendant (recommended).
     */
    componentScope: ComponentScopeSetting;
    severity: DiagnosticSeveritySetting;
    analyzeIds: boolean;
    analyzeElements: boolean;
    ignoreSelectors: string[];
    safelist: string[];
    dynamicClassPatterns: string[];
    ignoreComment: string;
    tagUnnecessary: boolean;
    maxUsageLocations: number;

    enableCaching: boolean;
    cacheTimeout: number;
    maxConcurrentFiles: number;
    largeProjectThreshold: number;
    enableFileWatcher: boolean;
    watcherThrottleDelay: number;
    maxCssFileSizeKb: number;
    maxSourceFileSizeKb: number;
    debugLogging: boolean;
}

export const DEFAULT_CSS_EXTENSIONS = ['.css', '.scss', '.less', '.sass'];
export const DEFAULT_COMPONENT_EXTENSIONS = [
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.mjs',
    '.cjs',
    '.mts',
    '.cts',
    '.vue',
    '.svelte',
    '.astro',
];
export const DEFAULT_MARKUP_EXTENSIONS = [
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
export const DEFAULT_EXCLUDE_PATTERNS = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/out/**',
    '**/.git/**',
    '**/coverage/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/.angular/**',
    '**/.svelte-kit/**',
    '**/vendor/**',
    '**/*.min.css',
    '**/*.d.ts',
];

export const DEFAULT_CONFIG: ExtensionConfig = {
    autoAnalyze: true,
    excludePatterns: DEFAULT_EXCLUDE_PATTERNS,
    includeFileTypes: DEFAULT_CSS_EXTENSIONS,
    componentFileTypes: DEFAULT_COMPONENT_EXTENSIONS,
    markupFileTypes: DEFAULT_MARKUP_EXTENSIONS,
    showStatusBar: true,
    showNotifications: true,
    minFilesForAnalysis: 1,
    debounceDelay: 600,

    analysisMode: 'token',
    componentScope: 'tree',
    severity: 'warning',
    analyzeIds: true,
    analyzeElements: false,
    ignoreSelectors: [],
    safelist: [],
    dynamicClassPatterns: [],
    ignoreComment: 'dead-css-ignore',
    tagUnnecessary: false,
    maxUsageLocations: 5,

    enableCaching: true,
    cacheTimeout: 300000,
    maxConcurrentFiles: 12,
    largeProjectThreshold: 150,
    enableFileWatcher: true,
    watcherThrottleDelay: 2000,
    maxCssFileSizeKb: 5120,
    maxSourceFileSizeKb: 2048,
    debugLogging: false,
};

export interface ConfigValidationIssue {
    setting: string;
    message: string;
    fatal: boolean;
}

/**
 * Coerce whatever the user has in settings.json into a safe config object.
 * Unknown/invalid values fall back to defaults instead of crashing analysis.
 */
export function normalizeConfig(raw: Partial<ExtensionConfig> | undefined): {
    config: ExtensionConfig;
    issues: ConfigValidationIssue[];
} {
    const issues: ConfigValidationIssue[] = [];
    const config: ExtensionConfig = { ...DEFAULT_CONFIG };

    if (!raw) {
        return { config, issues };
    }

    const readArray = (
        key: 'includeFileTypes' | 'componentFileTypes' | 'markupFileTypes' | 'excludePatterns',
        fallback: string[],
    ) => {
        const value = raw[key];
        if (value === undefined) {
            return fallback;
        }
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
            issues.push({
                setting: `unusedCssDetector.${key}`,
                message: `${key} must be an array of strings. Using defaults.`,
                fatal: false,
            });
            return fallback;
        }
        const cleaned = value.map((item) => String(item).trim()).filter((item) => item.length > 0);
        if (cleaned.length === 0) {
            issues.push({
                setting: `unusedCssDetector.${key}`,
                message: `${key} cannot be empty. Using defaults.`,
                fatal: false,
            });
            return fallback;
        }
        return cleaned;
    };

    const readStringArray = (key: 'ignoreSelectors' | 'safelist' | 'dynamicClassPatterns') => {
        const value = raw[key];
        if (value === undefined) {
            return [] as string[];
        }
        if (!Array.isArray(value)) {
            issues.push({
                setting: `unusedCssDetector.${key}`,
                message: `${key} must be an array of strings. Ignoring it.`,
                fatal: false,
            });
            return [];
        }
        return value.map((item) => String(item)).filter((item) => item.trim().length > 0);
    };

    const readBoolean = (key: keyof ExtensionConfig) => {
        const value = raw[key];
        if (value === undefined) {
            return DEFAULT_CONFIG[key] as boolean;
        }
        if (typeof value !== 'boolean') {
            issues.push({
                setting: `unusedCssDetector.${String(key)}`,
                message: `${String(key)} must be a boolean. Using default.`,
                fatal: false,
            });
            return DEFAULT_CONFIG[key] as boolean;
        }
        return value;
    };

    const readNumber = (key: keyof ExtensionConfig, min: number, max: number) => {
        const value = raw[key];
        if (value === undefined) {
            return DEFAULT_CONFIG[key] as number;
        }
        if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
            issues.push({
                setting: `unusedCssDetector.${String(key)}`,
                message: `${String(key)} must be a number. Using default.`,
                fatal: false,
            });
            return DEFAULT_CONFIG[key] as number;
        }
        if (value < min || value > max) {
            issues.push({
                setting: `unusedCssDetector.${String(key)}`,
                message: `${String(key)} must be between ${min} and ${max}. Clamping.`,
                fatal: false,
            });
            return Math.min(Math.max(value, min), max);
        }
        return value;
    };

    config.includeFileTypes = readArray('includeFileTypes', DEFAULT_CSS_EXTENSIONS);
    config.componentFileTypes = readArray('componentFileTypes', DEFAULT_COMPONENT_EXTENSIONS);
    config.markupFileTypes = readArray('markupFileTypes', DEFAULT_MARKUP_EXTENSIONS);
    config.excludePatterns = readArray('excludePatterns', DEFAULT_EXCLUDE_PATTERNS);

    config.ignoreSelectors = readStringArray('ignoreSelectors');
    config.safelist = readStringArray('safelist');
    config.dynamicClassPatterns = readStringArray('dynamicClassPatterns');

    config.autoAnalyze = readBoolean('autoAnalyze');
    config.showStatusBar = readBoolean('showStatusBar');
    config.showNotifications = readBoolean('showNotifications');
    config.analyzeIds = readBoolean('analyzeIds');
    config.analyzeElements = readBoolean('analyzeElements');
    config.tagUnnecessary = readBoolean('tagUnnecessary');
    config.enableCaching = readBoolean('enableCaching');
    config.enableFileWatcher = readBoolean('enableFileWatcher');
    config.debugLogging = readBoolean('debugLogging');

    config.minFilesForAnalysis = readNumber('minFilesForAnalysis', 1, 1000);
    config.debounceDelay = readNumber('debounceDelay', 0, 10000);
    config.cacheTimeout = readNumber('cacheTimeout', 0, 1800000);
    config.maxConcurrentFiles = readNumber('maxConcurrentFiles', 1, 64);
    config.largeProjectThreshold = readNumber('largeProjectThreshold', 10, 5000);
    config.watcherThrottleDelay = readNumber('watcherThrottleDelay', 200, 60000);
    config.maxCssFileSizeKb = readNumber('maxCssFileSizeKb', 64, 51200);
    config.maxSourceFileSizeKb = readNumber('maxSourceFileSizeKb', 64, 51200);
    config.maxUsageLocations = readNumber('maxUsageLocations', 1, 50);

    if (raw.analysisMode !== undefined) {
        if (raw.analysisMode === 'token' || raw.analysisMode === 'strict') {
            config.analysisMode = raw.analysisMode;
        } else {
            issues.push({
                setting: 'unusedCssDetector.analysisMode',
                message: `analysisMode must be "token" or "strict". Using "${DEFAULT_CONFIG.analysisMode}".`,
                fatal: false,
            });
        }
    }

    if (raw.componentScope !== undefined) {
        if (raw.componentScope === 'off' || raw.componentScope === 'component' || raw.componentScope === 'tree') {
            config.componentScope = raw.componentScope;
        } else {
            issues.push({
                setting: 'unusedCssDetector.componentScope',
                message: `componentScope must be "off", "component" or "tree". Using "${DEFAULT_CONFIG.componentScope}".`,
                fatal: false,
            });
        }
    }

    if (raw.severity !== undefined) {
        if (raw.severity === 'information' || raw.severity === 'warning' || raw.severity === 'error') {
            config.severity = raw.severity;
        } else {
            issues.push({
                setting: 'unusedCssDetector.severity',
                message: `severity must be "information", "warning" or "error". Using "${DEFAULT_CONFIG.severity}".`,
                fatal: false,
            });
        }
    }

    if (typeof raw.ignoreComment === 'string' && raw.ignoreComment.trim().length > 0) {
        config.ignoreComment = raw.ignoreComment.trim();
    }

    return { config, issues };
}

/** Compile ignore/safelist/dynamic patterns once per analysis run. */
export function buildDynamicPatterns(config: ExtensionConfig, discovered: string[]): DynamicPattern[] {
    const patterns: DynamicPattern[] = [];

    config.dynamicClassPatterns.forEach((entry) => {
        const compiled = compilePattern(entry);
        if (compiled) {
            patterns.push({ source: `setting:${entry}`, prefix: prefixOf(entry), regex: compiled });
        }
    });

    discovered.forEach((entry) => {
        const prefix = prefixOf(entry);
        if (prefix) {
            patterns.push({ source: `dynamic:${entry}`, prefix });
        } else {
            const compiled = compilePattern(entry);
            if (compiled) {
                patterns.push({ source: `dynamic:${entry}`, regex: compiled });
            }
        }
    });

    return patterns;
}

export function compileRegexList(entries: string[]): RegExp[] {
    const compiled: RegExp[] = [];
    entries.forEach((entry) => {
        const regex = compilePattern(entry);
        if (regex) {
            compiled.push(regex);
        }
    });
    return compiled;
}

function compilePattern(entry: string): RegExp | undefined {
    const trimmed = entry.trim();
    if (!trimmed) {
        return undefined;
    }
    try {
        // Treat `btn-*` and `btn-` as prefixes, everything else as a regex.
        if (/^[A-Za-z_][A-Za-z0-9_-]*\*$/.test(trimmed) || /^[A-Za-z_][A-Za-z0-9_-]*[-_]$/.test(trimmed)) {
            const prefix = trimmed.replace(/\*$/, '');
            return new RegExp(`^${escapeRegExp(prefix)}`);
        }
        if (/^\/.*\/[gimsuy]*$/.test(trimmed)) {
            const lastSlash = trimmed.lastIndexOf('/');
            return new RegExp(trimmed.slice(1, lastSlash), trimmed.slice(lastSlash + 1));
        }
        return new RegExp(trimmed);
    } catch {
        return undefined;
    }
}

function prefixOf(entry: string): string | undefined {
    const trimmed = entry.trim();
    if (!trimmed) {
        return undefined;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_-]*?[-_])(?:\*|\$\{|\{\{|#\{)/.exec(trimmed);
    if (match) {
        return match[1];
    }
    if (/^[A-Za-z_][A-Za-z0-9_-]*\*$/.test(trimmed)) {
        return trimmed.slice(0, -1);
    }
    // A bare prefix such as `item-` or `is_` is a prefix pattern too.
    if (/^[A-Za-z_][A-Za-z0-9_-]*[-_]$/.test(trimmed)) {
        return trimmed;
    }
    return undefined;
}

export function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
