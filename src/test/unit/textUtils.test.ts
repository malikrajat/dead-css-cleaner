import * as assert from 'node:assert';
import {
    collectStringLiterals,
    extractDynamicPrefixes,
    findMatches,
    hashString,
    isValidClassToken,
    isValidIdToken,
    LineIndex,
    looksBinary,
    normalizePathForCompare,
    splitClassTokens,
    toOneBasedColumn,
    unquote,
} from '../../core/textUtils';

suite('textUtils', () => {
    suite('LineIndex', () => {
        const text = 'a\nbb\r\nc';
        const index = new LineIndex(text);

        test('counts lines including CRLF', () => {
            assert.strictEqual(index.lineCount, 3);
            assert.strictEqual(new LineIndex('').lineCount, 1);
        });

        test('maps offsets to 1-based positions', () => {
            assert.deepStrictEqual(index.positionAt(0), { line: 1, column: 1, offset: 0 });
            assert.deepStrictEqual(index.positionAt(3), { line: 2, column: 2, offset: 3 });
            assert.deepStrictEqual(index.positionAt(6), { line: 3, column: 1, offset: 6 });
        });

        test('maps positions back to offsets', () => {
            assert.strictEqual(index.offsetOf(1, 1), 0);
            assert.strictEqual(index.offsetOf(2, 2), 3);
            assert.strictEqual(index.offsetOf(3, 1), 6);
        });

        test('clamps out-of-range input', () => {
            assert.strictEqual(index.positionAt(9999).offset, text.length);
            assert.strictEqual(index.positionAt(-5).offset, 0);
            assert.ok(index.offsetOf(99, 99) <= text.length);
        });

        test('returns line text without the newline', () => {
            assert.strictEqual(index.lineText(1), 'a');
            assert.strictEqual(index.lineText(2), 'bb');
            assert.strictEqual(index.lineText(3), 'c');
        });
    });

    test('toOneBasedColumn converts Babel columns', () => {
        assert.strictEqual(toOneBasedColumn(0), 1);
        assert.strictEqual(toOneBasedColumn(5), 6);
        assert.strictEqual(toOneBasedColumn(undefined), 1);
        assert.strictEqual(toOneBasedColumn(null), 1);
    });

    test('splitClassTokens trims and collapses whitespace', () => {
        assert.deepStrictEqual(splitClassTokens('  a  b\n\tc '), ['a', 'b', 'c']);
        assert.deepStrictEqual(splitClassTokens(''), []);
        assert.deepStrictEqual(splitClassTokens('   '), []);
    });

    test('validates class and id tokens', () => {
        assert.ok(isValidClassToken('btn-primary'));
        assert.ok(isValidClassToken('_private'));
        assert.ok(isValidClassToken('a1'));
        assert.ok(isValidIdToken('main-app'));
        assert.ok(!isValidClassToken('1abc'));
        assert.ok(!isValidClassToken('has space'));
        assert.ok(!isValidClassToken(''));
        assert.ok(!isValidClassToken('a'.repeat(201)));
    });

    test('unquote strips matching quotes only', () => {
        assert.strictEqual(unquote('"x"'), 'x');
        assert.strictEqual(unquote("'x'"), 'x');
        assert.strictEqual(unquote('`x`'), 'x');
        assert.strictEqual(unquote(' x '), 'x');
        assert.strictEqual(unquote('"x'), '"x');
    });

    test('extractDynamicPrefixes recognises every dynamic style', () => {
        assert.deepStrictEqual(extractDynamicPrefixes('`item-${size}`'), ['item-']);
        assert.deepStrictEqual(extractDynamicPrefixes("'btn-' + size"), ['btn-']);
        assert.deepStrictEqual(extractDynamicPrefixes('col-*'), ['col-']);
        assert.ok(extractDynamicPrefixes('card--{{ size }}').includes('card--'));
        assert.ok(extractDynamicPrefixes('.col-#{$size}').includes('col-'));
        assert.deepStrictEqual(extractDynamicPrefixes('plain-class'), []);
        assert.deepStrictEqual(extractDynamicPrefixes(''), []);
    });

    test('collectStringLiterals finds single, double and backtick strings', () => {
        const literals = collectStringLiterals('a = \'one\'; b = "two"; c = `three`;');
        assert.deepStrictEqual(
            literals.map((literal) => literal.value),
            ['one', 'two', 'three'],
        );
        assert.ok(literals[0].index > 0);
    });

    test('collectStringLiterals ignores unterminated strings', () => {
        assert.deepStrictEqual(collectStringLiterals("const x = 'unterminated"), []);
    });

    test('collectStringLiterals handles escaped quotes', () => {
        const literals = collectStringLiterals(String.raw`x = 'it\'s ok';`);
        assert.deepStrictEqual(
            literals.map((literal) => literal.value),
            [String.raw`it\'s ok`],
        );
    });

    test('findMatches returns every match and tolerates zero-length patterns', () => {
        assert.strictEqual(findMatches(/a/g, 'aaa').length, 3);
        assert.strictEqual(findMatches(/a/, 'aa').length, 2, 'non-global patterns should be handled');
        assert.strictEqual(findMatches(/(?=a)/g, 'aa').length, 2, 'zero-length matches must not loop forever');
        assert.deepStrictEqual(findMatches(/a/g, ''), []);
        assert.strictEqual(findMatches(/\bclass\b/g, 'class other class').length, 2);
    });

    test('findMatches does not leak lastIndex state between calls', () => {
        const shared = /a/g;
        assert.strictEqual(findMatches(shared, 'aaa').length, 3);
        assert.strictEqual(findMatches(shared, 'aaa').length, 3);
    });

    test('looksBinary detects NUL bytes', () => {
        assert.strictEqual(looksBinary('plain text'), false);
        assert.strictEqual(looksBinary('has\u0000nul'), true);
        assert.strictEqual(looksBinary(''), false);
    });

    test('hashString is stable and changes with input', () => {
        assert.strictEqual(hashString('abc'), hashString('abc'));
        assert.notStrictEqual(hashString('abc'), hashString('abd'));
        assert.ok(hashString('abc').length > 0);
    });

    test('normalizePathForCompare is case and separator insensitive', () => {
        assert.strictEqual(normalizePathForCompare('C:\\A\\B.css'), normalizePathForCompare('c:/a/b.css'));
    });
});
