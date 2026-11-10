import * as assert from 'node:assert';
import type { AnalysisError } from '../../core/errors';
import { buildLogFileContent, buildLogFileHeader, LOG_FILE_NAME, type LogFileInput } from '../../core/logFile';
import type { LogRecord } from '../../core/logger';

const ERROR: AnalysisError = {
    type: 'general',
    file: 'C:\\project\\src\\a.css',
    message: 'Analysis failed',
    details: 'Error: boom\n    at run (C:\\project\\src\\analyzer.ts:1:1)',
    recoverable: false,
    timestamp: new Date('2026-11-07T09:30:00.000Z'),
};

const LOG: LogRecord = {
    level: 'info',
    message: 'Run "manual" complete',
    details: '3 dead tokens',
    timestamp: new Date('2026-11-07T09:31:00.000Z'),
};

function sampleInput(): LogFileInput {
    return {
        generatedAt: new Date('2026-11-07T09:32:00.000Z'),
        extensionVersion: '2.1.0',
        environment: {
            extensionVersion: '2.1.0',
            vscodeVersion: '1.95.0',
        },
        errors: [ERROR],
        log: [LOG],
    };
}

suite('single-file log', () => {
    test('uses a stable file name', () => {
        assert.strictEqual(LOG_FILE_NAME, 'dead-css-cleaner.log');
    });

    test('header is written even before anything is logged', () => {
        const header = buildLogFileHeader({
            startedAt: new Date('2026-11-07T09:00:00.000Z'),
            extensionVersion: '2.1.0',
        });

        assert.ok(header.includes('Dead CSS Cleaner log'));
        assert.ok(header.includes('Session started: 2026-11-07T09:00:00.000Z'));
        assert.ok(header.includes('Extension: 2.1.0'));
        assert.ok(header.includes('Export Logs'));
    });

    test('complete export contains environment, errors and log', () => {
        const content = buildLogFileContent(sampleInput());

        assert.ok(content.includes('Dead CSS Cleaner - complete log'));
        assert.ok(content.includes('Generated: 2026-11-07T09:32:00.000Z'));
        assert.ok(content.includes('== Environment =='));
        assert.ok(content.includes('vscodeVersion: 1.95.0'));
        assert.ok(content.includes('== Errors (1) =='));
        assert.ok(content.includes('message: Analysis failed'));
        assert.ok(content.includes('== Log (1 entries) =='));
        assert.ok(content.includes('Run "manual" complete'));
    });

    test('complete export stays readable when nothing was recorded', () => {
        const content = buildLogFileContent({
            ...sampleInput(),
            errors: [],
            log: [],
        });

        assert.ok(content.includes('No errors were recorded in this session. Everything parsed cleanly.'));
        assert.ok(content.includes('No log entries were recorded in this session.'));
    });
});
