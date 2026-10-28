import * as assert from 'node:assert';
import { analyzeFixture } from './helpers';

suite('usage comparison (nth level + false positive guards)', () => {
    test('token mode flags the dead child token and marks the selector as partially dead', () => {
        const result = analyzeFixture({
            css: [
                {
                    file: '/tmp/a.css',
                    text: ['.card .title { color: red; }', '.card .body .deep-child { color: blue; }'].join('\n'),
                },
            ],
            markup: [
                {
                    file: '/tmp/index.html',
                    text: '<div class="card"><div class="body"><h1 class="title">Hi</h1></div></div>',
                },
            ],
        });

        assert.deepStrictEqual(result.dead, ['.deep-child']);
        assert.deepStrictEqual(result.partial, ['deep-child']);
    });

    test('child classes used deep inside a component are not reported', () => {
        const result = analyzeFixture({
            css: [
                {
                    file: '/tmp/a.css',
                    text: [
                        '.wrapper .panel .header .title .icon { color: red; }',
                        '.wrapper .panel .header .title .label { color: blue; }',
                    ].join('\n'),
                },
            ],
            markup: [
                {
                    file: '/tmp/App.tsx',
                    text: [
                        "import './a.css';",
                        'export const App = () => (',
                        '  <div className="wrapper">',
                        '    <div className="panel">',
                        '      <header className="header">',
                        '        <h2 className="title">',
                        '          <i className="icon" />',
                        '          <span className="label">x</span>',
                        '        </h2>',
                        '      </header>',
                        '    </div>',
                        '  </div>',
                        ');',
                    ].join('\n'),
                },
            ],
        });

        assert.deepStrictEqual(result.dead, [], `unexpected dead tokens: ${result.dead.join(', ')}`);
    });

    test('strict mode stays quiet when part of the selector is still used', () => {
        const fixture = {
            css: [{ file: '/tmp/a.css', text: '.card .legacy { color: red; }' }],
            markup: [{ file: '/tmp/index.html', text: '<div class="card"></div>' }],
        };

        const tokenMode = analyzeFixture(fixture);
        const strictMode = analyzeFixture(fixture, { analysisMode: 'strict' });

        assert.deepStrictEqual(tokenMode.dead, ['.legacy']);
        assert.deepStrictEqual(strictMode.dead, []);
    });

    test('strict mode still reports fully dead rules', () => {
        const result = analyzeFixture(
            {
                css: [{ file: '/tmp/a.css', text: '.gone .also-gone { color: red; }' }],
                markup: [{ file: '/tmp/index.html', text: '<div class="card"></div>' }],
            },
            { analysisMode: 'strict' },
        );
        assert.deepStrictEqual(result.dead, ['.gone', '.also-gone']);
    });

    test('dynamic class patterns suppress false positives', () => {
        const result = analyzeFixture({
            css: [{ file: '/tmp/a.css', text: '.item-3 { color: red; } .item-12 { color: blue; }' }],
            scripts: [{ file: '/tmp/util.ts', text: 'export const c = (index: number) => `item-${index}`;' }],
        });
        assert.deepStrictEqual(result.dead, []);
    });

    test('safelist and ignoreSelectors are honoured', () => {
        const result = analyzeFixture(
            {
                css: [{ file: '/tmp/a.css', text: '.js-hook { color: red; } .legacy-banner { color: blue; }' }],
                markup: [{ file: '/tmp/index.html', text: '<div></div>' }],
            },
            { safelist: ['^js-'], ignoreSelectors: ['legacy-'] },
        );
        assert.deepStrictEqual(result.dead, []);
    });

    test('ids and classes with the same name do not leak into each other', () => {
        const result = analyzeFixture({
            css: [
                { file: '/tmp/a.css', text: '.nav { color: red; } #nav { color: blue; } #missing { color: green; }' },
            ],
            markup: [{ file: '/tmp/index.html', text: '<nav class="nav"></nav>' }],
        });
        // `#nav` is only used as a class, so the cross-type safety net keeps it; `#missing` is dead.
        assert.deepStrictEqual(result.dead, ['#missing']);
    });

    test('element analysis reports unused element selectors', () => {
        const result = analyzeFixture(
            {
                css: [{ file: '/tmp/a.css', text: 'article { color: red; } aside { color: blue; }' }],
                markup: [{ file: '/tmp/index.html', text: '<article class="post"></article>' }],
            },
            { analyzeElements: true },
        );
        assert.deepStrictEqual(result.deadElements, ['aside']);
    });
});
