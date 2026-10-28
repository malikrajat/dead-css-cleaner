/**
 * JavaScript / TypeScript / JSX class-usage parser.
 *
 * Two layers:
 *  1. AST pass (Babel) - precise, understands JSX, CSS modules, clsx()/cx(),
 *     `cond && 'x'`, ternaries, arrays, objects and template literals.
 *  2. Text pass - always runs, so files Babel cannot parse (or that mix markup
 *     and script such as `.vue`/`.svelte`/`.astro`/`.html`) still contribute
 *     usages coming from `classList`, `querySelector`, `setAttribute`, ...
 */

import { parse as parseBabel } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { ErrorCollector, errorMessage } from '../core/errors';
import { logger } from '../core/logger';
import {
    collectStringLiterals,
    extractDynamicPrefixes,
    findMatches,
    isValidClassToken,
    LineIndex,
    splitClassTokens,
    toOneBasedColumn,
} from '../core/textUtils';
import type { Detection, TokenType, UsageKind, UsageResult } from '../core/types';

export interface JsParseLimits {
    maxSourceFileSizeKb: number;
    analyzeIds: boolean;
}

/** Identifiers that conventionally hold class names or CSS-module lookups. */
const _CLASS_ISH_OBJECT = /^(styles?|s|classes|cls|css|cssModule|stylesObj|theme|variants?)$/i;
const CLASS_ISH_VARIABLE = /(class|classes|cls|style|variant|modifier|tw|theme)/i;
const CLASS_ISH_CALLS = /^(clsx|classnames|classNames|cx|cn|twMerge|twJoin|join|concat|cva|tv|styled)$/;
const DOM_CLASS_METHODS = new Set(['add', 'remove', 'toggle', 'contains', 'replace', 'item', 'supports']);

interface ParseAttempt {
    plugins: any[];
    sourceType: 'module' | 'script';
}

