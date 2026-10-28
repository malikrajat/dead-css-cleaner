import * as vscode from 'vscode';
import type { AnalysisStats } from '../core/types';

export class StatusBarController {
    private item: vscode.StatusBarItem | undefined;

    constructor(private enabled: boolean) {
        if (this.enabled) {
            this.create();
        }
    }

    private create(): void {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.item.command = 'unusedCssDetector.analyze';
        this.item.tooltip = 'Dead CSS Cleaner - click to analyse the workspace';
        this.item.text = '$(check) No dead CSS';
        this.item.show();
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (enabled && !this.item) {
            this.create();
        } else if (!enabled && this.item) {
            this.item.dispose();
            this.item = undefined;
        }
    }

    setAnalyzing(): void {
        if (!this.item) {
            return;
        }
        this.item.text = '$(sync~spin) Analysing CSS...';
        this.item.backgroundColor = undefined;
        this.item.tooltip = 'Dead CSS Cleaner is analysing your workspace';
    }

    setIdle(unusedCount: number, stats?: AnalysisStats): void {
        if (!this.item) {
            return;
        }
        this.item.backgroundColor = undefined;

        if (unusedCount === 0) {
            this.item.text = '$(check) No dead CSS';
            this.item.tooltip = [
                'No unused CSS selectors found.',
                stats
                    ? `Scanned ${stats.cssFiles} CSS / ${stats.jsFiles + stats.markupFiles} source files in ${stats.durationMs}ms.`
                    : '',
            ]
                .filter(Boolean)
                .join('\n');
        } else {
            this.item.text = `$(warning) ${unusedCount} dead CSS selector${unusedCount === 1 ? '' : 's'}`;
            this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.item.tooltip = [
                `${unusedCount} unused CSS selector token${unusedCount === 1 ? '' : 's'} found.`,
                stats
                    ? `Scanned ${stats.cssFiles} CSS / ${stats.jsFiles + stats.markupFiles} source files in ${stats.durationMs}ms.`
                    : '',
                'Click to re-analyse. Use the Problems panel lightbulb for quick fixes.',
            ]
                .filter(Boolean)
                .join('\n');
        }
    }

    setFailed(message: string): void {
        if (!this.item) {
            return;
        }
        this.item.text = '$(error) Dead CSS analysis failed';
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.item.tooltip = `${message}\nClick to retry. Open the "Dead CSS Cleaner" output channel for details.`;
    }

    dispose(): void {
        this.item?.dispose();
        this.item = undefined;
    }
}
