/**
 * Component graph.
 *
 * A stylesheet owned by a component can legitimately be applied to elements that
 * are rendered by that component's **child components** (and, for shared/global
 * styles, anywhere in the tree). Without knowing that relationship, a checker
 * reports "dead" for classes that a child component actually uses.
 *
 * This module builds:
 *   - owner edges:  component file -> stylesheets it declares
 *   - child edges:  component file -> component files it renders
 *
 * and then answers "which files may legitimately use the classes in this
 * stylesheet?" so the comparison step can validate the whole subtree.
 */

import * as path from 'node:path';
import type { ComponentSummary } from '../core/types';

export type ComponentScopeMode = 'off' | 'component' | 'tree';

/** A tag is component-ish when it is capitalised (`Card`) or custom-element shaped (`app-card`). */
export function isComponentTag(tag: string): boolean {
    if (!tag) {
        return false;
    }
    return /^[A-Z]/.test(tag) || tag.includes('-') || tag.includes(':');
}

export interface ComponentGraphInput {
    file: string;
    /** Stylesheets declared by this component (styleUrls, CSS imports, SFC styles). */
    styleFiles: string[];
    /** Template files rendered by this component (e.g. an Angular templateUrl). */
    templateFiles: string[];
    /** Angular component selectors, used to match `<app-card>` in templates. */
    selectors: string[];
    /** Tags rendered by this component's template/JSX. */
    renderedTags: string[];
    /** Module specifiers imported by this component. */
    imports: string[];
}

export interface ScopeInfo {
    kind: 'global' | 'component-tree';
    /** Owner component file(s). */
    componentFiles: string[];
    /** Every file inside the searched scope. */
    files: Set<string>;
}

export interface ComponentGraphOptions {
    mode: ComponentScopeMode;
    /** Resolve a relative import specifier to a known file, if possible. */
    resolveImport?: (fromFile: string, specifier: string) => string | undefined;
}

const UNKNOWN_COMPONENT_NAME = 'unknown';

export class ComponentGraph {
    private readonly childrenByFile = new Map<string, Set<string>>();
    private readonly ownersByStyle = new Map<string, Set<string>>();
    private readonly templateFilesByFile = new Map<string, Set<string>>();
    private readonly componentFiles = new Set<string>();
    private readonly reportedComponents = new Set<string>();
    private readonly displayNames = new Map<string, string>();
    private readonly componentCount: number;
    private readonly scopeCache = new Map<string, ScopeInfo | undefined>();

    private constructor(
        private readonly inputs: ComponentGraphInput[],
        private readonly options: ComponentGraphOptions,
    ) {
        this.componentCount = inputs.length;
        inputs.forEach((input) => {
            this.componentFiles.add(input.file);
            this.displayNames.set(input.file, componentNameOf(input.file));
        });
        this.buildEdges();
    }

    static build(inputs: ComponentGraphInput[], options: ComponentGraphOptions): ComponentGraph {
        return new ComponentGraph(
            inputs.filter((input) => input.file),
            options,
        );
    }

    /** Stylesheets owned by at least one component (styleUrls / CSS imports / SFC). */
    ownersOf(styleFile: string): string[] {
        return [...(this.ownersByStyle.get(normalize(styleFile)) ?? [])];
    }

    childrenOf(file: string): string[] {
        return [...(this.childrenByFile.get(normalize(file)) ?? [])];
    }

    descendantsOf(file: string): string[] {
        const visited = new Set<string>();
        const result: string[] = [];
        const queue = [...this.childrenOf(file)];

        while (queue.length > 0) {
            const current = queue.shift() as string;
            const key = normalize(current);
            if (visited.has(key)) {
                continue;
            }
            visited.add(key);
            result.push(current);
            queue.push(...this.childrenOf(current));
        }

        return result;
    }

    /**
     * Files that may legitimately apply classes declared in `styleFile`.
     * Returns `undefined` when the stylesheet has no owning component, in which
     * case the caller should treat it as global (whole-workspace matching).
     */
    scopeFor(styleFile: string): ScopeInfo | undefined {
        const cacheKey = `${this.options.mode}:${normalize(styleFile)}`;
        if (this.scopeCache.has(cacheKey)) {
            return this.scopeCache.get(cacheKey);
        }

        const scope = this.computeScope(styleFile);
        this.scopeCache.set(cacheKey, scope);
        return scope;
    }

    summary(): ComponentSummary[] {
        return this.inputs
            .filter((input) => this.reportedComponents.has(normalize(input.file)))
            .map((input) => ({
                file: input.file,
                name: this.displayNames.get(input.file) ?? componentNameOf(input.file),
                styleFiles: input.styleFiles,
                children: this.childrenOf(input.file),
                descendantCount: this.descendantsOf(input.file).length,
            }))
            .sort((a, b) => a.file.localeCompare(b.file));
    }

    get size(): number {
        return this.componentCount;
    }

