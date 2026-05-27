// test/perf/PerfReporterIntegration.test.ts
import * as path from 'path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { Scene, SceneConfig } from 'arkanalyzer';
import { Rule } from 'homecheck';
import { ALERT_LEVEL } from 'homecheck/lib/model/Rule';
import { LongMethodCheck } from '../../src/Checkers/LongMethodCheck';
import { PerfReporter } from '../../src/Checkers/perf/PerfReporter';
import { PerfReportShape } from '../../src/Checkers/perf/types';

const PROJECT_DIR = path.resolve(__dirname, '..', 'sample/LongMethod');

describe('perf integration (LongMethodCheck)', () => {
    const previousEnabled = PerfReporter.enabled;

    beforeEach(() => {
        PerfReporter.enabled = true;
        PerfReporter.reset();
    });

    afterEach(() => {
        PerfReporter.reset();
        PerfReporter.enabled = previousEnabled;
    });

    it('开启时输出可解析的 perfReport.json，包含 LongMethodCheck.check', () => {
        const sceneConfig = new SceneConfig();
        sceneConfig.buildFromProjectDir(PROJECT_DIR);
        const scene = new Scene();
        scene.buildSceneFromProjectDir(sceneConfig);

        const checker = new LongMethodCheck();
        checker.rule = {
            ruleId: '@extrulesproject/long-method-check',
            alert: ALERT_LEVEL.WARN
        } as unknown as Rule;

        checker.beforeCheck();
        for (const arkFile of scene.getFiles()) {
            for (const arkClass of arkFile.getClasses()) {
                for (const method of arkClass.getMethods()) {
                    checker.check(method);
                }
            }
        }

        const tmp = path.join(os.tmpdir(), `perfReport-test-${Date.now()}.json`);
        PerfReporter.flush(tmp);

        const parsed = JSON.parse(fs.readFileSync(tmp, 'utf8')) as PerfReportShape;
        expect(parsed.perfEnabled).toBe(true);
        expect(parsed.checkers['LongMethodCheck']).toBeDefined();
        const stages = parsed.checkers['LongMethodCheck'].stages;
        expect(stages['beforeCheck']).toBeDefined();
        expect(stages['check']).toBeDefined();
        expect(stages['check'].count).toBeGreaterThan(0);

        fs.unlinkSync(tmp);
    });

    it('关闭时 flush() 不写文件', () => {
        PerfReporter.enabled = false;
        const tmp = path.join(os.tmpdir(), `perfReport-disabled-${Date.now()}.json`);
        PerfReporter.flush(tmp);
        expect(fs.existsSync(tmp)).toBe(false);
    });
});
