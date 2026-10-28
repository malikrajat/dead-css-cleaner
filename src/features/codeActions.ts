import * as vscode from 'vscode';
import type { ExtensionConfig } from '../core/config';
import type { UnusedFinding } from '../core/types';

/**
 * Lightbulb actions for dead selectors:
 *  - remove a single token from a selector
 *  - remove the whole rule
 *  - ignore the rule with a comment
 *  - remove every dead selector in the file
 */
export class DeadCssCodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

    constructor(
        private readonly getFindingsForFile: (file: string) => UnusedFinding[],
        private readonly getConfig: () => ExtensionConfig,
    ) {}

    provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
    ): vscode.CodeAction[] {
        try {
            const diagnostics = context.diagnostics.filter((diagnostic) => diagnostic.source === 'dead-css-cleaner');
            if (diagnostics.length === 0) {
                return [];
            }

            const findings = this.getFindingsForFile(document.uri.fsPath);
            const actions: vscode.CodeAction[] = [];
            const handled = new Set<UnusedFinding>();

            for (const diagnostic of diagnostics) {
                const finding = findings.find(
                    (item) =>
                        item.declaration.line - 1 === diagnostic.range.start.line &&
                        item.declaration.column - 1 === diagnostic.range.start.character,
                );
                if (!finding || handled.has(finding)) {
                    continue;
                }
                handled.add(finding);
                actions.push(...this.buildActions(document, finding, findings));
            }

            if (actions.length > 0) {
                const removeAll = new vscode.CodeAction(
                    `Remove all ${findings.length} dead selector(s) in this file`,
                    vscode.CodeActionKind.QuickFix,
                );
                removeAll.command = {
                    command: 'unusedCssDetector.removeUnusedInFile',
                    title: 'Remove all dead CSS in this file',
                    arguments: [document.uri],
                };
                actions.push(removeAll);
            }

            return actions;
        } catch {
            return [];
        }
    }

    private buildActions(
        document: vscode.TextDocument,
        finding: UnusedFinding,
        allFindings: UnusedFinding[],
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];
        const tokenRange = new vscode.Range(
            Math.max(finding.declaration.line - 1, 0),
            Math.max(finding.declaration.column - 1, 0),
            Math.max(finding.declaration.line - 1, 0),
            Math.max(finding.declaration.column - 1, 0) + finding.declaration.length,
        );

        // Removing the only token of a selector would leave `{}` behind, so when
        // the whole rule is dead we remove the rule instead.
        const rule = finding.rule;
        const ruleIsFullyDead =
            rule.declarations.length > 0 &&
            rule.declarations.every((declaration) => isDeclarationDead(declaration, allFindings));
        const ruleRange = ruleRangeIn(document, finding);

        const removeToken = new vscode.CodeAction(
            ruleIsFullyDead
                ? `Dead CSS: remove the rule "${truncate(rule.selector)}"`
                : `Dead CSS: remove "${finding.declaration.name}" from "${truncate(rule.selector)}"`,
            vscode.CodeActionKind.QuickFix,
        );
        removeToken.diagnostics = [
            new vscode.Diagnostic(tokenRange, 'unused css token', vscode.DiagnosticSeverity.Warning),
        ];
        removeToken.isPreferred = true;
        removeToken.edit = new vscode.WorkspaceEdit();
        if (ruleIsFullyDead && ruleRange) {
            removeToken.edit.delete(document.uri, ruleRange);
        } else {
            removeToken.edit.delete(document.uri, tokenRange);
        }
        removeToken.command = {
            command: 'unusedCssDetector.afterEdit',
            title: 'Refresh analysis',
            arguments: [document.uri],
        };
        actions.push(removeToken);

        if (ruleRange && !ruleIsFullyDead) {
            const removeRule = new vscode.CodeAction(
                `Dead CSS: remove the whole rule "${truncate(rule.selector)}"`,
                vscode.CodeActionKind.QuickFix,
            );
            removeRule.edit = new vscode.WorkspaceEdit();
            removeRule.edit.delete(document.uri, ruleRange);
            removeRule.command = {
                command: 'unusedCssDetector.afterEdit',
                title: 'Refresh analysis',
                arguments: [document.uri],
            };
            actions.push(removeRule);
        }

        const config = this.getConfig();
        const ignoreAction = new vscode.CodeAction(
            `Dead CSS: ignore this rule (add "${config.ignoreComment}")`,
            vscode.CodeActionKind.QuickFix,
        );
        const line = Math.max(finding.rule.line - 1, 0);
        const indent = (document.lineAt(line).text.match(/^\s*/) ?? [''])[0];
        ignoreAction.edit = new vscode.WorkspaceEdit();
        ignoreAction.edit.insert(
            document.uri,
            new vscode.Position(line, 0),
            `${indent}/* ${config.ignoreComment} */\n`,
        );
        ignoreAction.command = {
            command: 'unusedCssDetector.afterEdit',
            title: 'Refresh analysis',
            arguments: [document.uri],
        };
        actions.push(ignoreAction);

        return actions;
    }
}

