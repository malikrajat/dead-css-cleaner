/**
 * Per-component dead CSS reporting.
 *
 * Answers "which classes in this component are dead?" rather than only
 * "how many?" - grouping by the component that owns the stylesheet, showing the
 * full nested selector chain, and separating tokens that are used elsewhere in
 * the workspace (a parent stylesheet used by a child, for example).
 */

import { componentNameOf } from '../analysis/componentGraph';
import type { AnalysisResult, FindingScope, UnusedFinding } from '../core/types';

export interface ReportRow {
    file: string;
    line: number;
    /** Full selector chain, including every nested level. */
    selector: string;
    token: string;
    type: string;
    status: 'fully dead' | 'partially dead';
    /** Files where the token is used outside the component scope. */
    usedElsewhere: string[];
    finding: UnusedFinding;
}

export interface ComponentReportGroup {
    /** Component name, or "Global stylesheets" when no component owns the CSS. */
    title: string;
    componentFile?: string;
    styleFiles: string[];
    /** Human readable description of what was searched. */
    scopeSummary: string;
    rows: ReportRow[];
}

export interface ComponentReportOptions {
    workspaceName?: string;
    analysisMode?: string;
    scopeMode?: string;
}

const GLOBAL_GROUP = '__global__';

export function groupByComponent(result: AnalysisResult): ComponentReportGroup[] {
    const groups = new Map<string, ComponentReportGroup>();

    const groupFor = (finding: UnusedFinding): ComponentReportGroup => {
        const owner = finding.scope?.kind === 'component-tree' ? finding.scope.componentFiles[0] : undefined;
        const key = owner ?? GLOBAL_GROUP;

        let group = groups.get(key);
        if (!group) {
            group = {
                title: owner ? componentNameOf(owner) : 'Global stylesheets',
                componentFile: owner,
                styleFiles: [],
                scopeSummary: describeFindingScope(finding.scope),
                rows: [],
            };
            groups.set(key, group);
        }

        if (!group.styleFiles.includes(finding.rule.file)) {
            group.styleFiles.push(finding.rule.file);
        }
        return group;
    };

    result.findings.forEach((finding) => {
        const group = groupFor(finding);
        group.rows.push(toRow(finding));
    });

    result.outsideScope.forEach((finding) => {
        const group = groupFor(finding);
        group.rows.push({
            ...toRow(finding),
            usedElsewhere: finding.scope?.usedOutsideScope ?? [],
        });
    });

    return [...groups.values()]
        .map((group) => ({
            ...group,
            rows: group.rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
        }))
        .sort((a, b) => a.title.localeCompare(b.title));
}

