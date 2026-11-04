/**
 * Builds the support bundle users can send when something goes wrong.
 *
 * This module is deliberately free of `vscode` imports: it only formats data and
 * writes a ZIP, so it can be unit tested in plain Node. The VS Code-facing part
 * (reading settings, choosing the download folder, showing the toast) lives in
 * `src/features/supportBundle.ts`.
 */

import { strToU8, zipSync } from 'fflate';
import type { AnalysisError } from './errors';
import type { LogRecord } from './logger';
import type { AnalysisStats } from './types';

export const SUPPORT_EMAIL = 'support@rajatmalik.dev';
export const ISSUE_URL = 'https://github.com/malikrajat/dead-css-cleaner/issues/new?template=bug_report.yml';

export type SettingSource = 'default' | 'user' | 'workspace' | 'workspaceFolder' | 'language';

export interface SettingsSnapshotEntry {
    value: unknown;
    defaultValue?: unknown;
    source: SettingSource;
}

export interface RedactionRoot {
    path: string;
    label: string;
}

export interface SupportBundleInput {
    generatedAt: Date;
    extensionVersion: string;
    environment: Record<string, unknown>;
    settings: Record<string, SettingsSnapshotEntry>;
    stats?: Record<string, unknown>;
    errors: AnalysisError[];
    log: LogRecord[];
    redactionRoots: RedactionRoot[];
}

export interface SupportBundle {
    fileName: string;
    zip: Uint8Array;
    files: Record<string, string>;
}

export interface FormatLogOptions {
    /** `true` prints `HH:MM:SS.mmm` (output channel style) instead of a full ISO timestamp. */
    shortTime?: boolean;
    /** Truncate each record's details after this many lines. */
    maxDetailLines?: number;
}

