/**
 * Pure error bookkeeping + non-throwing execution helpers.
 * The VS Code-facing reporting lives in `src/core/errorReporter.ts`.
 */

export type ErrorCategory =
    | 'css-parse'
    | 'react-parse'
    | 'angular-parse'
    | 'markup-parse'
    | 'file-access'
    | 'configuration'
    | 'general';

export interface AnalysisError {
    type: ErrorCategory;
    file?: string;
    message: string;
    details?: string;
    recoverable: boolean;
    timestamp: Date;
}

const MAX_ERRORS = 200;

let errors: AnalysisError[] = [];
let subscribers: Array<(error: AnalysisError) => void> = [];

/**
 * Session-scoped error log.
 *
 * Exposed as a namespaced object rather than a class so parsers can report
 * problems without importing a VS Code dependency or threading state around.
 */
export const ErrorCollector = {
    subscribe(handler: (error: AnalysisError) => void): void {
        subscribers.push(handler);
    },

    unsubscribeAll(): void {
        subscribers = [];
    },

    log(error: Omit<AnalysisError, 'timestamp'> & { timestamp?: Date }): void {
        const record: AnalysisError = {
            ...error,
            timestamp: error.timestamp ?? new Date(),
        };

        errors.unshift(record);
        if (errors.length > MAX_ERRORS) {
            errors = errors.slice(0, MAX_ERRORS);
        }

        subscribers.forEach((handler) => {
            try {
                handler(record);
            } catch {
                /* subscriber failures are ignored */
            }
        });
    },

    from(
        type: ErrorCategory,
        message: string,
        error: unknown,
        options: { file?: string; recoverable?: boolean } = {},
    ): AnalysisError {
        const record: AnalysisError = {
            type,
            message,
            details: describeError(error),
            file: options.file,
            recoverable: options.recoverable ?? true,
            timestamp: new Date(),
        };
        ErrorCollector.log(record);
        return record;
    },

    getAll(): AnalysisError[] {
        return [...errors];
    },

    getSummary(): { total: number; byType: Record<string, number>; fatal: number } {
        const byType: Record<string, number> = {};
        let fatal = 0;
        errors.forEach((error) => {
            byType[error.type] = (byType[error.type] || 0) + 1;
            if (!error.recoverable) {
                fatal++;
            }
        });
        return { total: errors.length, byType, fatal };
    },

    clear(): void {
        errors = [];
    },
};

export function describeError(error: unknown): string {
    if (error instanceof Error) {
        return error.stack ? `${error.message}\n${error.stack}` : error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

export function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return typeof error === 'string' ? error : String(error);
}

/** Run a synchronous function, returning `fallback` instead of throwing. */
export function safeSync<T>(
    fn: () => T,
    fallback: T,
    context?: { type: ErrorCategory; message: string; file?: string; recoverable?: boolean },
): T {
    try {
        return fn();
    } catch (error) {
        if (context) {
            ErrorCollector.from(context.type, context.message, error, {
                file: context.file,
                recoverable: context.recoverable ?? true,
            });
        }
        return fallback;
    }
}

/** Run an async function, returning `fallback` instead of rejecting. */
export async function safeAsync<T>(
    fn: () => Promise<T>,
    fallback: T,
    context?: { type: ErrorCategory; message: string; file?: string; recoverable?: boolean },
): Promise<T> {
    try {
        return await fn();
    } catch (error) {
        if (context) {
            ErrorCollector.from(context.type, context.message, error, {
                file: context.file,
                recoverable: context.recoverable ?? true,
            });
        }
        return fallback;
    }
}
