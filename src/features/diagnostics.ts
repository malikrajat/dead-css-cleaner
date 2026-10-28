import * as path from 'node:path';
import * as vscode from 'vscode';
import type { UsageIndex } from '../analysis/usageIndex';
import type { ExtensionConfig } from '../core/config';
import type { AnalysisResult, Detection, UnusedFinding } from '../core/types';
import { describeFindingScope } from './componentReport';

export interface DiagnosticBuild {
    byFile: Map<string, vscode.Diagnostic[]>;
    findingsByFile: Map<string, UnusedFinding[]>;
}

const SOURCE = 'dead-css-cleaner';

export function buildDiagnostics(result: AnalysisResult, config: ExtensionConfig, index?: UsageIndex): DiagnosticBuild {
    const byFile = new Map<string, vscode.Diagnostic[]>();
    const findingsByFile = new Map<string, UnusedFinding[]>();
    const severity = toSeverity(config.severity);

    const push = (file: string, diagnostic: vscode.Diagnostic, finding: UnusedFinding) => {
        if (!byFile.has(file)) {
            byFile.set(file, []);
            findingsByFile.set(file, []);
        }
        byFile.get(file)!.push(diagnostic);
        findingsByFile.get(file)!.push(finding);
    };

    result.findings.forEach((finding) => {
        try {
            const file = finding.declaration.file;
            const range = rangeFor(finding.declaration);
            const message = describeFinding(finding, result, index);
            const diagnostic = new vscode.Diagnostic(range, message, severity);
            diagnostic.source = SOURCE;
            diagnostic.code = 'unused-selector';
            if (config.tagUnnecessary) {
                diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
            }
            diagnostic.relatedInformation = relatedInformationFor(finding, result, index, config);
            push(file, diagnostic, finding);
        } catch {
            /* never let one bad finding break the diagnostics */
        }
    });

    if (config.analyzeElements) {
        (result.elementFindings ?? []).forEach((entry) => {
            try {
                const range = rangeFor(entry.element);
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Dead CSS: element "${entry.element.name}" never appears in any scanned template.\n` +
                        `Selector: "${entry.name}"\nFix: remove the rule, or switch it off in unusedCssDetector.analyzeElements.`,
                    severity,
                );
                diagnostic.source = SOURCE;
                diagnostic.code = 'unused-element';
                if (config.tagUnnecessary) {
                    diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
                }
                push(entry.element.file, diagnostic, {
                    declaration: entry.element,
                    rule: {
                        file: entry.element.file,
                        selector: entry.name,
                        resolvedSelector: entry.name,
                        line: entry.element.line,
                        column: entry.element.column,
                        startOffset: 0,
                        endOffset: 0,
                        declarations: [],
                        ignored: false,
                    },
                    usedTokensInRule: 0,
                    totalTokensInRule: 0,
                    mode: config.analysisMode,
                    isPartialSelector: false,
                });
            } catch {
                /* ignore */
            }
        });
    }

    return { byFile, findingsByFile };
}

function toSeverity(setting: ExtensionConfig['severity']): vscode.DiagnosticSeverity {
    switch (setting) {
        case 'error':
            return vscode.DiagnosticSeverity.Error;
        case 'information':
            return vscode.DiagnosticSeverity.Information;
        default:
            return vscode.DiagnosticSeverity.Warning;
    }
}

function rangeFor(detection: Detection): vscode.Range {
    const line = Math.max(detection.line - 1, 0);
    const column = Math.max(detection.column - 1, 0);
    return new vscode.Range(line, column, line, column + Math.max(detection.length, 1));
}

export function describeFinding(finding: UnusedFinding, result: AnalysisResult, index?: UsageIndex): string {
    const { declaration, rule } = finding;
    const kindLabel = declaration.type === 'id' ? 'id' : declaration.type === 'element' ? 'element' : 'class';
    const tokenLabel = declaration.type === 'id' ? `#${declaration.name}` : `.${declaration.name}`;

    const lines: string[] = [];
    const match = index?.lookup(declaration.name, declaration.type);

    if (match?.used) {
        lines.push(
            `Possibly dead CSS ${kindLabel}: ${tokenLabel} (matched via ${describeReason(match.reason, match.locations[0])})`,
        );
    } else {
        lines.push(`Dead CSS ${kindLabel}: ${tokenLabel} - not found in any scanned file`);
    }

    lines.push(`Selector: ${rule.resolvedSelector || rule.selector}`);

    if (finding.isPartialSelector) {
        lines.push(
            `This selector is only partially dead: ${finding.usedTokensInRule} of ${finding.totalTokensInRule} tokens in this rule are still used.`,
        );
    } else if (finding.totalTokensInRule > 1) {
        lines.push(`All ${finding.totalTokensInRule} class/id tokens in this rule are unused.`);
    }

    if (rule.parentAtRule) {
        lines.push(`Inside: ${rule.parentAtRule}`);
    }

    lines.push(`Checked: ${describeFindingScope(finding.scope)}`);
    if (finding.scope?.usedOutsideScope.length) {
        lines.push(
            `Used outside this component: ${finding.scope.usedOutsideScope
                .map((file) => path.basename(file))
                .join(', ')}`,
        );
    }

    lines.push(
        `Scanned ${result.stats.cssFiles} CSS file(s), ${result.stats.jsFiles} script file(s), ${result.stats.markupFiles} markup file(s), ${result.stats.angularFiles} Angular component(s).`,
    );
    lines.push(`Quick fix: remove this token, delete the whole rule, or ignore it with "${'dead-css-ignore'}".`);

    return lines.join('\n');
}

function describeReason(reason: string, location?: Detection): string {
    switch (reason) {
        case 'cross-type':
            return `a ${location?.type === 'id' ? 'id' : 'class'} with the same name`;
        case 'dynamic-pattern':
            return 'a dynamic class pattern found in code';
        case 'safelist':
            return 'the configured safelist';
        case 'element-tag':
            return 'a matching element in a template';
        default:
            return 'an exact match';
    }
}

function relatedInformationFor(
    finding: UnusedFinding,
    result: AnalysisResult,
    index: UsageIndex | undefined,
    config: ExtensionConfig,
): vscode.DiagnosticRelatedInformation[] {
    const related: vscode.DiagnosticRelatedInformation[] = [];

    try {
        const match = index?.lookup(finding.declaration.name, finding.declaration.type);
        if (match?.used && match.locations.length > 0) {
            match.locations.slice(0, config.maxUsageLocations).forEach((location) => {
                related.push(
                    new vscode.DiagnosticRelatedInformation(
                        new vscode.Location(
                            vscode.Uri.file(location.file),
                            new vscode.Position(Math.max(location.line - 1, 0), Math.max(location.column - 1, 0)),
                        ),
                        `Used here (${location.kind})`,
                    ),
                );
            });
        }

        if (related.length === 0 && finding.declaration.type !== 'element') {
            related.push(
                new vscode.DiagnosticRelatedInformation(
                    new vscode.Location(
                        vscode.Uri.file(finding.rule.file),
                        new vscode.Position(Math.max(finding.rule.line - 1, 0), Math.max(finding.rule.column - 1, 0)),
                    ),
                    `Declared in ${path.basename(finding.rule.file)} - no usage of "${finding.declaration.name}" was found in ${result.stats.jsFiles + result.stats.markupFiles} scanned file(s)`,
                ),
            );
        }
    } catch {
        /* ignore */
    }

    return related;
}

export function describeUsageLocation(location: Detection): string {
    return `${path.basename(location.file)}:${location.line} (${location.kind})`;
}
