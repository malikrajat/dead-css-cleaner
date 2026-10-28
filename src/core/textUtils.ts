/** Pure text helpers shared by every parser. */

const CLASS_TOKEN_REGEX = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export interface TextPosition {
    /** 1-based line. */
    line: number;
    /** 1-based column. */
    column: number;
    /** 0-based absolute offset. */
    offset: number;
}

export class LineIndex {
    private readonly lineStarts: number[];

    constructor(public readonly text: string) {
        const starts = [0];
        for (let i = 0; i < text.length; i++) {
            if (text.charCodeAt(i) === 10 /* \n */) {
                starts.push(i + 1);
            }
        }
        this.lineStarts = starts;
    }

    get lineCount(): number {
        return this.lineStarts.length;
    }

    /** 0-based offset for the start of a 1-based line. */
    lineStart(line: number): number {
        const index = Math.min(Math.max(line - 1, 0), this.lineStarts.length - 1);
        return this.lineStarts[index];
    }

    positionAt(offset: number): TextPosition {
        const safeOffset = Math.min(Math.max(offset, 0), this.text.length);
        let low = 0;
        let high = this.lineStarts.length - 1;
        while (low < high) {
            const mid = Math.floor((low + high + 1) / 2);
            if (this.lineStarts[mid] <= safeOffset) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        return {
            line: low + 1,
            column: safeOffset - this.lineStarts[low] + 1,
            offset: safeOffset,
        };
    }

    offsetOf(line: number, column: number): number {
        const start = this.lineStart(line);
        const nextLineStart = line < this.lineStarts.length ? this.lineStarts[line] : this.text.length;
        return Math.min(start + Math.max(column - 1, 0), nextLineStart);
    }

    lineText(line: number): string {
        const start = this.lineStart(line);
        const end = line < this.lineStarts.length ? this.lineStarts[line] : this.text.length;
        return this.text.slice(start, end).replace(/\r?\n$/, '');
    }
}

/**
 * Convert a Babel/PostCSS `{ line, column }` (1-based line, 0-based column)
 * into a 1-based column we can hand to VS Code positions.
 */
export function toOneBasedColumn(column: number | null | undefined): number {
    return Math.max((column ?? 0) + 1, 1);
}

/** Split an attribute/class string ("btn  primary\n active") into tokens. */
export function splitClassTokens(value: string): string[] {
    if (!value) {
        return [];
    }
    return value
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
}

export function isValidClassToken(token: string): boolean {
    return token.length > 0 && token.length <= 200 && CLASS_TOKEN_REGEX.test(token);
}

export function isValidIdToken(token: string): boolean {
    return isValidClassToken(token);
}

/** Strip quotes/brackets from a value that may be `'x'`, `"x"`, `` `x` `` or bare. */
export function unquote(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
        const first = trimmed[0];
        const last = trimmed[trimmed.length - 1];
        if ((first === '"' || first === "'" || first === '`') && first === last) {
            return trimmed.slice(1, -1);
        }
    }
    return trimmed;
}

/**
 * Extract "dynamic class" prefixes from template strings, e.g.
 * `btn-${size}` -> `btn-`, `col-{{ index }}` -> `col-`, `is-*` -> `is-`.
 * These prefixes are used to suppress false positives.
 */
export function extractDynamicPrefixes(value: string): string[] {
    const prefixes = new Set<string>();
    if (!value) {
        return [];
    }

    const patterns = [
        // JS/TS template literal placeholders: btn-${size}-active
        /([A-Za-z_][A-Za-z0-9_-]*?[-_][A-Za-z0-9_-]*?)\$\{/g,
        // Angular/HTML interpolation: btn-{{ size }}
        /([A-Za-z_][A-Za-z0-9_-]*?[-_][A-Za-z0-9_-]*?)\{\{/g,
        // SCSS interpolation: btn-#{$size}
        /([A-Za-z_][A-Za-z0-9_-]*?[-_][A-Za-z0-9_-]*?)#\{/g,
        // Wildcard fragments: btn-*
        /([A-Za-z_][A-Za-z0-9_-]*?[-_])[.*]/g,
    ];

    for (const pattern of patterns) {
        for (const match of findMatches(pattern, value)) {
            const prefix = match[1];
            if (prefix && prefix.length >= 2) {
                prefixes.add(prefix);
            }
        }
    }

    // String concatenation: 'btn-' + size
    const concatenation = /(['"`])([A-Za-z_][A-Za-z0-9_-]*?[-_])\1\s*\+/g;
    for (const match of findMatches(concatenation, value)) {
        if (match[2].length >= 2) {
            prefixes.add(match[2]);
        }
    }

    return [...prefixes];
}

/**
 * All matches of a global regular expression.
 *
 * Uses a fresh regex internally so shared `lastIndex` state can never leak
 * between calls, and advances past zero-length matches so it always terminates.
 */
export function findMatches(pattern: RegExp, text: string): RegExpExecArray[] {
    const results: RegExpExecArray[] = [];
    if (!text) {
        return results;
    }

    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const regex = new RegExp(pattern.source, flags);
    let match = regex.exec(text);
    while (match !== null) {
        results.push(match);
        if (match[0].length === 0) {
            regex.lastIndex += 1;
        }
        match = regex.exec(text);
    }
    return results;
}

/** Collect string literal bodies (`'x'`, `"x"`, `` `x` ``) from arbitrary text. */
export function collectStringLiterals(text: string): Array<{ value: string; index: number }> {
    const results: Array<{ value: string; index: number }> = [];
    if (!text) {
        return results;
    }

    let quote: string | null = null;
    let start = -1;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (quote === null) {
            if (char === "'" || char === '"' || char === '`') {
                quote = char;
                start = i + 1;
                escaped = false;
            }
            continue;
        }

        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === '\\') {
            escaped = true;
            continue;
        }

        if (char === quote) {
            results.push({ value: text.slice(start, i), index: start });
            quote = null;
            start = -1;
        }
    }

    return results;
}

/** Cheap guard so we never read binary/huge files by accident. */
export function looksBinary(text: string): boolean {
    if (!text) {
        return false;
    }
    const sample = text.slice(0, 2000);
    return sample.indexOf('\u0000') !== -1;
}

export function normalizePathForCompare(filePath: string): string {
    return filePath.replace(/\\/g, '/').toLowerCase();
}

/** Stable, cheap string hash used for cache keys. */
export function hashString(value: string): string {
    let hash = 5381;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}
