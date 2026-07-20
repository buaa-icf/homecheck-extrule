const { buildDashboardHtml, startDashboardServer } = require('../../scripts/perfDashboard.js');

describe('performance dashboard', () => {
    const payload = {
        status: 'completed',
        startedAt: '2026-07-16T00:00:00.000Z',
        finishedAt: '2026-07-16T00:00:02.000Z',
        totalRuns: 1,
        current: null,
        repositoryRuns: [{
            id: 'cases',
            kind: 'repository',
            repoName: 'cases',
            success: true,
            timedOut: false,
            durationMs: 3000,
            homecheckWallMs: 2500,
            peakRssMB: 128,
            rules: ['long-method'],
            memorySamples: [],
        }],
        runs: [{
            id: 'cases/long-method',
            kind: 'scan',
            repoName: 'cases',
            smell: 'long-method',
            success: true,
            timedOut: false,
            durationMs: 2000,
            detectorDurationMs: 2000,
            issueMessages: 3,
            throughputWanLinesPerSecond: 5,
            memorySamples: [{
                timestamp: '2026-07-16T00:00:01.000Z',
                elapsedMs: 1000,
                heapUsedMB: 64,
                rssMB: 128,
            }],
        }],
        f1: {
            perRule: [{
                rule: '@extrulesproject/long-method-check',
                smell: 'long-method',
                tp: 4,
                fp: 1,
                fn: 4,
                precision: 0.8,
                recall: 0.5,
                f1: 0.6153846153846154,
            }],
            overall: {
                rule: 'TOTAL',
                smell: 'TOTAL',
                tp: 4,
                fp: 1,
                fn: 4,
                precision: 0.8,
                recall: 0.5,
                f1: 0.6153846153846154,
            },
        },
    };

    it('builds a self-contained static HTML report', () => {
        const html = buildDashboardHtml(payload);
        expect(html).toContain('ArkTS 检测器性能面板');
        expect(html).toContain('仓库共享峰值 RSS');
        expect(html).toContain('不含共享预处理');
        expect(html).toContain('性能基准 ≥ 2 万行/秒');
        expect(html).toContain("id:'throughputTarget'");
        expect(html).not.toContain('throughputValueLabels');
        expect(html).toContain('F1 图表');
        expect(html).toContain("getElementById('f1Chart')");
        expect(html).toContain('shortRepoName');
        expect(html).toContain("type:'logarithmic',min:1,max:1000");
        expect(html).toContain('[1,2,5,10,20,50,100,200,500,1000]');
        expect(html).toContain("2（性能基准）");
        expect(html).toContain("性能基准的 '+(value/throughputTarget).toFixed(2)+' 倍");
        expect(html).toContain("throughput>=throughputTarget?'已达到':'待提升'");
        expect(html).not.toContain('硬性指标');
        expect(html).toContain("state.runs.forEach(function(run){ var row=document.createElement('tr');");
        expect(html).toContain('cases/long-method');
        expect(html).toContain('F1 评估（数据集仓库）');
        expect(html).toContain('id="f1Panel"');
        expect(html).toContain('id="f1Body"');
        expect(html).not.toContain('id="runSelect"');
        expect(html).toContain("memoryChart.data.labels=runs.map(repositoryLabel)");
        expect(html).toContain('chart.umd');
        expect(html).not.toContain('cdn.jsdelivr.net');
    });

    it('serves live state and closes cleanly', async () => {
        const server = await startDashboardServer({ port: 0, getState: () => payload });
        try {
            const pageResponse = await fetch(server.url);
            expect(pageResponse.status).toBe(200);
            expect(await pageResponse.text()).toContain('ArkTS 检测器性能面板');

            const stateResponse = await fetch(`${server.url}api/state`);
            expect(stateResponse.status).toBe(200);
            await expect(stateResponse.json()).resolves.toEqual(payload);
        } finally {
            await server.close();
        }
    });
});
