/**
 * Angular component parser.
 *
 * Fixes the biggest false-positive source in the old implementation: backtick
 * (`template: \`...\``) inline templates were ignored completely, so every
 * class used by such a component was reported as unused. This parser handles
 * both string and template-literal templates, `templateUrl`, `styles`,
 * `styleUrls`, `host` bindings, `@HostBinding('class.x')` and standalone
 * components.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseBabel } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { ErrorCollector, errorMessage } from '../core/errors';
import { logger } from '../core/logger';
import { LineIndex, toOneBasedColumn } from '../core/textUtils';
import type { Detection } from '../core/types';
import { collectBindingExpressionTokens, type MarkupParseResult, parseMarkupText } from './markupParser';

export interface AngularComponentInfo {
    file: string;
    name: string;
    selector?: string;
    templateUrl?: string;
    resolvedTemplatePath?: string;
    templateFound: boolean;
    styleFiles: string[];
    standalone: boolean;
}

export interface AngularParseResult {
    usages: Detection[];
    dynamicPatterns: string[];
    components: AngularComponentInfo[];
    /** Lower-cased tags used by templates (for element-selector analysis). */
    tags: Set<string>;
    /** Component selectors such as `app-root` (their usage implies the tag exists). */
    componentSelectors: Set<string>;
    missingTemplates: Array<{ file: string; templateUrl: string }>;
}

export interface AngularParseOptions {
    /** Resolve a template path that could not be found relative to the component. */
    findFileByBasename?: (basename: string) => string | undefined;
}

