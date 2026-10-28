import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { errorMessage } from '../core/errors';
import { logger } from '../core/logger';
import type { AnalysisResult } from '../core/types';
import { buildJsonReport, buildMarkdownReport } from './reportText';

export async function exportReport(result: AnalysisResult, format: 'json' | 'markdown'): Promise<void> {
    try {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            vscode.window.showWarningMessage('Open a folder before exporting a report.');
            return;
        }

        const root = folders[0].uri.fsPath;
        const workspaceName = path.basename(root);
        const fileName = format === 'json' ? '.dead-css-report.json' : '.dead-css-report.md';
        const target = path.join(root, fileName);
        const content =
            format === 'json' ? buildJsonReport(result, workspaceName) : buildMarkdownReport(result, workspaceName);

        await fs.promises.writeFile(target, content, 'utf8');
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
        await vscode.window.showTextDocument(document, { preview: true });
        vscode.window.showInformationMessage(`Dead CSS report written to ${fileName}`);
    } catch (error) {
        logger.error('Failed to export report', errorMessage(error));
        vscode.window.showErrorMessage(`Could not export the report: ${errorMessage(error)}`);
    }
}
