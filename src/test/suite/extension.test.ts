import * as assert from 'node:assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'RajatMalik.dead-css-cleaner';

const EXPECTED_COMMANDS = [
    'unusedCssDetector.analyze',
    'unusedCssDetector.analyzeCurrentFile',
    'unusedCssDetector.removeUnusedInFile',
    'unusedCssDetector.exportReport',
    'unusedCssDetector.showPerformanceStats',
    'unusedCssDetector.clearCache',
    'unusedCssDetector.showErrors',
    'unusedCssDetector.clearErrors',
    'unusedCssDetector.showLog',
    'unusedCssDetector.openSettings',
    'unusedCssDetector.showComponentReport',
    'unusedCssDetector.copyDeadCssList',
    'unusedCssDetector.refreshDeadCssView',
    'unusedCssDetector.revealDeadSelector',
    'unusedCssDetector.removeDeadSelector',
    'unusedCssDetector.ignoreDeadSelector',
];

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

suite('Dead CSS Cleaner - VS Code integration', () => {
    test('extension is present and activates', async () => {
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `extension ${EXTENSION_ID} not found`);
        if (extension) {
            await extension.activate();
            assert.ok(extension.isActive, 'extension did not activate');
        }
    });

    test('all contributed commands are registered', async () => {
        const registered = await vscode.commands.getCommands(true);
        EXPECTED_COMMANDS.forEach((command) => {
            assert.ok(registered.includes(command), `command not registered: ${command}`);
        });
    });

    test('analysis runs on the fixture workspace and reports dead selectors', async function () {
        this.timeout(90000);

        await vscode.commands.executeCommand('unusedCssDetector.analyze');
        await wait(2000);

        const ours = vscode.languages
            .getDiagnostics()
            .filter(([, diagnostics]) => diagnostics.some((diagnostic) => diagnostic.source === 'dead-css-cleaner'));

        assert.ok(ours.length > 0, 'no diagnostics were produced for the fixture workspace');

        const messages = ours.flatMap(([, diagnostics]) =>
            diagnostics
                .filter((diagnostic) => diagnostic.source === 'dead-css-cleaner')
                .map((diagnostic) => diagnostic.message),
        );
        const joined = messages.join('\n');

        // Selectors that are intentionally dead in the fixtures.
        assert.ok(joined.includes('.unused-class'), `expected .unused-class to be reported:\n${joined}`);
        assert.ok(joined.includes('.unused-angular-class'), `expected the Angular fixture result:\n${joined}`);
        assert.ok(joined.includes('.card__legacy-note'), `expected the nested SCSS result:\n${joined}`);

        // Every finding states which scope was validated (component + children).
        assert.ok(joined.includes('Checked:'), `expected a scope explanation in the message:\n${joined}`);

        // Regression guard: used classes (including deeply nested ones) must not be reported.
        assert.ok(!/Dead CSS class: \.nav-link/.test(joined), `used nested class .nav-link was reported:\n${joined}`);
        assert.ok(
            !/Dead CSS class: \.card__text\b/.test(joined),
            `used nested class .card__text was reported:\n${joined}`,
        );
    });

    test('performance statistics and cache commands run without throwing', async function () {
        this.timeout(30000);
        await vscode.commands.executeCommand('unusedCssDetector.showPerformanceStats');
        await vscode.commands.executeCommand('unusedCssDetector.clearCache');
    });

    test('diagnostics carry related usage locations', async function () {
        this.timeout(60000);
        const ours = vscode.languages
            .getDiagnostics()
            .filter(([, diagnostics]) => diagnostics.some((diagnostic) => diagnostic.source === 'dead-css-cleaner'));

        const withRelated = ours.some(([, diagnostics]) =>
            diagnostics.some((diagnostic) => (diagnostic.relatedInformation?.length ?? 0) > 0),
        );
        assert.ok(withRelated, 'expected at least one diagnostic with related information');
    });

    test('the component report lists dead CSS per component', async function () {
        this.timeout(60000);

        await vscode.commands.executeCommand('unusedCssDetector.showComponentReport');
        await wait(500);

        const document = vscode.window.activeTextEditor?.document;
        assert.ok(document, 'the report document should be open');

        const text = document?.getText() ?? '';
        assert.ok(text.includes('# Dead CSS report'), `missing report header:\n${text.slice(0, 400)}`);
        assert.ok(text.includes('## Dead CSS by component'), 'missing per-component section');
        assert.ok(text.includes('.unused-class'), 'the dead class should be listed');
        assert.ok(
            text.includes('full nested chain'),
            'the report should explain that the nested selector chain is shown',
        );
    });

    test('the dead CSS list can be copied to the clipboard', async function () {
        this.timeout(30000);

        await vscode.commands.executeCommand('unusedCssDetector.copyDeadCssList');
        await wait(300);

        const clipboard = await vscode.env.clipboard.readText();
        assert.ok(clipboard.includes('.unused-class'), `clipboard missing the dead list:\n${clipboard}`);
        assert.ok(clipboard.includes('selector:'), 'clipboard list should include the selector chain');
    });
});