export function parseAngularFile(
    filePath: string,
    text: string,
    options: AngularParseOptions = {},
): AngularParseResult {
    const result: AngularParseResult = {
        usages: [],
        dynamicPatterns: [],
        components: [],
        tags: new Set<string>(),
        componentSelectors: new Set<string>(),
        missingTemplates: [],
    };

    if (!text || !/@(Component|Directive)\s*\(/.test(text)) {
        return result;
    }

    const lineIndex = new LineIndex(text);
    let ast: t.File | undefined;
    try {
        ast = parseBabel(text, {
            sourceType: 'module',
            plugins: [
                'typescript',
                'decorators-legacy',
                'classProperties',
                'classPrivateProperties',
                'classPrivateMethods',
            ] as any,
            errorRecovery: true,
        });
    } catch (_error) {
        try {
            ast = parseBabel(text, {
                sourceType: 'module',
                plugins: ['typescript', 'decorators-legacy'] as any,
                errorRecovery: true,
            });
        } catch (secondError) {
            ErrorCollector.from('angular-parse', `Failed to parse Angular component: ${filePath}`, secondError, {
                file: filePath,
                recoverable: true,
            });
            logger.warn(`Angular parse failed: ${filePath}`, errorMessage(secondError));
            return result;
        }
    }

    try {
        traverse(ast, {
            ClassDeclaration: (classPath: any) => {
                try {
                    processClass(classPath, filePath, text, lineIndex, options, result);
                } catch (error) {
                    ErrorCollector.from('angular-parse', `Failed to process Angular class in ${filePath}`, error, {
                        file: filePath,
                        recoverable: true,
                    });
                }
            },
            ClassExpression: (classPath: any) => {
                try {
                    processClass(classPath, filePath, text, lineIndex, options, result);
                } catch {
                    /* ignore */
                }
            },
        });
    } catch (error) {
        ErrorCollector.from('angular-parse', `AST traversal failed for Angular file: ${filePath}`, error, {
            file: filePath,
            recoverable: true,
        });
    }

    result.dynamicPatterns = [...new Set(result.dynamicPatterns)];
    return result;
}

function processClass(
    classPath: any,
    filePath: string,
    text: string,
    lineIndex: LineIndex,
    options: AngularParseOptions,
    result: AngularParseResult,
): void {
    const decorators: any[] = classPath.node.decorators ?? [];
    if (decorators.length === 0) {
        return;
    }

    const className: string = classPath.node.id?.name ?? 'AnonymousComponent';

    // @HostBinding('class.active') / @HostBinding('attr.class')
    classPath.node.body?.body?.forEach((member: any) => {
        const memberDecorators: any[] = member.decorators ?? [];
        memberDecorators.forEach((decorator) => {
            const decoratorName = decoratorNameOf(decorator);
            if (decoratorName !== 'HostBinding') {
                return;
            }
            const [firstArg] = decorator.expression?.arguments ?? [];
            if (t.isStringLiteral(firstArg)) {
                addHostBindingTokens(firstArg.value, filePath, lineIndex, nodeLocation(firstArg), result);
            }
        });
    });

    decorators.forEach((decorator) => {
        const name = decoratorNameOf(decorator);
        if (name !== 'Component' && name !== 'Directive') {
            return;
        }

        const [arg] = decorator.expression?.arguments ?? [];
        if (!t.isObjectExpression(arg)) {
            return;
        }

        const info: AngularComponentInfo = {
            file: filePath,
            name: className,
            templateFound: false,
            styleFiles: [],
            standalone: false,
        };

        arg.properties.forEach((property: any) => {
            if (!t.isObjectProperty(property)) {
                return;
            }
            const key = t.isIdentifier(property.key)
                ? property.key.name
                : t.isStringLiteral(property.key)
                  ? property.key.value
                  : undefined;
            if (!key) {
                return;
            }

            switch (key) {
                case 'selector': {
                    if (t.isStringLiteral(property.value)) {
                        info.selector = property.value.value;
                        splitSelectorTags(property.value.value).forEach((tag) => result.componentSelectors.add(tag));
                    }
                    break;
                }
                case 'template': {
                    const templateText = readTemplateProperty(property.value, text);
                    if (templateText) {
                        info.templateFound = true;
                        mergeMarkup(
                            parseMarkupText(filePath, templateText.masked),
                            templateText.offset,
                            filePath,
                            lineIndex,
                            text,
                            property.value,
                            result,
                        );
                    }
                    break;
                }
                case 'templateUrl': {
                    if (t.isStringLiteral(property.value)) {
                        info.templateUrl = property.value.value;
                        const resolution = resolveTemplate(property.value.value, filePath, options);
                        if (resolution.found && resolution.content !== undefined) {
                            info.templateFound = true;
                            info.resolvedTemplatePath = resolution.path;
                            mergeMarkup(
                                parseMarkupText(resolution.path ?? filePath, resolution.content),
                                0,
                                resolution.path ?? filePath,
                                new LineIndex(resolution.content),
                                resolution.content,
                                undefined,
                                result,
                            );
                        } else {
                            result.missingTemplates.push({ file: filePath, templateUrl: property.value.value });
                        }
                    }
                    break;
                }
                case 'styles':
                case 'styleUrls': {
                    collectStyleFiles(property.value, filePath, info.styleFiles);
                    break;
                }
                case 'standalone': {
                    info.standalone = t.isBooleanLiteral(property.value) ? property.value.value : false;
                    break;
                }
                case 'host': {
                    processHostObject(property.value, filePath, lineIndex, result);
                    break;
                }
                default:
                    break;
            }
        });

        result.components.push(info);
    });
}

interface TemplateText {
    masked: string;
    offset: number;
}

/**
 * Turn a `template` property into a masked copy of the file where only the
 * template characters survive. Keeping the original length means every offset
 * and line number still matches the real file.
 */
function readTemplateProperty(node: any, fileText: string): TemplateText | undefined {
    const start = typeof node?.start === 'number' ? node.start : undefined;
    const end = typeof node?.end === 'number' ? node.end : undefined;

    if (t.isStringLiteral(node) && start !== undefined && end !== undefined) {
        return { masked: maskRegion(fileText, start + 1, end - 1), offset: start + 1 };
    }

    if (t.isTemplateLiteral(node) && start !== undefined && end !== undefined) {
        // Mask the backticks and keep ${...} expressions masked as well; the
        // expressions are scanned separately for their string literals.
        let masked = maskRegion(fileText, start + 1, end - 1);
        node.expressions.forEach((expression: any) => {
            if (typeof expression?.start === 'number' && typeof expression?.end === 'number') {
                masked = maskRange(masked, expression.start, expression.end);
            }
        });
        return { masked, offset: start + 1 };
    }

    // `template: 'a' + b + 'c'`
    if (t.isBinaryExpression(node) && node.operator === '+') {
        const literal = flattenBinaryString(node);
        if (literal !== undefined && start !== undefined && end !== undefined) {
            return { masked: maskRegion(fileText, start, end), offset: start };
        }
    }

    return undefined;
}

function flattenBinaryString(node: any): string | undefined {
    if (t.isStringLiteral(node)) {
        return node.value;
    }
    if (t.isTemplateLiteral(node)) {
        return node.quasis.map((quasi: any) => quasi.value?.cooked ?? '').join('');
    }
    if (t.isBinaryExpression(node) && node.operator === '+') {
        const left = flattenBinaryString(node.left);
        const right = flattenBinaryString(node.right);
        if (left === undefined || right === undefined) {
            return undefined;
        }
        return left + right;
    }
    return undefined;
}

/** Replace everything except [start, end) with spaces, preserving newlines. */
function maskRegion(text: string, start: number, end: number): string {
    const chars = text.split('');
    for (let i = 0; i < chars.length; i++) {
        const isInside = i >= start && i < end;
        if (!isInside && chars[i] !== '\n' && chars[i] !== '\r') {
            chars[i] = ' ';
        }
    }
    return chars.join('');
}

function maskRange(masked: string, start: number, end: number): string {
    const chars = masked.split('');
    for (let i = start; i < end && i < chars.length; i++) {
        if (chars[i] !== '\n' && chars[i] !== '\r') {
            chars[i] = ' ';
        }
    }
    return chars.join('');
}

function mergeMarkup(
    markup: MarkupParseResult,
    _offset: number,
    _filePath: string,
    lineIndex: LineIndex,
    originalText: string,
    templateNode: any,
    result: AngularParseResult,
): void {
    result.usages.push(...markup.usages);
    result.dynamicPatterns.push(...markup.dynamicPatterns);
    markup.tags.forEach((tag) => result.tags.add(tag));
    markup.unresolvedBindings.forEach((binding) => {
        logger.debug(
            `Angular binding needs runtime resolution: ${binding.expression} (${binding.file}:${binding.line})`,
        );
    });

    // String literals inside `${...}` of a backtick template.
    if (templateNode && t.isTemplateLiteral(templateNode)) {
        templateNode.expressions.forEach((expression: any) => {
            if (typeof expression?.start !== 'number' || typeof expression?.end !== 'number') {
                return;
            }
            const expressionText = originalText.slice(expression.start, expression.end);
            try {
                const collected: MarkupParseResult = {
                    usages: [],
                    dynamicPatterns: [],
                    tags: new Set<string>(),
                    unresolvedBindings: [],
                };
                collectBindingExpressionTokens(expressionText, _filePath, lineIndex, expression.start, collected);
                result.usages.push(...collected.usages);
                result.dynamicPatterns.push(...collected.dynamicPatterns);
            } catch (error) {
                logger.debug('Failed to scan template expression', errorMessage(error));
            }
        });
    }
}

function processHostObject(node: any, filePath: string, _lineIndex: LineIndex, result: AngularParseResult): void {
    if (!t.isObjectExpression(node)) {
        return;
    }
    node.properties.forEach((property: any) => {
        if (!t.isObjectProperty(property)) {
            return;
        }
        const keyName = t.isStringLiteral(property.key)
            ? property.key.value
            : t.isIdentifier(property.key)
              ? property.key.name
              : undefined;
        if (!keyName) {
            return;
        }

        const location = nodeLocation(property.key);
        const classBinding = /^\[?class(?:\.([A-Za-z0-9_-]+))?\]?$/.exec(keyName);
        if (classBinding) {
            if (classBinding[1]) {
                result.usages.push({
                    name: classBinding[1],
                    type: 'class',
                    kind: 'angular-host-binding',
                    file: filePath,
                    line: location.line,
                    column: location.column,
                    length: keyName.length,
                });
            }
            if (t.isStringLiteral(property.value)) {
                splitTokens(property.value.value).forEach((name) => {
                    result.usages.push({
                        name,
                        type: 'class',
                        kind: 'angular-host-binding',
                        file: filePath,
                        line: location.line,
                        column: location.column,
                        length: name.length,
                    });
                });
            }
        }

        if (/^\[?id\]?$/.test(keyName) && t.isStringLiteral(property.value)) {
            result.usages.push({
                name: property.value.value,
                type: 'id',
                kind: 'angular-host-binding',
                file: filePath,
                line: location.line,
                column: location.column,
                length: property.value.value.length,
            });
        }
    });
}

function addHostBindingTokens(
    binding: string,
    filePath: string,
    lineIndex: LineIndex,
    location: { line: number; column: number },
    result: AngularParseResult,
): void {
    const classBinding = /^class\.([A-Za-z0-9_-]+)$/.exec(binding);
    if (classBinding) {
        result.usages.push({
            name: classBinding[1],
            type: 'class',
            kind: 'angular-host-binding',
            file: filePath,
            line: location.line,
            column: location.column,
            length: binding.length,
        });
    }
    if (/^attr\.(class|className)$/.test(binding)) {
        logger.debug(`@HostBinding('${binding}') allows dynamic classes; skipping`);
    }
    void lineIndex;
}

function collectStyleFiles(node: any, filePath: string, styleFiles: string[]): void {
    if (t.isArrayExpression(node)) {
        node.elements.forEach((element) => {
            if (t.isStringLiteral(element)) {
                if (/^\.\.?\//.test(element.value) || /\.(css|scss|sass|less)$/.test(element.value)) {
                    styleFiles.push(path.resolve(path.dirname(filePath), element.value));
                }
            }
        });
    } else if (t.isStringLiteral(node)) {
        styleFiles.push(path.resolve(path.dirname(filePath), node.value));
    }
}

function resolveTemplate(
    templateUrl: string,
    componentFile: string,
    options: AngularParseOptions,
): { found: boolean; path?: string; content?: string } {
    const direct = path.resolve(path.dirname(componentFile), templateUrl);

    try {
        if (fs.existsSync(direct)) {
            return { found: true, path: direct, content: fs.readFileSync(direct, 'utf8') };
        }
    } catch (error) {
        logger.debug(`templateUrl read failed: ${direct}`, errorMessage(error));
    }

    if (options.findFileByBasename) {
        try {
            const fallback = options.findFileByBasename(path.basename(templateUrl));
            if (fallback && fs.existsSync(fallback)) {
                logger.warn(
                    `templateUrl "${templateUrl}" not found next to ${path.basename(componentFile)}; using ${fallback}`,
                );
                return { found: true, path: fallback, content: fs.readFileSync(fallback, 'utf8') };
            }
        } catch (error) {
            logger.debug(`templateUrl fallback failed for ${templateUrl}`, errorMessage(error));
        }
    }

    return { found: false, path: direct };
}

function decoratorNameOf(decorator: any): string | undefined {
    const expression = decorator?.expression;
    if (t.isCallExpression(expression) && t.isIdentifier(expression.callee)) {
        return expression.callee.name;
    }
    if (t.isIdentifier(expression)) {
        return expression.name;
    }
    return undefined;
}

function splitSelectorTags(selector: string): string[] {
    const tags: string[] = [];
    selector.split(',').forEach((part) => {
        const tag = part.trim().split(/[\s>+~[]/)[0];
        if (tag && /^[a-zA-Z][\w-]*$/.test(tag)) {
            tags.push(tag.toLowerCase());
        }
    });
    return tags;
}

function nodeLocation(node: any): { line: number; column: number } {
    const index = node?.loc?.start;
    if (!index) {
        return { line: 1, column: 1 };
    }
    return { line: index.line, column: toOneBasedColumn(index.column) };
}

function splitTokens(value: string): string[] {
    return value
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(token));
}
