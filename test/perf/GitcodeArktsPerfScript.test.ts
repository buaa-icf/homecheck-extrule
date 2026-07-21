const {
    buildMarkdown,
    buildMultiRuleConfig,
    buildNodeOptions,
    computeThroughput,
    computeThroughputWan,
    countIssues,
    filterIssuesByRule,
    main,
    runRepositoryScan,
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

    it('computes end-to-end throughput in lines per second', () => {
        expect(computeThroughput(2500, 5000)).toBe(500);
        expect(computeThroughput(2500, 0)).toBe(0);
        expect(computeThroughputWan(100000, 2000)).toBe(5);
    });

    it('builds one rule config containing every selected smell rule', () => {
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

        const config = buildMultiRuleConfig(baseConfig, [RULES.longMethod, RULES.featureEnvy]);

        expect(config.extRuleSet[0].extRules).toEqual({
            '@extrulesproject/long-method-check': 2,
            '@extrulesproject/feature-envy-check': 2,
        });
        expect(config.files).toEqual(['**/*.ets']);
        expect(config.ignore).toEqual(['**/node_modules/**/*']);
    });

    it('splits a combined issues report by rule while preserving file grouping', () => {
        const issues = [{
            filePath: 'A.ets',
            messages: [
                { rule: RULES.longMethod.ruleName, message: 'long' },
                { rule: RULES.featureEnvy.ruleName, message: 'envy' },
            ],
        }, {
            filePath: 'B.ets',
            messages: [{ rule: RULES.featureEnvy.ruleName, message: 'envy-2' }],
        }];

        expect(filterIssuesByRule(issues, RULES.longMethod.ruleName)).toEqual([{
            filePath: 'A.ets',
            messages: [{ rule: RULES.longMethod.ruleName, message: 'long' }],
        }]);
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
                sharedRun: {
                    rules: ['long-method'],
                    durationMs: 3000,
                    homecheckWallMs: 2500,
                    peakHeapMB: 128.12,
                    peakRssMB: 256.24,
                },
                runs: [{
                    smell: 'long-method',
                    ruleName: '@extrulesproject/long-method-check',
                    success: true,
                    durationMs: 200,
                    detectorDurationMs: 200,
                    issueObjects: 2,
                    issueMessages: 5,
                    throughputLinesPerSecond: 5000,
                    throughputWanLinesPerSecond: 0.5,
                    peakHeapMB: 128.12,
                    peakRssMB: 256.24,
                    issuesReportPath: '/tmp/report/issues.json',
                    perfReportPath: '/tmp/report/perf.json',
                }],
            }],
        });

        expect(markdown).toContain('# ArkTS 异味检测性能报告');
        expect(markdown).toContain('- 开始时间: 2026-07-08T00:00:00.000Z');
        expect(markdown).toContain('- 结束时间: 2026-07-08T00:01:00.000Z');
        expect(markdown).toContain('- 输出目录: /tmp/report');
        expect(markdown).toContain('## 检测器性能（不含共享预处理）');
        expect(markdown).toContain('| cases | 1000 | long-method | 0.20 | 2 | 5 | 5000.00 | 0.5000 | 否 |');
        expect(markdown).toContain('## 仓库共享资源（Scene + 全部选中规则）');
        expect(markdown).toContain('| cases | long-method | 3.00 | 2.50 | 128.12 | 256.24 |');
        expect(markdown).toContain('## 输入仓库');
        expect(markdown).toContain('| 仓库 | 组别 | URL | 本地路径 | 克隆/更新时间 (s) |');
        expect(markdown).toContain('| cases | benchmark | https://gitcode.com/HarmonyOS-Cases/cases.git | /tmp/repos/cases | 0.10 |');
    });

    it('counts .ets code lines through cloc when a repository already exists', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcode-perf-'));
        const reposRoot = path.join(root, 'repos');
        const outputDir = path.join(root, 'out');
        const datasetDir = path.join(root, 'dataset');

        // 迷你数据集：1 条正例，属于仓库 cases（扫描目标只来自数据集标注）
        fs.mkdirSync(path.join(datasetDir, 'positive', 'local-test'), { recursive: true });
        fs.mkdirSync(path.join(datasetDir, 'negative'), { recursive: true });
        fs.writeFileSync(path.join(datasetDir, 'positive', 'local-test', 'long-method.json'), JSON.stringify([{
            filePath: 'cases/Index.ets',
            messages: [{ line: 2, rule: RULES.longMethod.ruleName, rangeStart: 1, rangeEnd: 4 }],
        }]));

        const casesRoot = path.join(reposRoot, 'dataset', 'cases');
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

        const runnerPath = path.join(root, 'fake-runner.js');
        fs.writeFileSync(runnerPath, [
            "const fs = require('node:fs');",
            "const path = require('node:path');",
            "const args = Object.fromEntries(process.argv.slice(2).map((item) => { const i=item.indexOf('='); return [item.slice(2,i), item.slice(i+1)]; }));",
            "const project = JSON.parse(fs.readFileSync(args.projectConfigPath, 'utf8'));",
            "fs.mkdirSync(project.reportDir, { recursive: true });",
            "fs.writeFileSync(path.join(project.reportDir, 'issuesReport.json'), JSON.stringify([]));",
            "fs.mkdirSync(path.join(process.cwd(), 'report'), { recursive: true });",
            "fs.writeFileSync(path.join(process.cwd(), 'report', 'perfReport.json'), JSON.stringify({ runId: 'shared', totalWallMs: 100, peakHeapUsedMB: 50, peakRssMB: 80, checkers: { LongMethodCheck: { totalMs: 10, stages: {} } } }));",
        ].join('\n'));

        const previousArgv = process.argv;
        process.argv = [
            previousArgv[0],
            previousArgv[1],
            `--reposRoot=${reposRoot}`,
            `--outputDir=${outputDir}`,
            `--runnerPath=${runnerPath}`,
            `--datasetDir=${datasetDir}`,
            '--includeRules=long-method',
            '--dashboard=false',
            '--f1=false',
        ];

        try {
            await expect(main()).resolves.toBe(0);
        } finally {
            process.argv = previousArgv;
        }

        const summary = JSON.parse(
            fs.readFileSync(path.join(outputDir, 'summary.json'), 'utf8'),
        );
        // 即使关闭 F1 评估（--f1=false），数据集仓库仍然会被扫描
        expect(summary.repositories).toHaveLength(1);
        expect(summary.repositories[0].name).toBe('cases');
        expect(summary.repositories[0].group).toBe('dataset');
        expect(summary.repositories[0].etsLines).toBe(4);
        expect(fs.existsSync(path.join(outputDir, 'perfDashboard.html'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'f1Report.json'))).toBe(false);
    });

    it('runs multiple rules in one repository process and writes compatible split artifacts', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcode-shared-scene-'));
        const runnerPath = path.join(root, 'fake-runner.js');
        fs.writeFileSync(runnerPath, [
            "const fs = require('node:fs');",
            "const path = require('node:path');",
            "const args = Object.fromEntries(process.argv.slice(2).map((item) => { const i=item.indexOf('='); return [item.slice(2,i), item.slice(i+1)]; }));",
            "const project = JSON.parse(fs.readFileSync(args.projectConfigPath, 'utf8'));",
            "fs.mkdirSync(project.reportDir, { recursive: true });",
            "fs.writeFileSync(path.join(project.reportDir, 'issuesReport.json'), JSON.stringify([{ filePath: 'A.ets', messages: [{ rule: '@extrulesproject/long-method-check' }, { rule: '@extrulesproject/feature-envy-check' }] }]));",
            "fs.mkdirSync(path.join(process.cwd(), 'report'), { recursive: true });",
            "fs.writeFileSync(path.join(process.cwd(), 'report', 'perfReport.json'), JSON.stringify({ runId: 'shared', totalWallMs: 500, peakHeapUsedMB: 100, peakRssMB: 200, checkers: { LongMethodCheck: { totalMs: 10, stages: {} }, FeatureEnvyCheck: { totalMs: 20, stages: {} } } }));",
            "fs.writeFileSync(process.env.EXTRULES_PERF_TIMELINE_PATH, JSON.stringify({ elapsedMs: 0, heapUsedMB: 90, rssMB: 190 }) + '\\n');",
            "fs.appendFileSync(path.join(__dirname, 'invocations.txt'), '1\\n');",
        ].join('\n'));

        const result = await runRepositoryScan({
            cwd: root,
            repo: { name: 'cases' },
            repoPath: root,
            rules: [RULES.longMethod, RULES.featureEnvy],
            etsLines: 1000,
            baseProjectConfig: {},
            baseRuleConfig: { extRuleSet: [{ ruleSetName: 'extrulesproject', packagePath: __filename }] },
            runnerPath,
            outputDir: path.join(root, 'out'),
            tmpConfigDir: path.join(root, 'tmp'),
            npmCacheDir: path.join(root, 'npm-cache'),
            timeoutMs: 5000,
            nodeMaxOldSpaceMB: 1024,
        });

        expect(fs.readFileSync(path.join(root, 'invocations.txt'), 'utf8').trim()).toBe('1');
        expect(result.sharedRun.success).toBe(true);
        expect(result.runs.map((run: { smell: string }) => run.smell)).toEqual(['long-method', 'feature-envy']);
        expect(result.runs[0]).toEqual(expect.objectContaining({
            detectorDurationMs: 10,
            throughputWanLinesPerSecond: 10,
            memoryScope: 'repository-shared',
        }));
        expect(JSON.parse(fs.readFileSync(result.runs[0].issuesReportPath, 'utf8'))[0].messages).toHaveLength(1);
        expect(fs.existsSync(path.join(root, 'out', 'runs', 'cases', 'memoryTimeline.ndjson'))).toBe(true);
    });

    it('evaluates F1 against a labeled dataset during the perf run', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcode-f1-'));
        const reposRoot = path.join(root, 'repos');
        const outputDir = path.join(root, 'out');
        const datasetDir = path.join(root, 'dataset');

        // 迷你数据集：1 条正例 + 1 条负例，均属于仓库 fakerepo
        fs.mkdirSync(path.join(datasetDir, 'positive', 'local-test'), { recursive: true });
        fs.mkdirSync(path.join(datasetDir, 'negative'), { recursive: true });
        fs.writeFileSync(path.join(datasetDir, 'positive', 'local-test', 'long-method.json'), JSON.stringify([{
            filePath: 'fakerepo/src/A.ets',
            messages: [{ line: 15, rule: RULES.longMethod.ruleName, rangeStart: 10, rangeEnd: 30 }],
        }]));
        fs.writeFileSync(path.join(datasetDir, 'negative', 'negative-long-method.json'), JSON.stringify([{
            filePath: 'fakerepo/src/Neg.ets',
            messages: [{ line: 60, rule: RULES.longMethod.ruleName, rangeStart: 55, rangeEnd: 90 }],
        }]));

        // 预置数据集仓库目录，触发 cloneOrUpdateRepository 的 reused 分支，避免网络克隆
        const fakeRepoRoot = path.join(reposRoot, 'dataset', 'fakerepo');
        fs.mkdirSync(path.join(fakeRepoRoot, 'src'), { recursive: true });
        fs.writeFileSync(path.join(fakeRepoRoot, 'Index.ets'), 'function main() {\n}\n');

        // fake homecheck runner：写出共享 issuesReport（正例文件命中 1 条 = TP、
        // 负例文件命中 1 条 = FP、未标注文件 1 条 = 忽略）与 perfReport
        const runnerPath = path.join(root, 'fake-runner.js');
        fs.writeFileSync(runnerPath, [
            "const fs = require('node:fs');",
            "const path = require('node:path');",
            "const args = Object.fromEntries(process.argv.slice(2).map((item) => { const i=item.indexOf('='); return [item.slice(2,i), item.slice(i+1)]; }));",
            "const project = JSON.parse(fs.readFileSync(args.projectConfigPath, 'utf8'));",
            "fs.mkdirSync(project.reportDir, { recursive: true });",
            "const issues = [",
            "  { filePath: project.projectPath + 'src/A.ets', messages: [{ rule: '@extrulesproject/long-method-check', line: 15 }] },",
            "  { filePath: project.projectPath + 'src/Neg.ets', messages: [{ rule: '@extrulesproject/long-method-check', line: 60 }] },",
            "  { filePath: project.projectPath + 'src/Other.ets', messages: [{ rule: '@extrulesproject/long-method-check', line: 5 }] },",
            "];",
            "fs.writeFileSync(path.join(project.reportDir, 'issuesReport.json'), JSON.stringify(issues));",
            "fs.mkdirSync(path.join(process.cwd(), 'report'), { recursive: true });",
            "fs.writeFileSync(path.join(process.cwd(), 'report', 'perfReport.json'), JSON.stringify({ runId: 'shared', totalWallMs: 100, peakHeapUsedMB: 50, peakRssMB: 80, checkers: { LongMethodCheck: { totalMs: 10, stages: {} } } }));",
        ].join('\n'));

        const previousArgv = process.argv;
        process.argv = [
            previousArgv[0],
            previousArgv[1],
            `--reposRoot=${reposRoot}`,
            `--outputDir=${outputDir}`,
            `--runnerPath=${runnerPath}`,
            `--datasetDir=${datasetDir}`,
            '--includeRules=long-method',
            '--dashboard=false',
        ];

        try {
            await expect(main()).resolves.toBe(0);
        } finally {
            process.argv = previousArgv;
        }

        const f1Report = JSON.parse(
            fs.readFileSync(path.join(outputDir, 'f1Report.json'), 'utf8'),
        );
        expect(f1Report.datasetRepos).toEqual(['fakerepo']);
        const longMethodResult = f1Report.repoResults[0].rules[RULES.longMethod.ruleName];
        expect(longMethodResult).toEqual(expect.objectContaining({ tp: 1, fp: 1, fn: 0 }));
        expect(f1Report.summary.overall).toEqual(expect.objectContaining({
            tp: 1,
            fp: 1,
            fn: 0,
            precision: 0.5,
            recall: 1,
        }));
        expect(fs.readFileSync(path.join(outputDir, 'f1Report.md'), 'utf8')).toContain('## 规则汇总');

        const summary = JSON.parse(
            fs.readFileSync(path.join(outputDir, 'summary.json'), 'utf8'),
        );
        expect(summary.repositories[0].group).toBe('dataset');
    });
});
