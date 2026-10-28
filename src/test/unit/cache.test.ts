import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AnalysisCache } from '../../core/cache';

suite('AnalysisCache', () => {
    let directory: string;
    let file: string;

    setup(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-css-cache-'));
        file = path.join(directory, 'styles.css');
        fs.writeFileSync(file, '.a { color: red; }\n');
    });

    teardown(() => {
        fs.rmSync(directory, { recursive: true, force: true });
    });

    test('returns a cached value for an unchanged file', () => {
        const cache = new AnalysisCache<string>(60000);
        cache.set(file, 'parsed');

        assert.strictEqual(cache.get(file), 'parsed');
        assert.strictEqual(cache.get(file), 'parsed');

        const stats = cache.getStats();
        assert.strictEqual(stats.entries, 1);
        assert.strictEqual(stats.hits, 2);
        assert.strictEqual(stats.misses, 0);
    });

    test('misses for unknown files', () => {
        const cache = new AnalysisCache<string>(60000);
        assert.strictEqual(cache.get(path.join(directory, 'missing.css')), undefined);
        assert.strictEqual(cache.getStats().misses, 1);
    });

    test('invalidates the entry when the file modification time changes', () => {
        const cache = new AnalysisCache<string>(60000);
        cache.set(file, 'first');
        assert.strictEqual(cache.get(file), 'first');

        const later = new Date(Date.now() + 5000);
        fs.utimesSync(file, later, later);

        assert.strictEqual(cache.get(file), undefined);
        assert.strictEqual(cache.getStats().invalidations, 1);
    });

    test('expires entries after the configured TTL', () => {
        const cache = new AnalysisCache<string>(1);
        cache.set(file, 'value');

        const deadline = Date.now() + 6;
        while (Date.now() < deadline) {
            /* wait for the TTL to elapse */
        }

        assert.strictEqual(cache.get(file), undefined);
        assert.strictEqual(cache.getStats().invalidations, 1);
    });

    test('treats a TTL of zero as "never expires"', () => {
        const cache = new AnalysisCache<string>(0);
        cache.set(file, 'forever');

        const deadline = Date.now() + 6;
        while (Date.now() < deadline) {
            /* TTL disabled, so the value must survive */
        }

        assert.strictEqual(cache.get(file), 'forever');
    });

    test('is a no-op when disabled', () => {
        const cache = new AnalysisCache<string>(60000, false);
        cache.set(file, 'value');

        assert.strictEqual(cache.get(file), undefined);
        assert.strictEqual(cache.getStats().entries, 0);
    });

    test('configure() can enable, disable and clear the cache', () => {
        const cache = new AnalysisCache<string>(60000, false);
        cache.configure(60000, true);
        cache.set(file, 'value');
        assert.strictEqual(cache.get(file), 'value');

        cache.configure(60000, false);
        assert.strictEqual(cache.get(file), undefined);
        assert.strictEqual(cache.getStats().entries, 0);
    });

    test('invalidate() and clear() drop entries', () => {
        const cache = new AnalysisCache<string>(60000);
        cache.set(file, 'value');

        cache.invalidate(file);
        assert.strictEqual(cache.get(file), undefined);
        assert.strictEqual(cache.getStats().invalidations, 1);

        cache.set(file, 'value');
        cache.clear();
        assert.strictEqual(cache.getStats().entries, 0);
        assert.strictEqual(cache.getStats().hits, 0);
    });

    test('deleted files behave like a miss instead of throwing', () => {
        const cache = new AnalysisCache<string>(60000);
        cache.set(file, 'value');
        fs.rmSync(file);

        assert.strictEqual(cache.get(file), undefined);
        assert.strictEqual(cache.getStats().misses, 1);
    });
});
