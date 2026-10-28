import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AnalysisResult } from '../core/types';
import { buildDeadCssList, type ComponentReportGroup, groupByComponent, type ReportRow } from './componentReport';

type TreeNode = GroupNode | RowNode | InfoNode;

interface GroupNode {
    kind: 'group';
    item: vscode.TreeItem;
    group: ComponentReportGroup;
}

interface RowNode {
    kind: 'row';
    item: vscode.TreeItem;
    row: ReportRow;
}

interface InfoNode {
    kind: 'info';
    item: vscode.TreeItem;
}

/**
 * Sidebar view that lists dead CSS **per component**, with the full nested
 * selector chain and the scope that was checked (component + child components).
 */
export class DeadCssTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;

    private result: AnalysisResult | undefined;
    private groups: ComponentReportGroup[] = [];

    constructor(private readonly showUsedElsewhere: () => boolean) {}

    setResult(result: AnalysisResult | undefined): void {
        this.result = result;
        this.groups = result ? groupByComponent(result) : [];
        this.emitter.fire(undefined);
    }

    getTreeItem(node: TreeNode): vscode.TreeItem {
        return node.item;
    }

    getChildren(node?: TreeNode): TreeNode[] {
        if (!node) {
            return this.buildRoots();
        }
        if (node.kind === 'group') {
            return node.group.rows
                .filter((row) => this.showUsedElsewhere() || row.usedElsewhere.length === 0)
                .map((row) => this.buildRow(row));
        }
        if (node.kind === 'row') {
            return this.buildRowDetails(node.row);
        }
        return [];
    }

    dispose(): void {
        this.emitter.dispose();
    }

    private buildRoots(): TreeNode[] {
        if (!this.result) {
            return [
                {
                    kind: 'info',
                    item: messageItem('Run "Dead CSS Cleaner: Analyze Workspace" to populate this view.'),
                },
            ];
        }

        if (this.groups.length === 0) {
            return [
                {
                    kind: 'info',
                    item: messageItem('No dead CSS found in the last analysis.'),
                },
            ];
        }

        return this.groups.map((group) => {
            const deadRows = group.rows.filter((row) => row.usedElsewhere.length === 0);
            const elsewhere = group.rows.length - deadRows.length;
            const item = new vscode.TreeItem(
                group.title,
                group.rows.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
            );
            item.description =
                elsewhere > 0 ? `${deadRows.length} dead · ${elsewhere} used elsewhere` : `${deadRows.length} dead`;
            item.tooltip = [
                group.componentFile ? `Component: ${group.componentFile}` : 'No owning component (global stylesheet)',
                ...group.styleFiles.map((file) => `Stylesheet: ${file}`),
                `Checked: ${group.scopeSummary}`,
            ].join('\n');
            item.contextValue = 'deadCssGroup';
            item.iconPath = new vscode.ThemeIcon(deadRows.length > 0 ? 'warning' : 'check');
            return { kind: 'group', item, group };
        });
    }

    private buildRow(row: ReportRow): TreeNode {
        const item = new vscode.TreeItem(row.token, vscode.TreeItemCollapsibleState.Collapsed);
        const isElsewhere = row.usedElsewhere.length > 0;
        item.description = `${path.basename(row.file)}:${row.line} · ${isElsewhere ? 'used elsewhere' : row.status}`;
        item.tooltip = [
            `Token: ${row.token}`,
            `Selector: ${row.selector}`,
            `Declared in: ${row.file}:${row.line}`,
            `Status: ${isElsewhere ? 'used outside this component' : row.status}`,
            row.usedElsewhere.length > 0 ? `Used in: ${row.usedElsewhere.join(', ')}` : '',
            'Click to open, or use the context menu to remove/ignore it.',
        ]
            .filter(Boolean)
            .join('\n');
        item.contextValue = 'deadCssRow';
        item.iconPath = new vscode.ThemeIcon(isElsewhere ? 'arrow-right' : 'circle-slash');
        item.command = {
            command: 'unusedCssDetector.revealDeadSelector',
            title: 'Reveal',
            arguments: [row],
        };
        return { kind: 'row', item, row };
    }

    private buildRowDetails(row: ReportRow): TreeNode[] {
        const details: TreeNode[] = [];
        const scope = row.finding.scope;

        details.push({
            kind: 'info',
            item: messageItem(`Selector chain: ${row.selector}`, 'symbol-class'),
        });
        details.push({
            kind: 'info',
            item: messageItem(
                scope?.kind === 'component-tree'
                    ? `Checked ${scope.fileCount} file(s) in this component's tree`
                    : 'Checked the whole workspace (global stylesheet)',
                'search',
            ),
        });
        if (row.finding.isPartialSelector) {
            details.push({
                kind: 'info',
                item: messageItem(
                    `${row.finding.usedTokensInRule} of ${row.finding.totalTokensInRule} tokens in this rule are still used`,
                    'info',
                ),
            });
        }
        row.usedElsewhere.forEach((file) => {
            const node = messageItem(`Used in ${path.basename(file)}`, 'references');
            node.command = {
                command: 'vscode.open',
                title: 'Open',
                arguments: [vscode.Uri.file(file)],
            };
            details.push({ kind: 'info', item: node });
        });

        return details;
    }
}

export function deadCssListForClipboard(result: AnalysisResult): string {
    return buildDeadCssList(result);
}

function messageItem(label: string, icon?: string): vscode.TreeItem {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'deadCssInfo';
    if (icon) {
        item.iconPath = new vscode.ThemeIcon(icon);
    }
    return item;
}
