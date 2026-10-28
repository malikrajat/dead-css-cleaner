import * as path from 'node:path';
import * as vscode from 'vscode';
import type { UsageIndex } from '../analysis/usageIndex';
import type { UnusedFinding } from '../core/types';
import { describeFindingScope } from './componentReport';

/**
 * Explains *why* a selector was flagged, including where the token is used when
 * the finding is only partial. This is the "help me understand" part of the UX.
 */
export class DeadCssHoverProvider implements vscode.HoverProvider {
    constructor(
        private readonly getFindingsForFile: (file: string) => UnusedFinding[],
        private readonly getIndex: () => UsageIndex | undefined,
    ) {}

    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        try {
            const findings = this.getFindingsForFile(document.uri.fsPath);
            const finding = findings.find((item) => {
                const line = item.declaration.line - 1;
                const start = item.declaration.column - 1;
                const end = start + item.declaration.length;
                return line === position.line && position.character >= start && position.character <= end;
            });

            if (!finding) {
                return undefined;
            }

            const markdown = new vscode.MarkdownString();
            markdown.isTrusted = false;
            markdown.appendMarkdown(`**Dead CSS Cleaner**\n\n`);
            markdown.appendMarkdown(
                `Token \`${finding.declaration.type === 'id' ? '#' : '.'}${finding.declaration.name}\` is not referenced anywhere.\n\n`,
            );
            markdown.appendMarkdown(`- Selector: \`${finding.rule.resolvedSelector || finding.rule.selector}\`\n`);
            markdown.appendMarkdown(
                `- Position: ${path.basename(finding.declaration.file)}:${finding.declaration.line}\n`,
            );
            if (finding.rule.parentAtRule) {
                markdown.appendMarkdown(`- Inside: \`${finding.rule.parentAtRule}\`\n`);
            }
            markdown.appendMarkdown(
                `- Rule status: ${
                    finding.isPartialSelector
                        ? `partially dead (${finding.usedTokensInRule}/${finding.totalTokensInRule} tokens still used)`
                        : 'fully dead'
                }\n`,
            );
            markdown.appendMarkdown(`- Mode: \`${finding.mode}\`\n\n`);

            markdown.appendMarkdown(`Checked: ${describeFindingScope(finding.scope)}.\n\n`);

            const index = this.getIndex();
            const match = index?.lookup(finding.declaration.name, finding.declaration.type);
            if (match?.used && match.locations.length > 0) {
                markdown.appendMarkdown(`Possibly used in:\n`);
                match.locations.slice(0, 5).forEach((location) => {
                    markdown.appendMarkdown(
                        `- \`${path.basename(location.file)}:${location.line}\` (${location.kind})\n`,
                    );
                });
                markdown.appendMarkdown('\n');
            }

            markdown.appendMarkdown(
                `Use the lightbulb to remove the token, delete the whole rule, or add an ignore comment.`,
            );

            return new vscode.Hover(markdown);
        } catch {
            return undefined;
        }
    }
}
