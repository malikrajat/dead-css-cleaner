/**
 * Markup parser for HTML / Angular templates / Vue / Svelte / Astro / Blade-ish
 * template files.
 *
 * The previous version only understood `class="..."` in Angular templates,
 * which is why nested/child classes and framework bindings were reported as
 * unused. This one understands:
 *   - `class="a b"`, `className="a b"`, `id="x"`
 *   - Angular: `[class.x]`, `[ngClass]`, `ngClass`, `[class]`, `[attr.class]`, `[id]`
 *   - Vue: `:class="{ active: isActive }"`, `v-bind:class="[...]"`
 *   - Svelte: `class:active={cond}`, `class:list`
 *   - Astro/Svelte 5: `class={...}`, `class:list={[...]}`
 *   - expression values: ternaries, `&&`, arrays, objects, calls, CSS-module members
 */

import {
    collectStringLiterals,
    extractDynamicPrefixes,
    findMatches,
    isValidClassToken,
    isValidIdToken,
    LineIndex,
    splitClassTokens,
} from '../core/textUtils';
import type { Detection, TokenType, UsageKind } from '../core/types';

export interface MarkupParseResult {
    usages: Detection[];
    dynamicPatterns: string[];
    /** Lower-cased tag names found in the markup (used by element-selector analysis). */
    tags: Set<string>;
    /** Attributes that held an unresolvable expression (reported in debug logs). */
    unresolvedBindings: Array<{ file: string; line: number; attribute: string; expression: string }>;
}