export function ruleRangeIn(document: vscode.TextDocument, finding: UnusedFinding): vscode.Range | undefined {
    const rule = finding.rule;
    if (!rule || rule.startOffset === undefined || rule.endOffset === undefined || rule.endOffset <= rule.startOffset) {
        return undefined;
    }
    try {
        const text = document.getText();
        const startPosition = document.positionAt(rule.startOffset);
        // Include the closing brace and the trailing newline so removal is clean.
        let end = Math.min(rule.endOffset + 1, text.length);
        while (end < text.length && (text[end] === '\r' || text[end] === '\n')) {
            end++;
        }
        const endPosition = document.positionAt(end);

        // Extend start to the beginning of the line so indentation is removed too.
        const lineStart = new vscode.Position(startPosition.line, 0);
        const lineText = document.lineAt(startPosition.line).text;
        const adjustedStart = lineText.trim().length === 0 ? lineStart : startPosition;
        return new vscode.Range(adjustedStart, endPosition);
    } catch {
        return undefined;
    }
}

/** Build a WorkspaceEdit that removes every dead selector in a document. */
export function buildRemoveAllEdit(
    document: vscode.TextDocument,
    findings: UnusedFinding[],
): vscode.WorkspaceEdit | undefined {
    if (findings.length === 0) {
        return undefined;
    }
    const edit = new vscode.WorkspaceEdit();
    const removedRules = new Set<string>();

    // Prefer removing whole rules when every token in the rule is dead.
    const sorted = [...findings].sort((a, b) => b.rule.startOffset - a.rule.startOffset);
    for (const finding of sorted) {
        const rule = finding.rule;
        const ruleKey = `${rule.startOffset}:${rule.endOffset}`;
        const ruleIsFullyDead =
            rule.declarations.length > 0 &&
            rule.declarations.every((declaration) => isDeclarationDead(declaration, findings));

        if (ruleIsFullyDead && !removedRules.has(ruleKey)) {
            const range = ruleRangeIn(document, finding);
            if (range) {
                removedRules.add(ruleKey);
                edit.delete(document.uri, range);
                continue;
            }
        }

        const line = Math.max(finding.declaration.line - 1, 0);
        const start = new vscode.Position(line, Math.max(finding.declaration.column - 1, 0));
        const end = new vscode.Position(line, Math.max(finding.declaration.column - 1, 0) + finding.declaration.length);
        edit.delete(document.uri, new vscode.Range(start, end));
    }

    return edit;
}

function isDeclarationDead(
    declaration: { file: string; line: number; column: number; name: string },
    findings: UnusedFinding[],
): boolean {
    return findings.some(
        (finding) =>
            finding.declaration.file === declaration.file &&
            finding.declaration.line === declaration.line &&
            finding.declaration.column === declaration.column &&
            finding.declaration.name === declaration.name,
    );
}

function truncate(value: string, max = 60): string {
    const single = value.replace(/\s+/g, ' ').trim();
    return single.length <= max ? single : `${single.slice(0, max - 1)}...`;
}
