import * as assert from 'node:assert';
import { analyzeFixture } from './helpers';

suite('end-to-end scenarios (no VS Code required)', () => {
    test('SPA: single index.html + single styles.css, nothing else', () => {
        const result = analyzeFixture({
            css: [
                {
                    file: '/tmp/site/styles.css',
                    text: [
                        '.hero { padding: 10px; }',
                        '.hero .hero__title { font-size: 2rem; }',
                        '.hero .hero__title .badge { color: gold; }',
                        '.unused-widget { display: none; }',
                        '#main-nav { display: flex; }',
                        '#dead-anchor { color: red; }',
                    ].join('\n'),
                },
            ],
            markup: [
                {
                    file: '/tmp/site/index.html',
                    text: [
                        '<div id="main-nav"></div>',
                        '<section class="hero">',
                        '  <h1 class="hero__title">Hello <span class="badge">new</span></h1>',
                        '</section>',
                    ].join('\n'),
                },
            ],
        });

        assert.deepStrictEqual(result.dead, ['.unused-widget', '#dead-anchor']);
    });

    test('SPA: index.html with an inline <style> block', () => {
        const result = analyzeFixture({
            css: [
                {
                    file: '/tmp/site/index.html',
                    text: [
                        '<div class="page"><span class="page__label">x</span></div>',
                        '<style>',
                        '.page { color: red; }',
                        '.page .page__label { color: blue; }',
                        '.ghost { color: green; }',
                        '</style>',
                    ].join('\n'),
                },
            ],
            markup: [
                {
                    file: '/tmp/site/index.html',
                    text: [
                        '<div class="page"><span class="page__label">x</span></div>',
                        '<style>',
                        '.page { color: red; }',
                        '.page .page__label { color: blue; }',
                        '.ghost { color: green; }',
                        '</style>',
                    ].join('\n'),
                },
            ],
        });

        assert.deepStrictEqual(result.dead, ['.ghost']);
        assert.ok(
            result.index.usageCount > 0,
            'the inline <style> block should have been parsed and compared against the markup',
        );
    });

    test('Angular component with backtick template + nested child styles', () => {
        const result = analyzeFixture({
            css: [
                {
                    file: '/tmp/src/app/card.component.scss',
                    text: [
                        '.card { display: block; }',
                        '.card .card__body { padding: 8px; }',
                        '.card .card__body .card__text { color: #333; }',
                        '.card .card__footer { display: none; }',
                    ].join('\n'),
                },
            ],
            angular: [
                {
                    file: '/tmp/src/app/card.component.ts',
                    text: [
                        '@Component({',
                        "  selector: 'app-card',",
                        '  template: `',
                        '    <article class="card">',
                        '      <div class="card__body"><p class="card__text">x</p></div>',
                        '    </article>',
                        '  `,',
                        "  styleUrls: ['./card.component.scss']",
                        '})',
                        'export class CardComponent {}',
                    ].join('\n'),
                },
            ],
        });

        assert.deepStrictEqual(result.dead, ['.card__footer']);
    });

    test('React component with conditional classes and nested children', () => {
        const result = analyzeFixture({
            css: [
                {
                    file: '/tmp/src/Panel.module.css',
                    text: [
                        '.panel { }',
                        '.panel .panel__head { }',
                        '.panel .panel__head .panel__title { }',
                        '.panel .panel__stale { }',
                    ].join('\n'),
                },
            ],
            scripts: [
                {
                    file: '/tmp/src/Panel.tsx',
                    text: [
                        "import clsx from 'clsx';",
                        "import styles from './Panel.module.css';",
                        'export const Panel = ({ isOpen }) => (',
                        '  <section className={styles.panel}>',
                        '    <header className={clsx(styles.panel__head, isOpen && "is-open")}>',
                        '      <h2 className={styles.panel__title}>x</h2>',
                        '    </header>',
                        '  </section>',
                        ');',
                    ].join('\n'),
                },
            ],
        });

        assert.deepStrictEqual(result.dead, ['.panel__stale']);
    });

    test('Vue SFC with template and scoped style block', () => {
        const vueFile = [
            '<template>',
            '  <div class="shell">',
            '    <p class="shell__text" :class="{ muted: isMuted }">x</p>',
            '  </div>',
            '</template>',
            '<style scoped>',
            '.shell { display: grid; }',
            '.shell .shell__text { color: black; }',
            '.shell .shell__unused { color: red; }',
            '</style>',
        ].join('\n');

        const result = analyzeFixture({
            css: [{ file: '/tmp/src/App.vue', text: vueFile }],
            markup: [{ file: '/tmp/src/App.vue', text: vueFile }],
        });

        assert.deepStrictEqual(result.dead, ['.shell__unused']);
    });

    test('files with parse problems degrade gracefully and still return results', () => {
        const result = analyzeFixture({
            css: [{ file: '/tmp/broken.css', text: '.a { color: red; }\n.b { color: blue' }],
            markup: [{ file: '/tmp/index.html', text: '<div class="a"></div>' }],
        });
        assert.ok(result.dead.includes('.b'), `expected .b to be reported, got ${result.dead.join(',')}`);
    });
});