export function parseJsUsage(filePath: string, text: string, _limits: JsParseLimits): UsageResult {
    const result: UsageResult = { file: filePath, usages: [], dynamicPatterns: [], imports: [], childComponents: [] };

    if (!text?.trim()) {
        return result;
    }

    // Text pass first: it is cheap, never throws and keeps working in degraded mode.
    try {
        const textUsages = extractUsageFromText(filePath, text);
        result.usages.push(...textUsages.usages);
        result.dynamicPatterns.push(...textUsages.dynamicPatterns);
    } catch (error) {
        logger.warn(`Text usage scan failed: ${filePath}`, errorMessage(error));
    }

    const ast = tryParse(filePath, text);
    if (!ast) {
        result.usages = dedupe(result.usages);
        result.dynamicPatterns = [...new Set(result.dynamicPatterns)];
        return result;
    }

    try {
        const astUsages: Detection[] = [];
        const stringVariables = new Map<string, string[]>();
        const cssModuleObjects = new Set<string>(['styles', 'style', 'classes', 'cls', 'css', 'cssModule', 's']);
        const imports = new Set<string>();
        const childComponents = new Set<string>();

        // Pass 0: discover imports, CSS modules and class-ish string variables.
        traverse(ast, {
            ImportDeclaration(path: any) {
                try {
                    const source = String(path.node.source?.value ?? '');
                    if (source) {
                        imports.add(source);
                    }
                    if (!/\.(css|scss|sass|less|styl)$/.test(source)) {
                        return;
                    }
                    path.node.specifiers?.forEach((specifier: any) => {
                        if (specifier.local?.name) {
                            cssModuleObjects.add(specifier.local.name);
                        }
                    });
                } catch {
                    /* ignore */
                }
            },
            VariableDeclarator(path: any) {
                try {
                    const id = path.node.id;
                    const init = path.node.init;
                    if (!t.isIdentifier(id) || !init || !CLASS_ISH_VARIABLE.test(id.name)) {
                        return;
                    }
                    const tokens = collectClassTokensFromNode(init, cssModuleObjects);
                    const names = tokens.map((token) => token.name).filter((name) => !name.startsWith('__dynamic__'));
                    if (names.length > 0) {
                        stringVariables.set(id.name, names);
                    }
                } catch {
                    /* ignore */
                }
            },
            AssignmentExpression(path: any) {
                // `this.className = 'a b'` / `element.className = cls`
                try {
                    const left = path.node.left;
                    const right = path.node.right;
                    const propertyName = memberPropertyName(left);
                    if (!propertyName) {
                        return;
                    }

                    if (/^className$|^class$/.test(propertyName)) {
                        collectClassTokensFromNode(right, cssModuleObjects).forEach((token) =>
                            pushUsage(
                                astUsages,
                                token.name,
                                'class',
                                'dom-class-attribute',
                                filePath,
                                token.location ?? nodeLocation(right),
                            ),
                        );
                    } else if (propertyName === 'id') {
                        collectClassTokensFromNode(right, cssModuleObjects).forEach((token) =>
                            pushUsage(
                                astUsages,
                                token.name,
                                'id',
                                'dom-id',
                                filePath,
                                token.location ?? nodeLocation(right),
                            ),
                        );
                    }
                } catch {
                    /* ignore */
                }
            },
        });

        // Pass 1: the actual usage extraction.
        traverse(ast, {
            JSXOpeningElement(path: any) {
                // `<Card />`, `<Card.Header />`, `<app-card />` - potential child components.
                try {
                    const name = jsxElementName(path.node.name);
                    if (name) {
                        childComponents.add(name);
                    }
                } catch {
                    /* ignore */
                }
            },

            JSXAttribute(path: any) {
                try {
                    const name = path.node.name;
                    if (!t.isJSXIdentifier(name)) {
                        return;
                    }
                    const attributeName = name.name;
                    const isClassAttribute =
                        attributeName === 'className' || attributeName === 'class' || attributeName === 'ngClass';
                    const isIdAttribute = attributeName === 'id';
                    if (!isClassAttribute && !isIdAttribute) {
                        return;
                    }

                    const type: TokenType = isIdAttribute ? 'id' : 'class';
                    const kind: UsageKind = isIdAttribute ? 'jsx-attribute' : 'jsx-attribute';
                    const value = path.node.value;
                    const location = nodeLocation(value ?? path.node);

                    if (!value) {
                        return;
                    }

                    if (t.isStringLiteral(value)) {
                        splitClassTokens(value.value).forEach((name) =>
                            pushUsage(astUsages, name, type, kind, filePath, nodeLocation(value)),
                        );
                        extractDynamicPrefixes(value.value).forEach((prefix) => result.dynamicPatterns.push(prefix));
                        return;
                    }

                    if (t.isJSXExpressionContainer(value)) {
                        const tokens = collectClassTokensFromNode(value.expression, cssModuleObjects, stringVariables);
                        tokens.forEach((token) =>
                            pushUsage(
                                astUsages,
                                token.name,
                                type,
                                token.kind ?? kind,
                                filePath,
                                token.location ?? location,
                            ),
                        );
                        tokens.forEach((token) => result.dynamicPatterns.push(...token.prefixes));
                        return;
                    }

                    // JSX spread attribute: `{...props}` - nothing to extract.
                } catch (error) {
                    logger.debug(`JSX attribute scan skipped in ${filePath}`, errorMessage(error));
                }
            },

            ObjectProperty(path: any) {
                // React.createElement('div', { className: 'x' }), Vue render `{ class: ... }`
                try {
                    const key = path.node.key;
                    const keyName = t.isIdentifier(key) ? key.name : t.isStringLiteral(key) ? key.value : undefined;
                    if (!keyName || !/^(className|class|ngClass|id)$/.test(keyName)) {
                        return;
                    }

                    // Skip JSX-like object literals inside CSS module maps.
                    const type: TokenType = keyName === 'id' ? 'id' : 'class';
                    const tokens = collectClassTokensFromNode(path.node.value, cssModuleObjects, stringVariables);
                    tokens.forEach((token) =>
                        pushUsage(
                            astUsages,
                            token.name,
                            type,
                            'js-object-key',
                            filePath,
                            token.location ?? nodeLocation(path.node.value),
                        ),
                    );
                    tokens.forEach((token) => result.dynamicPatterns.push(...token.prefixes));
                } catch {
                    /* ignore */
                }
            },

            CallExpression(path: any) {
                try {
                    const calleeText = calleeName(path.node.callee);
                    if (!calleeText) {
                        return;
                    }

                    // classList.add('a', 'b') / classList.toggle('a', cond)
                    if (calleeText === 'classList') {
                        const method = memberPropertyName(path.node.callee);
                        if (!method || !DOM_CLASS_METHODS.has(method)) {
                            return;
                        }
                        path.node.arguments.forEach((argument: any) => {
                            collectClassTokensFromNode(argument, cssModuleObjects, stringVariables).forEach((token) =>
                                pushUsage(
                                    astUsages,
                                    token.name,
                                    'class',
                                    'dom-classlist',
                                    filePath,
                                    token.location ?? nodeLocation(argument),
                                ),
                            );
                        });
                        return;
                    }

                    // setAttribute('class', 'a b') / setAttribute('id', 'x')
                    if (/^(setAttribute|setAttributeNS|attr)$/.test(calleeText)) {
                        const [nameArg, valueArg] = path.node.arguments;
                        if (t.isStringLiteral(nameArg)) {
                            const attribute = nameArg.value.toLowerCase();
                            if (attribute === 'class' || attribute === 'classname') {
                                collectClassTokensFromNode(valueArg, cssModuleObjects, stringVariables).forEach(
                                    (token) =>
                                        pushUsage(
                                            astUsages,
                                            token.name,
                                            'class',
                                            'dom-class-attribute',
                                            filePath,
                                            token.location ?? nodeLocation(valueArg),
                                        ),
                                );
                            } else if (attribute === 'id') {
                                collectClassTokensFromNode(valueArg, cssModuleObjects, stringVariables).forEach(
                                    (token) =>
                                        pushUsage(
                                            astUsages,
                                            token.name,
                                            'id',
                                            'dom-id',
                                            filePath,
                                            token.location ?? nodeLocation(valueArg),
                                        ),
                                );
                            }
                        }
                        return;
                    }

                    // querySelector('.a .b') / querySelectorAll('#x')
                    if (/^(querySelector|querySelectorAll|matches|closest)$/.test(calleeText)) {
                        const [selectorArg] = path.node.arguments;
                        if (t.isStringLiteral(selectorArg)) {
                            extractTokensFromSelector(selectorArg.value).forEach((token) =>
                                pushUsage(
                                    astUsages,
                                    token.name,
                                    token.type,
                                    'dom-selector',
                                    filePath,
                                    nodeLocation(selectorArg),
                                ),
                            );
                        }
                        return;
                    }

                    // getElementById('x') / getElementsByClassName('a b')
                    if (calleeText === 'getElementById') {
                        const [idArg] = path.node.arguments;
                        if (t.isStringLiteral(idArg)) {
                            pushUsage(astUsages, idArg.value, 'id', 'dom-id', filePath, nodeLocation(idArg));
                        }
                        return;
                    }
                    if (
                        /^(getElementsByClassName|getElementsByTagName|addClass|removeClass|hasClass|toggleClass)$/.test(
                            calleeText,
                        )
                    ) {
                        path.node.arguments.forEach((argument: any) => {
                            collectClassTokensFromNode(argument, cssModuleObjects, stringVariables).forEach((token) =>
                                pushUsage(
                                    astUsages,
                                    token.name,
                                    'class',
                                    'dom-classlist',
                                    filePath,
                                    token.location ?? nodeLocation(argument),
                                ),
                            );
                        });
                        return;
                    }

                    // jQuery: $('.foo .bar')
                    if (calleeText === '$' || calleeText === 'jQuery') {
                        path.node.arguments.forEach((argument: any) => {
                            if (t.isStringLiteral(argument) && /^[.#]/.test(argument.value.trim())) {
                                extractTokensFromSelector(argument.value).forEach((token) =>
                                    pushUsage(
                                        astUsages,
                                        token.name,
                                        token.type,
                                        'dom-selector',
                                        filePath,
                                        nodeLocation(argument),
                                    ),
                                );
                            }
                        });
                        return;
                    }
                } catch (error) {
                    logger.debug(`Call expression scan skipped in ${filePath}`, errorMessage(error));
                }
            },

            MemberExpression(path: any) {
                // styles.foo / styles['foo'] - CSS modules
                try {
                    const objectName = t.isIdentifier(path.node.object) ? path.node.object.name : undefined;
                    if (!objectName || !cssModuleObjects.has(objectName)) {
                        return;
                    }
                    let propertyName: string | undefined;
                    if (path.node.computed && t.isStringLiteral(path.node.property)) {
                        propertyName = path.node.property.value;
                    } else if (t.isIdentifier(path.node.property)) {
                        propertyName = path.node.property.name;
                    }
                    if (propertyName && isValidClassToken(propertyName)) {
                        pushUsage(
                            astUsages,
                            propertyName,
                            'class',
                            'css-module-member',
                            filePath,
                            nodeLocation(path.node.property),
                        );
                    }
                } catch {
                    /* ignore */
                }
            },

            Identifier(path: any) {
                // `className={myClass}` / `classList.add(activeClass)` via variable map.
                try {
                    const name = path.node.name;
                    const tokens = stringVariables.get(name);
                    if (!tokens || tokens.length === 0) {
                        return;
                    }
                    if (!path.isReferencedIdentifier()) {
                        return;
                    }
                    tokens.forEach((token) => {
                        pushUsage(astUsages, token, 'class', 'variable', filePath, nodeLocation(path.node));
                    });
                } catch {
                    /* ignore */
                }
            },
        });

        result.usages.push(...astUsages);
        result.imports = [...imports];
        result.childComponents = [...childComponents];
    } catch (error) {
        ErrorCollector.from('react-parse', `AST traversal failed for ${filePath}`, error, {
            file: filePath,
            recoverable: true,
        });
        logger.warn(`AST traversal failed, keeping text results: ${filePath}`, errorMessage(error));
    }

    result.usages = dedupe(result.usages);
    result.dynamicPatterns = [...new Set(result.dynamicPatterns)];
    return result;
}

function tryParse(filePath: string, text: string): t.File | undefined {
    const isTypeScript = /\.(ts|tsx|mts|cts)$/.test(filePath);
    const isJsx = /\.(jsx|tsx|js|mjs|cjs|vue|svelte|astro|mdx)$/.test(filePath);

    const base: any[] = ['decorators-legacy', 'classProperties', 'classPrivateProperties', 'classPrivateMethods'];
    const attempts: ParseAttempt[] = [
        {
            plugins: [
                ...(isTypeScript ? ['typescript'] : []),
                ...(isJsx ? ['jsx'] : []),
                ...base,
                'dynamicImport',
                'optionalChaining',
                'nullishCoalescingOperator',
                'objectRestSpread',
                'topLevelAwait',
                'exportDefaultFrom',
                'exportNamespaceFrom',
            ],
            sourceType: 'module',
        },
        { plugins: [...(isTypeScript ? ['typescript'] : []), ...base], sourceType: 'module' },
        { plugins: ['jsx', 'decorators-legacy', 'classProperties'], sourceType: 'module' },
        { plugins: [], sourceType: 'script' },
    ];

    for (const attempt of attempts) {
        try {
            return parseBabel(text, {
                sourceType: attempt.sourceType,
                plugins: attempt.plugins as any,
                errorRecovery: true,
                allowReturnOutsideFunction: true,
                allowAwaitOutsideFunction: true,
                tokens: false,
            });
        } catch (error) {
            logger.debug(
                `Babel parse attempt failed for ${filePath} (${attempt.plugins.join(',')})`,
                errorMessage(error),
            );
        }
    }

    ErrorCollector.from(
        'react-parse',
        `Could not parse script file, using text scan only: ${filePath}`,
        'All Babel plugin combinations failed',
        {
            file: filePath,
            recoverable: true,
        },
    );
    return undefined;
}

interface CollectedToken {
    name: string;
    kind?: UsageKind;
    location?: { line: number; column: number };
    prefixes: string[];
}

function collectClassTokensFromNode(
    node: t.Node | null | undefined,
    cssModuleObjects: Set<string>,
    stringVariables?: Map<string, string[]>,
): CollectedToken[] {
    const tokens: CollectedToken[] = [];

    const visit = (current: any, depth: number): void => {
        if (!current || depth > 8) {
            return;
        }
        const location = nodeLocation(current);

        if (t.isStringLiteral(current)) {
            splitClassTokens(current.value).forEach((name) =>
                tokens.push({ name, location, prefixes: extractDynamicPrefixes(current.value) }),
            );
            return;
        }

        if (t.isTemplateLiteral(current)) {
            current.quasis.forEach((quasi: any) => {
                const raw = quasi.value?.raw ?? '';
                const cooked = quasi.value?.cooked ?? raw;
                splitClassTokens(cooked).forEach((name) =>
                    tokens.push({ name, location: nodeLocation(quasi) ?? location, prefixes: [] }),
                );
                extractDynamicPrefixes(raw).forEach((prefix) =>
                    tokens.push({ name: `__dynamic__${prefix}`, kind: undefined, location, prefixes: [prefix] }),
                );
            });
            current.expressions.forEach((expression: any) => visit(expression, depth + 1));
            return;
        }

        if (t.isIdentifier(current)) {
            if (stringVariables?.has(current.name)) {
                stringVariables.get(current.name)!.forEach((name) => tokens.push({ name, location, prefixes: [] }));
            }
            return;
        }

        if (t.isMemberExpression(current) || t.isOptionalMemberExpression(current)) {
            const objectName = t.isIdentifier(current.object) ? current.object.name : undefined;
            let propertyName: string | undefined;
            if (current.computed && t.isStringLiteral(current.property)) {
                propertyName = current.property.value;
            } else if (t.isIdentifier(current.property)) {
                propertyName = current.property.name;
            }
            if (propertyName && objectName && cssModuleObjects.has(objectName) && isValidClassToken(propertyName)) {
                tokens.push({
                    name: propertyName,
                    kind: 'css-module-member',
                    location: nodeLocation(current.property),
                    prefixes: [],
                });
            }
            if (t.isSuper(current.object)) {
                return;
            }
            return;
        }

        if (t.isConditionalExpression(current)) {
            visit(current.consequent, depth + 1);
            visit(current.alternate, depth + 1);
            return;
        }

        if (t.isLogicalExpression(current)) {
            visit(current.left, depth + 1);
            visit(current.right, depth + 1);
            return;
        }

        if (t.isArrayExpression(current)) {
            current.elements.forEach((element: any) => visit(element, depth + 1));
            return;
        }

        if (t.isObjectExpression(current)) {
            current.properties.forEach((property: any) => {
                if (t.isObjectProperty(property)) {
                    const key = property.key;
                    if (t.isStringLiteral(key)) {
                        splitClassTokens(key.value).forEach((name) =>
                            tokens.push({ name, kind: 'js-object-key', location: nodeLocation(key), prefixes: [] }),
                        );
                    } else if (t.isIdentifier(key)) {
                        // { active: isActive }
                        if (key.name !== '__proto__') {
                            tokens.push({
                                name: key.name,
                                kind: 'js-object-key',
                                location: nodeLocation(key),
                                prefixes: [],
                            });
                        }
                    }
                }
            });
            return;
        }

        if (t.isCallExpression(current) || t.isOptionalCallExpression(current)) {
            const callee = calleeName(current.callee);
            const isClassishCall = !!callee && CLASS_ISH_CALLS.test(callee);
            current.arguments.forEach((argument: any) => {
                if (isClassishCall || t.isConditionalExpression(argument) || t.isLogicalExpression(argument)) {
                    visit(argument, depth + 1);
                    return;
                }
                // Unknown call: only trust string literals, never nested objects.
                if (t.isStringLiteral(argument) || t.isTemplateLiteral(argument)) {
                    visit(argument, depth + 1);
                }
            });
            return;
        }

        if (t.isBinaryExpression(current) && current.operator === '+') {
            // 'btn-' + size
            if (t.isStringLiteral(current.left)) {
                splitClassTokens(current.left.value).forEach((name) => tokens.push({ name, location, prefixes: [] }));
                extractDynamicPrefixes(current.left.value).forEach(
                    (prefix) => prefix && tokens.push({ name: `__dynamic__${prefix}`, prefixes: [prefix], location }),
                );
            }
            visit(current.left, depth + 1);
            visit(current.right, depth + 1);
            return;
        }

        if (t.isTaggedTemplateExpression(current)) {
            // styled.div`...` or tw`...`
            const tag = calleeName(current.tag);
            if (tag && /^(tw|css|styled|cva)$/.test(tag)) {
                visit(current.quasi, depth + 1);
            }
            return;
        }

        if (t.isTSAsExpression(current) || t.isTSNonNullExpression(current) || t.isTSTypeAssertion(current)) {
            visit((current as any).expression, depth + 1);
            return;
        }

        if (t.isParenthesizedExpression(current)) {
            visit(current.expression, depth + 1);
        }
    };

    visit(node, 0);
    return tokens;
}

function dedupe(usages: Detection[]): Detection[] {
    const seen = new Set<string>();
    const output: Detection[] = [];
    for (const usage of usages) {
        if (usage.name.startsWith('__dynamic__')) {
            continue;
        }
        const key = `${usage.type}:${usage.name}:${usage.file}:${usage.line}:${usage.column}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        output.push(usage);
    }
    return output;
}

function pushUsage(
    usages: Detection[],
    name: string,
    type: TokenType,
    kind: UsageKind,
    file: string,
    location?: { line: number; column: number },
): void {
    if (!name || name.startsWith('__dynamic__')) {
        return;
    }
    if (!isValidClassToken(name)) {
        return;
    }
    usages.push({
        name,
        type,
        kind,
        file,
        line: location?.line ?? 1,
        column: location?.column ?? 1,
        length: name.length,
    });
}

function nodeLocation(node: any): { line: number; column: number } | undefined {
    const index = node?.loc?.start;
    if (!index) {
        return undefined;
    }
    return { line: index.line, column: toOneBasedColumn(index.column) };
}

/**
 * Name of a rendered JSX element: `Card` -> `Card`, `<Foo.Bar>` -> `Bar`,
 * `app-card` -> `app-card`. Returns undefined for fragments.
 */
function jsxElementName(name: any): string | undefined {
    if (!name) {
        return undefined;
    }
    if (t.isJSXIdentifier(name)) {
        return name.name;
    }
    if (t.isJSXMemberExpression(name)) {
        return t.isJSXIdentifier(name.property) ? name.property.name : undefined;
    }
    if (t.isJSXNamespacedName(name)) {
        return `${name.namespace.name}:${name.name.name}`;
    }
    return undefined;
}

function calleeName(callee: any): string | undefined {
    if (!callee) {
        return undefined;
    }
    if (t.isIdentifier(callee)) {
        return callee.name;
    }
    if (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) {
        if (t.isIdentifier(callee.object)) {
            return memberPropertyName(callee) ?? callee.object.name;
        }
        return memberPropertyName(callee);
    }
    return undefined;
}

function memberPropertyName(node: any): string | undefined {
    if (!t.isMemberExpression(node) && !t.isOptionalMemberExpression(node)) {
        return undefined;
    }
    if (!node.computed && t.isIdentifier(node.property)) {
        return node.property.name;
    }
    if (node.computed && t.isStringLiteral(node.property)) {
        return node.property.value;
    }
    return undefined;
}

/** Extract class/id tokens from a CSS selector string (`.a .b#c`). */
export function extractTokensFromSelector(selector: string): Detection[] {
    const tokens: Detection[] = [];
    const pattern = /([.#])([A-Za-z_][A-Za-z0-9_-]*)/g;
    for (const match of findMatches(pattern, selector)) {
        tokens.push({
            name: match[2],
            type: match[1] === '.' ? 'class' : 'id',
            kind: 'dom-selector',
            file: '',
            line: 1,
            column: 1,
            length: match[2].length,
        });
    }
    return tokens;
}

/**
 * Regex-based usage extraction. Used as a supplement for every JS file and as
 * the only pass for files Babel rejects. Favours recall over precision so that
 * genuinely used classes are never reported as dead.
 */
export function extractUsageFromText(
    filePath: string,
    text: string,
): {
    usages: Detection[];
    dynamicPatterns: string[];
} {
    const usages: Detection[] = [];
    const dynamicPatterns: string[] = [];
    const lineIndex = new LineIndex(text);

    const add = (name: string, type: TokenType, kind: UsageKind, index: number) => {
        if (!isValidClassToken(name)) {
            return;
        }
        const position = lineIndex.positionAt(index);
        usages.push({
            name,
            type,
            kind,
            file: filePath,
            line: position.line,
            column: position.column,
            length: name.length,
        });
    };

    const runPattern = (pattern: RegExp, handler: (match: RegExpExecArray) => void) => {
        for (const match of findMatches(pattern, text)) {
            try {
                handler(match);
            } catch {
                /* ignore individual matches */
            }
        }
    };

    // classList.add('a', 'b') / classList.toggle("x")
    runPattern(/\bclassList\s*\.\s*(?:add|remove|toggle|contains|replace)\s*\(([^)]*)\)/g, (match) => {
        collectStringLiterals(match[1]).forEach((literal) => {
            splitClassTokens(literal.value).forEach((name) => add(name, 'class', 'dom-classlist', match.index));
        });
    });

    // setAttribute('class', 'a b')
    runPattern(/\bsetAttribute\s*\(\s*(['"`])(class|className|id)\1\s*,\s*(['"`])([^'"`]*)\3/g, (match) => {
        const type: TokenType = match[2].toLowerCase() === 'id' ? 'id' : 'class';
        splitClassTokens(match[4]).forEach((name) => add(name, type, 'dom-class-attribute', match.index));
    });

    // querySelector('.a .b') / querySelectorAll('#x')
    runPattern(/\b(?:querySelector|querySelectorAll|matches|closest)\s*\(\s*(['"`])([^'"`]+)\1/g, (match) => {
        extractTokensFromSelector(match[2]).forEach((token) =>
            add(token.name, token.type, 'dom-selector', match.index),
        );
    });

    // getElementById('x')
    runPattern(/\bgetElementById\s*\(\s*(['"`])([^'"`]+)\1/g, (match) => {
        add(match[2], 'id', 'dom-id', match.index);
    });

    // getElementsByClassName('a b')
    runPattern(/\bgetElementsByClassName\s*\(\s*(['"`])([^'"`]+)\1/g, (match) => {
        splitClassTokens(match[2]).forEach((name) => add(name, 'class', 'dom-classlist', match.index));
    });

    // element.className = 'a b' / element.id = 'x'
    runPattern(/\.(className|class|id)\s*=\s*(['"`])([^'"`]*)\2/g, (match) => {
        const type: TokenType = match[1] === 'id' ? 'id' : 'class';
        splitClassTokens(match[3]).forEach((name) => add(name, type, 'dom-class-attribute', match.index));
        extractDynamicPrefixes(match[3]).forEach((prefix) => dynamicPatterns.push(prefix));
    });

    // JSX / HTML attributes: className="a b", class="a b", id="x"
    runPattern(/\b(className|class|id)\s*=\s*(['"`])([^'"`{}]*)\2/g, (match) => {
        const type: TokenType = match[1] === 'id' ? 'id' : 'class';
        splitClassTokens(match[3]).forEach((name) => add(name, type, 'html-attribute', match.index));
        extractDynamicPrefixes(match[3]).forEach((prefix) => dynamicPatterns.push(prefix));
    });

    // class-ish string variables: const buttonClass = 'btn primary'
    runPattern(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`]*)\2/g, (match) => {
        if (!CLASS_ISH_VARIABLE.test(match[1])) {
            return;
        }
        splitClassTokens(match[3]).forEach((name) => add(name, 'class', 'variable', match.index));
        extractDynamicPrefixes(match[3]).forEach((prefix) => dynamicPatterns.push(prefix));
    });

    // CSS-module style member access: styles.foo / styles['foo']
    const moduleIdentifiers = new Set<string>();
    runPattern(/\bimport\s+([A-Za-z_$][\w$]*)\s+from\s*['"][^'"]*\.(?:css|scss|sass|less)['"]/g, (match) => {
        moduleIdentifiers.add(match[1]);
    });
    runPattern(
        /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"][^'"]*\.(?:css|scss|sass|less)['"]\s*\)/g,
        (match) => {
            moduleIdentifiers.add(match[1]);
        },
    );
    ['styles', 'style', 'classes', 'cls', 'css', 'cssModule', 's'].forEach((name) => moduleIdentifiers.add(name));

    const memberPattern = new RegExp(
        `\\b(?:${[...moduleIdentifiers].map(escapeRegExp).join('|')})\\s*(?:\\.\\s*([A-Za-z_$][\\w$]*)|\\[\\s*(['"\`])([^'"\`]+)\\2\\s*\\])`,
        'g',
    );
    runPattern(memberPattern, (match) => {
        const property = match[1] ?? match[3];
        if (property) {
            add(property, 'class', 'css-module-member', match.index);
        }
    });

    // Template literals with placeholders: `btn-${size}`
    runPattern(/`([^`]*)`/g, (match) => {
        extractDynamicPrefixes(match[1]).forEach((prefix) => dynamicPatterns.push(prefix));
    });

    // String concatenation: 'btn-' + size
    runPattern(/(['"`])([A-Za-z_][A-Za-z0-9_-]*?[-_])\1\s*\+/g, (match) => {
        dynamicPatterns.push(match[2]);
    });

    // Unquoted object keys in class-ish contexts: clsx({ active: true })
    runPattern(/\b(?:clsx|classnames|classNames|cx|cn|twMerge|twJoin|cva)\s*\(([\s\S]{0,400}?)\)/g, (match) => {
        collectObjectKeysFromText(match[1]).forEach((key) => add(key, 'class', 'js-object-key', match.index));
        collectStringLiterals(match[1]).forEach((literal) => {
            splitClassTokens(literal.value).forEach((name) => add(name, 'class', 'js-call-argument', match.index));
        });
    });

    return { usages, dynamicPatterns: [...new Set(dynamicPatterns)] };
}

export function collectObjectKeysFromText(text: string): string[] {
    const keys: string[] = [];
    const pattern = /(?:^|[{,])\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$-]*))\s*:/g;
    for (const match of findMatches(pattern, text)) {
        const key = match[1] ?? match[2] ?? match[3];
        if (key && key !== 'true' && key !== 'false') {
            keys.push(key);
        }
    }
    return keys;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
