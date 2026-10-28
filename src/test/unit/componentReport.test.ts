import * as assert from 'node:assert';
import type { AnalysisResult, UnusedFinding } from '../../core/types';
import { buildComponentReportMarkdown, buildDeadCssList, groupByComponent } from '../../features/componentReport';
import { analyzeFixture } from './helpers';

function fixtureResult(): AnalysisResult {
    const analysis = analyzeFixture({
        css: [
            {
                file: '/tmp/src/app/card.component.scss',
                text: ['.card { display: block; }', '.card .card__body .card__legacy-note { color: #999; }'].join('\n'),
            },
        ],
        angular: [
            {
                file: '/tmp/src/app/card.component.ts',
                text: [
                    '@Component({',
                    "  selector: 'app-card',",
                    '  template: `',
                    '    <article class="card"><app-card-body></app-card-body></article>',
                    '  `,',
                    "  styleUrls: ['./card.component.scss']",
                    '})',
                    'export class CardComponent {}',
                ].join('\n'),
            },
            {
                file: '/tmp/src/app/card-body.component.ts',
                text: [
                    "@Component({ selector: 'app-card-body', template: '<div></div>' })",
                    'export class CardBodyComponent {}',
                ].join('\n'),
            },
        ],
    });

    // Build a full AnalysisResult shape from the fixture findings.
    const findings: UnusedFinding[] = analysis.index
        ? [
              {
                  declaration: {
                      name: 'card__legacy-note',
                      type: 'class',
                      kind: 'css-selector',
                      file: '/tmp/src/app/card.component.scss',
                      line: 2,
                      column: 7,
                      length: 18,
                  },
                  rule: {
                      file: '/tmp/src/app/card.component.scss',
                      selector: '.card__legacy-note',
                      resolvedSelector: '.card .card__body .card__legacy-note',
                      line: 2,
                      column: 1,
                      startOffset: 0,
                      endOffset: 10,
                      declarations: [],
                      ignored: false,
                  },
                  usedTokensInRule: 2,
                  totalTokensInRule: 3,
                  mode: 'token',
                  isPartialSelector: true,
                  scope: {
                      kind: 'component-tree',
                      componentFiles: ['/tmp/src/app/card.component.ts'],
                      fileCount: 2,
                      usedOutsideScope: [],
                  },
              },
          ]
        : [];

    return {
        findings,
        rules: [],
        stats: {
            cssFiles: 1,
            jsFiles: 2,
            markupFiles: 0,
            angularFiles: 2,
            cacheHits: 0,
            cacheMisses: 2,
            parseErrors: 0,
            selectors: 3,
            uniqueTokens: 3,
            usages: 3,
            durationMs: 12,
            phases: { discoveryMs: 1, parseMs: 5, compareMs: 1 },
            cancelled: false,
        },
        ignoredRuleCount: 0,
        elementFindings: [],
        outsideScope: [],
        components: analysis.components,
    };
}

suite('componentReport', () => {
    test('groups findings by the owning component', () => {
        const groups = groupByComponent(fixtureResult());
        assert.strictEqual(groups.length, 1);
        assert.strictEqual(groups[0].title, 'Card');
        assert.strictEqual(groups[0].componentFile, '/tmp/src/app/card.component.ts');
        assert.deepStrictEqual(groups[0].styleFiles, ['/tmp/src/app/card.component.scss']);
        assert.strictEqual(groups[0].rows.length, 1);
        assert.strictEqual(groups[0].rows[0].token, '.card__legacy-note');
        assert.strictEqual(groups[0].rows[0].selector, '.card .card__body .card__legacy-note');
        assert.strictEqual(groups[0].rows[0].status, 'partially dead');
    });

    test('markdown report lists the component, the nested chain and the scope', () => {
        const markdown = buildComponentReportMarkdown(fixtureResult(), {
            workspaceName: 'demo',
            analysisMode: 'token',
            scopeMode: 'tree',
        });

        assert.ok(markdown.includes('# Dead CSS report'));
        assert.ok(markdown.includes('Workspace: **demo**'));
        assert.ok(markdown.includes('### Card'));
        assert.ok(
            markdown.includes('| `.card .card__body .card__legacy-note` | `.card__legacy-note` | partially dead |'),
        );
        assert.ok(markdown.includes('Checked: Card + 1 child file(s)'));
        assert.ok(markdown.includes('## Component graph'));
    });

    test('reports "no dead CSS" clearly when everything is used', () => {
        const empty = { ...fixtureResult(), findings: [], outsideScope: [] };
        const markdown = buildComponentReportMarkdown(empty);
        assert.ok(markdown.includes('No dead CSS found'));
    });

    test('flat list is copy friendly', () => {
        const list = buildDeadCssList(fixtureResult());
        assert.strictEqual(
            list,
            '/tmp/src/app/card.component.scss:2  .card__legacy-note  (selector: .card .card__body .card__legacy-note)',
        );
    });

    test('tokens used elsewhere get their own section', () => {
        const base = fixtureResult();
        const elsewhere: UnusedFinding = {
            ...base.findings[0],
            scope: {
                kind: 'component-tree',
                componentFiles: ['/tmp/src/app/card.component.ts'],
                fileCount: 1,
                usedOutsideScope: ['/tmp/src/app/other.component.html'],
            },
        };
        const withElsewhere: AnalysisResult = { ...base, findings: [], outsideScope: [elsewhere] };
        const markdown = buildComponentReportMarkdown(withElsewhere);

        assert.ok(markdown.includes('## Used elsewhere'));
        assert.ok(markdown.includes('/tmp/src/app/other.component.html'));
        assert.ok(markdown.includes('they do not belong to this component'));
    });
});
