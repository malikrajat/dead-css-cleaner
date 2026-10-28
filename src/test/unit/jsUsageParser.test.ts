import * as assert from 'node:assert';
import { parseJsUsage } from '../../parsers/jsUsageParser';

const limits = { maxSourceFileSizeKb: 2048, analyzeIds: true };

function names(text: string, file = '/tmp/Component.tsx'): string[] {
    return parseJsUsage(file, text, limits).usages.map((usage) => usage.name);
}

suite('jsUsageParser (React / JS / CSS modules)', () => {
    test('static className strings', () => {
        const found = names('const A = () => <div className="btn primary">x</div>;');
        assert.ok(found.includes('btn') && found.includes('primary'), found.join(','));
    });

    test('conditional and logical expressions inside className (child class case)', () => {
        const found = names(
            [
                'import clsx from "clsx";',
                'const A = ({ isOpen }) => (',
                '  <div className={clsx("parent", isOpen && "child", isOpen ? "expanded" : "collapsed")}>x</div>',
                ');',
            ].join('\n'),
        );
        ['parent', 'child', 'expanded', 'collapsed'].forEach((expected) => {
            assert.ok(found.includes(expected), `${expected} missing from ${found.join(',')}`);
        });
    });

    test('template literal with nested conditional (nth level child)', () => {
        const found = names(
            'const A = ({ on }) => <div className={`card ${on ? "card--active" : ""}`}><span className={`card__icon ${on ? "is-on" : ""}`} /></div>;',
        );
        ['card', 'card--active', 'card__icon', 'is-on'].forEach((expected) => {
            assert.ok(found.includes(expected), `${expected} missing from ${found.join(',')}`);
        });
    });

    test('CSS modules member access', () => {
        const found = names(
            [
                "import styles from './App.module.css';",
                'const A = () => <div className={styles.container}><span className={styles["child-item"]} /></div>;',
            ].join('\n'),
        );
        assert.ok(found.includes('container'), found.join(','));
        assert.ok(found.includes('child-item'), found.join(','));
    });

    test('arrays, objects and variables', () => {
        const found = names(
            [
                "const buttonClass = 'btn btn--primary';",
                'const A = ({ active }) => <div className={["flex", { "is-active": active }, buttonClass]}>x</div>;',
            ].join('\n'),
        );
        ['flex', 'is-active', 'btn', 'btn--primary'].forEach((expected) => {
            assert.ok(found.includes(expected), `${expected} missing from ${found.join(',')}`);
        });
    });

    test('DOM APIs: classList, querySelector, setAttribute, getElementById', () => {
        const found = names(
            [
                "document.querySelector('.wrapper .panel')?.classList.add('is-visible');",
                "element.setAttribute('class', 'legacy legacy--mod');",
                "const el = document.getElementById('main-app');",
                "el.classList.toggle('open');",
            ].join('\n'),
            '/tmp/init.js',
        );
        ['wrapper', 'panel', 'is-visible', 'legacy', 'legacy--mod', 'main-app', 'open'].forEach((expected) => {
            assert.ok(found.includes(expected), `${expected} missing from ${found.join(',')}`);
        });
    });

    test('React.createElement className objects', () => {
        const found = names("React.createElement('div', { className: 'box box--wide' }, 'x');");
        assert.ok(found.includes('box') && found.includes('box--wide'), found.join(','));
    });

    test('string concatenation produces a dynamic prefix', () => {
        const result = parseJsUsage(
            '/tmp/App.tsx',
            "const A = ({ size }) => <div className={'item-' + size} />;",
            limits,
        );
        assert.ok(result.dynamicPatterns.includes('item-'), result.dynamicPatterns.join(','));
    });

    test('falls back to text scanning for unparseable files', () => {
        const broken = "<div class='from-template'>ok</div>\nconst x = `bad ${ unclosed";
        const found = names(broken, '/tmp/broken.js');
        assert.ok(found.includes('from-template'), found.join(','));
    });

    test('ignores unrelated string literals (no false negatives from prose)', () => {
        const found = names("const greeting = 'Hello World'; function f(){ return 'not-a-class'; }", '/tmp/util.ts');
        assert.ok(!found.includes('Hello'), found.join(','));
        assert.ok(!found.includes('not-a-class'), found.join(','));
    });

    test('static tokens inside a plain template literal are not treated as usage (precision)', () => {
        const found = names('export const c = (index: number) => `item-${index}`;', '/tmp/util.ts');
        assert.deepStrictEqual(found, []);
    });
});
