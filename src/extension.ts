import * as path from 'node:path';
import * as vscode from 'vscode';
import { DEFAULT_CONFIG, type ExtensionConfig, normalizeConfig } from './core/config';
import { initializeOutputChannel, registerErrorReporting } from './core/errorReporter';
import { errorMessage } from './core/errors';
import { logger } from './core/logger';
import { buildRemoveAllEdit, DeadCssCodeActionProvider } from './features/codeActions';
import { buildComponentReportMarkdown, type ReportRow } from './features/componentReport';
import { DeadCssTreeProvider, deadCssListForClipboard } from './features/deadCssTreeView';
import { DeadCssHoverProvider } from './features/hoverProvider';
import { exportReport } from './features/report';
import { ExtensionState } from './state';

const CSS_LANGUAGES = ['css', 'scss', 'less', 'sass'];
const CSS_SELECTOR: vscode.DocumentSelector = CSS_LANGUAGES.map((language) => ({ language, scheme: 'file' }));

let debounceTimer: NodeJS.Timeout | undefined;
let watcherThrottleTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
    initializeOutputChannel(context);
    registerErrorReporting(context);

    const diagnosticCollection = vscode.languages.createDiagnosticCollection('dead-css-cleaner');
    context.subscriptions.push(diagnosticCollection);

    const config = readConfig();
    logger.setDebugEnabled(config.debugLogging);
    logger.info('Dead CSS Cleaner activated');

    let treeProvider: DeadCssTreeProvider | undefined;
    let updateBadge: ((count: number) => void) | undefined;

    const state = new ExtensionState(config, diagnosticCollection, (result) => {
        treeProvider?.setResult(result);
        updateBadge?.(result?.findings.length ?? 0);
    });
    context.subscriptions.push({ dispose: () => state.dispose() });
    context.subscriptions.push({ dispose: () => logger.clearSinks() });
    context.subscriptions.push({ dispose: () => clearTimers() });

    const runAnalysis = async (
        reason: string,
        options: { silent?: boolean; onlyCssFiles?: Set<string> } = {},
    ): Promise<void> => {
        await state.run({ reason, silent: options.silent, onlyCssFiles: options.onlyCssFiles });
    };

    const scheduleAnalysis = (reason: string, delayMs?: number): void => {
        const current = state.config;
        if (!current.autoAnalyze) {
            return;
        }
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(
            () => {
                debounceTimer = undefined;
                void runAnalysis(reason, { silent: true });
            },
            Math.max(delayMs ?? current.debounceDelay, 0),
        );
    };

    registerCommands(context, state, runAnalysis, scheduleAnalysis);
    registerProviders(context, state);
    ({ provider: treeProvider, updateBadge } = registerViews(context, state));
    registerListeners(context, state, scheduleAnalysis);

    if (config.autoAnalyze) {
        void runAnalysis('activation', { silent: true });
    } else {
        state.statusBarController.setIdle(0);
    }
}

