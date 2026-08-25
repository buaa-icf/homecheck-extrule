import { MatcherTypes } from 'homecheck';
import { File2Check } from 'homecheck/lib/model/File2Check';

function createFileWithMethods(methods: object[]) {
    const arkClass = {
        hasViewTree: () => false,
        getMethods: () => methods,
        getFields: () => []
    };
    return {
        getNamespaces: () => [],
        getAllNamespacesUnderThisFile: () => [],
        getClasses: () => [arkClass]
    };
}

function createChecker(callback: jest.Mock, directMatch: boolean) {
    const matcher = directMatch
        ? { matcherType: MatcherTypes.METHOD, match: () => true }
        : { matcherType: MatcherTypes.METHOD };
    return {
        metaData: {},
        rule: {},
        issues: [],
        check: callback,
        registerMatchers: () => [{ matcher, callback }]
    };
}

describe('HomeCheck File2Check METHOD matcher compatibility', () => {
    test('旧式 matcher 会在每次方法派发时重新扫描当前文件，形成 N×N 回调', async () => {
        const callback = jest.fn();
        const fileCheck = new File2Check();
        fileCheck.arkFile = createFileWithMethods([{}, {}, {}]) as any;
        fileCheck.addChecker('legacy', createChecker(callback, false) as any);

        fileCheck.collectMatcherCallbacks();
        await fileCheck.emitCheck();

        expect(callback).toHaveBeenCalledTimes(9);
    });

    test('实现 match 的 matcher 直接处理当前方法，每个方法只回调一次', async () => {
        const callback = jest.fn();
        const fileCheck = new File2Check();
        fileCheck.arkFile = createFileWithMethods([{}, {}, {}]) as any;
        fileCheck.addChecker('direct', createChecker(callback, true) as any);

        fileCheck.collectMatcherCallbacks();
        await fileCheck.emitCheck();

        expect(callback).toHaveBeenCalledTimes(3);
    });
});
