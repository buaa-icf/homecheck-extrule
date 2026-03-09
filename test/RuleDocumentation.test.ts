import * as fs from "fs";
import * as path from "path";
import { file2CheckRuleMap, project2CheckRuleMap } from "../src";

describe("ruleDocPath 文档完整性", () => {
    test("所有 checker 的 ruleDocPath 对应文档都存在", () => {
        const allRules = [...file2CheckRuleMap.entries(), ...project2CheckRuleMap.entries()];
        expect(allRules.length).toBeGreaterThan(0);

        for (const [ruleId, CheckerClass] of allRules) {
            const checker = new CheckerClass() as { metaData?: { ruleDocPath?: string } };
            const ruleDocPath = checker.metaData?.ruleDocPath;

            expect(ruleDocPath).toBeDefined();
            expect(typeof ruleDocPath).toBe("string");

            const fullPath = path.resolve(__dirname, "..", ruleDocPath!);
            expect(fs.existsSync(fullPath)).toBe(true);

            const stat = fs.statSync(fullPath);
            expect(stat.isFile()).toBe(true);
            expect(stat.size).toBeGreaterThan(0);
            expect(ruleId.length).toBeGreaterThan(0);
        }
    });
});
