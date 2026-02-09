/**
 * LongMethodCheck 单元测试
 *
 * 测试内容：
 * 1. isUIMethod 判定逻辑（@Builder、ViewTree、build in STRUCT、UI 生命周期）
 * 2. 普通方法阈值检测（默认 50）
 * 3. UI 方法双阈值检测（软阈值 80、硬阈值 120）
 * 4. 配置读取（自定义阈值）
 * 5. severity 覆盖（软阈值降级为 warning）
 */

import { LongMethodCheck } from '../src/Checkers/LongMethodCheck';
import { ClassCategory } from 'arkanalyzer/lib/core/model/ArkClass';

// ============================================================
// Mock 工具
// ============================================================

interface MockMethodOptions {
    name?: string;
    stmtCount?: number;
    hasBuilderDecorator?: boolean;
    hasViewTree?: boolean;
    hasComponentDecorator?: boolean;
    classCategory?: ClassCategory;
    line?: number;
    column?: number;
    filePath?: string;
}

function createMockMethod(options: MockMethodOptions = {}) {
    const {
        name = 'testMethod',
        stmtCount = 10,
        hasBuilderDecorator = false,
        hasViewTree = false,
        hasComponentDecorator = false,
        classCategory = ClassCategory.CLASS,
        line = 1,
        column = 0,
        filePath = '/test/file.ets'
    } = options;

    const stmts = Array.from({ length: stmtCount }, () => ({}));

    const mockClass = {
        getCategory: () => classCategory,
        hasComponentDecorator: () => hasComponentDecorator
    };

    return {
        getName: () => name,
        getLine: () => line,
        getColumn: () => column,
        hasBuilderDecorator: () => hasBuilderDecorator,
        hasViewTree: () => hasViewTree,
        getDeclaringArkClass: () => mockClass,
        getDeclaringArkFile: () => ({
            getFilePath: () => filePath
        }),
        getBody: () => ({
            getCfg: () => ({
                getStmts: () => stmts
            })
        })
    };
}

function createChecker(ruleOptions?: Record<string, unknown>) {
    const checker = new LongMethodCheck();
    (checker as any).rule = {
        ruleId: '@extrulesproject/long-method-check',
        alert: 2,
        option: ruleOptions ? [ruleOptions] : []
    };
    return checker;
}

// ============================================================
// isUIMethod 判定逻辑
// ============================================================

describe('isUIMethod 判定逻辑', () => {
    let checker: LongMethodCheck;

    beforeEach(() => {
        checker = createChecker();
    });

    test('带 @Builder 装饰器的方法应判定为 UI 方法', () => {
        const method = createMockMethod({
            hasBuilderDecorator: true,
            stmtCount: 100
        });
        (checker as any).check(method);
        // @Builder 方法 100 条语句，在软阈值 80 和硬阈值 120 之间
        // 应触发软阈值告警（severity=1）
        expect(checker.issues.length).toBe(1);
        expect(checker.issues[0].defect.severity).toBe(1);
    });

    test('含 ViewTree 的方法应判定为 UI 方法', () => {
        const method = createMockMethod({
            hasViewTree: true,
            stmtCount: 100
        });
        (checker as any).check(method);
        expect(checker.issues.length).toBe(1);
        expect(checker.issues[0].defect.severity).toBe(1);
    });

    test('STRUCT 中的 build 方法应判定为 UI 方法', () => {
        const method = createMockMethod({
            name: 'build',
            classCategory: ClassCategory.STRUCT,
            stmtCount: 100
        });
        (checker as any).check(method);
        expect(checker.issues.length).toBe(1);
        expect(checker.issues[0].defect.severity).toBe(1);
    });

    test('@Component struct 中的 UI 生命周期方法应判定为 UI 方法', () => {
        const lifecycleMethods = ['aboutToAppear', 'aboutToDisappear', 'onPageShow', 'onPageHide', 'onBackPress'];

        for (const methodName of lifecycleMethods) {
            const localChecker = createChecker();
            const method = createMockMethod({
                name: methodName,
                classCategory: ClassCategory.STRUCT,
                hasComponentDecorator: true,
                stmtCount: 100
            });
            (localChecker as any).check(method);
            expect(localChecker.issues.length).toBe(1);
            expect(localChecker.issues[0].defect.severity).toBe(1);
        }
    });

    test('普通 CLASS 中的 build 方法不应判定为 UI 方法', () => {
        const method = createMockMethod({
            name: 'build',
            classCategory: ClassCategory.CLASS,
            stmtCount: 60
        });
        (checker as any).check(method);
        // 60 > 50（普通方法阈值），应触发普通告警（severity=2）
        expect(checker.issues.length).toBe(1);
        expect(checker.issues[0].defect.severity).toBe(2);
    });

    test('STRUCT 中的非 build 非生命周期方法不应判定为 UI 方法（无 @Component）', () => {
        const method = createMockMethod({
            name: 'aboutToAppear',
            classCategory: ClassCategory.STRUCT,
            hasComponentDecorator: false,  // 非 @Component
            stmtCount: 60
        });
        (checker as any).check(method);
        // 非 UI 方法，60 > 50 普通阈值
        expect(checker.issues.length).toBe(1);
        expect(checker.issues[0].defect.severity).toBe(2);
    });

    test('普通方法不应判定为 UI 方法', () => {
        const method = createMockMethod({
            name: 'calculateTotal',
            stmtCount: 60
        });
        (checker as any).check(method);
        // 60 > 50 普通方法阈值
        expect(checker.issues.length).toBe(1);
        expect(checker.issues[0].defect.severity).toBe(2);
    });
});

