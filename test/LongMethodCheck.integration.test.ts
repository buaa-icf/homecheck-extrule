/**
 * LongMethodCheck 集成测试
 *
 * 使用 arkanalyzer 的 Scene + SceneConfig 解析真实 .ets 文件，
 * 然后使用 LongMethodCheck 对解析出的方法进行检测。
 *
 * 测试流程：
 * 1. 构建 Scene（解析 test/sample/LongMethod/ 项目）
 * 2. 遍历所有方法，记录每个方法的 CFG 语句数
 * 3. 用 LongMethodCheck 检测，验证正确的方法被标记
 */

import * as path from 'path';
import { Scene, SceneConfig } from 'arkanalyzer';
import { ArkMethod } from 'arkanalyzer';
import { LongMethodCheck } from '../src/Checkers/LongMethodCheck';
import { Rule } from 'homecheck';
import { ALERT_LEVEL } from 'homecheck/lib/model/Rule';

const PROJECT_DIR = path.resolve(__dirname, 'sample/LongMethod');

let scene: Scene;

function buildScene(): Scene {
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(PROJECT_DIR);
    const s = new Scene();
    s.buildSceneFromProjectDir(sceneConfig);
    return s;
}

function getMethodKey(method: ArkMethod): string {
    const arkFile = method.getDeclaringArkFile();
    const filePath = arkFile?.getFilePath() ?? '';
    const fileStem = path.basename(filePath, path.extname(filePath));
    const className = method.getDeclaringArkClass()?.getName() ?? '';
    const methodName = method.getName() ?? '';
    return `${fileStem}::${className}::${methodName}`;
}

function getStmtCount(method: ArkMethod): number {
    const body = method.getBody();
    if (!body) return 0;
    return body.getCfg().getStmts().length;
}

function createChecker(options?: Record<string, unknown>): LongMethodCheck {
    const checker = new LongMethodCheck();
    const rule = new Rule('@extrulesproject/long-method-check', ALERT_LEVEL.ERROR);
    if (options) {
        rule.option = [options];
    }
    checker.rule = rule;
    return checker;
}

function collectUserMethods(s: Scene): ArkMethod[] {
    const methods: ArkMethod[] = [];
    for (const file of s.getFiles()) {
        for (const cls of file.getClasses()) {
            for (const method of cls.getMethods()) {
                const methodName = method.getName();
                if (methodName.startsWith('%') || methodName === 'constructor') continue;
                methods.push(method);
            }
        }
    }
    return methods;
}

beforeAll(() => {
    scene = buildScene();
}, 60_000);

describe('校准：arkanalyzer CFG 语句数', () => {
    test('Scene 应成功构建并包含 .ets 文件', () => {
        const files = scene.getFiles();
        expect(files.length).toBeGreaterThan(0);

        const fileNames = files.map(f => path.basename(f.getFilePath()));
        expect(fileNames).toEqual(expect.arrayContaining([
            expect.stringContaining('NormalMethods'),
            expect.stringContaining('UIBuilderMethods'),
            expect.stringContaining('ComponentMethods')
        ]));
    });

    test('打印所有用户方法及其 CFG 语句数（用于校准）', () => {
        const methods = collectUserMethods(scene);
        expect(methods.length).toBeGreaterThan(0);

        const methodInfo: Record<string, number> = {};
        for (const m of methods) {
            methodInfo[getMethodKey(m)] = getStmtCount(m);
        }
        console.log('=== 方法 CFG 语句数校准 ===');
        console.log(JSON.stringify(methodInfo, null, 2));

        const longMethodKey = Object.keys(methodInfo).find(k => k.includes('longMethod'));
        if (longMethodKey) {
            expect(methodInfo[longMethodKey]).toBeGreaterThan(50);
        }
    });
});

describe('LongMethodCheck 集成测试：NormalMethods.ets', () => {
    test('应检测到 longMethod 和 standaloneLongFunction（普通方法超阈值）', () => {
        const checker = createChecker();
        const methods = collectUserMethods(scene);

        const normalMethods = methods.filter(m => {
            const filePath = m.getDeclaringArkFile()?.getFilePath() ?? '';
            return filePath.includes('NormalMethods');
        });
        expect(normalMethods.length).toBeGreaterThan(0);

        for (const method of normalMethods) {
            checker.check(method);
        }

        const reportedMethods = checker.issues.map(i => i.defect.methodName);

        const longMethodStmts = normalMethods.find(m => m.getName() === 'longMethod');
        if (longMethodStmts && getStmtCount(longMethodStmts) > 50) {
            expect(reportedMethods).toContain('longMethod');
        }

        const standaloneStmts = normalMethods.find(m => m.getName() === 'standaloneLongFunction');
        if (standaloneStmts && getStmtCount(standaloneStmts) > 50) {
            expect(reportedMethods).toContain('standaloneLongFunction');
        }

        expect(reportedMethods).not.toContain('shortMethod');

        for (const issue of checker.issues) {
            expect(issue.defect.severity).toBe(2);
        }
    });
});

