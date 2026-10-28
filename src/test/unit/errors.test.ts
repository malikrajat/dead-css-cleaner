import * as assert from 'node:assert';
import { describeError, ErrorCollector, errorMessage, safeAsync, safeSync } from '../../core/errors';

suite('ErrorCollector and safe execution helpers', () => {
    setup(() => {
        ErrorCollector.clear();
        ErrorCollector.unsubscribeAll();
    });

    teardown(() => {
        ErrorCollector.clear();
        ErrorCollector.unsubscribeAll();
    });

    test('records entries with the newest first', () => {
        ErrorCollector.log({ type: 'general', message: 'first', recoverable: true });
        ErrorCollector.log({ type: 'general', message: 'second', recoverable: true });

        const all = ErrorCollector.getAll();
        assert.strictEqual(all.length, 2);
        assert.strictEqual(all[0].message, 'second');
        assert.ok(all[0].timestamp instanceof Date);
    });

    test('summarises totals, types and fatal entries', () => {
        ErrorCollector.log({ type: 'css-parse', message: 'a', recoverable: true });
        ErrorCollector.log({ type: 'css-parse', message: 'b', recoverable: true });
        ErrorCollector.log({ type: 'file-access', message: 'c', recoverable: false });

        const summary = ErrorCollector.getSummary();
        assert.strictEqual(summary.total, 3);
        assert.strictEqual(summary.byType['css-parse'], 2);
        assert.strictEqual(summary.byType['file-access'], 1);
        assert.strictEqual(summary.fatal, 1);
    });

    test('bounds the log so a broken workspace cannot exhaust memory', () => {
        for (let i = 0; i < 250; i++) {
            ErrorCollector.log({ type: 'general', message: `entry ${i}`, recoverable: true });
        }
        const all = ErrorCollector.getAll();
        assert.strictEqual(all.length, 200);
        assert.strictEqual(all[0].message, 'entry 249');
    });

    test('notifies subscribers and survives a throwing subscriber', () => {
        const seen: string[] = [];
        ErrorCollector.subscribe(() => {
            throw new Error('subscriber exploded');
        });
        ErrorCollector.subscribe((error) => {
            seen.push(error.message);
        });

        ErrorCollector.log({ type: 'general', message: 'hello', recoverable: true });
        assert.deepStrictEqual(seen, ['hello']);

        ErrorCollector.unsubscribeAll();
        ErrorCollector.log({ type: 'general', message: 'ignored', recoverable: true });
        assert.deepStrictEqual(seen, ['hello']);
    });

    test('from() captures the underlying error details', () => {
        const record = ErrorCollector.from('react-parse', 'Parse failed', new Error('unexpected token'), {
            file: '/tmp/App.tsx',
        });

        assert.strictEqual(record.type, 'react-parse');
        assert.strictEqual(record.file, '/tmp/App.tsx');
        assert.ok(record.details?.includes('unexpected token'));
        assert.strictEqual(record.recoverable, true);
        assert.strictEqual(ErrorCollector.getAll().length, 1);
    });

    test('clear() empties the log', () => {
        ErrorCollector.log({ type: 'general', message: 'x', recoverable: true });
        ErrorCollector.clear();
        assert.strictEqual(ErrorCollector.getAll().length, 0);
        assert.strictEqual(ErrorCollector.getSummary().total, 0);
    });

    test('describeError and errorMessage handle non-Error values', () => {
        assert.strictEqual(errorMessage(new Error('boom')), 'boom');
        assert.strictEqual(errorMessage('plain'), 'plain');
        assert.strictEqual(errorMessage(42), '42');
        assert.ok(describeError(new Error('boom')).includes('boom'));
        assert.strictEqual(describeError({ code: 1 }), '{"code":1}');

        const circular: Record<string, unknown> = {};
        circular.self = circular;
        assert.strictEqual(typeof describeError(circular), 'string');
    });

    test('safeSync returns the fallback and records the failure', () => {
        const value = safeSync(
            () => {
                throw new Error('disk on fire');
            },
            'fallback',
            { type: 'file-access', message: 'Could not read file', file: '/tmp/a.css' },
        );

        assert.strictEqual(value, 'fallback');
        const logged = ErrorCollector.getAll();
        assert.strictEqual(logged.length, 1);
        assert.strictEqual(logged[0].file, '/tmp/a.css');
    });

    test('safeSync passes through successful results without logging', () => {
        const value = safeSync(() => 21 * 2, 0, { type: 'general', message: 'nope' });
        assert.strictEqual(value, 42);
        assert.strictEqual(ErrorCollector.getAll().length, 0);
    });

    test('safeAsync resolves the fallback when the promise rejects', async () => {
        const value = await safeAsync(
            async () => {
                throw new Error('nope');
            },
            [],
            { type: 'general', message: 'Async failure' },
        );

        assert.deepStrictEqual(value, []);
        assert.strictEqual(ErrorCollector.getAll()[0].message, 'Async failure');
    });
});
