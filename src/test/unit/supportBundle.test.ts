import * as assert from 'node:assert';
import { strFromU8, unzipSync } from 'fflate';
import type { AnalysisError } from '../../core/errors';
import type { LogRecord } from '../../core/logger';
import {
    buildDiagnosticsText,
    buildSupportBundle,
    createSupportZip,
    diagnosticsFileName,
    formatErrors,
    formatLogRecord,
    formatSettings,
    type RedactionRoot,
    redactText,
    type SupportBundleInput,
} from '../../core/supportBundle';

const ROOTS: RedactionRoot[] = [
    { path: 'C:\\Users\\Rajat', label: '<home>' },
    { path: 'C:\\Users\\Rajat\\project', label: '<workspace>' },
];

const ERROR: AnalysisError = {
    type: 'css-parse',
    file: 'C:\\Users\\Rajat\\project\\src\\a.css',
    message: 'Could not parse a rule',
    details: 'Error: unclosed block\n    at parse (C:\\Users\\Rajat\\project\\src\\parser.ts:1:1)',
    recoverable: true,
    timestamp: new Date('2026-11-03T10:00:00.000Z'),
};

const LOG: LogRecord = {
    level: 'info',
    message: 'Analysed C:\\Users\\Rajat\\project\\src',
    details: 'line one\nline two\nline three',
    timestamp: new Date('2026-11-03T10:01:00.000Z'),
};

function sampleInput(): SupportBundleInput {
    return {
        generatedAt: new Date(2026, 10, 3, 16, 54, 7),
        extensionVersion: '2.1.0',
        environment: {
            vscodeVersion: '1.95.0',
            workspaceRoots: ['C:\\Users\\Rajat\\project'],
        },
        settings: {
            analysisMode: { value: 'token', defaultValue: 'token', source: 'default' },
            excludePatterns: { value: ['**/node_modules/**'], source: 'user' },
        },
        stats: { cssFiles: 3, findings: 2, cache: { entries: 4 } },
        errors: [ERROR],
        log: [LOG],
        redactionRoots: ROOTS,
    };
}

suite('support bundle', () => {
    test('names the file with a sortable timestamp', () => {
        assert.strictEqual(
            diagnosticsFileName(new Date(2026, 10, 3, 16, 54, 7)),
            'dead-css-cleaner-diagnostics-20261103-165407.zip',
        );
    });

    test('redacts workspace roots before home roots', () => {
        const redacted = redactText(
            'C:\\Users\\Rajat\\project\\src\\a.css and c:/users/rajat/project/src/b.css',
            ROOTS,
        );
        assert.ok(redacted.includes('<workspace>\\src\\a.css'));
        assert.ok(redacted.includes('<workspace>/src/b.css'));
        assert.ok(!redacted.toLowerCase().includes('rajat'));
    });

    test('redacts home paths outside the workspace', () => {
        const redacted = redactText('C:\\Users\\Rajat\\.vscode\\settings.json', ROOTS);
        assert.strictEqual(redacted, '<home>\\.vscode\\settings.json');
    });

    test('formats log records with full details or a line limit', () => {
        const full = formatLogRecord(LOG);
        assert.ok(full.includes('[2026-11-03T10:01:00.000Z] [INFO]'));
        assert.ok(full.includes('line three'));

        const limited = formatLogRecord(LOG, { maxDetailLines: 1, shortTime: true });
        assert.ok(limited.includes('[10:01:00.000]'));
        assert.ok(limited.includes('line one'));
        assert.ok(!limited.includes('line three'));
        assert.ok(limited.includes('2 more line(s) omitted'));
    });

    test('formats errors with type, stack and recoverability', () => {
        const text = formatErrors([ERROR]);
        assert.ok(text.includes('#1 [css-parse] recoverable'));
        assert.ok(text.includes('message: Could not parse a rule'));
        assert.ok(text.includes('at parse'));
    });

    test('formats settings with value, source and default', () => {
        const text = formatSettings({
            analysisMode: { value: 'token', defaultValue: 'strict', source: 'user' },
        });
        assert.ok(text.includes('analysisMode: token'));
        assert.ok(text.includes('source: user'));
        assert.ok(text.includes('default: strict'));
    });

    test('builds a self-contained diagnostics text', () => {
        const text = buildDiagnosticsText(sampleInput());
        assert.ok(text.includes('Dead CSS Cleaner diagnostics'));
        assert.ok(text.includes('== Environment =='));
        assert.ok(text.includes('vscodeVersion: 1.95.0'));
        assert.ok(text.includes('== Settings (unusedCssDetector.*) =='));
        assert.ok(text.includes('== Last analysis =='));
        assert.ok(text.includes('== Errors (1) =='));
        assert.ok(text.includes('== Log (1 entries) =='));
    });

    test('creates a readable ZIP with every expected entry', () => {
        const zip = createSupportZip({ 'a.txt': 'hello', 'nested/b.txt': 'world' });
        assert.ok(zip instanceof Uint8Array);

        const entries = unzipSync(zip);
        assert.deepStrictEqual(Object.keys(entries).sort(), ['a.txt', 'nested/b.txt']);
        assert.strictEqual(strFromU8(entries['a.txt']), 'hello');
        assert.strictEqual(strFromU8(entries['nested/b.txt']), 'world');
    });

    test('redacts paths in every file of the bundle', () => {
        const bundle = buildSupportBundle(sampleInput());
        const expected = [
            'README.txt',
            'diagnostics.txt',
            'log.txt',
            'errors.json',
            'environment.json',
            'settings.json',
        ];
        assert.deepStrictEqual(Object.keys(bundle.files).sort(), expected.sort());

        const zipEntries = unzipSync(bundle.zip);
        assert.deepStrictEqual(Object.keys(zipEntries).sort(), expected.sort());

        const homePathVariants = ['c:\\users\\rajat', 'c:\\\\users\\\\rajat', 'c:/users/rajat'];
        Object.entries(bundle.files).forEach(([name, content]) => {
            const lower = content.toLowerCase();
            homePathVariants.forEach((variant) => {
                assert.ok(!lower.includes(variant), `${name} still contains a home path`);
            });
        });
        assert.ok(bundle.files['diagnostics.txt'].includes('<workspace>'));
        assert.ok(bundle.files['log.txt'].includes('<workspace>'));
        assert.ok(bundle.files['README.txt'].includes('support@rajatmalik.dev'));
    });
});
