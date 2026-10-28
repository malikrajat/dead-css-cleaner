import type { AnalysisResult } from '../core/types';

/** Pure report builders (unit tested, no VS Code dependency). */

export function buildMarkdownReport(result: AnalysisResult, workspaceName: string): string {
    const findings = [...result.findings].sort((a, b) => a.declaration.file.localeCompare(b.declaration.file));
    const byFile = new Map<string, typeof findings>();

    findings.forEach((finding) => {
        const list = byFile.get(finding.declaration.file) ?? [];
        list.push(finding);
        byFile.set(finding.declaration.file, list);
    });

    const lines: string[] = [
        `# Dead CSS report - ${workspaceName}`,
        '',
        `Generated: ${new Date().toLocaleString()}`,
        '',
        '## Summary',
        '',
        `- Dead selector tokens: **${findings.length}**`,
        `- Selectors analysed: ${result.stats.selectors}`,
        `- Unique class/id tokens: ${result.stats.uniqueTokens}`,
        `- Usages found in code: ${result.stats.usages}`,
        `- Files scanned: ${result.stats.cssFiles} CSS, ${result.stats.jsFiles} script, ${result.stats.markupFiles} markup, ${result.stats.angularFiles} Angular`,
        `- Ignored by comment/settings: ${result.ignoredRuleCount}`,
        `- Parse problems (recovered): ${result.stats.parseErrors}`,
        `- Analysis time: ${result.stats.durationMs}ms`,
        '',
        '## Dead selectors',
        '',
    ];

    if (findings.length === 0) {
        lines.push('No dead CSS detected. ');
    }

    [...byFile.entries()].forEach(([file, fileFindings]) => {
        lines.push(`### ${file}`);
        lines.push('');
        lines.push('| Line | Token | Selector | Scope |');
        lines.push('| --- | --- | --- | --- |');
        fileFindings.forEach((finding) => {
            lines.push(
                `| ${finding.declaration.line} | \`${finding.declaration.type === 'id' ? '#' : '.'}${finding.declaration.name}\` | \`${escapePipes(finding.rule.resolvedSelector || finding.rule.selector)}\` | ${finding.isPartialSelector ? 'partially dead' : 'fully dead'} |`,
            );
        });
        lines.push('');
    });

    return lines.join('\n');
}

export function buildJsonReport(result: AnalysisResult, workspaceName: string): string {
    return JSON.stringify(
        {
            workspace: workspaceName,
            generatedAt: new Date().toISOString(),
            stats: result.stats,
            ignoredRuleCount: result.ignoredRuleCount,
            deadSelectors: result.findings.map((finding) => ({
                name: finding.declaration.name,
                type: finding.declaration.type,
                selector: finding.rule.resolvedSelector || finding.rule.selector,
                file: finding.declaration.file,
                line: finding.declaration.line,
                column: finding.declaration.column,
                partial: finding.isPartialSelector,
                usedTokensInRule: finding.usedTokensInRule,
                totalTokensInRule: finding.totalTokensInRule,
                mode: finding.mode,
                parentAtRule: finding.rule.parentAtRule,
            })),
            unusedElements: (result.elementFindings ?? []).map((entry) => ({
                name: entry.name,
                file: entry.element.file,
                line: entry.element.line,
            })),
        },
        null,
        2,
    );
}

function escapePipes(value: string): string {
    return value.replace(/\|/g, '\\|');
}