    private computeScope(styleFile: string): ScopeInfo | undefined {
        if (this.options.mode === 'off') {
            return undefined;
        }

        const owners = this.ownersOf(styleFile);
        if (owners.length === 0) {
            return undefined;
        }

        const files = new Set<string>();
        owners.forEach((owner) => {
            files.add(owner);
            this.templateFilesOf(owner).forEach((template) => files.add(template));
            if (this.options.mode === 'tree') {
                this.descendantsOf(owner).forEach((descendant) => {
                    files.add(descendant);
                    this.templateFilesOf(descendant).forEach((template) => files.add(template));
                });
            } else {
                this.childrenOf(owner).forEach((child) => {
                    files.add(child);
                    this.templateFilesOf(child).forEach((template) => files.add(template));
                });
            }
        });

        // The stylesheet file itself can be a component (Vue/Svelte/Astro SFC).
        files.add(styleFile);

        return { kind: 'component-tree', componentFiles: owners, files };
    }

    private templateFilesOf(file: string): string[] {
        return [...(this.templateFilesByFile.get(normalize(file)) ?? [])];
    }

    private buildEdges(): void {
        const selectorIndex = new Map<string, string>();
        const nameIndex = new Map<string, string>();

        this.inputs.forEach((input) => {
            if (isRealComponent(input)) {
                this.reportedComponents.add(normalize(input.file));
            }
            input.selectors.forEach((selector) => {
                splitSelectors(selector).forEach((single) => {
                    if (single) {
                        selectorIndex.set(single.toLowerCase(), input.file);
                    }
                });
            });
            nameIndex.set(normalizeName(componentNameOf(input.file)), input.file);
        });

        this.inputs.forEach((input) => {
            input.styleFiles.forEach((styleFile) => {
                const key = normalize(styleFile);
                const owners = this.ownersByStyle.get(key) ?? new Set<string>();
                owners.add(input.file);
                this.ownersByStyle.set(key, owners);
            });

            if (input.templateFiles.length > 0) {
                const templates = this.templateFilesByFile.get(normalize(input.file)) ?? new Set<string>();
                input.templateFiles.forEach((template) => templates.add(template));
                this.templateFilesByFile.set(normalize(input.file), templates);
            }

            const children = this.childrenByFile.get(normalize(input.file)) ?? new Set<string>();

            input.renderedTags.forEach((tag) => {
                const resolved =
                    selectorIndex.get(tag.toLowerCase()) ??
                    nameIndex.get(normalizeName(tag)) ??
                    this.resolveImported(input, tag);
                if (resolved && normalize(resolved) !== normalize(input.file)) {
                    children.add(resolved);
                }
            });

            input.imports.forEach((specifier) => {
                const resolved = this.resolveImport(specifier, input.file);
                if (resolved && normalize(resolved) !== normalize(input.file) && this.componentFiles.has(resolved)) {
                    children.add(resolved);
                }
            });

            this.childrenByFile.set(normalize(input.file), children);
        });
    }

    /**
     * Match a rendered tag against the imported local name it belongs to, for
     * example `import Card from './Card'` + `<Card />`.
     */
    private resolveImported(input: ComponentGraphInput, tag: string): string | undefined {
        const importSpecifiers = input.imports.filter((specifier) => specifier.startsWith('.'));
        if (importSpecifiers.length === 0) {
            return undefined;
        }

        const wanted = normalizeName(tag);
        for (const specifier of importSpecifiers) {
            const base = specifier.replace(/^.*\//, '').replace(/\.[a-z]+$/, '');
            if (normalizeName(base) === wanted) {
                return this.resolveImport(specifier, input.file);
            }
        }
        return undefined;
    }

    private resolveImport(specifier: string, fromFile: string): string | undefined {
        if (!this.options.resolveImport) {
            return undefined;
        }
        try {
            return this.options.resolveImport(fromFile, specifier);
        } catch {
            return undefined;
        }
    }
}

/** `src/app/card.component.ts` -> `Card`. */
export function componentNameOf(file: string): string {
    const base = path.basename(file).replace(/\.[^.]+$/, '');
    const stripped = base.replace(/\.(component|container|view|page|screen)$/i, '');
    const camel = stripped
        .split(/[-_.]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
    return camel || base || UNKNOWN_COMPONENT_NAME;
}

/** `CardHeader` / `card-header` / `card_header` -> `cardheader`. */
export function normalizeName(value: string): string {
    return value
        .replace(/\.[^.]+$/, '')
        .replace(/[-_\s]/g, '')
        .toLowerCase();
}

function splitSelectors(selector: string): string[] {
    return selector
        .split(',')
        .map(
            (part) =>
                part
                    .trim()
                    .split(/[\s>+~[]/)[0]
                    ?.trim() ?? '',
        )
        .filter(Boolean);
}

function normalize(file: string): string {
    return file.replace(/\\/g, '/').toLowerCase();
}

/**
 * A file is worth listing as a component when it declares styles, exposes an
 * Angular selector, or renders something component-shaped. Other files still
 * take part in resolution (a leaf component with no stylesheet must stay
 * resolvable by name), they just do not show up in the summary.
 */
function isRealComponent(input: ComponentGraphInput): boolean {
    return input.selectors.length > 0 || input.styleFiles.length > 0 || input.renderedTags.some(isComponentTag);
}
