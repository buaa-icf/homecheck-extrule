const {
    buildMarkdown,
    buildNodeOptions,
    buildSingleRuleConfig,
    computeThroughput,
    countIssues,
    getRuleDurationMs,
    main,
    RULES,
} = require('../../scripts/gitcodeArktsPerfTest.js');

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('gitcodeArktsPerfTest helpers', () => {
    it('counts top-level issue objects and nested messages', () => {
        const result = countIssues([
            { filePath: 'A.ets', messages: [{}, {}] },
            { filePath: 'B.ets', messages: [{}] },
            { filePath: 'C.ets' },
        ]);

        expect(result.issueObjects).toBe(3);
        expect(result.issueMessages).toBe(3);
    });

    it('computes rule throughput in lines per second', () => {
        expect(computeThroughput(2500, 5000)).toBe(500);
        expect(computeThroughput(2500, 0)).toBe(0);
    });

    it('reads the requested rule execution time from its checker report', () => {
        const perf = {
            checkers: {
                CodeCloneFragmentCheck: { totalMs: 1234.56 },
            },
        };

        expect(getRuleDurationMs(perf, RULES.codeCloneFragment)).toBe(1234.56);
        expect(getRuleDurationMs(perf, RULES.longMethod)).toBeNull();
    });

    it('builds a rule config containing only the requested smell rule', () => {
        const baseConfig = {
            files: ['**/*.ets'],
            ignore: ['**/node_modules/**/*'],
            extRuleSet: [{
                ruleSetName: 'extrulesproject',
                packagePath: '/tmp/extrulesproject-1.0.0.tgz',
                extRules: {
                    '@extrulesproject/long-method-check': 2,
                    '@extrulesproject/feature-envy-check': 2,
                },
            }],
        };

        const config = buildSingleRuleConfig(baseConfig, RULES.longMethod);

        expect(config.extRuleSet[0].extRules).toEqual({
            '@extrulesproject/long-method-check': 2,
        });
        expect(config.files).toEqual(['**/*.ets']);
        expect(config.ignore).toEqual(['**/node_modules/**/*']);
    });

    it('appends max old space size to child NODE_OPTIONS without dropping existing flags', () => {
        expect(buildNodeOptions('--trace-warnings', 8192)).toBe('--trace-warnings --max-old-space-size=8192');
        expect(buildNodeOptions('', 8192)).toBe('--max-old-space-size=8192');
        expect(buildNodeOptions('--max-old-space-size=4096', 8192)).toBe('--max-old-space-size=4096');
    });

    it('exports a Chinese markdown table with requested performance columns', () => {
        const markdown = buildMarkdown({
            startedAt: '2026-07-08T00:00:00.000Z',
            finishedAt: '2026-07-08T00:01:00.000Z',
            outputDir: '/tmp/report',
            repositories: [{
                name: 'cases',
                url: 'https://gitcode.com/HarmonyOS-Cases/cases.git',
                path: '/tmp/repos/cases',
                etsLines: 1000,
                cloneDurationMs: 100,
                runs: [{
                    smell: 'long-method',
                    ruleName: '@extrulesproject/long-method-check',
                    success: true,
                    durationMs: 2000,
                    processDurationMs: 3000,
                    issueObjects: 2,
                    issueMessages: 5,
                    throughputLinesPerSecond: 500,
                    peakHeapMB: 128.12,
                    issuesReportPath: '/tmp/report/issues.json',
                    perfReportPath: '/tmp/report/perf.json',
                }],
            }],
        });

        expect(markdown).toContain('# ArkTS 异味检测性能报告');
        expect(markdown).toContain('- 开始时间: 2026-07-08T00:00:00.000Z');
        expect(markdown).toContain('- 结束时间: 2026-07-08T00:01:00.000Z');
        expect(markdown).toContain('- 输出目录: /tmp/report');
        expect(markdown).toContain('| 仓库 | .ets 代码行数 | 异味类型 | 规则执行耗时 (s) | 告警对象数 | 告警指标数 | 规则吞吐 (行/s) | peakHeapMB |');
        expect(markdown).toContain('| cases | 1000 | long-method | 2.00 | 2 | 5 | 500.00 | 128.12 |');
        expect(markdown).toContain('## 输入仓库');
        expect(markdown).toContain('| 仓库 | URL | 本地路径 | 克隆/更新时间 (s) |');
    });

    it('counts .ets code lines through cloc when a repository already exists', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcode-perf-'));
        const reposRoot = path.join(root, 'repos');
        const outputDir = path.join(root, 'out');
        const casesRoot = path.join(reposRoot, 'cases');
        fs.mkdirSync(casesRoot, { recursive: true });
        fs.writeFileSync(
            path.join(casesRoot, 'Index.ets'),
            [
                'function main() {',
                '  const value = 1',
                '  return value',
                '}',
                '',
            ].join('\n'),
        );

        const previousArgv = process.argv;
        process.argv = [
            previousArgv[0],
            previousArgv[1],
            `--reposRoot=${reposRoot}`,
            `--outputDir=${outputDir}`,
            '--includeRepos=cases',
            '--includeRules=__none__',
        ];

        try {
            expect(main()).toBe(0);
        } finally {
            process.argv = previousArgv;
        }

        const summary = JSON.parse(
            fs.readFileSync(path.join(outputDir, 'summary.json'), 'utf8'),
        );
        expect(summary.repositories[0].etsLines).toBe(4);
    });
});
