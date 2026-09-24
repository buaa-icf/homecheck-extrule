import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CodeCloneFragmentCheck } from "../src/Checkers/CodeCloneFragmentCheck";
import { Tokenizer } from "../src/Checkers/FragmentDetection/Tokenizer";
import { blankImportDeclarations } from "../src/Checkers/fragment-clone/importFilter";

describe("code-clone import filtering", () => {
    test("filters common import forms without moving source positions", () => {
        const source = [
            'import DefaultValue, { first as renamed, second } from "./dep";',
            'import {',
            '  third,',
            '  fourth as alias',
            '} from "./multi";',
            'import Legacy = require("./legacy");',
            'export const retained = DefaultValue;'
        ].join("\n");

        const filtered = blankImportDeclarations(source, "Sample.ets");

        expect(filtered.length).toBe(source.length);
        expect(filtered.split(/\r?\n/)).toHaveLength(7);
        expect(filtered).not.toContain("first as renamed");
        expect(filtered).not.toContain('require("./legacy")');
        expect(filtered.split(/\r?\n/)[6]).toBe("export const retained = DefaultValue;");

        const tokens = new Tokenizer().tokenize(filtered, "Sample.ets");
        expect(tokens[0].line).toBe(7);
    });

    test("shared imports no longer contribute tokens to the clone threshold", () => {
        const imports = [
            'import DefaultValue, { first, second, third, fourth } from "./shared";',
            'import { fifth, sixth, seventh, eighth } from "./more";'
        ].join("\n");
        const sourceA = `${imports}\nexport const alpha = 1;`;
        const sourceB = `${imports}\nexport const beta = 2;`;
        const tokenizer = new Tokenizer({ normalizeIdentifiers: false, normalizeLiterals: false });

        const rawA = tokenizer.tokenize(sourceA, "A.ets");
        const rawB = tokenizer.tokenize(sourceB, "B.ets");
        const filteredA = tokenizer.tokenize(blankImportDeclarations(sourceA, "A.ets"), "A.ets");
        const filteredB = tokenizer.tokenize(blankImportDeclarations(sourceB, "B.ets"), "B.ets");

        expect(rawA.length).toBeGreaterThan(filteredA.length);
        expect(rawB.length).toBeGreaterThan(filteredB.length);
        expect(filteredA.map(token => token.value)).not.toEqual(filteredB.map(token => token.value));
    });

    test("a file below minimumTokens after import removal is not indexed", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clone-import-"));
        const filePath = path.join(tempDir, "Short.ets");
        fs.writeFileSync(filePath, [
            'import DefaultValue, { first, second, third, fourth } from "./shared";',
            "export const retained = 1;"
        ].join("\n"));

        try {
            const checker = new CodeCloneFragmentCheck();
            checker.rule = {
                ruleId: "@extrulesproject/code-clone-fragment-check",
                option: [{ minimumTokens: 10, ignoreLogs: false, ignoreImports: true }]
            } as any;
            checker.beforeCheck();
            checker.collectTokens({ getFilePath: () => filePath } as any);

            expect((checker as any).fileCache.has(filePath)).toBe(false);
            expect((checker as any).cloneMatcher.fileTokenIds.size).toBe(0);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("repeated implementation still reports when it exceeds the threshold without imports", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clone-body-"));
        const imports = 'import { sharedOne, sharedTwo } from "./shared";';
        const implementation = [
            "export function calculate(value: number): number {",
            "  const doubled = value * 2;",
            "  const adjusted = doubled + 3;",
            "  return adjusted;",
            "}"
        ].join("\n");
        const fileA = path.join(tempDir, "A.ets");
        const fileB = path.join(tempDir, "B.ets");
        fs.writeFileSync(fileA, `${imports}\n${implementation}`);
        fs.writeFileSync(fileB, `${imports}\n${implementation}`);

        try {
            const checker = new CodeCloneFragmentCheck();
            checker.rule = {
                ruleId: "@extrulesproject/code-clone-fragment-check",
                alert: 2,
                option: [{
                    minimumTokens: 12,
                    ignoreLogs: false,
                    ignoreImports: true,
                    normalizeIdentifiers: false,
                    normalizeLiterals: false
                }]
            } as any;
            checker.beforeCheck();
            const arkFile = (filePath: string) => ({
                getFilePath: () => filePath,
                getClasses: () => []
            }) as any;
            checker.collectTokens(arkFile(fileA));
            checker.collectTokens(arkFile(fileB));
            checker.afterCheck();

            expect(checker.issues.length).toBeGreaterThan(0);
            expect(checker.issues[0].defect.reportLine).toBe(2);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
