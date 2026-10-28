import * as assert from 'node:assert';
import { ComponentGraph, componentNameOf, normalizeName } from '../../analysis/componentGraph';
import { isComponentTag, resolveRelativeImport, toGraphInputs, toKnownFiles } from '../../analysis/graphBuilder';

const known = toKnownFiles([
    '/tmp/src/app/parent.component.ts',
    '/tmp/src/app/parent.component.html',
    '/tmp/src/app/parent.component.scss',
    '/tmp/src/app/child.component.ts',
    '/tmp/src/app/child.component.html',
    '/tmp/src/app/grandchild.component.ts',
    '/tmp/src/app/unrelated.component.ts',
    '/tmp/src/components/Card.tsx',
]);

const resolveImport = (from: string, specifier: string) => resolveRelativeImport(from, specifier, known);

const angularGraph = (mode: 'off' | 'component' | 'tree' = 'tree') =>
    ComponentGraph.build(
        toGraphInputs([
            {
                file: '/tmp/src/app/parent.component.ts',
                styleFiles: ['/tmp/src/app/parent.component.scss'],
                templateFiles: ['/tmp/src/app/parent.component.html'],
                angularComponents: [{ selector: 'app-parent', styleFiles: ['/tmp/src/app/parent.component.scss'] }],
                renderedTags: ['div', 'app-child'],
                imports: [],
                ownsInlineStyles: false,
            },
            {
                file: '/tmp/src/app/child.component.ts',
                styleFiles: ['/tmp/src/app/child.component.scss'],
                templateFiles: ['/tmp/src/app/child.component.html'],
                angularComponents: [{ selector: 'app-child', styleFiles: [] }],
                renderedTags: ['app-grandchild'],
                imports: [],
                ownsInlineStyles: false,
            },
            {
                file: '/tmp/src/app/grandchild.component.ts',
                styleFiles: [],
                templateFiles: [],
                angularComponents: [{ selector: 'app-grandchild', styleFiles: [] }],
                renderedTags: [],
                imports: [],
                ownsInlineStyles: false,
            },
            {
                file: '/tmp/src/app/unrelated.component.ts',
                styleFiles: [],
                templateFiles: [],
                angularComponents: [{ selector: 'app-unrelated', styleFiles: [] }],
                renderedTags: [],
                imports: [],
                ownsInlineStyles: false,
            },
        ]),
        { mode, resolveImport },
    );

