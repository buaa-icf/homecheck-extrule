import * as path from "path";
import { ArkMethod, Scene, SceneConfig } from "arkanalyzer";
import { Rule } from "homecheck";
import { ALERT_LEVEL } from "homecheck/lib/model/Rule";
import { SwitchStatementCheck } from "../src/Checkers/SwitchStatementCheck";

const PROJECT_DIR = path.resolve(__dirname, "sample/SwitchStatement");

let scene: Scene;

function buildScene(): Scene {
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(PROJECT_DIR);
    const builtScene = new Scene();
    builtScene.buildSceneFromProjectDir(sceneConfig);
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

function createChecker(options?: Record<string, unknown>): SwitchStatementCheck {
    const checker = new SwitchStatementCheck();
    const rule = new Rule("@extrulesproject/switch-statement-check", ALERT_LEVEL.ERROR);
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

describe("SwitchStatementCheck integration", () => {
    test("默认阈值下应同时检测 large switch 和长 if-else 链", () => {
        const checker = createChecker();

        for (const method of collectUserMethods(scene)) {
            checker.check(method);
        }

        const descriptions = checker.issues.map(issue => issue.defect.description ?? "");
        expect(descriptions.some(description => description.includes("Switch statement with 7 cases"))).toBe(true);
        expect(descriptions.some(description => description.includes("if-else chain with 6 branches"))).toBe(true);

        expect(checker.issues.some(issue => issue.defect.methodName === "renderShortChain")).toBe(false);
        expect(checker.issues.some(issue => issue.defect.methodName === "renderNestedElseIf")).toBe(false);
    });

    test("应检测 FileA 样例中的长 if-else 链", () => {
        const checker = createChecker();

        for (const method of collectUserMethods(scene)) {
            checker.check(method);
        }

        const hasFileALongChainIssue = checker.issues.some(issue => {
            const description = issue.defect.description ?? "";
            const mergeKey = issue.defect.mergeKey ?? "";
            return description.includes("if-else chain with 6 branches") && mergeKey.includes("FileA.ets");
        });

        expect(hasFileALongChainIssue).toBe(true);
    });

    test("自定义阈值应同步作用于 switch 和 if-else 链", () => {
        const checker = createChecker({ minCases: 7 });

        for (const method of collectUserMethods(scene)) {
            checker.check(method);
        }

        const descriptions = checker.issues.map(issue => issue.defect.description ?? "");
        expect(descriptions.some(description => description.includes("Switch statement with 7 cases"))).toBe(true);
        expect(descriptions.some(description => description.includes("if-else chain"))).toBe(false);
    });
});
