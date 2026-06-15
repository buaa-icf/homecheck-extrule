import { project2CheckRuleMap } from "../src";

describe("Code clone rule registry", () => {
    test("only the fragment clone checker is registered", () => {
        const codeCloneRuleIds = [...project2CheckRuleMap.keys()]
            .filter(ruleId => ruleId.includes("code-clone"))
            .sort();

        expect(codeCloneRuleIds).toEqual([
            "@extrulesproject/code-clone-fragment-check"
        ]);
        expect(project2CheckRuleMap.has("@extrulesproject/code-clone-type1-check")).toBe(false);
        expect(project2CheckRuleMap.has("@extrulesproject/code-clone-type2-check")).toBe(false);
    });
});
