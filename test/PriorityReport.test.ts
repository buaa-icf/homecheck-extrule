import { createDefects } from "../src/Checkers/shared/defects";
import { scoreLongMethod, scorePriority, thresholdScore } from "../src/Checkers/priority/PriorityScorer";

const { GeneratingJsonFile } = require("homecheck/lib/utils/common/GeneratingJsonFile");

describe("告警重构优先级", () => {
    test("各维度得分映射到 P1～P4，超阈值最多占 10 分", () => {
        expect(thresholdScore(1)).toBe(0);
        expect(thresholdScore(3.1)).toBe(10);
        expect(scorePriority({
            maintenanceImpact: 30,
            smellSpecificEvidence: 30,
            changeAmplification: 20,
            comprehensionRisk: 10,
            thresholdRatio: 3.1
        })).toEqual({ priorityScore: 100, priorityLevel: "P1" });
        expect(scorePriority({
            maintenanceImpact: 5,
            smellSpecificEvidence: 4,
            changeAmplification: 2,
            comprehensionRisk: 3,
            thresholdRatio: 1
        })).toEqual({ priorityScore: 14, priorityLevel: "P4" });
    });

    test("报告在 messages[] 中输出独立的分数和级别", () => {
        const issue = createDefects({
            line: 12,
            startCol: 3,
            endCol: 8,
            description: "Long method",
            severity: 1,
            ruleId: "@extrulesproject/long-method-check",
            filePath: "C:/sample/Page.ets",
            ruleDocPath: "docs/long-method-check.md",
            priority: { priorityScore: 75, priorityLevel: "P1" }
        });
        const fileReports = [{ filePath: "C:/sample/Page.ets", defects: [issue.defect] }];
        const formatted = GeneratingJsonFile.format(fileReports);
        const results = new Map([["page", formatted[0]]]);
        const message = JSON.parse(GeneratingJsonFile.format2(results))[0].messages[0];
        expect(message).toEqual({
            line: 12,
            column: 3,
            severity: "WARN",
            message: "Long method",
            rule: "@extrulesproject/long-method-check",
            priorityScore: 75,
            priorityLevel: "P1"
        });
    });

    test("连续读取同一输入流的长方法不会只因行数高就排到前面", () => {
        const source = Array.from({ length: 12 }, (_, i) => `input.readInt(true); if (field${i}) { input.readFloat(); }`).join("\n");
        const score = scoreLongMethod(source, 442, 50, false);
        expect(score.priorityLevel).toBe("P3");
    });
});
