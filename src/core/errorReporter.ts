import * as path from 'node:path';
import * as vscode from 'vscode';
import { DOWNLOAD_DIAGNOSTICS_COMMAND } from './commandIds';
import { type AnalysisError, ErrorCollector } from './errors';
import { type LogRecord, logger } from './logger';

let outputChannel: vscode.OutputChannel | undefined;

/** Wire the logger to a VS Code output channel (call once on activation). */
export function initializeOutputChannel(context: vscode.ExtensionContext): vscode.OutputChannel {
    if (outputChannel) {
        return outputChannel;
    }
    outputChannel = vscode.window.createOutputChannel('Dead CSS Cleaner');
    context.subscriptions.push(outputChannel);

    logger.addSink((record: LogRecord) => {
        const time = record.timestamp.toISOString().slice(11, 23);
        outputChannel?.appendLine(`[${time}] [${record.level.toUpperCase()}] ${record.message}`);
        if (record.details) {
            String(record.details)
                .split('\n')
                .slice(0, 12)
                .forEach((line) => outputChannel?.appendLine(`    ${line}`));
        }
    });

    return outputChannel;
}

export function showOutputChannel(): void {
    outputChannel?.show(true);
}

/**
 * Surface only *fatal* problems in the UI. Recoverable parse issues are logged
 * so the user is never interrupted by noise, but can still inspect them.
 *
 * Every fatal notification offers "Download Log", which writes a ZIP bundle
 * with the session log, error records, environment, settings and analysis stats.
 */
export function registerErrorReporting(context: vscode.ExtensionContext): void {
    ErrorCollector.subscribe((error) => {
        if (error.recoverable) {
            logger.debug(`Recoverable ${error.type}: ${error.message}`, error.details);
            return;
        }
        notifyFatal(error);
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('unusedCssDetector.showErrors', () => showErrorSummary()),
        vscode.commands.registerCommand('unusedCssDetector.clearErrors', () => {
            ErrorCollector.clear();
            vscode.window.showInformationMessage('Dead CSS Cleaner: error log cleared.');
        }),
        vscode.commands.registerCommand('unusedCssDetector.showLog', () => showOutputChannel()),
    );
}

/**
 * Capture exceptions that bypass `ErrorCollector`.
 *
 * `uncaughtExceptionMonitor` observes crashes without changing Node's default
 * behaviour. Errors whose stack points into this extension are marked fatal, so
 * the user gets the same "Download Log" notification; unrelated extension-host
 * errors are only recorded.
 */
export function installCrashHandlers(context: vscode.ExtensionContext): void {
    const onUncaught = (error: Error, origin: string): void => {
        const ours = isExtensionError(error, context);
        const record = ErrorCollector.from('general', `Uncaught exception (${origin})`, error, {
            recoverable: !ours,
        });
        if (!ours) {
            logger.error(record.message, record.details);
        }
    };

    const onRejection = (reason: unknown): void => {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        if (!isExtensionError(error, context)) {
            return;
        }
        ErrorCollector.from('general', 'Unhandled promise rejection', error, { recoverable: false });
    };

    process.on('uncaughtExceptionMonitor', onUncaught);
    process.on('unhandledRejection', onRejection);

    context.subscriptions.push({
        dispose: () => {
            process.removeListener('uncaughtExceptionMonitor', onUncaught);
            process.removeListener('unhandledRejection', onRejection);
        },
    });
}

function isExtensionError(error: Error, context: vscode.ExtensionContext): boolean {
    const stack = error.stack ?? '';
    const root = context.extension.extensionUri.fsPath;
    return root.length > 0 && stack.toLowerCase().includes(root.toLowerCase());
}

function notifyFatal(error: AnalysisError): void {
    const message = error.file
        ? `Dead CSS Cleaner could not be applied to ${path.basename(error.file)}: ${error.message}`
        : `Dead CSS Cleaner: ${error.message}`;

    vscode.window
        .showWarningMessage(message, 'Download Log', 'Show Log', 'Show Errors', 'Open Settings')
        .then((action) => {
            if (action === 'Download Log') {
                vscode.commands
                    .executeCommand(DOWNLOAD_DIAGNOSTICS_COMMAND)
                    .then(undefined, (commandError: unknown) => {
                        logger.warn('Could not download the diagnostics bundle', String(commandError));
                        showOutputChannel();
                    });
            } else if (action === 'Show Log') {
                showOutputChannel();
            } else if (action === 'Show Errors') {
                showErrorSummary();
            } else if (action === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'unusedCssDetector');
            }
        });
}

export function showErrorSummary(): void {
    const summary = ErrorCollector.getSummary();
    const errors = ErrorCollector.getAll();

    const lines = [
        '# Dead CSS Cleaner - diagnostics log',
        '',
        `Total entries: ${summary.total} (fatal: ${summary.fatal})`,
        '',
        '## By type',
    ];

    Object.entries(summary.byType).forEach(([type, count]) => {
        lines.push(`- ${type}: ${count}`);
    });

    if (errors.length > 0) {
        lines.push('', '## Latest entries', '');
        errors.slice(0, 40).forEach((error) => {
            lines.push(`### ${error.type} - ${error.message}`);
            if (error.file) {
                lines.push(`- File: \`${error.file}\``);
            }
            lines.push(`- Recoverable: ${error.recoverable ? 'yes' : 'no'}`);
            if (error.details) {
                lines.push('', '```', error.details.split('\n').slice(0, 8).join('\n'), '```');
            }
            lines.push('');
        });
    } else {
        lines.push('', 'No problems recorded in this session. Everything parsed cleanly.');
    }

    vscode.workspace
        .openTextDocument({ content: lines.join('\n'), language: 'markdown' })
        .then((document) => vscode.window.showTextDocument(document, { preview: true }));
}
