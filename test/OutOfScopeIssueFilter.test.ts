import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const {
    classifyOutOfScopePath,
    filterOutOfScopeIssues,
    normalizePath,
    parseClonePeerPath
} = require("../scripts/outOfScopeIssueFilter");

const CLONE_RULE = "@extrulesproject/code-clone-fragment-check";
const LONG_METHOD_RULE = "@extrulesproject/long-method-check";

function issue(filePath: string, messages: any[]) {
    return { filePath, messages };
}

function message(rule = LONG_METHOD_RULE, text = "positive") {
    return { line: 1, column: 1, severity: "WARN", rule, message: text };
}

function cloneMessage(peerPath: string) {
    return message(CLONE_RULE, `Code Clone Type-2: A.ets:1-10 is similar to ${peerPath}:2-11. (80 tokens, 10 lines)`);
}

describe("out-of-scope issue filter", () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "homecheck-scope-filter-"));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("normalizes Windows and POSIX separators", () => {
        expect(normalizePath("C:\\repo\\src\\test\\Foo.ets")).toBe("C:/repo/src/test/Foo.ets");
        expect(normalizePath("/repo/src/test/Foo.ets")).toBe("/repo/src/test/Foo.ets");
    });

    test.each([
        ["src/test/Foo.test.ets", "PATH_TEST"],
        ["src/main/ets/test/test_file.ets", "PATH_TEST"],
        ["src/main/ets/account/components/VerifyPage.test.ets", "PATH_TEST"],
        ["src/main/ets/account/components/VerifyPage.spec.ets", "PATH_TEST"],
        ["src/main/ts/account/VerifyPage.test.ts", "PATH_TEST"],
        ["src/main/ts/account/VerifyPage.spec.ts", "PATH_TEST"],
        [".test/default/cache/Foo.ets", "PATH_GENERATED_OR_CACHE"],
        ["sample/performance/Foo.ets", "PATH_PERFORMANCE_OR_BENCHMARK"],
        ["sample/benchmark/Foo.ets", "PATH_PERFORMANCE_OR_BENCHMARK"],
        ["sample/OHBM/Foo.ets", "PATH_PERFORMANCE_OR_BENCHMARK"],
        ["sample/perfermance/Foo.ets", "PATH_PERFORMANCE_OR_BENCHMARK"]
    ])("classifies %s", (relativePath, expectedRule) => {
        const match = classifyOutOfScopePath(path.join(root, ...relativePath.split("/")), root);
        expect(match?.rule).toBe(expectedRule);
    });

    test.each([
        "src/main/ets/pages/Contest.ets",
        "src/main/ets/pages/Latest.ets",
        "src/main/ets/pages/TestPage.ets",
        "src/main/ets/pages/Foo.test.ets.backup"
    ])("does not classify production-like filename %s as test", (relativePath) => {
        const match = classifyOutOfScopePath(path.join(root, ...relativePath.split("/")), root);
        expect(match).toBeNull();
    });

    test("does not treat an ancestor report directory or normal production source as out of scope", () => {
        const nestedRoot = path.join(root, "report", ".perftest", "repo");
        const productionFile = path.join(nestedRoot, "src", "main", "ets", "pages", "Index.ets");
        expect(classifyOutOfScopePath(productionFile, nestedRoot)).toBeNull();
    });

    test("filters a non-clone issue by its primary path", () => {
        const result = filterOutOfScopeIssues([
            issue(path.join(root, "src", "ohosTest", "ets", "Spec.ets"), [message()])
        ], { repositoryRoot: root });
        expect(result.issues).toEqual([]);
        expect(result.stats.byRule.PATH_TEST).toBe(1);
    });

    test("filters a .test.ets file under src/main without a test directory", () => {
        const result = filterOutOfScopeIssues([
            issue(
                path.join(root, "src", "main", "ets", "account", "components", "VerifyPage.test.ets"),
                [message()]
            )
        ], { repositoryRoot: root });
        expect(result.issues).toEqual([]);
        expect(result.stats.byRule.PATH_TEST).toBe(1);
    });

    test("filters an entire clone when its peer is out of scope", () => {
        const peer = path.join(root, "benchmark", "Clone.ets");
        const result = filterOutOfScopeIssues([
            issue(path.join(root, "src", "main", "ets", "A.ets"), [cloneMessage(peer)])
        ], { repositoryRoot: root });
        expect(result.issues).toEqual([]);
        expect(result.stats.byRule.CLONE_PEER_OUT_OF_SCOPE_PATH).toBe(1);
    });

    test("filters a clone when its peer uses a test filename under src/main", () => {
        const peer = path.join(root, "src", "main", "ets", "components", "Peer.test.ets");
        const result = filterOutOfScopeIssues([
            issue(path.join(root, "src", "main", "ets", "A.ets"), [cloneMessage(peer)])
        ], { repositoryRoot: root });
        expect(result.issues).toEqual([]);
        expect(result.stats.byRule.CLONE_PEER_OUT_OF_SCOPE_PATH).toBe(1);
    });

    test("filters a clone across two independent application roots", () => {
        const appA = path.join(root, "app-a");
        const appB = path.join(root, "app-b");
        fs.mkdirSync(path.join(appA, "src"), { recursive: true });
        fs.mkdirSync(path.join(appB, "src"), { recursive: true });
        fs.writeFileSync(path.join(appA, "build-profile.json5"), "{ app: { products: [] } }");
        fs.writeFileSync(path.join(appB, "build-profile.json5"), "{ app: { products: [] } }");
        const peer = path.join(appB, "src", "B.ets");
        const result = filterOutOfScopeIssues([
            issue(path.join(appA, "src", "A.ets"), [cloneMessage(peer)])
        ], { repositoryRoot: root });
        expect(result.stats.byRule.CLONE_CROSS_APPLICATION_BOUNDARY).toBe(1);
        expect(result.issues).toEqual([]);
    });

    test("keeps clones between features belonging to one application root", () => {
        fs.writeFileSync(path.join(root, "build-profile.json5"), "{ app: { products: [] }, modules: [] }");
        const left = path.join(root, "features", "one", "src", "A.ets");
        const right = path.join(root, "features", "two", "src", "B.ets");
        fs.mkdirSync(path.dirname(left), { recursive: true });
        fs.mkdirSync(path.dirname(right), { recursive: true });
        const result = filterOutOfScopeIssues([issue(left, [cloneMessage(right)])], { repositoryRoot: root });
        expect(result.issues[0].messages).toHaveLength(1);
        expect(result.stats.removedMessages).toBe(0);
    });

    test("removes only matching messages and preserves other messages on the same file", () => {
        const peer = path.join(root, "test", "Clone.ets");
        const source = path.join(root, "src", "main", "ets", "A.ets");
        const result = filterOutOfScopeIssues([
            issue(source, [cloneMessage(peer), message()])
        ], { repositoryRoot: root });
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0].messages).toHaveLength(1);
        expect(result.issues[0].messages[0].rule).toBe(LONG_METHOD_RULE);
    });

    test("keeps an unparseable clone and records it for audit", () => {
        const result = filterOutOfScopeIssues([
            issue(path.join(root, "src", "A.ets"), [message(CLONE_RULE, "unexpected clone format")])
        ], { repositoryRoot: root });
        expect(result.issues).toHaveLength(1);
        expect(result.stats.unresolvedClonePeerPath).toBe(1);
    });

    test("extracts a Windows clone peer path without losing the drive letter", () => {
        const text = "A.ets:1-9 is similar to D:\\repo\\src\\B.ets > B.work():10-18. (80 tokens, 9 lines)";
        expect(parseClonePeerPath(text)).toBe("D:\\repo\\src\\B.ets");
    });
});