function registerCommands(
    context: vscode.ExtensionContext,
    state: ExtensionState,
    runAnalysis: (reason: string, options?: { silent?: boolean; onlyCssFiles?: Set<string> }) => Promise<void>,
    scheduleAnalysis: (reason: string, delayMs?: number) => void,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('unusedCssDetector.analyze', async () => {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Window, title: 'Dead CSS Cleaner: analysing workspace...' },
                async () => runAnalysis('manual'),
            );
        }),

        vscode.commands.registerCommand('unusedCssDetector.analyzeCurrentFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showInformationMessage('Open a file first.');
                return;
            }
            const fileName = editor.document.uri.fsPath;
            const extension = path.extname(fileName).toLowerCase();
            const isCssFile = normalizeExtensions(state.config.includeFileTypes).includes(extension);

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Window,
                    title: `Dead CSS Cleaner: analysing ${path.basename(fileName)}...`,
                },
                async () => {
                    if (isCssFile) {
                        await runAnalysis('current-file', { onlyCssFiles: new Set([fileName]) });
                    } else {
                        await runAnalysis('current-file');
                    }
                },
            );
        }),

        vscode.commands.registerCommand('unusedCssDetector.showPerformanceStats', () => showPerformanceReport(state)),

        vscode.commands.registerCommand('unusedCssDetector.clearCache', () => {
            state.analyzerInstance.clearCache();
            logger.info('Analysis cache cleared');
            vscode.window.showInformationMessage('Dead CSS Cleaner: analysis cache cleared.');
        }),

        vscode.commands.registerCommand('unusedCssDetector.exportReport', async () => {
            const result = state.lastResult;
            if (!result) {
                vscode.window.showInformationMessage('Run an analysis first.');
                return;
            }
            const format = await vscode.window.showQuickPick(
                [
                    { label: 'Markdown report', description: 'Human readable tables', value: 'markdown' as const },
                    { label: 'JSON report', description: 'Machine readable', value: 'json' as const },
                ],
                { placeHolder: 'Report format' },
            );
            if (!format) {
                return;
            }
            await exportReport(result, format.value);
        }),

        vscode.commands.registerCommand('unusedCssDetector.removeUnusedInFile', async (uri?: vscode.Uri) => {
            const target = uri ?? vscode.window.activeTextEditor?.document.uri;
            if (!target) {
                vscode.window.showInformationMessage('Open a CSS file first.');
                return;
            }
            const document = await vscode.workspace.openTextDocument(target);
            const findings = state.getFindingsForFile(document.uri.fsPath);
            if (findings.length === 0) {
                vscode.window.showInformationMessage('No dead selectors recorded for this file.');
                return;
            }

            const edit = buildRemoveAllEdit(document, findings);
            if (!edit) {
                return;
            }

            const confirmation = await vscode.window.showWarningMessage(
                `Remove ${findings.length} dead selector token(s) from ${path.basename(document.uri.fsPath)}?`,
                { modal: true },
                'Remove',
            );
            if (confirmation !== 'Remove') {
                return;
            }

            const applied = await vscode.workspace.applyEdit(edit);
            if (applied) {
                await document.save();
                state.analyzerInstance.invalidateFile(document.uri.fsPath);
                scheduleAnalysis('after-remove-all', 250);
            } else {
                vscode.window.showErrorMessage('Dead CSS Cleaner: could not apply the edit.');
            }
        }),

        vscode.commands.registerCommand('unusedCssDetector.afterEdit', async (uri?: vscode.Uri) => {
            if (uri) {
                state.analyzerInstance.invalidateFile(uri.fsPath);
            }
            scheduleAnalysis('after-quick-fix', 250);
        }),

        vscode.commands.registerCommand('unusedCssDetector.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'unusedCssDetector');
        }),

        vscode.commands.registerCommand('unusedCssDetector.refreshDeadCssView', async () => {
            await runAnalysis('view-refresh', { silent: true });
        }),

        vscode.commands.registerCommand('unusedCssDetector.showComponentReport', async () => {
            const result = state.lastResult;
            if (!result) {
                vscode.window.showInformationMessage('Run an analysis first.');
                return;
            }

            const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name;
            const markdown = buildComponentReportMarkdown(result, {
                workspaceName,
                analysisMode: state.config.analysisMode,
                scopeMode: state.config.componentScope,
            });
            const document = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
            await vscode.window.showTextDocument(document, { preview: false });
        }),

        vscode.commands.registerCommand('unusedCssDetector.copyDeadCssList', async () => {
            const result = state.lastResult;
            if (!result || result.findings.length === 0) {
                vscode.window.showInformationMessage('No dead CSS to copy.');
                return;
            }
            await vscode.env.clipboard.writeText(deadCssListForClipboard(result));
            vscode.window.showInformationMessage(
                `Copied ${result.findings.length} dead selector token${result.findings.length === 1 ? '' : 's'} to the clipboard.`,
            );
        }),

        vscode.commands.registerCommand('unusedCssDetector.revealDeadSelector', async (argument?: unknown) => {
            const row = asReportRow(argument);
            if (!row) {
                return;
            }
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(row.file));
            const editor = await vscode.window.showTextDocument(document, { preview: false });
            const position = new vscode.Position(Math.max(row.line - 1, 0), 0);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            editor.selection = new vscode.Selection(position, position);
        }),

        vscode.commands.registerCommand('unusedCssDetector.removeDeadSelector', async (argument?: unknown) => {
            const row = asReportRow(argument);
            if (!row) {
                return;
            }
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(row.file));
            const edit = buildRemoveAllEdit(document, [row.finding]);
            if (!edit) {
                return;
            }
            const applied = await vscode.workspace.applyEdit(edit);
            if (applied) {
                await document.save();
                state.analyzerInstance.invalidateFile(row.file);
                scheduleAnalysis('after-tree-remove', 200);
            }
        }),

        vscode.commands.registerCommand('unusedCssDetector.ignoreDeadSelector', async (argument?: unknown) => {
            const row = asReportRow(argument);
            if (!row) {
                return;
            }
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(row.file));
            const line = Math.max(row.finding.rule.line - 1, 0);
            const indent = (document.lineAt(line).text.match(/^\s*/) ?? [''])[0];
            const edit = new vscode.WorkspaceEdit();
            edit.insert(document.uri, new vscode.Position(line, 0), `${indent}/* ${state.config.ignoreComment} */\n`);
            if (await vscode.workspace.applyEdit(edit)) {
                await document.save();
                state.analyzerInstance.invalidateFile(row.file);
                scheduleAnalysis('after-tree-ignore', 200);
            }
        }),
    );
}

