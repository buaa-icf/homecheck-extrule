import * as path from "path";
import { ArkMethod, Scene, SceneConfig } from "arkanalyzer";
import { Rule } from "homecheck";
import { ALERT_LEVEL } from "homecheck/lib/model/Rule";
import { FeatureEnvyCheck } from "../src/Checkers/FeatureEnvyCheck";

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