describe('LongMethodCheck 集成测试：UIBuilderMethods.ets', () => {
    test('应区分 @Builder 方法并使用 UI 阈值', () => {
        const checker = createChecker();
        const methods = collectUserMethods(scene);

        const builderMethods = methods.filter(m => {
            const filePath = m.getDeclaringArkFile()?.getFilePath() ?? '';
            return filePath.includes('UIBuilderMethods');
        });
        expect(builderMethods.length).toBeGreaterThan(0);

        for (const method of builderMethods) {
            checker.check(method);
        }

        const reportedMethods = checker.issues.map(i => i.defect.methodName);

        const longBuilder = builderMethods.find(m => m.getName() === 'longBuilderFunction');
        if (longBuilder) {
            const stmts = getStmtCount(longBuilder);
            console.log(`longBuilderFunction CFG stmts: ${stmts}`);
            if (stmts > 80) {
                expect(reportedMethods).toContain('longBuilderFunction');
                const issue = checker.issues.find(i => i.defect.methodName === 'longBuilderFunction');
                expect(issue).toBeDefined();
                if (stmts <= 120) {
                    expect(issue!.defect.severity).toBe(1);
                } else {
                    expect(issue!.defect.severity).toBe(2);
                }
            }
        }

        expect(reportedMethods).not.toContain('shortBuilderFunction');
    });
});

describe('LongMethodCheck 集成测试：ComponentMethods.ets', () => {
    test('应区分 @Component struct 中的 build/lifecycle/普通方法', () => {
        const checker = createChecker();
        const methods = collectUserMethods(scene);

        const componentMethods = methods.filter(m => {
            const filePath = m.getDeclaringArkFile()?.getFilePath() ?? '';
            return filePath.includes('ComponentMethods');
        });
        expect(componentMethods.length).toBeGreaterThan(0);

        for (const method of componentMethods) {
            checker.check(method);
        }

        const reportedMethods = checker.issues.map(i => i.defect.methodName);
        console.log('ComponentMethods issues:', checker.issues.map(i => ({
            method: i.defect.methodName,
            severity: i.defect.severity,
            desc: i.defect.description
        })));

        const buildMethod = componentMethods.find(m =>
            m.getName() === 'build' &&
            m.getDeclaringArkClass()?.getName() === 'LongBuildComponent'
        );
        if (buildMethod) {
            const stmts = getStmtCount(buildMethod);
            console.log(`LongBuildComponent.build() CFG stmts: ${stmts}`);
            if (stmts > 80) {
                expect(reportedMethods).toContain('build');
                const issue = checker.issues.find(i =>
                    i.defect.methodName === 'build' &&
                    i.defect.description.includes('build')
                );
                if (issue && stmts <= 120) {
                    expect(issue.defect.severity).toBe(1);
                }
            }
        }

        const lifecycleMethod = componentMethods.find(m =>
            m.getName() === 'aboutToAppear' &&
            m.getDeclaringArkClass()?.getName() === 'LongBuildComponent'
        );
        if (lifecycleMethod) {
            const stmts = getStmtCount(lifecycleMethod);
            console.log(`LongBuildComponent.aboutToAppear() CFG stmts: ${stmts}`);
            if (stmts > 80) {
                expect(reportedMethods).toContain('aboutToAppear');
                const issue = checker.issues.find(i => i.defect.methodName === 'aboutToAppear');
                if (issue && stmts <= 120) {
                    expect(issue.defect.severity).toBe(1);
                }
            }
        }

        const helperMethod = componentMethods.find(m =>
            m.getName() === 'helperMethod' &&
            m.getDeclaringArkClass()?.getName() === 'LongBuildComponent'
        );
        if (helperMethod) {
            const stmts = getStmtCount(helperMethod);
            console.log(`LongBuildComponent.helperMethod() CFG stmts: ${stmts}`);
            if (stmts > 50) {
                expect(reportedMethods).toContain('helperMethod');
                const issue = checker.issues.find(i => i.defect.methodName === 'helperMethod');
                expect(issue).toBeDefined();
                expect(issue!.defect.severity).toBe(2);
            }
        }

        const shortBuild = componentMethods.find(m =>
            m.getName() === 'build' &&
            m.getDeclaringArkClass()?.getName() === 'ShortComponent'
        );
        if (shortBuild) {
            const stmts = getStmtCount(shortBuild);
            console.log(`ShortComponent.build() CFG stmts: ${stmts}`);
            expect(stmts).toBeLessThanOrEqual(80);
        }
    });
});

describe('LongMethodCheck 集成测试：全量检测', () => {
    test('全量方法检测 — 检查 issue 总数和分类', () => {
        const checker = createChecker();
        const methods = collectUserMethods(scene);

        for (const method of methods) {
            checker.check(method);
        }

        console.log(`\n=== 全量检测结果 ===`);
        console.log(`总方法数: ${methods.length}`);
        console.log(`触发 issue 数: ${checker.issues.length}`);
        for (const issue of checker.issues) {
            console.log(`  - ${issue.defect.methodName}: severity=${issue.defect.severity}, ${issue.defect.description}`);
        }

        expect(checker.issues.length).toBeGreaterThan(0);

        const shortMethodNames = ['shortMethod', 'shortBuilderFunction'];
        for (const issue of checker.issues) {
            expect(shortMethodNames).not.toContain(issue.defect.methodName);
        }

        for (const issue of checker.issues) {
            expect([1, 2]).toContain(issue.defect.severity);
        }
    });

    test('自定义阈值应生效', () => {
        const checker = createChecker({
            maxStmts: 1,
            maxUIStmtsSoft: 1,
            maxUIStmtsHard: 2
        });
        const methods = collectUserMethods(scene);

        for (const method of methods) {
            checker.check(method);
        }

        const methodsWithBody = methods.filter(m => m.getBody() && getStmtCount(m) > 0);
        expect(checker.issues.length).toBeGreaterThanOrEqual(methodsWithBody.filter(m => getStmtCount(m) > 1).length);
    });
});