/** Tree context menus can hand us either the tree node or the report row. */
function asReportRow(argument: unknown): ReportRow | undefined {
    if (!argument || typeof argument !== 'object') {
        return undefined;
    }
    const candidate = argument as { row?: ReportRow };
    if (candidate.row?.finding) {
        return candidate.row;
    }
    const direct = argument as ReportRow;
    return direct.finding ? direct : undefined;
}

function registerProviders(context: vscode.ExtensionContext, state: ExtensionState): void {
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            CSS_SELECTOR,
            new DeadCssCodeActionProvider(
                (file) => state.getFindingsForFile(file),
                () => state.config,
            ),
            { providedCodeActionKinds: DeadCssCodeActionProvider.providedCodeActionKinds },
        ),
        vscode.languages.registerHoverProvider(
            CSS_SELECTOR,
            new DeadCssHoverProvider(
                (file) => state.getFindingsForFile(file),
                () => state.getIndex(),
            ),
        ),
    );
}

/**
 * Sidebar view listing dead CSS per component (with the nested selector chain
 * and the scope that was validated), plus a badge with the current count.
 */
function registerViews(
    context: vscode.ExtensionContext,
    _state: ExtensionState,
): { provider: DeadCssTreeProvider; updateBadge: (count: number) => void } {
    const provider = new DeadCssTreeProvider(() => true);
    const treeView = vscode.window.createTreeView('deadCssCleaner.deadSelectors', {
        treeDataProvider: provider,
        showCollapseAll: true,
    });

    context.subscriptions.push(treeView, { dispose: () => provider.dispose() });

    const updateBadge = (count: number): void => {
        treeView.badge =
            count > 0 ? { value: count, tooltip: `${count} dead selector token${count === 1 ? '' : 's'}` } : undefined;
    };

    return { provider, updateBadge };
}

function registerListeners(
    context: vscode.ExtensionContext,
    state: ExtensionState,
    scheduleAnalysis: (reason: string, delayMs?: number) => void,
): void {
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (!state.config.autoAnalyze || !isRelevantFile(document.uri.fsPath, state.config)) {
                return;
            }
            state.analyzerInstance.invalidateFile(document.uri.fsPath);
            scheduleAnalysis('file-saved');
        }),

        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (!state.config.autoAnalyze || !editor) {
                return;
            }
            if (!isRelevantFile(editor.document.uri.fsPath, state.config)) {
                return;
            }
            scheduleAnalysis('editor-changed', Math.min(state.config.debounceDelay, 400));
        }),

        vscode.workspace.onDidChangeConfiguration((event) => {
            if (!event.affectsConfiguration('unusedCssDetector')) {
                return;
            }
            const newConfig = readConfig();
            state.updateConfig(newConfig);
            logger.setDebugEnabled(newConfig.debugLogging);
            logger.info('Configuration changed; re-running analysis');
            state.analyzerInstance.clearCache();
            if (newConfig.autoAnalyze) {
                scheduleAnalysis('configuration-changed', 200);
            }
        }),
    );

    if (state.config.enableFileWatcher) {
        const watcher = vscode.workspace.createFileSystemWatcher(
            '**/*.{css,scss,sass,less,js,jsx,ts,tsx,mjs,cjs,html,htm,vue,svelte,astro,php,erb,hbs,twig,ejs,cshtml,mdx}',
        );
        const throttle = () => {
            if (watcherThrottleTimer) {
                clearTimeout(watcherThrottleTimer);
            }
            watcherThrottleTimer = setTimeout(() => {
                watcherThrottleTimer = undefined;
                scheduleAnalysis('file-watcher');
            }, state.config.watcherThrottleDelay);
        };

        context.subscriptions.push(
            watcher,
            watcher.onDidCreate(throttle),
            watcher.onDidDelete(throttle),
            watcher.onDidChange((uri) => {
                state.analyzerInstance.invalidateFile(uri.fsPath);
                throttle();
            }),
        );
    }
}

