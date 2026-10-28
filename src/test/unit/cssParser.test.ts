import * as assert from 'node:assert';
import { parseCssText } from '../../parsers/cssParser';

const options = { ignoreComment: 'dead-css-ignore', analyzeElements: false, analyzeIds: true };

function names(text: string): string[] {
    const result = parseCssText('/tmp/test.css', text, options);
    return result.rules.flatMap((rule) => rule.declarations.map((declaration) => declaration.name));
}

suite('cssParser', () => {
    test('collects every class in deep descendant selectors (nth level children)', () => {
        const result = parseCssText(
            '/tmp/test.css',
            [
                '.card .body .title span { color: red; }',
                '.card > .body > .deep > .deeper { color: blue; }',
                '.a .b .c .d .e .f { color: green; }',
            ].join('\n'),
            options,
        );

        const allNames = result.rules.flatMap((rule) => rule.declarations.map((declaration) => declaration.name));
        ['card', 'body', 'title', 'deep', 'deeper', 'a', 'b', 'c', 'd', 'e', 'f'].forEach((expected) => {
            assert.ok(allNames.includes(expected), `expected "${expected}" to be parsed, got ${allNames.join(',')}`);
        });
    });

    test('reports an exact position for each token (line + column)', () => {
        const result = parseCssText('/tmp/test.css', '.card .title {\n  color: red;\n}\n', options);
        const card = result.rules[0].declarations.find((declaration) => declaration.name === 'card');
        const title = result.rules[0].declarations.find((declaration) => declaration.name === 'title');

        assert.ok(card, 'card token missing');
        assert.ok(title, 'title token missing');
        assert.strictEqual(card!.line, 1);
        assert.strictEqual(card!.column, 1);
        assert.strictEqual(title!.line, 1);
        assert.strictEqual(title!.column, 7);
    });

    test('resolves SCSS nesting including & parent selectors', () => {
        const allNames = names(
            [
                '.card {',
                '  &__title { color: red; }',
                '  &--large { color: blue; }',
                '  .child { color: green; }',
                '}',
            ].join('\n'),
        );

        assert.ok(allNames.includes('card'), 'card missing');
        assert.ok(allNames.includes('card__title'), `card__title missing (${allNames.join(',')})`);
        assert.ok(allNames.includes('card--large'), `card--large missing (${allNames.join(',')})`);
        assert.ok(allNames.includes('child'), 'nested child missing');
    });

    test('handles :not/:is/:where/:has and attribute selectors', () => {
        const allNames = names(
            [
                '.list:not(.empty) .item:is(.active, .selected) { color: red; }',
                '.grid:has(.card) { color: blue; }',
                '.button[data-state="open"], .button:hover, .button::before { color: green; }',
            ].join('\n'),
        );

        ['list', 'empty', 'item', 'active', 'selected', 'grid', 'card', 'button'].forEach((expected) => {
            assert.ok(allNames.includes(expected), `${expected} missing (${allNames.join(',')})`);
        });
        assert.strictEqual(new Set(allNames.filter((name) => name === 'button')).size, 1);
    });

    test('handles comma separated selector lists with accurate positions', () => {
        const result = parseCssText('/tmp/test.css', '.first, .second, .third { color: red; }', options);
        assert.strictEqual(result.rules.length, 3);
        assert.deepStrictEqual(
            result.rules.map((rule) => rule.declarations[0].name),
            ['first', 'second', 'third'],
        );
        assert.deepStrictEqual(
            result.rules.map((rule) => rule.declarations[0].column),
            [1, 9, 18],
        );
    });

    test('skips @keyframes, @font-face and other non-selector at-rules', () => {
        const allNames = names(
            [
                '@keyframes spin { from { opacity: 0; } to { opacity: 1; } }',
                '@font-face { font-family: "X"; }',
                '@media (min-width: 600px) { .responsive { color: red; } }',
            ].join('\n'),
        );
        assert.deepStrictEqual(allNames, ['responsive']);
    });

    test('ignores rules marked with the ignore comment, keeps everything else', () => {
        const result = parseCssText(
            '/tmp/test.css',
            ['/* dead-css-ignore */', '.ignored { color: red; }', '', '.kept { color: blue; }'].join('\n'),
            options,
        );
        assert.strictEqual(result.ignoredRuleCount, 1);
        const ignoredRule = result.rules.find((rule) => rule.selector === '.ignored');
        const keptRule = result.rules.find((rule) => rule.selector === '.kept');
        assert.ok(ignoredRule?.ignored, 'ignored rule should be flagged');
        assert.strictEqual(keptRule?.ignored, false);
    });

    test('detects dynamic class patterns from attribute selectors and interpolation', () => {
        const result = parseCssText(
            '/tmp/test.scss',
            ['[class*="btn-"] { color: red; }', '.col-#{$size} { color: blue; }'].join('\n'),
            { ...options, syntax: 'scss' },
        );
        assert.ok(result.dynamicPatterns.includes('btn-'), `btn- missing (${result.dynamicPatterns.join(',')})`);
        assert.ok(
            result.dynamicPatterns.some((pattern) => pattern.startsWith('col-')),
            'col- prefix missing',
        );
        assert.strictEqual(result.parseErrors, 0, `interpolated SCSS should parse cleanly: ${result.parseError ?? ''}`);
    });

    test('collects element-only selectors when element analysis is enabled', () => {
        const result = parseCssText(
            '/tmp/test.css',
            ['article { color: red; }', '.used { color: blue; }', 'custom-widget { color: green; }'].join('\n'),
            { ...options, analyzeElements: true },
        );
        const elementNames = result.elementSelectors.map((entry) => entry.name);
        assert.ok(elementNames.includes('article'), 'article missing');
        assert.ok(elementNames.includes('custom-widget'), 'custom-widget missing');
        assert.ok(!elementNames.includes('used'), 'class rule must not be treated as element selector');
    });

    test('recovers from broken CSS instead of throwing', () => {
        const result = parseCssText('/tmp/broken.css', '.a { color: red; .b { color: blue; }', options);
        assert.ok(result.rules.length >= 1, 'fallback scan should still find selectors');
    });
});
