import * as path from "path";
import { Scene, SceneConfig } from "arkanalyzer";
import { Rule } from "homecheck";
import { ALERT_LEVEL } from "homecheck/lib/model/Rule";
import { IssueReport } from "homecheck";
import { CodeCloneFragmentCheck } from "../src/Checkers/CodeCloneFragmentCheck";
import { CodeCloneType1Check } from "../src/Checkers/CodeCloneType1Check";
import { CodeCloneType2Check } from "../src/Checkers/CodeCloneType2Check";
import { LongMethodCheck } from "../src/Checkers/LongMethodCheck";
import { djb2Hash } from "../src/Checkers/shared";

const LONG_METHOD_PROJECT_DIR = path.resolve(__dirname, "sample/LongMethod");
const CODE_CLONE_PROJECT_DIR = path.resolve(__dirname, "sample/CodeClone");

function buildScene(projectDir: string): Scene {
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    return scene;
}

function summarizeIssues(issues: IssueReport[]) {
    return issues
        .map(issue => ({
            ruleId: issue.defect.ruleId,
            file: path.basename((issue.defect.mergeKey ?? "").split("%")[0] || ""),
            line: issue.defect.reportLine,
            severity: issue.defect.severity,
            methodName: issue.defect.methodName ?? "",
            descriptionHash: djb2Hash(issue.defect.description ?? "")
        }))
        .sort((a, b) => {
            if (a.file !== b.file) {
                return a.file.localeCompare(b.file);
            }
            if (a.line !== b.line) {
                return a.line - b.line;
            }
            if (a.methodName !== b.methodName) {
                return a.methodName.localeCompare(b.methodName);
            }
            return a.descriptionHash.localeCompare(b.descriptionHash);
        });
}

describe("规则行为回归快照", () => {
    test("LongMethodCheck 输出应稳定", () => {
        const scene = buildScene(LONG_METHOD_PROJECT_DIR);
        const checker = new LongMethodCheck() as any;
        checker.rule = new Rule("@extrulesproject/long-method-check", ALERT_LEVEL.ERROR);

        checker.beforeCheck?.();
        for (const file of scene.getFiles()) {
            for (const arkClass of file.getClasses()) {
                for (const method of arkClass.getMethods()) {
                    const methodName = method.getName();
                    if (methodName.startsWith("%") || methodName === "constructor") {
                        continue;
                    }
                    checker.check(method);
                }
            }
        }

        expect({
            issueCount: checker.issues.length,
            issues: summarizeIssues(checker.issues)
        }).toMatchSnapshot();
    });

    test("CodeClone 系列规则输出应稳定", () => {
        const scene = buildScene(CODE_CLONE_PROJECT_DIR);
        const files = scene.getFiles();

        const type1 = new CodeCloneType1Check() as any;
        type1.rule = new Rule("@extrulesproject/code-clone-type1-check", ALERT_LEVEL.ERROR);
        type1.rule.option = [{ minStmts: 5, ignoreLogs: true }];
        type1.beforeCheck();
        for (const file of files) {
            type1.collectMethods(file);
        }
        type1.afterCheck();

        const type2 = new CodeCloneType2Check() as any;
        type2.rule = new Rule("@extrulesproject/code-clone-type2-check", ALERT_LEVEL.ERROR);
        type2.rule.option = [{ minStmts: 5, ignoreLiterals: true, ignoreLogs: true, ignoreTypes: true }];
        type2.beforeCheck();
        for (const file of files) {
            type2.collectMethods(file);
        }
        type2.afterCheck();

        const fragment = new CodeCloneFragmentCheck() as any;
        fragment.rule = new Rule("@extrulesproject/code-clone-fragment-check", ALERT_LEVEL.ERROR);
        fragment.rule.option = [{ minimumTokens: 20, normalizeIdentifiers: true, normalizeLiterals: true, ignoreLogs: true }];
        fragment.beforeCheck();
        for (const file of files) {
            fragment.collectTokens(file);
        }
        fragment.afterCheck();

        expect({
            type1: {
                issueCount: type1.issues.length,
                issues: summarizeIssues(type1.issues)
            },
            type2: {
                issueCount: type2.issues.length,
                issues: summarizeIssues(type2.issues)
            },
            fragment: {
                issueCount: fragment.issues.length,
                issues: summarizeIssues(fragment.issues),
                diagnostics: fragment.getDiagnostics()
            }
        }).toMatchSnapshot();
    });
});