suite('componentGraph', () => {
    test('resolves children through Angular selectors, however deep', () => {
        const graph = angularGraph();
        assert.deepStrictEqual(graph.childrenOf('/tmp/src/app/parent.component.ts'), [
            '/tmp/src/app/child.component.ts',
        ]);
        assert.deepStrictEqual(graph.descendantsOf('/tmp/src/app/parent.component.ts').sort(), [
            '/tmp/src/app/child.component.ts',
            '/tmp/src/app/grandchild.component.ts',
        ]);
    });

    test('scope includes the component, its template, and every descendant', () => {
        const scope = angularGraph().scopeFor('/tmp/src/app/parent.component.scss');
        assert.ok(scope, 'parent stylesheet should have an owner');
        assert.strictEqual(scope?.kind, 'component-tree');
        assert.ok(scope?.files.has('/tmp/src/app/parent.component.ts'), 'owner missing');
        assert.ok(scope?.files.has('/tmp/src/app/parent.component.html'), 'owner template missing');
        assert.ok(scope?.files.has('/tmp/src/app/child.component.ts'), 'child missing');
        assert.ok(scope?.files.has('/tmp/src/app/child.component.html'), 'child template missing');
        assert.ok(scope?.files.has('/tmp/src/app/grandchild.component.ts'), 'grandchild missing');
        assert.ok(!scope?.files.has('/tmp/src/app/unrelated.component.ts'), 'unrelated component leaked into scope');
    });

    test('"component" mode stops at direct children', () => {
        const scope = angularGraph('component').scopeFor('/tmp/src/app/parent.component.scss');
        assert.ok(scope?.files.has('/tmp/src/app/child.component.ts'), 'child missing');
        assert.ok(!scope?.files.has('/tmp/src/app/grandchild.component.ts'), 'grandchild should be excluded');
    });

    test('"off" mode disables scoping entirely', () => {
        const graph = angularGraph('off');
        assert.strictEqual(graph.scopeFor('/tmp/src/app/parent.component.scss'), undefined);
    });

    test('a stylesheet with no owning component is global', () => {
        const graph = angularGraph();
        assert.strictEqual(graph.scopeFor('/tmp/src/styles/global.css'), undefined);
        assert.deepStrictEqual(graph.ownersOf('/tmp/src/styles/global.css'), []);
    });

    test('resolves React children through imports and JSX usage', () => {
        const graph = ComponentGraph.build(
            toGraphInputs([
                {
                    file: '/tmp/src/components/Panel.tsx',
                    styleFiles: ['/tmp/src/components/Panel.module.css'],
                    templateFiles: [],
                    angularComponents: [],
                    renderedTags: ['Card', 'div'],
                    imports: ['./Card', './Panel.module.css'],
                    ownsInlineStyles: false,
                },
                {
                    file: '/tmp/src/components/Card.tsx',
                    styleFiles: [],
                    templateFiles: [],
                    angularComponents: [],
                    renderedTags: [],
                    imports: [],
                    ownsInlineStyles: false,
                },
            ]),
            { mode: 'tree', resolveImport },
        );

        assert.deepStrictEqual(graph.childrenOf('/tmp/src/components/Panel.tsx'), ['/tmp/src/components/Card.tsx']);
        const scope = graph.scopeFor('/tmp/src/components/Panel.module.css');
        assert.ok(scope?.files.has('/tmp/src/components/Card.tsx'), 'child component missing from scope');
    });

    test('single-file components own their inline styles', () => {
        const graph = ComponentGraph.build(
            toGraphInputs([
                {
                    file: '/tmp/src/App.vue',
                    styleFiles: ['/tmp/src/App.vue'],
                    templateFiles: [],
                    angularComponents: [],
                    renderedTags: ['ChildThing'],
                    imports: ['./ChildThing.vue'],
                    ownsInlineStyles: true,
                },
            ]),
            { mode: 'tree', resolveImport },
        );

        const scope = graph.scopeFor('/tmp/src/App.vue');
        assert.strictEqual(scope?.kind, 'component-tree');
        assert.ok(scope?.files.has('/tmp/src/App.vue'));
    });

    test('classifies tags as component-ish only when they can be components', () => {
        assert.ok(isComponentTag('Card'));
        assert.ok(isComponentTag('app-card'));
        assert.ok(isComponentTag('my:widget'));
        assert.ok(!isComponentTag('div'));
        assert.ok(!isComponentTag('span'));
    });

    test('normalises component names across naming conventions', () => {
        assert.strictEqual(normalizeName('card-header'), 'cardheader');
        assert.strictEqual(normalizeName('CardHeader'), 'cardheader');
        assert.strictEqual(normalizeName('card_header'), 'cardheader');
        assert.strictEqual(componentNameOf('/tmp/src/app/card-header.component.ts'), 'CardHeader');
        assert.strictEqual(componentNameOf('/tmp/src/components/Card.tsx'), 'Card');
    });

    test('survives import cycles without hanging', () => {
        const graph = ComponentGraph.build(
            toGraphInputs([
                {
                    file: '/tmp/src/a.tsx',
                    styleFiles: ['/tmp/src/a.css'],
                    templateFiles: [],
                    angularComponents: [],
                    renderedTags: ['B'],
                    imports: ['./b', './a.css'],
                    ownsInlineStyles: false,
                },
                {
                    file: '/tmp/src/b.tsx',
                    styleFiles: [],
                    templateFiles: [],
                    angularComponents: [],
                    renderedTags: ['A'],
                    imports: ['./a'],
                    ownsInlineStyles: false,
                },
            ]),
            {
                mode: 'tree',
                resolveImport: (from, specifier) =>
                    resolveRelativeImport(from, specifier, toKnownFiles(['/tmp/src/a.tsx', '/tmp/src/b.tsx'])),
            },
        );

        const scope = graph.scopeFor('/tmp/src/a.css');
        assert.ok(scope?.files.has('/tmp/src/a.tsx'));
        assert.ok(scope?.files.has('/tmp/src/b.tsx'));
    });
});
