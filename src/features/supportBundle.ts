import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DOWNLOAD_DIAGNOSTICS_COMMAND } from '../core/commandIds';
import { DEFAULT_CONFIG } from '../core/config';
import { describeError, ErrorCollector, errorMessage } from '../core/errors';
import { logger } from '../core/logger';
import {
    buildSupportBundle,
    ISSUE_URL,
    type RedactionRoot,
    type SettingsSnapshotEntry,
    type SupportBundleInput,
} from '../core/supportBundle';
import type { ExtensionState } from '../state';

export function registerDiagnosticsCommand(
    context: vscode.ExtensionContext,
    getState: () => ExtensionState | undefined,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(DOWNLOAD_DIAGNOSTICS_COMMAND, () => downloadSupportBundle(context, getState())),
    );
}

/**
 * Write a ZIP support bundle to the user's Downloads folder and show the path.
 * Never throws: a failure is reported through a notification and the log.
 */
export async function downloadSupportBundle(
    context: vscode.ExtensionContext,
    state: ExtensionState | undefined,
): Promise<string | undefined> {
    try {
        const bundle = buildSupportBundle(collectSupportBundleInput(context, state));
        const directory = await resolveDownloadsDirectory();
        const target = path.join(directory, bundle.fileName);

        await fs.writeFile(target, bundle.zip);
        logger.info(`Diagnostics bundle written to ${target}`);

        await showDownloadedMessage(target);
        return target;
    } catch (error) {
        logger.error('Could not create the diagnostics bundle', describeError(error));
        const action = await vscode.window.showErrorMessage(
            `Dead CSS Cleaner could not create the diagnostics file: ${errorMessage(error)}`,
            'Show Log',
        );
        if (action === 'Show Log') {
            vscode.commands.executeCommand('unusedCssDetector.showLog');
        }
        return undefined;
    }
}

function collectSupportBundleInput(
    context: vscode.ExtensionContext,
    state: ExtensionState | undefined,
): SupportBundleInput {
    return {
        generatedAt: new Date(),
        extensionVersion: extensionVersion(context),
        environment: collectEnvironment(context),
        settings: collectSettings(),
        stats: collectStats(state),
        errors: ErrorCollector.getAll(),
        log: logger.getHistory(),
        redactionRoots: collectRedactionRoots(),
    };
}

function extensionVersion(context: vscode.ExtensionContext): string {
    const packageJson = context.extension.packageJSON as { version?: string } | undefined;
    return typeof packageJson?.version === 'string' ? packageJson.version : 'unknown';
}

function collectEnvironment(context: vscode.ExtensionContext): Record<string, unknown> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    return {
        extensionVersion: extensionVersion(context),
        vscodeVersion: vscode.version,
        appName: vscode.env.appName,
        appHost: vscode.env.appHost,
        uiKind: vscode.env.uiKind === vscode.UIKind.Desktop ? 'desktop' : 'web',
        remoteName: vscode.env.remoteName ?? 'none',
        language: vscode.env.language,
        platform: process.platform,
        architecture: process.arch,
        osType: os.type(),
        osRelease: os.release(),
        nodeVersion: process.versions.node,
        electronVersion: process.versions.electron ?? 'unknown',
        chromeVersion: process.versions.chrome ?? 'unknown',
        v8Version: process.versions.v8,
        workspaceFolderCount: folders.length,
        workspaceFolderNames: folders.map((folder) => folder.name),
        workspaceRoots: folders.map((folder) => folder.uri.fsPath),
    };
}

function collectSettings(): Record<string, SettingsSnapshotEntry> {
    const config = vscode.workspace.getConfiguration('unusedCssDetector');
    const snapshot: Record<string, SettingsSnapshotEntry> = {};

    Object.keys(DEFAULT_CONFIG).forEach((key) => {
        try {
            const inspected = config.inspect(key);
            let source: SettingsSnapshotEntry['source'] = 'default';
            if (inspected?.workspaceFolderValue !== undefined) {
                source = 'workspaceFolder';
            } else if (inspected?.workspaceValue !== undefined) {
                source = 'workspace';
            } else if (inspected?.globalValue !== undefined) {
                source = 'user';
            } else if (
                inspected?.defaultLanguageValue !== undefined ||
                inspected?.globalLanguageValue !== undefined ||
                inspected?.workspaceLanguageValue !== undefined ||
                inspected?.workspaceFolderLanguageValue !== undefined
            ) {
                source = 'language';
            }

            snapshot[key] = {
                value: config.get(key),
                defaultValue: inspected?.defaultValue,
                source,
            };
        } catch (error) {
            snapshot[key] = { value: undefined, source: 'default' };
            logger.warn(`Could not read setting ${key} for diagnostics`, errorMessage(error));
        }
    });

    return snapshot;
}

function collectStats(state: ExtensionState | undefined): Record<string, unknown> | undefined {
    if (!state) {
        return undefined;
    }

    const cache = state.analyzerInstance.getCacheStats();
    const result = state.lastResult;
    if (!result) {
        return { cache };
    }

    return {
        ...result.stats,
        findings: result.findings.length,
        elementFindings: result.elementFindings?.length ?? 0,
        outsideScope: result.outsideScope?.length ?? 0,
        ignoredRuleCount: result.ignoredRuleCount,
        components: result.components?.length ?? 0,
        cache,
    };
}

function collectRedactionRoots(): RedactionRoot[] {
    const roots: RedactionRoot[] = [{ path: os.homedir(), label: '<home>' }];
    (vscode.workspace.workspaceFolders ?? []).forEach((folder) => {
        roots.push({ path: folder.uri.fsPath, label: '<workspace>' });
    });

    const currentDirectory = process.cwd();
    if (currentDirectory) {
        roots.push({ path: currentDirectory, label: '<cwd>' });
    }

    return roots;
}

async function resolveDownloadsDirectory(): Promise<string> {
    const home = os.homedir();
    const candidates = [path.join(home, 'Downloads'), path.join(home, 'OneDrive', 'Downloads')];

    for (const candidate of candidates) {
        try {
            const stats = await fs.stat(candidate);
            if (stats.isDirectory()) {
                return candidate;
            }
        } catch {
            // Try the next candidate.
        }
    }

    const preferred = candidates[0];
    try {
        await fs.mkdir(preferred, { recursive: true });
        return preferred;
    } catch {
        const fallback = path.join(os.tmpdir(), 'dead-css-cleaner');
        await fs.mkdir(fallback, { recursive: true });
        return fallback;
    }
}

async function showDownloadedMessage(target: string): Promise<void> {
    const action = await vscode.window.showInformationMessage(
        `Download file has been downloaded in this location: ${target}`,
        'Show in Folder',
        'Open GitHub Issue',
        'Copy Path',
    );

    if (action === 'Show in Folder') {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target));
    } else if (action === 'Open GitHub Issue') {
        await vscode.env.openExternal(vscode.Uri.parse(ISSUE_URL));
    } else if (action === 'Copy Path') {
        await vscode.env.clipboard.writeText(target);
        vscode.window.showInformationMessage('Diagnostics file path copied to the clipboard.');
    }
}
