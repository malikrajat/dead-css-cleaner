import * as path from 'node:path';
import * as vscode from 'vscode';
import { CssAnalyzer } from './analysis/analyzer';
import type { UsageIndex } from './analysis/usageIndex';
import type { ExtensionConfig } from './core/config';
import { ErrorCollector, errorMessage } from './core/errors';
import { logger } from './core/logger';
import type { AnalysisResult, UnusedFinding } from './core/types';
import { buildDiagnostics, type DiagnosticBuild } from './features/diagnostics';
import { StatusBarController } from './features/statusBar';

export interface RunOptions {
    reason: string;
    silent?: boolean;
    onlyCssFiles?: Set<string>;
}

/**
 * Central runtime state: config, analyzer, diagnostics collection, last result.
 * Keeping it in one place makes it obvious what a "run" touches and keeps the
 * activation file readable.
 */
export class ExtensionState {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private analyzer: CssAnalyzer;
    private _config: ExtensionConfig;
    private statusBar: StatusBarController;
    private runId = 0;
    private lastBuild: DiagnosticBuild | undefined;
    private lastIndex: UsageIndex | undefined;

    lastResult: AnalysisResult | undefined;
    lastRunAt = 0;
    isRunning = false;

    constructor(
        config: ExtensionConfig,
        diagnosticCollection: vscode.DiagnosticCollection,
        private readonly onResult?: (result: AnalysisResult | undefined) => void,
    ) {
        this._config = config;
        this.diagnosticCollection = diagnosticCollection;
        this.analyzer = new CssAnalyzer(config);
        this.statusBar = new StatusBarController(config.showStatusBar);
    }

    get config(): ExtensionConfig {
        return this._config;
    }

    get analyzerInstance(): CssAnalyzer {
        return this.analyzer;
    }

    get statusBarController(): StatusBarController {
        return this.statusBar;
    }

    updateConfig(config: ExtensionConfig): void {
        this._config = config;
        this.analyzer.updateConfig(config);
        this.statusBar.setEnabled(config.showStatusBar);
        logger.setDebugEnabled(config.debugLogging);
    }

    getFindingsForFile(file: string): UnusedFinding[] {
        if (!this.lastBuild) {
            return [];
        }
        return this.lastBuild.findingsByFile.get(file) ?? [];
    }

    getIndex(): UsageIndex | undefined {
        return this.lastIndex;
    }

    clearDiagnostics(): void {
        this.diagnosticCollection.clear();
        this.lastBuild = undefined;
        this.lastResult = undefined;
    }

    async run(options: RunOptions): Promise<AnalysisResult | undefined> {
        const runId = ++this.runId;
        this.isRunning = true;
        this.statusBar.setAnalyzing();

        try {
            const result = await this.analyzer.analyze({
                onlyCssFiles: options.onlyCssFiles,
                onProgress: () => undefined,
            });

            // A newer run started while this one was working: drop the result.
            if (runId !== this.runId) {
                logger.debug(`Discarding stale analysis result (${options.reason})`);
                return undefined;
            }

            if (result.stats.cancelled) {
                logger.info(`Analysis cancelled (${options.reason})`);
                return undefined;
            }

            this.lastResult = result;
            this.lastRunAt = Date.now();

            if (result.stats.cssFiles < this._config.minFilesForAnalysis) {
                this.statusBar.setIdle(0, result.stats);
                this.diagnosticCollection.clear();
                this.onResult?.(result);
                if (!options.silent && this._config.showNotifications) {
                    vscode.window.showInformationMessage(
                        `Dead CSS Cleaner: skipped analysis - found ${result.stats.cssFiles} style file(s), ` +
                            `minimum is ${this._config.minFilesForAnalysis} (unusedCssDetector.minFilesForAnalysis).`,
                    );
                }
                return result;
            }

            const index = this.analyzerInstance.getLastUsageIndex();
            this.lastIndex = index;

            const build = buildDiagnostics(result, this._config, index);
            this.lastBuild = build;
            this.applyDiagnostics(build);
            this.onResult?.(result);

            this.statusBar.setIdle(result.findings.length + (result.elementFindings?.length ?? 0), result.stats);

            logger.info(
                `Run "${options.reason}" complete: ${result.findings.length} dead token(s), ` +
                    `${result.ignoredRuleCount} ignored, ${result.stats.parseErrors} recovered parse issue(s)`,
            );

            if (!options.silent && this._config.showNotifications) {
                this.notifyResult(result);
            }

            return result;
        } catch (error) {
            const record = ErrorCollector.from('general', 'Analysis failed', error, { recoverable: false });
            this.statusBar.setFailed(record.message);
            if (!options.silent) {
                vscode.window.showErrorMessage(`Dead CSS Cleaner: ${errorMessage(error)}`);
            }
            return undefined;
        } finally {
            if (runId === this.runId) {
                this.isRunning = false;
            }
        }
    }

    private applyDiagnostics(build: DiagnosticBuild): void {
        this.diagnosticCollection.clear();
        build.byFile.forEach((diagnostics, file) => {
            try {
                this.diagnosticCollection.set(vscode.Uri.file(path.normalize(file)), diagnostics);
            } catch (error) {
                logger.warn(`Could not attach diagnostics to ${file}`, errorMessage(error));
            }
        });
    }

    private notifyResult(result: AnalysisResult): void {
        const deadCount = result.findings.length;
        const totalScanned = result.stats.jsFiles + result.stats.markupFiles;

        if (deadCount === 0) {
            vscode.window.showInformationMessage(
                `Dead CSS Cleaner: no dead selectors found (${result.stats.cssFiles} CSS / ${totalScanned} source files, ${result.stats.durationMs}ms).`,
            );
            return;
        }

        vscode.window
            .showWarningMessage(
                `Dead CSS Cleaner: ${deadCount} dead selector token${deadCount === 1 ? '' : 's'} across ${result.stats.cssFiles} CSS file(s).`,
                'Export report',
                'Show log',
            )
            .then((action) => {
                if (action === 'Export report') {
                    vscode.commands.executeCommand('unusedCssDetector.exportReport');
                } else if (action === 'Show log') {
                    vscode.commands.executeCommand('unusedCssDetector.showLog');
                }
            });
    }

    dispose(): void {
        this.statusBar.dispose();
    }
}