// ============================================================
// 普通方法阈值检测
// ============================================================

describe('普通方法阈值检测', () => {
    test('语句数 <= 50 不应触发告警', () => {
        const checker = createChecker();
        const method = createMockMethod({ stmtCount: 50 });
        (checker as any).check(method);
        expect(checker.issues.length).toBe(0);
    });

    test('语句数 = 51 应触发告警', () => {
        const checker = createChecker();
        const method = createMockMethod({ stmtCount: 51 });
        (checker as any).check(method);
        expect(checker.issues.length).toBe(1);
    });

    test('语句数 = 0 不应触发告警', () => {
        const checker = createChecker();
        const method = createMockMethod({ stmtCount: 0 });
        (checker as any).check(method);
        expect(checker.issues.length).toBe(0);
    });

    test('无方法体不应触发告警', () => {
        const checker = createChecker();
        const method = createMockMethod({ stmtCount: 100 });
        // 覆盖 getBody 返回 undefined
        (method as any).getBody = () => undefined;
        (checker as any).check(method);
        expect(checker.issues.length).toBe(0);
    });

    test('自定义普通方法阈值 maxStmts=30', () => {
        const checker = createChecker({ maxStmts: 30 });
        const method = createMockMethod({ stmtCount: 31 });
        (checker as any).check(method);
        expect(checker.issues.length).toBe(1);
    });

    test('自定义普通方法阈值 maxStmts=30 边界值不触发', () => {
        const checker = createChecker({ maxStmts: 30 });
        const method = createMockMethod({ stmtCount: 30 });
        (checker as any).check(method);
        expect(checker.issues.length).toBe(0);
    });

    test('兼容旧配置 maxLines', () => {
        const checker = createChecker({ maxLines: 40 });
        const method = createMockMethod({ stmtCount: 41 });
        (checker as any).check(method);
        expect(checker.issues.length).toBe(1);
    });

    test('maxStmts 优先于 maxLines', () => {
        const checker = createChecker({ maxStmts: 30, maxLines: 40 });
        const method = createMockMethod({ stmtCount: 35 });
        (checker as any).check(method);
        // maxStmts=30 生效, 35 > 30
        expect(checker.issues.length).toBe(1);
    });
});

// ============================================================
// UI 方法双阈值检测
// ============================================================

