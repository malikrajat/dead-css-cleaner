import * as assert from 'node:assert';
import { parseAngularFile } from '../../parsers/angularParser';
import { parseMarkupText } from '../../parsers/markupParser';

function names(text: string, file = '/tmp/index.html'): string[] {
    return parseMarkupText(file, text).usages.map((usage) => usage.name);
}

suite('markupParser (SPA HTML + Angular/Vue/Svelte templates)', () => {
    test('plain SPA index.html with nested child classes', () => {
        const found = names(
            [
                '<!doctype html>',
                '<html>',
                '  <body>',
                '    <div id="app" class="app-shell">',
                '      <header class="site-header">',
                '        <nav class="nav">',
                '          <ul class="nav-list">',
                '            <li class="nav-item nav-item--active"><a class="nav-link">Home</a></li>',
                '          </ul>',
                '        </nav>',
                '      </header>',
                '    </div>',
                '  </body>',
                '</html>',
            ].join('\n'),
        );

        ['app-shell', 'site-header', 'nav', 'nav-list', 'nav-item', 'nav-item--active', 'nav-link'].forEach(
            (expected) => {
                assert.ok(found.includes(expected), `${expected} missing from ${found.join(',')}`);
            },
        );
    });

    test('multi-line class attribute and id attributes', () => {
        const found = names('<div\n  class="card\n         card--wide"\n  id="hero-card">x</div>');
        assert.ok(found.includes('card') && found.includes('card--wide'), found.join(','));
        assert.ok(found.includes('hero-card'), 'id missing');
    });

    test('interpolated classes in HTML and Angular', () => {
        const found = names('<div class="base {{ theme }} extra"></div>');
        assert.ok(found.includes('base') && found.includes('extra'), found.join(','));
    });

    test('Angular bindings: [class.x], [ngClass] object/array/ternary, ngClass', () => {
        const found = names(
            [
                '<div [class.active]="isActive" [ngClass]="{ open: isOpen, \'is-large\': isLarge }">',
                "  <span [ngClass]=\"['chip', isNew && 'chip--new']\"></span>",
                "  <i [ngClass]=\"isHot ? 'hot' : 'cold'\"></i>",
                '  <b ngClass="static-one static-two"></b>',
                '</div>',
            ].join('\n'),
        );
        ['active', 'open', 'is-large', 'chip', 'chip--new', 'hot', 'cold', 'static-one', 'static-two'].forEach(
            (expected) => {
                assert.ok(found.includes(expected), `${expected} missing from ${found.join(',')}`);
            },
        );
    });

    test('Vue bindings: :class object/array and class list', () => {
        const found = names(
            [
                '<div :class="{ active: isActive, disabled: isDisabled }">',
                "  <span :class=\"['tag', isNew && 'tag--new']\"></span>",
                '</div>',
            ].join('\n'),
            '/tmp/App.vue',
        );
        ['active', 'disabled', 'tag', 'tag--new'].forEach((expected) => {
            assert.ok(found.includes(expected), `${expected} missing from ${found.join(',')}`);
        });
    });

    test('Svelte class directives and class:list', () => {
        const found = names(
            '<div class="base" class:active={isActive} class:list={["a", "b"]}></div>',
            '/tmp/App.svelte',
        );
        ['base', 'active', 'a', 'b'].forEach((expected) => {
            assert.ok(found.includes(expected), `${expected} missing from ${found.join(',')}`);
        });
    });

    test('ignores script and style blocks', () => {
        const found = names(
            [
                '<div class="real"></div>',
                '<style>.not-html { color: red; }</style>',
                "<script>const x = 'not-html';</script>",
            ].join('\n'),
        );
        assert.ok(found.includes('real'), found.join(','));
        assert.ok(!found.includes('not-html'), `style/script content leaked: ${found.join(',')}`);
    });
});

suite('angularParser', () => {
    test('backtick inline templates are parsed (previous major bug)', () => {
        const result = parseAngularFile(
            '/tmp/app.component.ts',
            [
                "import { Component } from '@angular/core';",
                '@Component({',
                "  selector: 'app-root',",
                '  template: `',
                '    <div class="shell">',
                '      <div class="shell__body">',
                '        <p class="shell__text text--muted">{{ message }}</p>',
                '      </div>',
                '    </div>',
                '  `,',
                "  styleUrls: ['./app.component.scss']",
                '})',
                'export class AppComponent {}',
            ].join('\n'),
        );

        const found = result.usages.map((usage) => usage.name);
        ['shell', 'shell__body', 'shell__text', 'text--muted'].forEach((expected) => {
            assert.ok(found.includes(expected), `${expected} missing from ${found.join(',')}`);
        });
        assert.strictEqual(result.components.length, 1);
        assert.strictEqual(result.components[0].templateFound, true);
    });

    test('template literal with ${} expression string literals', () => {
        const result = parseAngularFile(
            '/tmp/inline.component.ts',
            [
                '@Component({',
                "  template: `<div class=\"box ${isActive ? 'box--on' : 'box--off'}\"></div>`",
                '})',
                'export class InlineComponent {}',
            ].join('\n'),
        );
        const found = result.usages.map((usage) => usage.name);
        ['box', 'box--on', 'box--off'].forEach((expected) => {
            assert.ok(found.includes(expected), `${expected} missing from ${found.join(',')}`);
        });
    });

    test('@HostBinding and host object bindings', () => {
        const result = parseAngularFile(
            '/tmp/directive.ts',
            [
                "@Component({ selector: 'app-x', template: '<span class=\"tpl\"></span>', host: { '[class.host-open]': 'isOpen', class: 'host-base' } })",
                'export class XComponent {',
                "  @HostBinding('class.is-collapsed') collapsed = false;",
                '}',
            ].join('\n'),
        );
        const found = result.usages.map((usage) => usage.name);
        ['tpl', 'host-open', 'host-base', 'is-collapsed'].forEach((expected) => {
            assert.ok(found.includes(expected), `${expected} missing from ${found.join(',')}`);
        });
    });

    test('component selector contributes element tags', () => {
        const result = parseAngularFile(
            '/tmp/app.component.ts',
            ["@Component({ selector: 'app-hero', template: '<div></div>' })", 'export class HeroComponent {}'].join(
                '\n',
            ),
        );
        assert.ok(result.componentSelectors.has('app-hero'), [...result.componentSelectors].join(','));
    });

    test('string templates still work', () => {
        const result = parseAngularFile(
            '/tmp/legacy.component.ts',
            [
                "@Component({ selector: 'app-l', template: '<div class=\"legacy-box\"></div>' })",
                'export class LComponent {}',
            ].join('\n'),
        );
        assert.ok(result.usages.some((usage) => usage.name === 'legacy-box'));
    });
});
