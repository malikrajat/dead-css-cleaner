import * as assert from 'node:assert';
import { buildJsonReport, buildMarkdownReport } from '../../features/reportText';
import { analyzeFixture } from './helpers';

function sampleResult() {
    return analyzeFixture({
        css: [{ file: '/tmp/a.css', text: '.used { color: red; }\n.unused { color: blue; }' }],
        markup: [{ file: '/tmp/index.html', text: '<div class="used"></div>' }],
    });
}

suite('reportText', () => {
    test('markdown report lists dead selectors per file', () => {
        const { config } = sampleResult();
        const analysis = {
            findings: [
                {
                    declaration: {
                        name: 'unused',
                        type: 'class' as const,
                        kind: 'css-selector' as const,
                        file: '/tmp/a.css',
                        line: 2,
                        column: 1,
                        length: 7,
                    },
                    rule: {
                        file: '/tmp/a.css',
                        selector: '.unused',
                        resolvedSelector: '.unused',
                        line: 2,
                        column: 1,
                        startOffset: 0,
                        endOffset: 20,
                        declarations: [],
                        ignored: false,
                    },
                    usedTokensInRule: 0,
                    totalTokensInRule: 1,
                    mode: 'token' as const,
                    isPartialSelector: false,
                },
            ],
            rules: [],
            stats: {
                cssFiles: 1,
                jsFiles: 0,
                markupFiles: 1,
                angularFiles: 0,
                cacheHits: 0,
                cacheMisses: 2,
                parseErrors: 0,
                selectors: 2,
                uniqueTokens: 2,
                usages: 1,
                durationMs: 12,
                phases: { discoveryMs: 1, parseMs: 5, compareMs: 1 },
                cancelled: false,
            },
            ignoredRuleCount: 0,
            elementFindings: [],
            outsideScope: [],
            components: [],
        };

        const markdown = buildMarkdownReport(analysis, 'demo');
        assert.ok(markdown.includes('# Dead CSS report - demo'));
        assert.ok(markdown.includes('.unused'));
        assert.ok(markdown.includes('/tmp/a.css'));

        const json = JSON.parse(buildJsonReport(analysis, 'demo'));
        assert.strictEqual(json.workspace, 'demo');
        assert.strictEqual(json.deadSelectors.length, 1);
        assert.strictEqual(json.deadSelectors[0].name, 'unused');
        assert.ok(config);
    });
});
