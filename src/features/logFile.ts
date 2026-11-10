import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { EXPORT_LOGS_COMMAND } from '../core/commandIds';
import type { AnalysisError } from '../core/errors';
import { describeError, ErrorCollector, errorMessage } from '../core/errors';
import { buildLogFileContent, buildLogFileHeader, LOG_FILE_NAME } from '../core/logFile';
import { type LogRecord, logger } from '../core/logger';
import { formatLogRecord } from '../core/supportBundle';

let logFilePath: string | undefined;
let writeQueue: Promise<void> = Promise.resolve();
let sinksInstalled = false;

/** The single file the extension writes to and the Export Logs command opens. */
export function getLogFilePath(): string | undefined {
    return logFilePath;
}

/**
 * Start writing every log record and error into one file. The file is created
 * immediately - with a header - even when nothing has been logged yet, so the
 * Export Logs action always has something to show.
 */
export function initializeLogFile(context: vscode.ExtensionContext): string | undefined {
    if (!logFilePath) {
        logFilePath = resolveLogFilePath(context);
        if (logFilePath) {
            ensureHeader(logFilePath, context);
        }
    }

    if (!logFilePath) {
        return undefined;
    }

    if (!sinksInstalled) {
        const target = logFilePath;
        logger.addSink((record) => appendRecord(target, record));
        ErrorCollector.subscribe((error) => appendError(target, error));
        sinksInstalled = true;
    }

    return logFilePath;
}

export function registerLogExportCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.commands.registerCommand(EXPORT_LOGS_COMMAND, () => exportLogs(context)));
}

/**
 * Rebuild the complete single-file log from the in-memory history, write it to
 * disk, then open it in Notepad (Windows) or the OS default text handler.
 * Never throws: failures are reported through a notification and the logger.
 */
export async function exportLogs(context: vscode.ExtensionContext): Promise<string | undefined> {
    const filePath = logFilePath ?? initializeLogFile(context);
    if (!filePath) {
        vscode.window.showErrorMessage(
            'Dead CSS Cleaner: could not create the log file. Check that the extension log directory is writable.',
        );
        return undefined;
    }

    try {
        const content = buildLogFileContent({
            generatedAt: new Date(),
            extensionVersion: extensionVersion(context),
            environment: collectEnvironment(context),
            errors: ErrorCollector.getAll(),
            log: logger.getHistory(),
        });

        // Serialise with the incremental appends so nothing is interleaved.
        await enqueueWrite(() => fs.promises.writeFile(filePath, content, 'utf8'));
        logger.info(`Log exported to ${filePath}`);
        await openInNotepad(filePath);
        return filePath;
    } catch (error) {
        logger.error('Could not export the log file', describeError(error));
        const action = await vscode.window.showErrorMessage(
            `Dead CSS Cleaner could not export the log: ${errorMessage(error)}`,
            'Show Log',
        );
        if (action === 'Show Log') {
            vscode.commands.executeCommand('unusedCssDetector.showLog');
        }
        return undefined;
    }
}

function resolveLogFilePath(context: vscode.ExtensionContext): string | undefined {
    const candidates = [context.logUri.fsPath, path.join(os.tmpdir(), 'dead-css-cleaner')];

    for (const directory of candidates) {
        try {
            fs.mkdirSync(directory, { recursive: true });
            return path.join(directory, LOG_FILE_NAME);
        } catch {
            // Try the next writable location.
        }
    }

    return undefined;
}

function ensureHeader(filePath: string, context: vscode.ExtensionContext): void {
    try {
        const exists = fs.existsSync(filePath);
        if (!exists || fs.statSync(filePath).size === 0) {
            fs.writeFileSync(
                filePath,
                buildLogFileHeader({
                    startedAt: new Date(),
                    extensionVersion: extensionVersion(context),
                }),
                'utf8',
            );
        }
    } catch (error) {
        // The export command retries writing the full file, so keep going.
        console.error('[dead-css-cleaner] could not create the log file', error);
    }
}

function appendRecord(filePath: string, record: LogRecord): void {
    const text = `${formatLogRecord(record)}${os.EOL}`;
    void enqueueWrite(() => fs.promises.appendFile(filePath, text, 'utf8')).catch((error) => {
        console.error('[dead-css-cleaner] could not write the log file', error);
    });
}

function appendError(filePath: string, error: AnalysisError): void {
    const lines = [
        '',
        `=== ${error.timestamp.toISOString()} [${error.type}] ${error.recoverable ? 'recoverable' : 'fatal'} ===`,
        error.message,
    ];
    if (error.file) {
        lines.push(`file: ${error.file}`);
    }
    if (error.details) {
        lines.push(error.details);
    }
    lines.push('');

    const text = `${lines.join(os.EOL)}${os.EOL}`;
    void enqueueWrite(() => fs.promises.appendFile(filePath, text, 'utf8')).catch((error) => {
        console.error('[dead-css-cleaner] could not write the log file', error);
    });
}

/**
 * All writes share one queue, so appends and the export snapshot never race.
 * The returned promise rejects when the task fails, letting the export command
 * surface the error while incremental appends simply log it.
 */
function enqueueWrite(task: () => Promise<void>): Promise<void> {
    const next = writeQueue.then(task);
    writeQueue = next.catch(() => undefined);
    return next;
}

async function openInNotepad(filePath: string): Promise<void> {
    if (process.platform === 'win32') {
        try {
            const child = spawn('notepad.exe', [filePath], { detached: true, stdio: 'ignore' });
            child.once('error', () => {
                void openWithDefaultHandler(filePath);
            });
            child.unref();
            return;
        } catch {
            // Fall back to the default handler below.
        }
    }

    await openWithDefaultHandler(filePath);
}

async function openWithDefaultHandler(filePath: string): Promise<void> {
    const opened = await vscode.env.openExternal(vscode.Uri.file(filePath));
    if (!opened) {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath), { preview: false });
    }
}

function extensionVersion(context: vscode.ExtensionContext): string {
    const packageJson = context.extension.packageJSON as { version?: string } | undefined;
    return typeof packageJson?.version === 'string' ? packageJson.version : 'unknown';
}

function collectEnvironment(context: vscode.ExtensionContext): Record<string, unknown> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    return {
        extensionVersion: extensionVersion(context),
        vscodeVersion: vscode.version,
        appName: vscode.env.appName,
        appHost: vscode.env.appHost,
        platform: process.platform,
        architecture: process.arch,
        osType: os.type(),
        osRelease: os.release(),
        nodeVersion: process.versions.node,
        electronVersion: process.versions.electron ?? 'unknown',
        workspaceFolderCount: folders.length,
        workspaceFolderNames: folders.map((folder) => folder.name),
    };
}