export function parseMarkupText(filePath: string, text: string): MarkupParseResult {
    const result: MarkupParseResult = {
        usages: [],
        dynamicPatterns: [],
        tags: new Set<string>(),
        unresolvedBindings: [],
    };

    if (!text?.trim()) {
        return result;
    }

    const lineIndex = new LineIndex(text);
    const masked = maskNonMarkup(text);
    const tagRegex = /<([A-Za-z][A-Za-z0-9:._-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

    for (const tagMatch of findMatches(tagRegex, masked)) {
        const tagName = tagMatch[1];
        const attributesText = tagMatch[2];
        const attributesStart = tagMatch.index + 1 + tagName.length;

        if (!tagName.startsWith('!') && !tagName.toLowerCase().startsWith('ng-')) {
            result.tags.add(tagName.toLowerCase());
        }

        try {
            const attributes = scanAttributes(attributesText, attributesStart);
            attributes.forEach((attribute) => {
                handleAttribute(attribute, filePath, lineIndex, result);
            });
        } catch {
            // Malformed tag: skip it, never break the whole file.
        }
    }

    // Framework bindings that are not inside a tag we recognised (e.g. `{...}` in MDX).
    collectLooseBindings(masked, filePath, lineIndex, result);

    return result;
}

interface MarkupAttribute {
    name: string;
    /** Raw value without surrounding quotes. */
    value: string;
    /** Absolute offset of the first character of the value. */
    valueOffset: number;
    hasValue: boolean;
}

function scanAttributes(attributesText: string, attributesStart: number): MarkupAttribute[] {
    const attributes: MarkupAttribute[] = [];
    let i = 0;

    while (i < attributesText.length) {
        while (i < attributesText.length && /\s/.test(attributesText[i])) {
            i++;
        }
        if (i >= attributesText.length) {
            break;
        }
        if (attributesText[i] === '/') {
            i++;
            continue;
        }

        const nameStart = i;
        while (i < attributesText.length && !/[\s=/>]/.test(attributesText[i])) {
            i++;
        }
        const name = attributesText.slice(nameStart, i);
        if (!name) {
            i++;
            continue;
        }

        while (i < attributesText.length && /\s/.test(attributesText[i])) {
            i++;
        }

        if (attributesText[i] !== '=') {
            attributes.push({ name, value: '', valueOffset: attributesStart + i, hasValue: false });
            continue;
        }

        i++; // consume '='
        while (i < attributesText.length && /\s/.test(attributesText[i])) {
            i++;
        }

        const valueStart = i;
        let value = '';

        if (i < attributesText.length && (attributesText[i] === '"' || attributesText[i] === "'")) {
            const quote = attributesText[i];
            i++;
            const contentStart = i;
            while (i < attributesText.length && attributesText[i] !== quote) {
                if (attributesText[i] === '\\') {
                    i++;
                }
                i++;
            }
            value = attributesText.slice(contentStart, i);
            i++; // closing quote
            attributes.push({
                name,
                value,
                valueOffset: attributesStart + contentStart,
                hasValue: true,
            });
            continue;
        }

        if (i < attributesText.length && attributesText[i] === '{') {
            const contentStart = i + 1;
            let depth = 0;
            let quote: string | null = null;
            for (; i < attributesText.length; i++) {
                const char = attributesText[i];
                if (quote) {
                    if (char === '\\') {
                        i++;
                    } else if (char === quote) {
                        quote = null;
                    }
                    continue;
                }
                if (char === '"' || char === "'") {
                    quote = char;
                    continue;
                }
                if (char === '{') {
                    depth++;
                    continue;
                }
                if (char === '}') {
                    depth--;
                    if (depth === 0) {
                        i++;
                        break;
                    }
                }
            }
            value = attributesText.slice(contentStart, Math.max(i - 1, contentStart));
            attributes.push({
                name,
                value,
                valueOffset: attributesStart + contentStart,
                hasValue: true,
            });
            continue;
        }

        while (i < attributesText.length && !/[\s>]/.test(attributesText[i])) {
            i++;
        }
        value = attributesText.slice(valueStart, i);
        attributes.push({
            name,
            value,
            valueOffset: attributesStart + valueStart,
            hasValue: true,
        });
    }

    return attributes;
}

function handleAttribute(
    attribute: MarkupAttribute,
    filePath: string,
    lineIndex: LineIndex,
    result: MarkupParseResult,
): void {
    const rawName = attribute.name;
    const name = rawName.replace(/^\[|\]$/g, '');
    const lower = name.toLowerCase();

    // Svelte class directive: class:active / class:active={cond}
    if (lower.startsWith('class:')) {
        const className = name.slice('class:'.length);
        if (className && className.toLowerCase() !== 'list') {
            addTokens([className], 'class', 'html-binding', filePath, lineIndex, attribute.valueOffset, result);
        }
        if (attribute.hasValue && attribute.value) {
            collectBindingExpressionTokens(attribute.value, filePath, lineIndex, attribute.valueOffset, result);
        }
        return;
    }

    // Svelte id directive: id:name
    if (lower.startsWith('id:')) {
        const idName = name.slice('id:'.length);
        if (idName) {
            addTokens([idName], 'id', 'html-binding', filePath, lineIndex, attribute.valueOffset, result);
        }
        return;
    }

    // Angular class binding with an explicit class: [class.active]
    const angularClassBinding = /^class\.([A-Za-z0-9_-]+)$/i.exec(name);
    if (angularClassBinding) {
        addTokens(
            [angularClassBinding[1]],
            'class',
            'angular-binding',
            filePath,
            lineIndex,
            attribute.valueOffset,
            result,
        );
        if (attribute.hasValue) {
            collectBindingExpressionTokens(attribute.value, filePath, lineIndex, attribute.valueOffset, result);
        }
        return;
    }

    if (/^(class|classname|ngclass|classlist|attr\.class)$/i.test(name) || /class/i.test(lower)) {
        handleClassValue(attribute, filePath, lineIndex, result);
        return;
    }

    if (/^(id|attr\.id)$/i.test(name)) {
        handleIdValue(attribute, filePath, lineIndex, result);
    }
}

function handleClassValue(
    attribute: MarkupAttribute,
    filePath: string,
    lineIndex: LineIndex,
    result: MarkupParseResult,
): void {
    if (!attribute.hasValue || !attribute.value.trim()) {
        return;
    }

    const value = attribute.value.trim();
    const looksLikePlainList = /^[A-Za-z0-9_\-\s{}$]+$/.test(value) && !/[?&|]/.test(value);

    if (looksLikePlainList) {
        extractPlainClassList(value, filePath, lineIndex, attribute.valueOffset, 'html-attribute', result);
        return;
    }

    collectBindingExpressionTokens(value, filePath, lineIndex, attribute.valueOffset, result);
}

function handleIdValue(
    attribute: MarkupAttribute,
    filePath: string,
    lineIndex: LineIndex,
    result: MarkupParseResult,
): void {
    if (!attribute.hasValue || !attribute.value.trim()) {
        return;
    }
    const value = attribute.value.trim();
    if (/^[A-Za-z0-9_-]+$/.test(value)) {
        addTokens([value], 'id', 'html-attribute', filePath, lineIndex, attribute.valueOffset, result);
        return;
    }
    // Bound ids: [id]="expr" / :id="expr"
    collectBindingExpressionTokens(value, filePath, lineIndex, attribute.valueOffset, result, 'id');
}

/** `class="a b c"` and `class="a {{b}} c"`. */
function extractPlainClassList(
    value: string,
    filePath: string,
    lineIndex: LineIndex,
    valueOffset: number,
    kind: UsageKind,
    result: MarkupParseResult,
): void {
    const tokens: Array<{ name: string; offset: number }> = [];
    const interpPattern = /\{\{\s*[^}]*\}\}|\$\{[^}]*\}|#\{[^}]*\}|<%=?[\s\S]*?%>/g;
    let lastIndex = 0;
    const staticParts: string[] = [];

    for (const match of findMatches(interpPattern, value)) {
        staticParts.push(value.slice(lastIndex, match.index));
        lastIndex = match.index + match[0].length;
    }
    staticParts.push(value.slice(lastIndex));

    staticParts.forEach((part) => {
        splitClassTokens(part).forEach((token) => tokens.push({ name: token, offset: 0 }));
    });

    const dynamicPrefixes = extractDynamicPrefixes(value);
    dynamicPrefixes.forEach((prefix) => result.dynamicPatterns.push(prefix));

    addTokens(
        tokens.filter((token) => isValidClassToken(token.name)).map((token) => token.name),
        'class',
        kind,
        filePath,
        lineIndex,
        valueOffset,
        result,
    );
}

