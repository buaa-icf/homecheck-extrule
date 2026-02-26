import { parseRuleOptions, RuleOptionSchema } from "../src/Checkers/config/parseRuleOptions";

interface TestOptions {
    minStmts: number;
    similarityThreshold: number;
    ignoreLogs: boolean;
    mode: string;
}

const SCHEMA: RuleOptionSchema<TestOptions> = {
    minStmts: { type: "number", min: 1, aliases: ["minLines"] },
    similarityThreshold: { type: "number", min: 0, max: 1 },
    ignoreLogs: { type: "boolean" },
    mode: { type: "string" }
};

const DEFAULTS: TestOptions = {
    minStmts: 5,
    similarityThreshold: 1,
    ignoreLogs: true,
    mode: "strict"
};

describe("parseRuleOptions", () => {
    test("应使用默认值（无 options）", () => {
        const result = parseRuleOptions(undefined as any, SCHEMA, DEFAULTS);
        expect(result).toEqual(DEFAULTS);
    });

    test("应读取合法配置", () => {
        const rule = { option: [{ minStmts: 10, similarityThreshold: 0.8, ignoreLogs: false, mode: "fast" }] } as any;
        const result = parseRuleOptions(rule, SCHEMA, DEFAULTS);
        expect(result).toEqual({
            minStmts: 10,
            similarityThreshold: 0.8,
            ignoreLogs: false,
            mode: "fast"
        });
    });

    test("类型不匹配应回退默认值", () => {
        const rule = { option: [{ minStmts: "10", ignoreLogs: "false", mode: 1 }] } as any;
        const result = parseRuleOptions(rule, SCHEMA, DEFAULTS);
        expect(result).toEqual(DEFAULTS);
    });

    test("越界值应回退默认值", () => {
        const rule = { option: [{ minStmts: 0, similarityThreshold: 1.5 }] } as any;
        const result = parseRuleOptions(rule, SCHEMA, DEFAULTS);
        expect(result).toEqual(DEFAULTS);
    });

    test("应支持别名字段", () => {
        const rule = { option: [{ minLines: 9 }] } as any;
        const result = parseRuleOptions(rule, SCHEMA, DEFAULTS);
        expect(result.minStmts).toBe(9);
    });
});