describe('UI 方法双阈值检测', () => {
    test('UI 方法语句数 <= 80 不应触发告警', () => {
        const checker = createChecker();
        const method = createMockMethod({
            hasBuilderDecorator: true,
            stmtCount: 80
        });
        (checker as any).check(method);
        expect(checker.issues.length).toBe(0);
    });

    test('UI 方法语句数 = 81 应触发软阈值告警 (severity=1)', () => {
        const checker = createChecker();
        const method = createMockMethod({
            hasBuilderDecorator: true,
            stmtCount: 81
        });
        (checker as any).check(method);
        expect(checker.issues.length).toBe(1);
        expect(checker.issues[0].defect.severity).toBe(1);
    });

    test('UI 方法语句数 = 120 应触发软阈值告警（边界值）', () => {
        const checker = createChecker();
        const method = createMockMethod({
            hasBuilderDecorator: true,
            stmtCount: 120
        });
        (checker as any).check(method);
        expect(checker.issues.length).toBe(1);
        expect(checker.issues[0].defect.severity).toBe(1);
    });

    test('UI 方法语句数 = 121 应触发硬阈值告警 (severity=2)', () => {
        const checker = createChecker();
        const method = createMockMethod({
            hasBuilderDecorator: true,
            stmtCount: 121
        });
        (checker as any).check(method);
        expect(checker.issues.length).toBe(1);
        expect(checker.issues[0].defect.severity).toBe(2);
    });

    test('UI 方法语句数远超硬阈值 (200) 应触发硬阈值告警', () => {
        const checker = createChecker();
        const method = createMockMethod({
            hasBuilderDecorator: true,
            stmtCount: 200
        });
        (checker as any).check(method);
        expect(checker.issues.length).toBe(1);
        expect(checker.issues[0].defect.severity).toBe(2);
    });
});

// ============================================================
// UI 方法自定义阈值
// ============================================================

describe('UI 方法自定义阈值', () => {
    test('自定义 maxUIStmtsSoft=60, maxUIStmtsHard=100', () => {
        const checker = createChecker({ maxUIStmtsSoft: 60, maxUIStmtsHard: 100 });

        // 61 > 60, 应触发软阈值
        const method1 = createMockMethod({ hasBuilderDecorator: true, stmtCount: 61 });
        (checker as any).check(method1);
        expect(checker.issues.length).toBe(1);
        expect(checker.issues[0].defect.severity).toBe(1);
    });

    test('自定义阈值硬阈值边界', () => {
        const checker = createChecker({ maxUIStmtsSoft: 60, maxUIStmtsHard: 100 });

        // 101 > 100, 应触发硬阈值
        const method = createMockMethod({ hasBuilderDecorator: true, stmtCount: 101 });
        (checker as any).check(method);
        expect(checker.issues.length).toBe(1);
        expect(checker.issues[0].defect.severity).toBe(2);
    });

    test('仅自定义 maxUIStmtsSoft，hardLimit 使用默认 120', () => {
        const checker = createChecker({ maxUIStmtsSoft: 60 });

        // 100 > 60, < 120, 应触发软阈值
        const method = createMockMethod({ hasBuilderDecorator: true, stmtCount: 100 });
        (checker as any).check(method);
        expect(checker.issues.length).toBe(1);
        expect(checker.issues[0].defect.severity).toBe(1);
    });

    test('仅自定义 maxUIStmtsHard，softLimit 使用默认 80', () => {
        const checker = createChecker({ maxUIStmtsHard: 100 });

        // 85 > 80, < 100, 应触发软阈值
        const method = createMockMethod({ hasBuilderDecorator: true, stmtCount: 85 });
        (checker as any).check(method);
        expect(checker.issues.length).toBe(1);
        expect(checker.issues[0].defect.severity).toBe(1);
    });
});

// ============================================================
// 描述信息格式
// ============================================================

