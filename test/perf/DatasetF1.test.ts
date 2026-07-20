const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    buildDatasetRepos,
    buildF1Markdown,
    compareRepo,
    computeMetrics,
    extractDetectionLocations,
    loadGroundTruth,
    locationMatches,
    parseCsvRows,
    splitRepoRelFile,
    summarizeF1,
    toRepoRelative,
} = require('../../scripts/datasetF1.js');

const LONG_METHOD = '@extrulesproject/long-method-check';
const FEATURE_ENVY = '@extrulesproject/feature-envy-check';
const CODE_CLONE = '@extrulesproject/code-clone-fragment-check';
const RULE_NAMES = [CODE_CLONE, FEATURE_ENVY, LONG_METHOD, '@extrulesproject/switch-statement-check'];

describe('datasetF1 helpers', () => {
    it('parses CSV rows with quoted fields and CRLF', () => {
        const rows = parseCsvRows('a,b,c\r\n1,"x, y","say ""hi"""\r\n3,4,\n');
        expect(rows).toEqual([
            ['a', 'b', 'c'],
            ['1', 'x, y', 'say "hi"'],
            ['3', '4', ''],
        ]);
    });

    it('splits repo name and repo-relative file', () => {
        expect(splitRepoRelFile('repoA/src/A.ets')).toEqual({ repo: 'repoA', relFile: 'src/A.ets' });
        expect(splitRepoRelFile('repoA\\src\\A.ets')).toEqual({ repo: 'repoA', relFile: 'src/A.ets' });
        expect(splitRepoRelFile('A.ets')).toBeNull();
        expect(splitRepoRelFile('repoA/')).toBeNull();
    });

    it('converts absolute paths to repo-relative', () => {
        expect(toRepoRelative('/repos/repoA/src/A.ets', '/repos/repoA')).toBe('src/A.ets');
        expect(toRepoRelative('C:\\repos\\repoA\\src\\A.ets', 'C:\\repos\\repoA')).toBe('src/A.ets');
        expect(toRepoRelative('src/A.ets', '/repos/repoA')).toBe('src/A.ets');
    });

    it('loads ground truth, filters non-linter rules and collects labeled files', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dataset-f1-gt-'));
        fs.mkdirSync(path.join(root, 'positive'), { recursive: true });
        fs.mkdirSync(path.join(root, 'negative'), { recursive: true });
        fs.writeFileSync(path.join(root, 'positive', 'merged_coverage_all.csv'), [
            'record_index,message_index,fragment_role,rule,source_file,commit_id,range_start,range_end,note',
            `1,1,original,${LONG_METHOD},repoA/src/A.ets,abc123,10,30,"note, with comma"`,
            '2,1,original,Data Clumps,repoA/src/B.ets,abc123,5,8,',
            `3,1,original,${FEATURE_ENVY},repoB/src/C.ets,,40,50,`,
            '',
        ].join('\n'));
        fs.writeFileSync(path.join(root, 'negative', 'negative-long-method.json'), JSON.stringify([{
            filePath: 'repoA/src/Neg.ets',
            messages: [{ line: 60, rule: LONG_METHOD, rangeStart: 55, rangeEnd: 90 }],
        }]));

        const groundTruth = loadGroundTruth(root, RULE_NAMES);

        expect(groundTruth.positives).toHaveLength(2);
        expect(groundTruth.positives[0]).toEqual(expect.objectContaining({
            kind: 'positive',
            rule: LONG_METHOD,
            repo: 'repoA',
            relFile: 'src/A.ets',
            rangeStart: 10,
            rangeEnd: 30,
            commitId: 'abc123',
        }));
        expect(groundTruth.negatives).toHaveLength(1);
        expect(groundTruth.negatives[0]).toEqual(expect.objectContaining({
            kind: 'negative',
            repo: 'repoA',
            relFile: 'src/Neg.ets',
        }));
        expect(groundTruth.repoNames).toEqual(['repoA', 'repoB']);
        expect([...groundTruth.labeledFilesByRepo.get('repoA')].sort()).toEqual(['src/A.ets', 'src/Neg.ets']);
        expect(buildDatasetRepos(groundTruth.repoNames)).toEqual([
            { name: 'repoA', url: 'https://github.com/buaa-icf/repoA.git' },
            { name: 'repoB', url: 'https://github.com/buaa-icf/repoB.git' },
        ]);
    });

    it('extracts the primary location plus both fragments of a clone message', () => {
        const issue = { filePath: '/repos/repoA/src/Clone.ets' };
        const message = {
            rule: CODE_CLONE,
            line: 21,
            message: 'Code Clone Type-2 (different classes): Clone.ets:21-39 is similar to ' +
                '/repos/repoA/src/other/Other.ets:5-25. (100 tokens, 19 lines)',
        };

        const locations = extractDetectionLocations(issue, message, '/repos/repoA');

        expect(locations).toEqual([
            { relFile: 'src/Clone.ets', line: 21, rangeStart: 21, rangeEnd: 21 },
            { relFile: 'src/Clone.ets', line: 21, rangeStart: 21, rangeEnd: 39 },
            { relFile: 'src/other/Other.ets', line: 5, rangeStart: 5, rangeEnd: 25 },
        ]);
    });

    it('matches a detection line inside the target range or overlapping ranges', () => {
        const target = { relFile: 'src/A.ets', rangeStart: 10, rangeEnd: 30 };
        expect(locationMatches({ relFile: 'src/A.ets', line: 15, rangeStart: 15, rangeEnd: 15 }, target)).toBe(true);
        expect(locationMatches({ relFile: 'src/A.ets', line: 5, rangeStart: 25, rangeEnd: 40 }, target)).toBe(true);
        expect(locationMatches({ relFile: 'src/A.ets', line: 5, rangeStart: 5, rangeEnd: 9 }, target)).toBe(false);
        expect(locationMatches({ relFile: 'src/B.ets', line: 15, rangeStart: 15, rangeEnd: 15 }, target)).toBe(false);
    });

    it('counts TP with dedup, FP within labeled files only and FN', () => {
        const repoPath = '/repos/repoA';
        const targets = [
            { kind: 'positive', rule: LONG_METHOD, repo: 'repoA', relFile: 'src/A.ets', rangeStart: 10, rangeEnd: 30 },
            { kind: 'positive', rule: LONG_METHOD, repo: 'repoA', relFile: 'src/A.ets', rangeStart: 100, rangeEnd: 120 },
            { kind: 'negative', rule: LONG_METHOD, repo: 'repoA', relFile: 'src/Neg.ets', rangeStart: 55, rangeEnd: 90 },
        ];
        const issues = [
            // 两条命中同一正例 → TP 去重为 1
            { filePath: '/repos/repoA/src/A.ets', messages: [{ rule: LONG_METHOD, line: 15 }, { rule: LONG_METHOD, line: 20 }] },
            // 未命中任何正例 → FP；另一规则 → 不参与
            { filePath: '/repos/repoA/src/A.ets', messages: [{ rule: LONG_METHOD, line: 95 }, { rule: FEATURE_ENVY, line: 15 }] },
            // 负例文件中的检测 → FP
            { filePath: '/repos/repoA/src/Neg.ets', messages: [{ rule: LONG_METHOD, line: 60 }] },
            // 未标注文件 → 忽略
            { filePath: '/repos/repoA/src/Other.ets', messages: [{ rule: LONG_METHOD, line: 5 }] },
        ];

        const rules = compareRepo({
            issues,
            repoName: 'repoA',
            repoPath,
            targets,
            labeledFiles: new Set(['src/A.ets', 'src/Neg.ets']),
            ruleNames: [LONG_METHOD],
        });

        expect(rules[LONG_METHOD].tp).toBe(1);
        expect(rules[LONG_METHOD].fp).toBe(2);
        expect(rules[LONG_METHOD].fn).toBe(1);
        expect(rules[LONG_METHOD].tpList).toHaveLength(1);
        expect(rules[LONG_METHOD].fnList).toEqual([{ file: 'src/A.ets', rangeStart: 100, rangeEnd: 120 }]);
    });

    it('matches a clone ground-truth row via the similar-side fragment', () => {
        const repoPath = '/repos/repoA';
        const targets = [
            { kind: 'positive', rule: CODE_CLONE, repo: 'repoA', relFile: 'src/other/Other.ets', rangeStart: 1, rangeEnd: 10 },
        ];
        const issues = [{
            filePath: '/repos/repoA/src/Clone.ets',
            messages: [{
                rule: CODE_CLONE,
                line: 21,
                message: 'Code Clone Type-2: Clone.ets:21-39 is similar to /repos/repoA/src/other/Other.ets:5-25. (100 tokens)',
            }],
        }];

        const rules = compareRepo({
            issues,
            repoName: 'repoA',
            repoPath,
            targets,
            labeledFiles: new Set(['src/Clone.ets', 'src/other/Other.ets']),
            ruleNames: [CODE_CLONE],
        });

        expect(rules[CODE_CLONE].tp).toBe(1);
        expect(rules[CODE_CLONE].fp).toBe(0);
        expect(rules[CODE_CLONE].fn).toBe(0);
    });

    it('computes precision/recall/F1 and handles zero denominators', () => {
        expect(computeMetrics({ tp: 3, fp: 1, fn: 1 })).toEqual({
            precision: 0.75,
            recall: 0.75,
            f1: 0.75,
        });
        expect(computeMetrics({ tp: 0, fp: 0, fn: 0 })).toEqual({
            precision: null,
            recall: null,
            f1: null,
        });
        expect(computeMetrics({ tp: 0, fp: 2, fn: 0 }).f1).toBeNull();
    });

    it('aggregates per-rule and overall metrics across repositories', () => {
        const rules = [
            { ruleName: LONG_METHOD, smell: 'long-method' },
            { ruleName: FEATURE_ENVY, smell: 'feature-envy' },
        ];
        const repoResults = [
            { repoName: 'repoA', rules: {
                [LONG_METHOD]: { tp: 3, fp: 1, fn: 1, tpList: [], fpList: [], fnList: [] },
                [FEATURE_ENVY]: { tp: 1, fp: 1, fn: 0, tpList: [], fpList: [], fnList: [] },
            } },
            { repoName: 'repoB', rules: {
                [LONG_METHOD]: { tp: 1, fp: 0, fn: 3, tpList: [], fpList: [], fnList: [] },
            } },
        ];

        const summary = summarizeF1(repoResults, rules);

        expect(summary.perRule[0]).toEqual(expect.objectContaining({
            smell: 'long-method', tp: 4, fp: 1, fn: 4, precision: 0.8, recall: 0.5,
        }));
        expect(summary.overall).toEqual(expect.objectContaining({ tp: 5, fp: 2, fn: 4 }));

        const markdown = buildF1Markdown({
            generatedAt: '2026-07-20T00:00:00.000Z',
            datasetDir: '/data',
            datasetRepos: ['repoA', 'repoB'],
            rules,
            summary,
            repoResults,
        });
        expect(markdown).toContain('## 规则汇总');
        expect(markdown).toContain('| long-method | 4 | 1 | 4 | 80.00% | 50.00% | 61.54% |');
        expect(markdown).toContain('## 漏报清单（FN）');
        expect(markdown).toContain('## 误报清单（FP）');
    });
});
