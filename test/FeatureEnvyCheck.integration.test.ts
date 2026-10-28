import * as path from "path";
import { ArkMethod, Scene, SceneConfig } from "arkanalyzer";
import { Rule } from "homecheck";
import { ALERT_LEVEL } from "homecheck/lib/model/Rule";
import { FeatureEnvyCheck } from "../src/Checkers/FeatureEnvyCheck";
import { buildFeatureEnvyFieldTypeMap, FeatureEnvyAnalyzer } from "../src/Checkers/feature-envy/analysis";

const PROJECT_DIR = path.resolve(__dirname, "sample/FeatureEnvy");

let scene: Scene;

function buildScene(): Scene {
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(PROJECT_DIR);
    const builtScene = new Scene();
    builtScene.buildSceneFromProjectDir(sceneConfig);
    builtScene.inferTypes();
    builtScene.buildClassDone();
    return builtScene;
}

function collectUserMethods(currentScene: Scene): ArkMethod[] {
    const methods: ArkMethod[] = [];
    for (const file of currentScene.getFiles()) {
        for (const arkClass of file.getClasses()) {
            for (const method of arkClass.getMethods()) {
                const methodName = method.getName();
                if (methodName.startsWith("%") || methodName === "constructor") {
                    continue;
                }
                methods.push(method);
            }
        }
    }
    return methods;
}

function collectAllMethods(currentScene: Scene): ArkMethod[] {
    const methods: ArkMethod[] = [];
    for (const file of currentScene.getFiles()) {
        for (const arkClass of file.getClasses()) {
            for (const method of arkClass.getMethods()) {
                methods.push(method);
            }
        }
    }
    return methods;
}

function createChecker(options?: Record<string, unknown>): FeatureEnvyCheck {
    const checker = new FeatureEnvyCheck();
    const rule = new Rule("@extrulesproject/feature-envy-check", ALERT_LEVEL.ERROR);
    if (options) {
        rule.option = [options];
    }
    checker.rule = rule;
    checker.beforeCheck();
    return checker;
}

beforeAll(() => {
    scene = buildScene();
}, 60_000);

describe("FeatureEnvyCheck integration", () => {
    test("默认三指标应只报告 BillingService.settle，而不是 DTO 映射、UI builder、primitive 格式化或纯适配组装", () => {
        const checker = createChecker();

        for (const method of collectUserMethods(scene)) {
            checker.check(method);
        }

        expect(checker.issues).toHaveLength(1);
        expect(checker.issues[0].defect.methodName).toBe("settle");
        expect(checker.issues[0].defect.description).toContain("ATFD=5");
        expect(checker.issues[0].defect.description).toContain("LDA=0.00");
        expect(checker.issues[0].defect.description).toContain("CPFD=1");
        expect(checker.issues.map((issue) => issue.defect.methodName)).not.toContain("updateFromUserInfo");
        expect(checker.issues.map((issue) => issue.defect.methodName)).not.toContain("cardSelector");
        expect(checker.issues.map((issue) => issue.defect.methodName)).not.toContain("maskPhone");
        expect(checker.issues.map((issue) => issue.defect.methodName)).not.toContain("submitPayment");
    });

    test("自定义阈值应生效", () => {
        const checker = createChecker({
            atfdThreshold: 5,
            ldaThreshold: 0.33,
            cpfdThreshold: 2
        });

        for (const method of collectUserMethods(scene)) {
            checker.check(method);
        }

        expect(checker.issues).toHaveLength(0);
    });

    test("ArkUI 样式方法和内建对象调用不产生 Feature Envy 告警", () => {
        const methods = collectAllMethods(scene);
        const style = methods.find(method => method.getName() === "cardStyle");
        const extended = methods.find(method => method.getName() === "labelStyle");
        const builtin = methods.find(method => method.getName() === "clearMaps");
        const modifier = methods.find(method => method.getDeclaringArkClass()?.getName() === "WidgetModifier" && method.getName() === "applyNormalAttribute");
        const builtinConstructors = methods.find(method => method.getDeclaringArkClass()?.getName() === "BuiltinConstructors" && method.getName() === "validate");
        const builtinInstances = methods.find(method => method.getDeclaringArkClass()?.getName() === "BuiltinInstances" && method.getName() === "read");
        expect(style?.hasDecorator("Styles")).toBe(true);
        expect(extended?.hasDecorator("Extend")).toBe(true);
        expect(builtin).toBeDefined();
        expect(modifier).toBeDefined();
        expect(builtinConstructors).toBeDefined();
        expect(builtinInstances).toBeDefined();
        expect(modifier?.getDeclaringArkClass()?.getImplementedInterfaceNames()).toContain("AttributeModifier<WidgetAttribute>");
        const modifierAnalysis = new FeatureEnvyAnalyzer(
            modifier!.getSignature().getDeclaringClassSignature().getClassName(),
            buildFeatureEnvyFieldTypeMap(modifier!)
        ).analyze(modifier!.getBody()!.getCfg().getStmts());
        expect(modifierAnalysis.metrics.atfd).toBeGreaterThan(4);
        const builtinAnalysis = new FeatureEnvyAnalyzer(
            builtinConstructors!.getSignature().getDeclaringClassSignature().getClassName(),
            buildFeatureEnvyFieldTypeMap(builtinConstructors!)
        ).analyze(builtinConstructors!.getBody()!.getCfg().getStmts());
        expect(builtinAnalysis.metrics.dominantProvider).not.toBe("ErrorConstructor");
        const builtinInstanceAnalysis = new FeatureEnvyAnalyzer(
            builtinInstances!.getSignature().getDeclaringClassSignature().getClassName(),
            buildFeatureEnvyFieldTypeMap(builtinInstances!)
        ).analyze(builtinInstances!.getBody()!.getCfg().getStmts());
        expect(builtinInstanceAnalysis.metrics.dominantProvider).not.toBe("Uint8Array");

        const checker = createChecker();
        checker.check(style as ArkMethod);
        checker.check(extended as ArkMethod);
        checker.check(builtin as ArkMethod);
        checker.check(modifier as ArkMethod);
        checker.check(builtinConstructors as ArkMethod);
        checker.check(builtinInstances as ArkMethod);
        expect(checker.issues).toHaveLength(0);
    });

    test("synthetic 回调方法不应参与 Feature Envy 检查", () => {
        const checker = createChecker();
        const syntheticMethod = collectAllMethods(scene).find((method) => {
            const methodName = method.getName();
            const line = method.getLine() ?? -1;
            return methodName.startsWith("%") && line >= 145 && line <= 160;
        });

        expect(syntheticMethod).toBeDefined();

        checker.check(syntheticMethod as ArkMethod);

        expect(checker.issues).toHaveLength(0);
    });
});
