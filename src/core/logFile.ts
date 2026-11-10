/**
 * Pure helpers for the single-file log users can open or attach to a bug report.
 *
 * The VS Code-facing side (writing the file and opening Notepad) lives in
 * `src/features/logFile.ts`; keeping the rendering here makes it unit-testable.
 */

import type { AnalysisError } from './errors';
import type { LogRecord } from './logger';
import { formatEnvironment, formatErrors, formatLog } from './supportBundle';

export const LOG_FILE_NAME = 'dead-css-cleaner.log';

export interface LogFileInput {
    generatedAt: Date;
    extensionVersion: string;
    environment: Record<string, unknown>;
    errors: AnalysisError[];
    log: LogRecord[];
}

export interface LogFileHeaderInput {
    startedAt: Date;
    extensionVersion: string;
}

/** Header written once when the session starts, so the file exists before anything is logged. */
export function buildLogFileHeader(input: LogFileHeaderInput): string {
    return [
        'Dead CSS Cleaner log',
        `Session started: ${input.startedAt.toISOString()}`,
        `Extension: ${input.extensionVersion}`,
        'This file is written while the extension runs.',
        'Run "Dead CSS Cleaner: Export Logs" to rebuild the complete log and open it in Notepad.',
        '='.repeat(72),
        '',
    ].join('\n');
}

/**
 * The complete single-file export: metadata, errors and every log record.
 * It still renders a readable message when nothing has been logged yet.
 */
export function buildLogFileContent(input: LogFileInput): string {
    const header = [
        'Dead CSS Cleaner - complete log',
        `Generated: ${input.generatedAt.toISOString()}`,
        `Extension: ${input.extensionVersion}`,
        '',
        'This single file contains every log entry and error recorded in this session.',
        'Attach it to a bug report, or email it to support@rajatmalik.dev.',
        '',
    ].join('\n');

    return [
        header,
        formatEnvironment(input.environment),
        '',
        formatErrors(input.errors),
        '',
        formatLog(input.log),
        '',
    ].join('\n');
}
