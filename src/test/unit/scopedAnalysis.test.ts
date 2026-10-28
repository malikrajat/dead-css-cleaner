import * as assert from 'node:assert';
import { analyzeFixture, fixturePath } from './helpers';

suite('component-scoped dead CSS detection', () => {
    test('parent stylesheet classes used by a child component are NOT dead', () => {
        const result = analyzeFixture({
            css: [
                {
                    file: '/tmp/src/app/parent.component.scss',
                    text: [
                        '.parent-shell { display: grid; }',
                        '.parent-shell .parent__title { font-weight: 600; }',
                        '.parent-shell .parent__footer { margin-top: 8px; }',
                        '.parent-shell .parent__never-used { color: red; }',
                    ].join('\n'),
                },
            ],
            angular: [
                {
                    file: '/tmp/src/app/parent.component.ts',
                    text: [
                        '@Component({',
                        "  selector: 'app-parent',",
                        "  templateUrl: './parent.component.html',",
                        "  styleUrls: ['./parent.component.scss']",
                        '})',
                        'export class ParentComponent {}',
                    ].join('\n'),
                },
                {
                    file: '/tmp/src/app/child.component.ts',
                    text: [
                        '@Component({',
                        "  selector: 'app-child',",
                        '  template: `',
                        '    <div class="parent__title">child renders a parent class</div>',
                        '    <span class="parent__footer">and another one</span>',
                        '  `,',
                        '})',
                        'export class ChildComponent {}',
                    ].join('\n'),
                },
            ],
            markup: [
                {
                    file: '/tmp/src/app/parent.component.html',
                    text: '<section class="parent-shell">parent uses its own class<app-child></app-child></section>',
                },
            ],
        });

        assert.deepStrictEqual(result.dead, ['.parent__never-used']);
        assert.ok(
            !result.dead.includes('.parent__title') && !result.dead.includes('.parent__footer'),
            `child usage was ignored: ${result.dead.join(', ')}`,
        );
    });

    test('a class used only by a grandchild is still validated', () => {
        const result = analyzeFixture({
            css: [
                {
                    file: '/tmp/src/app/top.component.scss',
                    text: '.top .top__deep-child { color: red; }\n.top .top__ghost { color: blue; }',
                },
            ],
            angular: [
                {
                    file: '/tmp/src/app/top.component.ts',
                    text: [
                        '@Component({',
                        "  selector: 'app-top',",
                        "  templateUrl: './top.component.html',",
                        "  styleUrls: ['./top.component.scss']",
                        '})',
                        'export class TopComponent {}',
                    ].join('\n'),
                },
                {
                    file: '/tmp/src/app/middle.component.ts',
                    text: [
                        "@Component({ selector: 'app-middle', template: '<app-leaf></app-leaf>' })",
                        'export class MiddleComponent {}',
                    ].join('\n'),
                },
                {
                    file: '/tmp/src/app/leaf.component.ts',
                    text: [
                        '@Component({',
                        "  selector: 'app-leaf',",
                        '  template: \'<div class="top__deep-child"></div>\'',
                        '})',
                        'export class LeafComponent {}',
                    ].join('\n'),
                },
            ],
            markup: [
                {
                    file: '/tmp/src/app/top.component.html',
                    text: '<div class="top"><app-middle></app-middle></div>',
                },
            ],
        });

        assert.deepStrictEqual(result.dead, ['.top__ghost']);
    });

    test('direct-child-only mode ignores grandchild usage (opt-in strictness)', () => {
        const fixture = {
            css: [{ file: '/tmp/src/app/top.component.scss', text: '.top__deep-child { color: red; }' }],
            angular: [
                {
                    file: '/tmp/src/app/top.component.ts',
                    text: [
                        '@Component({',
                        "  selector: 'app-top',",
                        "  templateUrl: './top.component.html',",
                        "  styleUrls: ['./top.component.scss']",
                        '})',
                        'export class TopComponent {}',
                    ].join('\n'),
                },
                {
                    file: '/tmp/src/app/middle.component.ts',
                    text: [
                        "@Component({ selector: 'app-middle', template: '<app-leaf></app-leaf>' })",
                        'export class MiddleComponent {}',
                    ].join('\n'),
                },
                {
                    file: '/tmp/src/app/leaf.component.ts',
                    text: [
                        '@Component({',
                        "  selector: 'app-leaf',",
                        '  template: \'<div class="top__deep-child"></div>\'',
                        '})',
                        'export class LeafComponent {}',
                    ].join('\n'),
                },
            ],
            markup: [
                {
                    file: '/tmp/src/app/top.component.html',
                    text: '<div class="top"><app-middle></app-middle></div>',
                },
            ],
        };

        assert.deepStrictEqual(analyzeFixture(fixture, { componentScope: 'tree' }).dead, []);
        // In `component` mode the grandchild is out of scope, so the token is
        // reported as "used elsewhere" rather than dead.
        const directChildrenOnly = analyzeFixture(fixture, { componentScope: 'component' });
        assert.deepStrictEqual(directChildrenOnly.dead, []);
        assert.deepStrictEqual(directChildrenOnly.usedElsewhere, ['.top__deep-child']);
    });

    test('tokens used in an unrelated component are reported as used elsewhere, not dead', () => {
        const result = analyzeFixture({
            css: [{ file: '/tmp/src/app/panel.component.scss', text: '.panel__shared { color: red; }' }],
            components: [
                {
                    file: '/tmp/src/app/panel.component.ts',
                    styleFiles: ['/tmp/src/app/panel.component.scss'],
                    selectors: ['app-panel'],
                    renderedTags: ['div'],
                },
                {
                    file: '/tmp/src/app/other.component.ts',
                    selectors: ['app-other'],
                    renderedTags: ['div'],
                },
            ],
            markup: [{ file: '/tmp/src/app/other.component.html', text: '<div class="panel__shared"></div>' }],
        });

        assert.deepStrictEqual(result.dead, []);
        assert.deepStrictEqual(result.usedElsewhere, ['.panel__shared']);
    });

    test('global stylesheets keep whole-workspace matching', () => {
        const result = analyzeFixture({
            css: [
                { file: '/tmp/public/global.css', text: '.from-global { color: red; }\n.really-dead { color: blue; }' },
            ],
            markup: [{ file: '/tmp/public/index.html', text: '<div class="from-global"></div>' }],
        });

        assert.deepStrictEqual(result.dead, ['.really-dead']);
    });

    test('componentScope "off" restores whole-workspace matching', () => {
        const fixture = {
            css: [{ file: '/tmp/src/app/panel.component.scss', text: '.panel__shared { color: red; }' }],
            components: [
                {
                    file: '/tmp/src/app/panel.component.ts',
                    styleFiles: ['/tmp/src/app/panel.component.scss'],
                    selectors: ['app-panel'],
                },
            ],
            markup: [{ file: '/tmp/src/app/other.component.html', text: '<div class="panel__shared"></div>' }],
        };

        const scoped = analyzeFixture(fixture);
        const global = analyzeFixture(fixture, { componentScope: 'off' });

        assert.deepStrictEqual(scoped.dead, []);
        assert.deepStrictEqual(scoped.usedElsewhere, ['.panel__shared']);
        assert.deepStrictEqual(global.dead, []);
        assert.deepStrictEqual(global.usedElsewhere, []);
    });

    test('the component summary exposes the resolved tree', () => {
        const result = analyzeFixture({
            css: [{ file: '/tmp/src/app/parent.component.scss', text: '.x { color: red; }' }],
            components: [
                {
                    file: '/tmp/src/app/parent.component.ts',
                    styleFiles: ['/tmp/src/app/parent.component.scss'],
                    selectors: ['app-parent'],
                    renderedTags: ['app-child'],
                },
                { file: '/tmp/src/app/child.component.ts', selectors: ['app-child'] },
            ],
        });

        const parent = result.components.find(
            (component) => component.file === fixturePath('/tmp/src/app/parent.component.ts'),
        );
        assert.ok(parent, 'parent component missing from the summary');
        assert.strictEqual(parent?.name, 'Parent');
        assert.deepStrictEqual(parent?.styleFiles, [fixturePath('/tmp/src/app/parent.component.scss')]);
        assert.deepStrictEqual(parent?.children, [fixturePath('/tmp/src/app/child.component.ts')]);
        assert.strictEqual(parent?.descendantCount, 1);
    });
});
