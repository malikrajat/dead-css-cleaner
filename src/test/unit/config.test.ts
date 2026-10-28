import * as assert from 'node:assert';
import {
    buildDynamicPatterns,
    compileRegexList,
    DEFAULT_CONFIG,
    DEFAULT_CSS_EXTENSIONS,
    escapeRegExp,
    normalizeConfig,
} from '../../core/config';

suite('config (settings normalisation)', () => {
    test('falls back to defaults when no configuration is provided', () => {
        const { config, issues } = normalizeConfig(undefined);
        assert.deepStrictEqual(config, DEFAULT_CONFIG);
        assert.deepStrictEqual(issues, []);
    });

    test('accepts valid values unchanged', () => {
        const { config, issues } = normalizeConfig({
            autoAnalyze: false,
            analysisMode: 'strict',
            severity: 'error',
            debounceDelay: 1500,
            maxConcurrentFiles: 32,
            ignoreSelectors: ['^legacy-'],
            safelist: ['^js-'],
            dynamicClassPatterns: ['item-'],
            tagUnnecessary: true,
        });

        assert.strictEqual(config.autoAnalyze, false);
        assert.strictEqual(config.analysisMode, 'strict');
        assert.strictEqual(config.severity, 'error');
        assert.strictEqual(config.debounceDelay, 1500);
        assert.strictEqual(config.maxConcurrentFiles, 32);
        assert.deepStrictEqual(config.ignoreSelectors, ['^legacy-']);
        assert.deepStrictEqual(config.safelist, ['^js-']);
        assert.deepStrictEqual(config.dynamicClassPatterns, ['item-']);
        assert.strictEqual(config.tagUnnecessary, true);
        assert.deepStrictEqual(issues, []);
    });

    test('rejects wrong types for arrays and falls back to defaults', () => {
        const { config, issues } = normalizeConfig({
            includeFileTypes: 'css' as unknown as string[],
            componentFileTypes: [1, 2] as unknown as string[],
        });

        assert.deepStrictEqual(config.includeFileTypes, DEFAULT_CSS_EXTENSIONS);
        assert.ok(issues.some((issue) => issue.setting === 'unusedCssDetector.includeFileTypes'));
        assert.ok(issues.some((issue) => issue.setting === 'unusedCssDetector.componentFileTypes'));
    });

    test('rejects empty arrays with an issue', () => {
        const { config, issues } = normalizeConfig({ markupFileTypes: ['   '] });
        assert.ok(config.markupFileTypes.length > 0);
        assert.ok(issues.some((issue) => issue.setting === 'unusedCssDetector.markupFileTypes'));
    });

    test('clamps out-of-range numbers instead of failing', () => {
        const { config, issues } = normalizeConfig({
            debounceDelay: 999999,
            maxConcurrentFiles: 0,
            cacheTimeout: -5,
            minFilesForAnalysis: 0,
        });

        assert.strictEqual(config.debounceDelay, 10000);
        assert.strictEqual(config.maxConcurrentFiles, 1);
        assert.strictEqual(config.cacheTimeout, 0);
        assert.strictEqual(config.minFilesForAnalysis, 1);
        assert.strictEqual(issues.length, 4);
        assert.ok(issues.every((issue) => issue.fatal === false));
    });

    test('rejects non-numeric values', () => {
        const { config, issues } = normalizeConfig({ debounceDelay: 'soon' as unknown as number });
        assert.strictEqual(config.debounceDelay, DEFAULT_CONFIG.debounceDelay);
        assert.ok(issues.some((issue) => issue.setting === 'unusedCssDetector.debounceDelay'));
    });

    test('validates enum settings', () => {
        const { config, issues } = normalizeConfig({
            analysisMode: 'aggressive' as unknown as 'token',
            severity: 'fatal' as unknown as 'warning',
        });

        assert.strictEqual(config.analysisMode, DEFAULT_CONFIG.analysisMode);
        assert.strictEqual(config.severity, DEFAULT_CONFIG.severity);
        assert.strictEqual(issues.length, 2);
    });

    test('keeps a custom ignore comment but rejects a blank one', () => {
        assert.strictEqual(normalizeConfig({ ignoreComment: 'todo-remove' }).config.ignoreComment, 'todo-remove');
        assert.strictEqual(
            normalizeConfig({ ignoreComment: '   ' }).config.ignoreComment,
            DEFAULT_CONFIG.ignoreComment,
        );
    });

    test('builds dynamic patterns from prefixes, wildcards, globs and regexes', () => {
        const { config } = normalizeConfig({
            dynamicClassPatterns: ['item-', 'col-*', '^js-', '/^theme-/'],
            safelist: ['btn-*'],
        });

        const patterns = buildDynamicPatterns(config, ['chip-${size}']);
        const prefixes = patterns.map((pattern) => pattern.prefix).filter(Boolean);

        assert.ok(prefixes.includes('item-'), `item- missing from ${JSON.stringify(prefixes)}`);
        assert.ok(prefixes.includes('col-'), `col- missing from ${JSON.stringify(prefixes)}`);
        assert.ok(prefixes.includes('chip-'), `chip- missing from ${JSON.stringify(prefixes)}`);

        const regexes = patterns.map((pattern) => pattern.regex).filter(Boolean) as RegExp[];
        assert.ok(
            regexes.some((regex) => regex.test('js-hook')),
            'js- regex pattern missing',
        );
        assert.ok(
            regexes.some((regex) => regex.test('theme-dark')),
            'theme- regex pattern missing',
        );
    });

    test('ignores invalid patterns instead of throwing', () => {
        const { config } = normalizeConfig({ dynamicClassPatterns: ['[', '(unclosed'] });
        const patterns = buildDynamicPatterns(config, []);
        assert.deepStrictEqual(patterns, []);
    });

    test('compiles regex lists and skips broken entries', () => {
        const compiled = compileRegexList(['^js-', '[', '^theme-']);
        assert.strictEqual(compiled.length, 2);
        assert.ok(compiled[0].test('js-hook'));
        assert.ok(compiled[1].test('theme-dark'));
    });

    test('escapes regular expression metacharacters', () => {
        assert.strictEqual(escapeRegExp('a.b*c?'), 'a\\.b\\*c\\?');
    });
});
