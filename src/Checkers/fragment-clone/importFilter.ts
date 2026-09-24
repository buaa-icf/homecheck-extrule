import { ts } from "arkanalyzer";

/**
 * 将 import 声明替换为空格，同时保留换行和总字符数。
 * 这样 import 不参与克隆 token 窗口，后续报告的原始行列仍保持不变。
 */
export function blankImportDeclarations(sourceCode: string, filePath: string = "source.ets"): string {
    if (!/\bimport\b/.test(sourceCode)) {
        return sourceCode;
    }

    const sourceFile = ts.createSourceFile(
        filePath,
        sourceCode,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    const ranges: Array<{ start: number; end: number }> = [];

    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) {
            ranges.push({ start: statement.getFullStart(), end: statement.getEnd() });
        }
    }

    if (ranges.length === 0) {
        return sourceCode;
    }

    const chars = sourceCode.split("");
    for (const range of ranges) {
        for (let index = range.start; index < range.end; index++) {
            if (chars[index] !== "\n" && chars[index] !== "\r") {
                chars[index] = " ";
            }
        }
    }
    return chars.join("");
}