function showPerformanceReport(state: ExtensionState): void {
    const result = state.lastResult;
    const cache = state.analyzerInstance.getCacheStats();
    const lines: string[] = ['# Dead CSS Cleaner - performance & cache', ''];

    if (!result) {
        lines.push('No analysis has run yet in this session.');
    } else {
        const { stats } = result;
        lines.push('## Last analysis');
        lines.push('');
        lines.push('| Metric | Value |');
        lines.push('| --- | --- |');
        lines.push(`| Duration | ${stats.durationMs} ms |`);
        lines.push(`| Discovery | ${stats.phases.discoveryMs} ms |`);
        lines.push(`| Parsing | ${stats.phases.parseMs} ms |`);
        lines.push(`| Comparison | ${stats.phases.compareMs} ms |`);
        lines.push(`| CSS files | ${stats.cssFiles} |`);
        lines.push(`| Script files | ${stats.jsFiles} |`);
        lines.push(`| Markup files | ${stats.markupFiles} |`);
        lines.push(`| Angular components | ${stats.angularFiles} |`);
        lines.push(`| Selector tokens | ${stats.selectors} |`);
        lines.push(`| Unique tokens | ${stats.uniqueTokens} |`);
        lines.push(`| Usages indexed | ${stats.usages} |`);
        lines.push(`| Dead tokens | ${result.findings.length} |`);
        lines.push(`| Ignored rules | ${result.ignoredRuleCount} |`);
        lines.push(`| Recovered parse issues | ${stats.parseErrors} |`);
        lines.push('');
    }

    lines.push('## Cache');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('| --- | --- |');
    lines.push(`| Entries | ${cache.entries} |`);
    lines.push(`| Hits | ${cache.hits} |`);
    lines.push(`| Misses | ${cache.misses} |`);
    lines.push(`| Invalidations | ${cache.invalidations} |`);
    lines.push('');
    lines.push(
        `Cache is ${state.config.enableCaching ? 'enabled' : 'disabled'} (timeout ${state.config.cacheTimeout} ms). ` +
            'Run "Dead CSS Cleaner: Clear Analysis Cache" to reset it.',
    );

    vscode.workspace
        .openTextDocument({ content: lines.join('\n'), language: 'markdown' })
        .then((document) => vscode.window.showTextDocument(document, { preview: true }));
}

function readConfig(): ExtensionConfig {
    const raw = vscode.workspace.getConfiguration('unusedCssDetector');
    const partial: Record<string, unknown> = {};

    (Object.keys(DEFAULT_CONFIG) as Array<keyof ExtensionConfig>).forEach((key) => {
        try {
            const value = raw.get<unknown>(String(key));
            if (value !== undefined) {
                partial[String(key)] = value;
            }
        } catch (error) {
            logger.warn(`Could not read setting ${String(key)}`, errorMessage(error));
        }
    });

    const { config, issues } = normalizeConfig(partial as Partial<ExtensionConfig>);
    issues.forEach((issue) => logger.warn(`${issue.setting}: ${issue.message}`));
    return config;
}

function normalizeExtensions(extensions: string[]): string[] {
    return extensions.map((ext) => (ext.startsWith('.') ? ext : `.${ext}`).toLowerCase());
}

function isRelevantFile(fileName: string, config: ExtensionConfig): boolean {
    const extension = path.extname(fileName).toLowerCase();
    return (
        normalizeExtensions(config.includeFileTypes).includes(extension) ||
        normalizeExtensions(config.componentFileTypes).includes(extension) ||
        normalizeExtensions(config.markupFileTypes).includes(extension)
    );
}

function clearTimers(): void {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
    }
    if (watcherThrottleTimer) {
        clearTimeout(watcherThrottleTimer);
        watcherThrottleTimer = undefined;
    }
}

export function deactivate(): void {
    clearTimers();
    logger.clearSinks();
}
