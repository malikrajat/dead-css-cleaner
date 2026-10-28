import * as fs from 'node:fs';

interface CacheEntry<T> {
    mtimeMs: number;
    size: number;
    value: T;
    storedAt: number;
}

export interface CacheStats {
    entries: number;
    hits: number;
    misses: number;
    invalidations: number;
    filesSkippedByCache: number;
}

/**
 * Small mtime-based cache for parsed file results.
 * Prevents re-parsing the whole workspace on every keystroke-triggered analysis.
 */
export class AnalysisCache<T> {
    private entries = new Map<string, CacheEntry<T>>();
    private hits = 0;
    private misses = 0;
    private invalidations = 0;
    private skipped = 0;

    constructor(
        private ttlMs: number,
        private enabled = true,
    ) {}

    configure(ttlMs: number, enabled: boolean): void {
        this.ttlMs = ttlMs;
        this.enabled = enabled;
        if (!enabled) {
            this.clear();
        }
    }

    /** Returns a cached value when the file content is unchanged. */
    get(file: string): T | undefined {
        if (!this.enabled) {
            return undefined;
        }
        try {
            const entry = this.entries.get(file);
            if (!entry) {
                this.misses++;
                return undefined;
            }
            if (this.ttlMs > 0 && Date.now() - entry.storedAt > this.ttlMs) {
                this.entries.delete(file);
                this.invalidations++;
                this.misses++;
                return undefined;
            }
            const stats = fs.statSync(file);
            if (stats.mtimeMs !== entry.mtimeMs || stats.size !== entry.size) {
                this.entries.delete(file);
                this.invalidations++;
                this.misses++;
                return undefined;
            }
            this.hits++;
            this.skipped++;
            return entry.value;
        } catch {
            // File disappeared or is unreadable: behave like a miss.
            this.entries.delete(file);
            this.misses++;
            return undefined;
        }
    }

    set(file: string, value: T): void {
        if (!this.enabled) {
            return;
        }
        try {
            const stats = fs.statSync(file);
            this.entries.set(file, {
                mtimeMs: stats.mtimeMs,
                size: stats.size,
                value,
                storedAt: Date.now(),
            });
        } catch {
            /* ignore */
        }
    }

    invalidate(file: string): void {
        if (this.entries.delete(file)) {
            this.invalidations++;
        }
    }

    clear(): void {
        this.entries.clear();
        this.hits = 0;
        this.misses = 0;
        this.invalidations = 0;
        this.skipped = 0;
    }

    getStats(): CacheStats {
        return {
            entries: this.entries.size,
            hits: this.hits,
            misses: this.misses,
            invalidations: this.invalidations,
            filesSkippedByCache: this.skipped,
        };
    }
}