describe('告警描述信息', () => {
    test('普通方法告警应包含方法名、实际数和阈值', () => {
        const checker = createChecker();
        const method = createMockMethod({ name: 'processData', stmtCount: 60 });
        (checker as any).check(method);

        expect(checker.issues.length).toBe(1);
        const desc = checker.issues[0].defect.description;
        expect(desc).toContain('processData');
        expect(desc).toContain('60');
        expect(desc).toContain('50');
    });

    test('UI 方法软阈值告警应包含正确的阈值', () => {
        const checker = createChecker();
        const method = createMockMethod({
            name: 'build',
            classCategory: ClassCategory.STRUCT,
            stmtCount: 90
        });
        (checker as any).check(method);

        expect(checker.issues.length).toBe(1);
        const desc = checker.issues[0].defect.description;
        expect(desc).toContain('build');
        expect(desc).toContain('90');
        expect(desc).toContain('80');
    });

    test('UI 方法硬阈值告警应包含正确的阈值', () => {
        const checker = createChecker();
        const method = createMockMethod({
            name: 'build',
            classCategory: ClassCategory.STRUCT,
            stmtCount: 130
        });
        (checker as any).check(method);

        expect(checker.issues.length).toBe(1);
        const desc = checker.issues[0].defect.description;
        expect(desc).toContain('build');
        expect(desc).toContain('130');
        expect(desc).toContain('120');
    });
});

// ============================================================
// 元数据和注册
// ============================================================

describe('LongMethodCheck 元数据和注册', () => {
    test('metaData 应正确定义', () => {
        const checker = new LongMethodCheck();
        expect(checker.metaData).toBeDefined();
        expect(checker.metaData.severity).toBe(2);
        expect(checker.metaData.ruleDocPath).toContain('long-method-check');
    });

    test('issues 初始为空数组', () => {
        const checker = new LongMethodCheck();
        expect(checker.issues).toBeDefined();
        expect(checker.issues.length).toBe(0);
    });

    test('registerMatchers 应返回回调数组', () => {
        const checker = new LongMethodCheck();
        const matchers = checker.registerMatchers();
        expect(Array.isArray(matchers)).toBe(true);
        expect(matchers.length).toBe(1);
        expect(matchers[0].matcher).toBeDefined();
        expect(matchers[0].callback).toBeDefined();
    });
});

// ============================================================
// 多方法累积告警
// ============================================================

describe('多方法累积告警', () => {
    test('多个方法超出阈值应累积多个 issue', () => {
        const checker = createChecker();

        const method1 = createMockMethod({ name: 'methodA', stmtCount: 60 });
        const method2 = createMockMethod({ name: 'methodB', stmtCount: 70 });
        (checker as any).check(method1);
        (checker as any).check(method2);

        expect(checker.issues.length).toBe(2);
    });

    test('普通方法和 UI 方法混合检测', () => {
        const checker = createChecker();

        // 普通方法 60 > 50，触发
        const normalMethod = createMockMethod({ name: 'process', stmtCount: 60 });
        // UI 方法 90 > 80，触发软阈值
        const uiMethod = createMockMethod({
            name: 'build',
            classCategory: ClassCategory.STRUCT,
            stmtCount: 90
        });
        // UI 方法 70 <= 80，不触发
        const uiMethodSmall = createMockMethod({
            name: 'render',
            hasBuilderDecorator: true,
            stmtCount: 70
        });

        (checker as any).check(normalMethod);
        (checker as any).check(uiMethod);
        (checker as any).check(uiMethodSmall);

        expect(checker.issues.length).toBe(2);
        // 普通方法 severity=2
        expect(checker.issues[0].defect.severity).toBe(2);
        // UI 方法软阈值 severity=1
        expect(checker.issues[1].defect.severity).toBe(1);
    });
});

// ============================================================
// 位置信息
// ============================================================

describe('位置信息记录', () => {
    test('告警应包含正确的行号和列号', () => {
        const checker = createChecker();
        const method = createMockMethod({
            name: 'longMethod',
            stmtCount: 60,
            line: 42,
            column: 4,
            filePath: '/src/MyComponent.ets'
        });
        (checker as any).check(method);

        expect(checker.issues.length).toBe(1);
        const defects = checker.issues[0].defect;
        expect(defects.reportLine).toBe(42);
        expect(defects.reportColumn).toBe(4);
        expect(defects.mergeKey).toContain('/src/MyComponent.ets');
    });
});