export function collectBindingExpressionTokens(
    expression: string,
    filePath: string,
    lineIndex: LineIndex,
    valueOffset: number,
    result: MarkupParseResult,
    forcedType?: TokenType,
): void {
    const expr = expression.trim();
    if (!expr) {
        return;
    }

    const tokens: Array<{ name: string; offset: number; type: TokenType }> = [];

    // 1. String literals: 'a', "a", `a`, and interpolation inside them.
    collectStringLiterals(expr).forEach((literal) => {
        const inner = literal.value;
        const literalHasInterpolation = /\$\{|#\{|\{\{/.test(inner);
        const parts = literalHasInterpolation ? inner.split(/\$\{[^}]*\}|#\{[^}]*\}|\{\{[^}]*\}\}/) : [inner];
        parts.forEach((part) => {
            splitClassTokens(part).forEach((token) => {
                tokens.push({ name: token, offset: literal.index, type: forcedType ?? 'class' });
            });
        });
        extractDynamicPrefixes(inner).forEach((prefix) => result.dynamicPatterns.push(prefix));
        if (literalHasInterpolation) {
            const prefix = inner.split(/\$\{|#\{|\{\{/)[0];
            if (prefix && prefix.length >= 2) {
                result.dynamicPatterns.push(prefix);
            }
        }
    });

    // 2. Object literal keys: { active: isActive, 'btn-lg': cond }
    collectObjectKeys(expr).forEach((key) => {
        tokens.push({ name: key.name, offset: key.offset, type: forcedType ?? 'class' });
    });

    // 3. CSS-module / styles member access: styles.foo, s['bar']
    collectMemberNames(expr).forEach((member) => {
        tokens.push({ name: member.name, offset: member.offset, type: forcedType ?? 'class' });
    });

    // 4. Angular/Vue mixed values such as "a {{cls}} b" without quotes handled above.
    extractDynamicPrefixes(expr).forEach((prefix) => result.dynamicPatterns.push(prefix));

    const resolvedType: TokenType = forcedType ?? 'class';
    const kind: UsageKind = forcedType === 'id' ? 'html-binding' : 'html-binding';

    tokens.forEach((token) => {
        const valid = resolvedType === 'id' ? isValidIdToken(token.name) : isValidClassToken(token.name);
        if (!valid) {
            return;
        }
        const absolute = valueOffset + Math.max(token.offset, 0);
        const position = lineIndex.positionAt(absolute);
        result.usages.push({
            name: token.name,
            type: resolvedType,
            kind,
            file: filePath,
            line: position.line,
            column: position.column,
            length: token.name.length,
        });
    });

    if (tokens.length === 0 && /^[A-Za-z_$][\w$.[\]'"]*$/.test(expr)) {
        // e.g. `[ngClass]="dynamicClass"`: the value lives in the component class.
        const position = lineIndex.positionAt(valueOffset);
        result.unresolvedBindings.push({
            file: filePath,
            line: position.line,
            attribute: 'class',
            expression: expr,
        });
    }
}

/** Collect `key` names from object literals inside an expression. */
export function collectObjectKeys(expression: string): Array<{ name: string; offset: number }> {
    const results: Array<{ name: string; offset: number }> = [];
    if (!expression.includes('{')) {
        return results;
    }
    const pattern = /[{,]\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$.-]*))\s*:/g;
    for (const match of findMatches(pattern, expression)) {
        const value = match[1] ?? match[2] ?? match[3];
        if (!value) {
            continue;
        }
        const offset = match.index + match[0].indexOf(value);
        results.push({ name: value, offset });
    }
    return results;
}

/** Collect `styles.foo` / `styles['foo']` members when the object looks class-ish. */
export function collectMemberNames(expression: string): Array<{ name: string; offset: number }> {
    const results: Array<{ name: string; offset: number }> = [];
    const memberPattern = /\b([A-Za-z_$][\w$]*)\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*(['"])([^'"]+)\3\s*\])/g;
    for (const match of findMatches(memberPattern, expression)) {
        const objectName = match[1];
        const propertyName = match[2] ?? match[4];
        if (!propertyName) {
            continue;
        }
        if (!/^(styles?|s|classes|cls|css|cssModule|stylesObj)$/i.test(objectName)) {
            continue;
        }
        const offset = match.index + match[0].lastIndexOf(propertyName);
        results.push({ name: propertyName, offset });
    }
    return results;
}

/** Catch bindings that live outside a tag we parsed (MDX / Vue templates). */
function collectLooseBindings(masked: string, filePath: string, lineIndex: LineIndex, result: MarkupParseResult): void {
    const loosePattern = /\[class\.([A-Za-z0-9_-]+)\]/g;
    for (const match of findMatches(loosePattern, masked)) {
        const position = lineIndex.positionAt(match.index);
        if (!isValidClassToken(match[1])) {
            continue;
        }
        result.usages.push({
            name: match[1],
            type: 'class',
            kind: 'angular-binding',
            file: filePath,
            line: position.line,
            column: position.column,
            length: match[0].length,
        });
    }
}

function addTokens(
    names: string[],
    type: TokenType,
    kind: UsageKind,
    filePath: string,
    lineIndex: LineIndex,
    valueOffset: number,
    result: MarkupParseResult,
): void {
    names.forEach((name) => {
        if (!name) {
            return;
        }
        const valid = type === 'id' ? isValidIdToken(name) : isValidClassToken(name);
        if (!valid) {
            return;
        }
        const position = lineIndex.positionAt(valueOffset);
        result.usages.push({
            name,
            type,
            kind,
            file: filePath,
            line: position.line,
            column: position.column,
            length: name.length,
        });
    });
}

/**
 * Replace comments and the contents of `<script>` / `<style>` / frontmatter with
 * spaces so attribute scanning never picks up JS/CSS text, while offsets stay valid.
 */
function maskNonMarkup(text: string): string {
    const chars = text.split('');
    const blank = (start: number, end: number) => {
        for (let i = start; i < end && i < chars.length; i++) {
            if (chars[i] !== '\n' && chars[i] !== '\r') {
                chars[i] = ' ';
            }
        }
    };

    // Comments.
    const commentPattern = /<!--[\s\S]*?-->/g;
    for (const match of findMatches(commentPattern, text)) {
        blank(match.index, match.index + match[0].length);
    }

    // Script / style blocks.
    const blockPattern = /<(script|style)\b[\s\S]*?<\/\1>/gi;
    for (const match of findMatches(blockPattern, text)) {
        const openEnd = match[0].indexOf('>');
        blank(match.index + openEnd + 1, match.index + match[0].length);
    }

    // Astro / Svelte frontmatter (`--- ... ---` at the very top).
    const frontmatter = /^\uFEFF?\s*---\r?\n[\s\S]*?\r?\n---/.exec(text);
    if (frontmatter) {
        blank(frontmatter.index, frontmatter.index + frontmatter[0].length);
    }

    // Vue SFC blocks other than the template.
    const vueScript = /<script\b[\s\S]*?<\/script>/gi;
    for (const match of findMatches(vueScript, text)) {
        const openEnd = match[0].indexOf('>');
        blank(match.index + openEnd + 1, match.index + match[0].length);
    }

    return chars.join('');
}
