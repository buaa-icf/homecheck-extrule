import {
    calculateCaseLineCounts,
    collectBraceDelimitedBlock,
    collectSourceSwitchBlocks,
    countCases,
    countElseIfChainBranches,
    isNestedInsideElseBlock,
    scanConditionalTokens
} from "../src/Checkers/switch-statement/sourceAnalysis";

describe("switch-statement source analysis", () => {
    test("collectSourceSwitchBlocks 应处理 switch 与左花括号分行的情况", () => {
        const lines = [
            "switch (kind)",
            "{",
            "  case 1:",
            "    foo();",
            "  default:",
            "    bar();",
            "}"
        ];

        const blocks = collectSourceSwitchBlocks(lines);

        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toEqual({
            startLineIndex: 0,
            switchColumn: 0,
            text: lines.join("\n")
        });
        expect(countCases(blocks[0].text)).toBe(2);
    });

    test("collectBraceDelimitedBlock 应截取完整 switch 块", () => {
        const lines = [
            "switch (kind) {",
            "  case 1:",
            "    foo();",
            "}",
            "const next = 1;"
        ];

        expect(collectBraceDelimitedBlock(lines, 0)).toBe(lines.slice(0, 4).join("\n"));
    });

    test("collectBraceDelimitedBlock 不应拼接重复的完整 builder 语句", () => {
        const builderStmt = [
            "CalendarSheetHeader({",
            "  onConfirm: async () => {",
            "    switch (this.currentIndex) {",
            "      case 0:",
            "        dispatchToSchedule();",
            "        break;",
            "      case 1:",
            "        dispatchToBirthday();",
            "        break;",
            "      case 2:",
            "        dispatchToReminder();",
            "        break;",
            "      case 3:",
            "        dispatchToTodo();",
            "        break;",
            "    }",
            "  },",
            "})"
        ].join("\n");

        const block = collectBraceDelimitedBlock([builderStmt, builderStmt, "return"], 0);

        expect(block).toBe(builderStmt);
        expect(countCases(block)).toBe(4);
    });

    test("calculateCaseLineCounts 应统计各分支行数并忽略结尾空白花括号", () => {
        const text = [
            "switch (kind) {",
            "  case 1:",
            "    foo();",
            "    break;",
            "  case 2:",
            "    bar();",
            "  default:",
            "    baz();",
            "}"
        ].join("\n");

        expect(calculateCaseLineCounts(text)).toEqual([
            { label: "1", lines: 3 },
            { label: "2", lines: 2 },
            { label: "default", lines: 2 }
        ]);
    });

    test("scanConditionalTokens 应区分顶层链和 else 块中的嵌套 if", () => {
        const code = `
            if (a) {
                foo();
            } else if (b) {
                bar();
            } else if (c) {
                baz();
            } else {
                if (nested) {
                    qux();
                }
            }
        `;

        const tokens = scanConditionalTokens(code);
        const rootIfIndex = tokens.findIndex(token => token.kind === "if" && token.depth === 0);
        const nestedIfIndex = tokens.findIndex((token, index) => index > rootIfIndex && token.kind === "if" && token.depth > 0);

        expect(rootIfIndex).toBeGreaterThanOrEqual(0);
        expect(nestedIfIndex).toBeGreaterThanOrEqual(0);
        expect(countElseIfChainBranches(tokens, rootIfIndex)).toBe(3);
        expect(isNestedInsideElseBlock(tokens, nestedIfIndex)).toBe(true);
    });
});
