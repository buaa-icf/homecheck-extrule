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
        ["sample/perfermance/Foo.ets", "PATH_PERFORMANCE_OR_BENCHMARK"],
        ["function/arkui/inspector_test/entry/src/main/ets/pages/Index.ets", "PATH_TEST"],
        ["box2d/entry/src/main/ets/Testbed/Tests/Mobile.ts", "PATH_TESTBED"],
        ["box2d/entry/src/main/ets/Testbed/Framework/Main.ts", "PATH_TEST"],
        ["library/src/main/ets/example/Example.ets", "PATH_DEMO_SOURCE"],
        ["library/src/main/ets/preview/PreviewPage.ets", "PATH_DEMO_SOURCE"],
        ["node-imap/entry/src/main/ets/pages/TestInterfacePage.ets", "PATH_TEST_INTERFACE_PAGE"],
        ["openharmony_tpc_samples/sanitize-html/entry/src/main/ets/pages/allowed_schemes.ets", "PATH_API_DEMO_ENTRY"],
        ["openharmony_tpc_samples/stringTemplate/entry/src/main/ets/pages/Index.ets", "PATH_API_DEMO_ENTRY"],
        ["openharmony_tpc_samples/ohos_polka/entry/src/main/ets/pages/demo/http.ts", "PATH_API_DEMO_ENTRY"],
        ["openharmony_tpc_samples/lodashDemo/entry/src/main/ets/pages/Index.ets", "PATH_API_DEMO_ENTRY"],
        ["openharmony_tpc_samples/BasicFtp/entry/src/main/ets/pages/PressPage.ets", "PATH_API_DEMO_ENTRY"],
        ["ohos_msgpack/entry/src/main/ets/pages/Encoding64DemoOne.ets", "PATH_API_DEMO_ENTRY"]
    ])("classifies %s", (relativePath, expectedRule) => {
        const match = classifyOutOfScopePath(path.join(root, ...relativePath.split("/")), root);
        expect(match?.rule).toBe(expectedRule);
    });

    test.each([
        "src/main/ets/pages/Contest.ets",
        "src/main/ets/pages/Latest.ets",
        "src/main/ets/pages/TestPage.ets",
        "src/main/ets/pages/Foo.test.ets.backup",
        "src/main/ets/mock/preview/MockResponse.ets",
        "src/main/ets/mocks/sample/TransactionDatasetMock.ets",
        "openharmony_tpc_samples/ohos_polka/library/src/main/ets/http/core/request/IncomingMessage.ts",
        "openharmony_tpc_samples/net_snmp/library/src/main/ets/Snmp.ets",
        "openharmony_tpc_samples/metadata-extractor/library/src/main/ets/TextSampleDescriptionAtom.ts",
        "openharmony_tpc_samples/mathjsDemo/library/src/main/ets/Calculator.ets",
        "openharmony_tpc_samples/mathjsDemo/entry/src/main/ets/mock/MockData.ets",
        "openharmony_tpc_samples/unknown/entry/src/main/ets/pages/Index.ets",
        "business/entry/src/main/ets/pages/Index.ets"
    ])("does not classify production-like filename %s as test", (relativePath) => {
        const match = classifyOutOfScopePath(path.join(root, ...relativePath.split("/")), root);
        expect(match).toBeNull();
    });

    test("does not treat an ancestor report directory or normal production source as out of scope", () => {
        const nestedRoot = path.join(root, "report", ".perftest", "repo");
        const productionFile = path.join(nestedRoot, "src", "main", "ets", "pages", "Index.ets");
        expect(classifyOutOfScopePath(productionFile, nestedRoot)).toBeNull();
    });

    test("filters TPC demo entry helpers and sample pages while keeping library code", () => {
        const tpcRoot = path.join(root, "openharmony_tpc_samples");
        const helper = path.join(tpcRoot, "mathjsDemo", "entry", "src", "main", "ets", "crcalc", "crcalc.ets");
        const samplePage = path.join(tpcRoot, "SmartRefreshLayout", "entry", "src", "main", "ets", "pages", "PhoenixSample.ets");
        const library = path.join(tpcRoot, "SmartRefreshLayout", "library", "src", "main", "ets", "components", "Refresh.ets");
        expect(classifyOutOfScopePath(helper, tpcRoot)?.rule).toBe("PATH_API_DEMO_ENTRY");
        expect(classifyOutOfScopePath(samplePage, tpcRoot)?.rule).toBe("PATH_API_DEMO_ENTRY");
        expect(classifyOutOfScopePath(library, tpcRoot)).toBeNull();
    });

    test("filters TPC entry components while keeping exported page utilities", () => {
        const tpcRoot = path.join(root, "openharmony_tpc_samples");
        const pages = path.join(tpcRoot, "codec", "entry", "src", "main", "ets", "pages");
        fs.mkdirSync(pages, { recursive: true });
        const demo = path.join(pages, "Index.ets");
        const component = path.join(pages, "Player.ets");
        const utility = path.join(pages, "helper.ts");
        fs.writeFileSync(demo, "@Entry\n@Component\nstruct Index { build() {} }\n");
        fs.writeFileSync(component, "@Component\nexport struct Player { build() {} }\n");
        fs.writeFileSync(utility, "export function decode(value: number) { return value; }\n");
        expect(classifyOutOfScopePath(demo, tpcRoot)?.rule).toBe("PATH_TPC_ENTRY_COMPONENT");
        expect(classifyOutOfScopePath(component, tpcRoot)?.rule).toBe("PATH_TPC_ENTRY_COMPONENT");
        expect(classifyOutOfScopePath(utility, tpcRoot)).toBeNull();
    });

    test("filters directory-external fixture mocks but preserves mock directory and persistent service", () => {
        const service = path.join(root, "src", "main", "ets", "service");
        const persistent = path.join(root, "src", "main", "ets", "persistent");
        const mock = path.join(root, "src", "main", "ets", "mock");
        for (const dir of [service, persistent, mock]) fs.mkdirSync(dir, { recursive: true });
        const data = path.join(service, "MockData.ets");
        const fixture = path.join(service, "MockService.ets");
        const durable = path.join(persistent, "MockService.ets");
        const exempt = path.join(mock, "MockService.ets");
        fs.writeFileSync(data, "export const rows = [{ id: 1 }];\n");
        fs.writeFileSync(fixture, "const records: Map<string, string> = new Map();\ngetRawFile<Result>('users.json');\n");
        fs.writeFileSync(durable, "import { preferences } from '@kit.ArkData';\nconst records: Map<string, string> = new Map();\ngetRawFile<Result>('users.json');\n");
        fs.writeFileSync(exempt, "const records: Map<string, string> = new Map();\ngetRawFile<Result>('users.json');\n");
        expect(classifyOutOfScopePath(data, root)?.rule).toBe("PATH_MOCK_DATA_FILE");
        expect(classifyOutOfScopePath(fixture, root)?.rule).toBe("PATH_FIXTURE_ONLY_MOCK_SERVICE");
        expect(classifyOutOfScopePath(durable, root)).toBeNull();
        expect(classifyOutOfScopePath(exempt, root)).toBeNull();
    });

    test("filters declaration-only files, TPC demo abilities, and source-confirmed mock infrastructure", () => {
        const tpcRoot = path.join(root, "openharmony_tpc_samples");
        const ability = path.join(tpcRoot, "codec", "entry", "src", "main", "ets", "entryability", "EntryAbility.ets");
        const declaration = path.join(tpcRoot, "codec", "api", "common", "function.d.ts");
        const service = path.join(root, "src", "main", "ets", "network");
        fs.mkdirSync(service, { recursive: true });
        const data = path.join(service, "institutions_mock_data.ts");
        const server = path.join(service, "MockServer.ets");
        const ordinary = path.join(service, "MockServer.ts");
        fs.writeFileSync(data, "export const institutions = [{ name: 'demo' }];\n");
        fs.writeFileSync(server, "import { AxiosMock } from './MockUtil'; import { MockDatabase } from './mock/MockDatabase';\n");
        fs.writeFileSync(ordinary, "export class MockServer { save() { return 1; } }\n");
        expect(classifyOutOfScopePath(declaration, tpcRoot)?.rule).toBe("PATH_DECLARATION_ONLY");
        expect(classifyOutOfScopePath(ability, tpcRoot)?.rule).toBe("PATH_TPC_DEMO_ABILITY");
        expect(classifyOutOfScopePath(data, root)?.rule).toBe("PATH_LITERAL_MOCK_DATA");
        expect(classifyOutOfScopePath(server, root)?.rule).toBe("PATH_FIXTURE_MOCK_INFRASTRUCTURE");
        expect(classifyOutOfScopePath(ordinary, root)).toBeNull();
    });

    test("filters functional test apps in OSTest while keeping scenario apps", () => {
        const ostestRoot = path.join(root, "ostest_integration_test");
        const functionalTest = path.join(ostestRoot, "function", "communication", "wifi", "p2ptest", "entry", "src", "main", "ets", "workers", "Worker.ets");
        const scenario = path.join(ostestRoot, "scenario", "MyMusic", "entry", "src", "main", "ets", "viewmodel", "MainViewModel.ets");
        expect(classifyOutOfScopePath(functionalTest, ostestRoot)?.rule).toBe("PATH_INTEGRATION_TEST_FUNCTION");
        expect(classifyOutOfScopePath(scenario, ostestRoot)).toBeNull();
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