/** Replace home/workspace roots with stable placeholders. Longest roots win. */
export function redactText(text: string, roots: RedactionRoot[]): string {
    if (!text || roots.length === 0) {
        return text;
    }

    let result = text;
    const ordered = roots
        .filter((root) => root.path && root.path.length > 3)
        .slice()
        .sort((left, right) => right.path.length - left.path.length);

    for (const root of ordered) {
        const variants = new Set<string>();
        [root.path, root.path.replace(/[\\/]+$/, '')].forEach((base) => {
            if (!base) {
                return;
            }
            variants.add(base);
            variants.add(base.replace(/\\/g, '/'));
            variants.add(base.replace(/\//g, '\\'));
            // JSON-escaped forms (`C:\\Users\\...`) appear in nested values and
            // in the .json files, so redact those as well.
            variants.add(base.replace(/\\/g, '\\\\'));
            variants.add(base.replace(/\//g, '\\\\'));
        });

        const pattern = [...variants].filter(Boolean).map(escapeRegExp).join('|');
        if (!pattern) {
            continue;
        }

        result = result.replace(new RegExp(pattern, 'gi'), root.label);
    }

    return result;
}

export function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatLogRecord(record: LogRecord, options: FormatLogOptions = {}): string {
    const stamp = options.shortTime ? record.timestamp.toISOString().slice(11, 23) : record.timestamp.toISOString();
    const lines = [`[${stamp}] [${record.level.toUpperCase()}] ${record.message}`];

    if (record.details) {
        const detailLines = record.details.split(/\r?\n/);
        const limit = options.maxDetailLines ?? detailLines.length;
        detailLines.slice(0, limit).forEach((line) => lines.push(`    ${line}`));
        if (detailLines.length > limit) {
            lines.push(`    ... (${detailLines.length - limit} more line(s) omitted)`);
        }
    }

    return lines.join('\n');
}

export function formatLog(records: LogRecord[], options: FormatLogOptions = {}): string {
    const lines = [`== Log (${records.length} entries) ==`, ''];
    if (records.length === 0) {
        lines.push('No log entries were recorded in this session.');
    } else {
        records.forEach((record) => {
            lines.push(formatLogRecord(record, options));
        });
    }
    return lines.join('\n');
}

export function formatErrors(errors: AnalysisError[]): string {
    const lines = [`== Errors (${errors.length}) ==`, ''];
    if (errors.length === 0) {
        lines.push('No errors were recorded in this session. Everything parsed cleanly.');
        return lines.join('\n');
    }

    errors.forEach((error, index) => {
        lines.push(`#${index + 1} [${error.type}] ${error.recoverable ? 'recoverable' : 'fatal'}`);
        lines.push(`time: ${error.timestamp.toISOString()}`);
        lines.push(`message: ${error.message}`);
        if (error.file) {
            lines.push(`file: ${error.file}`);
        }
        if (error.details) {
            lines.push('details:');
            error.details.split(/\r?\n/).forEach((line) => lines.push(`    ${line}`));
        }
        lines.push('');
    });

    return lines.join('\n');
}

export function formatEnvironment(environment: Record<string, unknown>): string {
    const lines = ['== Environment ==', ''];
    const keys = Object.keys(environment).sort();
    if (keys.length === 0) {
        lines.push('No environment information was collected.');
    } else {
        keys.forEach((key) => lines.push(`${key}: ${displayValue(environment[key])}`));
    }
    return lines.join('\n');
}

export function formatSettings(settings: Record<string, SettingsSnapshotEntry>): string {
    const lines = ['== Settings (unusedCssDetector.*) ==', ''];
    const keys = Object.keys(settings).sort();
    if (keys.length === 0) {
        lines.push('No settings were read.');
    } else {
        keys.forEach((key) => {
            const entry = settings[key];
            lines.push(`${key}: ${displayValue(entry.value)}`);
            lines.push(`    source: ${entry.source}`);
            if (entry.defaultValue !== undefined) {
                lines.push(`    default: ${displayValue(entry.defaultValue)}`);
            }
        });
    }
    return lines.join('\n');
}

export function formatStats(stats: Record<string, unknown> | undefined): string {
    const lines = ['== Last analysis ==', ''];
    if (!stats) {
        lines.push('No analysis has run in this session.');
        return lines.join('\n');
    }

    Object.keys(stats)
        .sort()
        .forEach((key) => lines.push(`${key}: ${displayValue(stats[key])}`));
    return lines.join('\n');
}

export function buildDiagnosticsText(input: SupportBundleInput): string {
    const header = [
        'Dead CSS Cleaner diagnostics',
        `Generated: ${input.generatedAt.toISOString()}`,
        `Extension: ${input.extensionVersion}`,
        `Support: ${SUPPORT_EMAIL}`,
        `Issue tracker: ${ISSUE_URL}`,
        '',
        'Home directory paths are replaced with <home>, workspace roots with <workspace>',
        'and the working directory with <cwd>.',
        'This bundle contains logs, settings and error messages only - no source files.',
        '',
    ].join('\n');

    return [
        header,
        formatEnvironment(input.environment),
        '',
        formatSettings(input.settings),
        '',
        formatStats(input.stats),
        '',
        formatErrors(input.errors),
        '',
        formatLog(input.log),
        '',
    ].join('\n');
}

export function buildReadme(input: SupportBundleInput): string {
    return [
        'Dead CSS Cleaner diagnostics bundle',
        '===================================',
        '',
        `Generated: ${input.generatedAt.toISOString()}`,
        `Extension: ${input.extensionVersion}`,
        `Support: ${SUPPORT_EMAIL}`,
        `Issue tracker: ${ISSUE_URL}`,
        '',
        'Please attach this ZIP file to a bug report:',
        ISSUE_URL,
        '',
        `Or email it to ${SUPPORT_EMAIL} with a short description of what happened.`,
        '',
        'Contents',
        '--------',
        '- diagnostics.txt  Environment, settings, stats, errors and the full log in one readable file.',
        '- log.txt          Raw log for this VS Code session.',
        '- errors.json      Error records with stack traces (newest first).',
        '- environment.json VS Code, OS and extension versions.',
        '- settings.json    Your unusedCssDetector.* settings and where each is set.',
        '',
        'Privacy',
        '-------',
        '- Home directory paths are replaced with <home>.',
        '- Workspace root paths are replaced with <workspace>.',
        '- The process working directory is replaced with <cwd>.',
        '- No source files are included, only log messages and settings.',
        '- Review the text files before sharing if project names are sensitive.',
        '',
    ].join('\n');
}

export function diagnosticsFileName(date: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    const stamp =
        `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
        `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    return `dead-css-cleaner-diagnostics-${stamp}.zip`;
}

export function createSupportZip(files: Record<string, string>): Uint8Array {
    const archive: Record<string, Uint8Array> = {};
    Object.entries(files).forEach(([name, content]) => {
        archive[name] = strToU8(content);
    });
    return zipSync(archive, { level: 6 });
}

export function buildSupportBundle(input: SupportBundleInput): SupportBundle {
    const diagnostics = redactText(buildDiagnosticsText(input), input.redactionRoots);
    const files: Record<string, string> = {
        'README.txt': buildReadme(input),
        'diagnostics.txt': diagnostics,
        'log.txt': redactText(formatLog(input.log), input.redactionRoots),
        'errors.json': redactText(JSON.stringify(input.errors, null, 2), input.redactionRoots),
        'environment.json': redactText(JSON.stringify(input.environment, null, 2), input.redactionRoots),
        'settings.json': redactText(JSON.stringify(input.settings, null, 2), input.redactionRoots),
    };

    return {
        fileName: diagnosticsFileName(input.generatedAt),
        zip: createSupportZip(files),
        files,
    };
}

/** Exposed for tests and for future stats extensions. */
export function summarizeStats(stats: AnalysisStats | undefined): Record<string, unknown> | undefined {
    return stats ? { ...stats } : undefined;
}

function displayValue(value: unknown): string {
    if (value === undefined) {
        return 'undefined';
    }
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
