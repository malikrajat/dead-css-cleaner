import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('dead-css-cleaner-dev.dead-css-cleaner'));
    });

    test('Extension should activate', async () => {
        const extension = vscode.extensions.getExtension('dead-css-cleaner-dev.dead-css-cleaner');
        if (extension) {
            await extension.activate();
            assert.ok(extension.isActive);
        }
    });

    test('Command should be registered', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('unusedCssDetector.analyze'));
    });
});