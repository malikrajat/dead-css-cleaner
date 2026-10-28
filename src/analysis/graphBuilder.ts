/**
 * Turns parsed file results into component-graph inputs.
 *
 * Kept pure (no VS Code imports) so both the analyzer and the unit tests build
 * the graph the same way.
 */

import * as path from 'node:path';
import { type ComponentGraphInput, isComponentTag } from './componentGraph';

export { isComponentTag };

export interface ComponentFileBundle {
    file: string;
    /** Stylesheets this file declares, already resolved to absolute paths. */
    styleFiles: string[];
    /** Template files this component renders (Angular `templateUrl`, partials). */
    templateFiles: string[];
    /** Angular components found in this file. */
    angularComponents: Array<{ selector?: string; styleFiles: string[] }>;
    /** Tags this file's template or JSX renders. */
    renderedTags: string[];
    /** Module specifiers imported by this file. */
    imports: string[];
    /** True for single-file components (.vue/.svelte/.astro) that style themselves. */
    ownsInlineStyles: boolean;
}

export function toGraphInputs(bundles: ComponentFileBundle[]): ComponentGraphInput[] {
    // Every bundle stays in the graph so a child component can always be
    // resolved by name, selector or import. `ComponentGraph.summary()` filters
    // down to the files that are worth reporting.
    return bundles.map((bundle) => ({
        file: bundle.file,
        styleFiles: dedupe([
            ...bundle.styleFiles,
            ...(bundle.ownsInlineStyles ? [bundle.file] : []),
            ...bundle.angularComponents.flatMap((component) => component.styleFiles),
        ]),
        templateFiles: dedupe(bundle.templateFiles),
        selectors: dedupe(
            bundle.angularComponents
                .map((component) => component.selector)
                .filter((selector): selector is string => typeof selector === 'string' && selector.length > 0),
        ),
        renderedTags: dedupe(bundle.renderedTags),
        imports: dedupe(bundle.imports),
    }));
}

const RESOLVE_EXTENSIONS = [
    '',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.mts',
    '.cts',
    '.vue',
    '.svelte',
    '.astro',
];

/**
 * Resolve a relative module specifier against the set of known workspace files.
 * `knownFiles` maps a normalised absolute path to the real path.
 */
export function resolveRelativeImport(
    fromFile: string,
    specifier: string,
    knownFiles: Map<string, string>,
): string | undefined {
    if (!specifier.startsWith('.')) {
        return undefined;
    }

    const base = path.resolve(path.dirname(fromFile), specifier);
    const candidates: string[] = [];

    RESOLVE_EXTENSIONS.forEach((extension) => {
        candidates.push(`${base}${extension}`);
        if (extension) {
            candidates.push(path.join(base, `index${extension}`));
        }
    });

    for (const candidate of candidates) {
        const found = knownFiles.get(normalizeKey(candidate));
        if (found) {
            return found;
        }
    }

    // The specifier may already be dropped to a directory or extensionless file.
    return knownFiles.get(normalizeKey(base));
}

export function toKnownFiles(files: Iterable<string>): Map<string, string> {
    const map = new Map<string, string>();
    for (const file of files) {
        map.set(normalizeKey(file), file);
    }
    return map;
}

export function normalizeKey(file: string): string {
    return file.replace(/\\/g, '/').toLowerCase();
}

function dedupe(values: string[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    values.forEach((value) => {
        if (!value) {
            return;
        }
        const key = value.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            output.push(value);
        }
    });
    return output;
}
