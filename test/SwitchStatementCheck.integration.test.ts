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
    test("同一源码 switch 被普通方法和匿名 ArkMethod 覆盖时只上报一次并归属普通方法", () => {
        const checker = createChecker();
        const file = { getFilePath: () => "CallbackSwitch.ets" };
        const cfg = { getStmts: () => [] };
        const switchBody = [
            "switch (state) {",
            "case 1: break;",
            "case 2: break;",
            "case 3: break;",
            "case 4: break;",
            "case 5: break;",
            "default: break;",
            "}"
        ].join("\n");
        const anonymous = {
            getName: () => "%AM1$setCallback",
            getBody: () => ({ getCfg: () => cfg }),
            getCode: () => switchBody,
            getLine: () => 12,
            getDeclaringArkFile: () => file
        } as any;
        const ordinary = {
            getName: () => "setCallback",
            getBody: () => ({ getCfg: () => cfg }),
            getCode: () => ["setCallback() {", "register(() => {", switchBody, "});", "}"].join("\n"),
            getLine: () => 10,
            getDeclaringArkFile: () => file
        } as any;

        // 故意先派发匿名方法，验证普通方法仍能接管同一个源码节点的归属。
        checker.check(anonymous);
        checker.check(ordinary);

        expect(checker.issues).toHaveLength(1);
        expect(checker.issues[0].defect.reportLine).toBe(12);
        expect(checker.issues[0].defect.methodName).toBe("setCallback");
    });

    test("同一方法内两个不同的 switch 仍分别上报", () => {
        const checker = createChecker();
        const file = { getFilePath: () => "TwoSwitches.ets" };
        const cfg = { getStmts: () => [] };
        const oneSwitch = (name: string) => [
            `switch (${name}) {`,
            "case 1: break; case 2: break; case 3: break;",
            "case 4: break; case 5: break; default: break;",
            "}"
        ].join("\n");
        const method = {
            getName: () => "render",
            getBody: () => ({ getCfg: () => cfg }),
            getCode: () => ["render() {", oneSwitch("first"), oneSwitch("second"), "}"].join("\n"),
            getLine: () => 20,
            getDeclaringArkFile: () => file
        } as any;

        checker.check(method);

        expect(checker.issues).toHaveLength(2);
        expect(checker.issues.map(issue => issue.defect.reportLine)).toEqual([21, 25]);
    });

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

        const fileASwitch = checker.issues.find(issue =>
            issue.defect.methodName === "render" &&
            (issue.defect.description ?? "").includes("Switch statement with 7 cases") &&
            (issue.defect.mergeKey ?? "").includes("FileA.ets"),
        );
        expect(fileASwitch?.defect.reportLine).toBe(3);

        const fileAChain = checker.issues.find(issue =>
            (issue.defect.description ?? "").includes("if-else chain with 6 branches") &&
            (issue.defect.mergeKey ?? "").includes("FileA.ets"),
        );
        expect(fileAChain?.defect.reportLine).toBe(39);
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

    test("嵌套 if-else 链不应被误报为 switch 语句", () => {
        const checker = createChecker();

        for (const method of collectUserMethods(scene)) {
            checker.check(method);
        }

        const hasNestedElseIfIssue = checker.issues.some(issue => {
            const description = issue.defect.description ?? "";
            const mergeKey = issue.defect.mergeKey ?? "";
            return description.includes("if-else chain") && mergeKey.includes("FileC.ets");
        });

        expect(hasNestedElseIfIssue).toBe(false);
    });
});
