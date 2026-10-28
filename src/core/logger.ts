/**
 * Tiny, dependency-free logger.
 *
 * The extension host wires an `OutputChannel` sink at activation time; parsers
 * only ever call `logger.*`, so they never need to import `vscode`.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
    level: LogLevel;
    message: string;
    details?: string;
    timestamp: Date;
}

export type LogSink = (record: LogRecord) => void;

class Logger {
    private sinks: LogSink[] = [];
    private buffer: LogRecord[] = [];
    private debugEnabled = false;
    private static readonly MAX_BUFFER = 200;

    /** Register an additional sink (e.g. the VS Code output channel). */
    addSink(sink: LogSink): void {
        this.sinks.push(sink);
        if (this.buffer.length > 0) {
            const pending = this.buffer;
            this.buffer = [];
            pending.forEach((record) => sink(record));
        }
    }

    clearSinks(): void {
        this.sinks = [];
    }

    setDebugEnabled(enabled: boolean): void {
        this.debugEnabled = enabled;
    }

    isDebugEnabled(): boolean {
        return this.debugEnabled;
    }

    debug(message: string, details?: string): void {
        if (!this.debugEnabled) {
            return;
        }
        this.emit('debug', message, details);
    }

    info(message: string, details?: string): void {
        this.emit('info', message, details);
    }

    warn(message: string, details?: string): void {
        this.emit('warn', message, details);
    }

    error(message: string, details?: string): void {
        this.emit('error', message, details);
    }

    private emit(level: LogLevel, message: string, details?: string): void {
        const record: LogRecord = { level, message, details, timestamp: new Date() };

        // Never let logging itself break a parse.
        try {
            if (this.sinks.length === 0) {
                this.buffer.push(record);
                if (this.buffer.length > Logger.MAX_BUFFER) {
                    this.buffer.shift();
                }
            } else {
                this.sinks.forEach((sink) => {
                    try {
                        sink(record);
                    } catch {
                        /* ignore sink failures */
                    }
                });
            }

            if (level === 'error') {
                console.error(`[dead-css-cleaner] ${message}`, details ?? '');
            } else if (level === 'warn') {
                console.warn(`[dead-css-cleaner] ${message}`, details ?? '');
            } else if (this.debugEnabled) {
                console.log(`[dead-css-cleaner] ${message}`, details ?? '');
            }
        } catch {
            /* logging must never throw */
        }
    }
}

export const logger = new Logger();