export function buildComponentReportMarkdown(result: AnalysisResult, options: ComponentReportOptions = {}): string {
    const groups = groupByComponent(result);
    const deadCount = result.findings.length;
    const elsewhereCount = result.outsideScope.length;
    const lines: string[] = [];

    lines.push('# Dead CSS report');
    lines.push('');
    if (options.workspaceName) {
        lines.push(`Workspace: **${options.workspaceName}**`);
    }
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push(
        `Reporting mode: \`${options.analysisMode ?? 'token'}\` · component scope: \`${options.scopeMode ?? 'tree'}\``,
    );
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(`- Dead selector tokens: **${deadCount}**`);
    lines.push(`- Used elsewhere (not dead, unused by the owning component): ${elsewhereCount}`);
    lines.push(`- Components discovered: ${result.components.length}`);
    lines.push(`- Stylesheets analysed: ${result.stats.cssFiles}`);
    lines.push(`- Source files scanned: ${result.stats.jsFiles + result.stats.markupFiles}`);
    lines.push(`- Ignored by comment or settings: ${result.ignoredRuleCount}`);
    lines.push('');

    if (deadCount === 0 && elsewhereCount === 0) {
        lines.push('No dead CSS found. Every selector is used inside its component tree.');
        return lines.join('\n');
    }

    lines.push('## Dead CSS by component');
    lines.push('');
    lines.push(
        'Each row is a class or id that nothing in the owning component **or its child components** uses. ' +
            'The selector column shows the full nested chain so you can see exactly which level is dead.',
    );
    lines.push('');

    const deadGroups = groups.filter((group) => group.rows.some((row) => row.usedElsewhere.length === 0));
    if (deadGroups.length === 0) {
        lines.push('_Nothing is fully dead in this run._');
        lines.push('');
    }

    deadGroups.forEach((group) => {
        const deadRows = group.rows.filter((row) => row.usedElsewhere.length === 0);
        lines.push(`### ${group.title}`);
        lines.push('');
        lines.push(`- Stylesheet(s): ${group.styleFiles.map((file) => `\`${file}\``).join(', ')}`);
        lines.push(`- Checked: ${group.scopeSummary}`);
        lines.push(`- Dead tokens: **${deadRows.length}**`);
        lines.push('');
        lines.push('| Line | Selector (nested chain) | Dead token | Status |');
        lines.push('| --- | --- | --- | --- |');
        deadRows.forEach((row) => {
            lines.push(`| ${row.line} | \`${row.selector}\` | \`${row.token}\` | ${row.status} |`);
        });
        lines.push('');
    });

    if (elsewhereCount > 0) {
        lines.push('## Used elsewhere');
        lines.push('');
        lines.push(
            'These classes are declared by one component but only used outside its tree. They are **not dead code**, ' +
                'but they do not belong to this component any more - consider moving the rule.',
        );
        lines.push('');
        lines.push('| Line | Selector (nested chain) | Token | Used in |');
        lines.push('| --- | --- | --- | --- |');
        result.outsideScope.forEach((finding) => {
            const files = finding.scope?.usedOutsideScope ?? [];
            lines.push(
                `| ${finding.declaration.line} | \`${finding.rule.resolvedSelector || finding.rule.selector}\` | ` +
                    `\`${tokenOf(finding)}\` | ${files.map((file) => `\`${file}\``).join(', ') || '-'} |`,
            );
        });
        lines.push('');
    }

    if (result.components.length > 0) {
        lines.push('## Component graph');
        lines.push('');
        lines.push('| Component | File | Stylesheets | Children | Descendants |');
        lines.push('| --- | --- | --- | --- | --- |');
        result.components.forEach((component) => {
            lines.push(
                `| ${component.name} | \`${component.file}\` | ${component.styleFiles.length} | ` +
                    `${component.children.length} | ${component.descendantCount} |`,
            );
        });
        lines.push('');
    }

    return lines.join('\n');
}

/** Flat, copy-friendly list: one line per dead class. */
export function buildDeadCssList(result: AnalysisResult): string {
    const lines = result.findings.map(
        (finding) =>
            `${finding.declaration.file}:${finding.declaration.line}  ${tokenOf(finding)}  ` +
            `(selector: ${finding.rule.resolvedSelector || finding.rule.selector})`,
    );
    return lines.join('\n');
}

export function tokenOf(finding: UnusedFinding): string {
    const prefix = finding.declaration.type === 'id' ? '#' : '.';
    return `${prefix}${finding.declaration.name}`;
}

function toRow(finding: UnusedFinding): ReportRow {
    return {
        file: finding.declaration.file,
        line: finding.declaration.line,
        selector: finding.rule.resolvedSelector || finding.rule.selector,
        token: tokenOf(finding),
        type: finding.declaration.type,
        status: finding.isPartialSelector ? 'partially dead' : 'fully dead',
        usedElsewhere: finding.scope?.usedOutsideScope ?? [],
        finding,
    };
}

/** Human readable description of what was searched before calling a token dead. */
export function describeFindingScope(scope: FindingScope | undefined): string {
    if (!scope || scope.kind === 'global') {
        return 'the whole workspace (no component owns this stylesheet)';
    }

    const owners = scope.componentFiles.map((file) => componentNameOf(file));
    const others = Math.max(scope.fileCount - owners.length, 0);
    const ownerLabel = owners.length > 0 ? owners.join(', ') : 'the owning component';
    return others > 0
        ? `${ownerLabel} + ${others} child file(s) (${scope.fileCount} files searched)`
        : `${ownerLabel} (${scope.fileCount} file(s) searched)`;
}
