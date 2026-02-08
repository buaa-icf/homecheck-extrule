/**
 * 代码克隆检测 单元测试
 * 
 * 测试内容：
 * 1. 规范化函数的正确性
 * 2. 哈希计算的一致性
 * 3. 测试用例目录结构与期望结果
 */

import * as fs from 'fs';
import * as path from 'path';
import { normalizeBasic, normalizeIdentifiers, normalizeLiterals, djb2Hash as simpleHash } from '../src/Checkers/utils';

// 测试用例目录
const SAMPLE_DIR = path.join(__dirname, 'sample/CodeClone');

function isLogStatement(text: string): boolean {
    const trimmed = text.trim();
    const logPattern = /^(console|hilog|Logger)\.\w+\s*\([\s\S]*\)$/i;
    return logPattern.test(trimmed);
}

function filterLogStatements(statements: string[], ignoreLogs: boolean): string[] {
    if (!ignoreLogs) {
        return statements;
    }
    return statements.filter(stmt => !isLogStatement(stmt));
}

describe('测试用例目录结构', () => {
    test('应该存在 positive 目录', () => {
        const posDir = path.join(SAMPLE_DIR, 'positive');
        expect(fs.existsSync(posDir)).toBe(true);
    });

    test('应该存在 negative 目录', () => {
        const negDir = path.join(SAMPLE_DIR, 'negative');
        expect(fs.existsSync(negDir)).toBe(true);
    });

    test('应该存在 expected.json', () => {
        const expectedPath = path.join(SAMPLE_DIR, 'expected.json');
        expect(fs.existsSync(expectedPath)).toBe(true);
    });

    test('positive/type1 目录应包含 FileA.ets 和 FileB.ets', () => {
        const type1Dir = path.join(SAMPLE_DIR, 'positive/type1');
        expect(fs.existsSync(path.join(type1Dir, 'FileA.ets'))).toBe(true);
        expect(fs.existsSync(path.join(type1Dir, 'FileB.ets'))).toBe(true);
    });

    test('positive/type2_identifier 目录应包含 FileD.ets 和 FileE.ets', () => {
        const type2Dir = path.join(SAMPLE_DIR, 'positive/type2_identifier');
        expect(fs.existsSync(path.join(type2Dir, 'FileD.ets'))).toBe(true);
        expect(fs.existsSync(path.join(type2Dir, 'FileE.ets'))).toBe(true);
    });

    test('negative/control 目录应包含 FileC.ets', () => {
        const ctrlDir = path.join(SAMPLE_DIR, 'negative/control');
        expect(fs.existsSync(path.join(ctrlDir, 'FileC.ets'))).toBe(true);
    });

    test('negative/similar_but_different 目录应包含误报测试文件', () => {
        const simDir = path.join(SAMPLE_DIR, 'negative/similar_but_different');
        expect(fs.existsSync(path.join(simDir, 'Calculator.ets'))).toBe(true);
        expect(fs.existsSync(path.join(simDir, 'Counter.ets'))).toBe(true);
    });
});

describe('测试用例标注验证', () => {
    test('所有测试文件应包含期望结果标注', () => {
        const allFiles = [
            'positive/type1/FileA.ets',
            'positive/type1/FileB.ets',
            'positive/type2_identifier/FileD.ets',
            'positive/type2_identifier/FileE.ets',
            'positive/type2_literal/Config1.ets',
            'positive/type2_literal/Config2.ets',
            'negative/control/FileC.ets',
            'negative/similar_but_different/Calculator.ets',
            'negative/similar_but_different/Counter.ets',
        ];

        for (const file of allFiles) {
            const filePath = path.join(SAMPLE_DIR, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            // 支持 @expect: 或 @expect-when 两种格式
            expect(content).toMatch(/@expect/);
        }
    });
});

describe('expected.json 验证', () => {
    let expected: any;

    beforeAll(() => {
        const expectedPath = path.join(SAMPLE_DIR, 'expected.json');
        const content = fs.readFileSync(expectedPath, 'utf-8');
        expected = JSON.parse(content);
    });

    test('positive.type1 应有期望的克隆对', () => {
        expect(expected.positive.type1.expectedClones.length).toBeGreaterThan(0);
    });

    test('positive.type2_identifier 应有期望的克隆对', () => {
        expect(expected.positive.type2_identifier.expectedClones.length).toBeGreaterThan(0);
    });

    test('negative.control 不应有克隆对', () => {
        expect(expected.negative.control.expectedClones.length).toBe(0);
    });

    test('negative.similar_but_different 应说明不同配置下的行为', () => {
        const simDiff = expected.negative.similar_but_different;
        // 检查有 expectedBehavior 字段
        expect(simDiff.expectedBehavior).toBeDefined();
        // 默认配置下不应有克隆
        expect(simDiff.expectedBehavior.ignoreLiterals_false.expectedClones.length).toBe(0);
        // 开启 ignoreLiterals 后会有误报
        expect(simDiff.expectedBehavior.ignoreLiterals_true.expectedClones.length).toBeGreaterThan(0);
    });
});

describe('基础规范化函数', () => {
    test('应去除多余空白', () => {
        const input = 'let   x   =   1';
        const result = normalizeBasic(input);
        expect(result).toBe('let x = 1');
    });

    test('应规范化文件路径', () => {
        const input = '@/path/to/file.ets: SomeClass';
        const result = normalizeBasic(input);
        expect(result).toBe('@FILE: SomeClass');
    });

    test('应规范化匿名类引用', () => {
        const input = '%AC123 some text %AC456';
        const result = normalizeBasic(input);
        expect(result).toBe('%AC some text %AC');
    });
});

describe('标识符规范化函数', () => {
    test('应将变量名替换为占位符', () => {
        const map = new Map<string, string>();
        const input = 'let myVariable = 10';
        const result = normalizeIdentifiers(input, map);
        expect(result).toBe('let ID_1 = 10');
    });

    test('应保持关键字不变', () => {
        const map = new Map<string, string>();
        const input = 'return true';
        const result = normalizeIdentifiers(input, map);
        expect(result).toBe('return true');
    });

    test('相同变量应映射到相同占位符', () => {
        const map = new Map<string, string>();
        const input = 'let foo = bar + foo';
        const result = normalizeIdentifiers(input, map);
        expect(result).toBe('let ID_1 = ID_2 + ID_1');
    });

    test('不同方法相同结构应生成相同模式', () => {
        const map1 = new Map<string, string>();
        const map2 = new Map<string, string>();
        
        const code1 = 'let total = items + count';
        const code2 = 'let result = data + num';
        
        const norm1 = normalizeIdentifiers(code1, map1);
        const norm2 = normalizeIdentifiers(code2, map2);
        
        expect(norm1).toBe(norm2);
    });
});

describe('哈希函数', () => {
    test('相同输入应产生相同哈希', () => {
        const input = 'let x = 1';
        const hash1 = simpleHash(input);
        const hash2 = simpleHash(input);
        expect(hash1).toBe(hash2);
    });

    test('不同输入应产生不同哈希', () => {
        const hash1 = simpleHash('let x = 1');
        const hash2 = simpleHash('let y = 2');
        expect(hash1).not.toBe(hash2);
    });
});

describe('Type-1 克隆检测模拟', () => {
    test('完全相同的代码应产生相同哈希', () => {
        const code1 = [
            'let total = 0',
            'for (let i = 0; i < items.length; i++)',
            'total = total + items[i]',
            'return total'
        ];
        const code2 = [...code1]; // 完全相同

        const hash1 = simpleHash(code1.map(normalizeBasic).join('|'));
        const hash2 = simpleHash(code2.map(normalizeBasic).join('|'));

        expect(hash1).toBe(hash2);
    });

    test('不同的代码应产生不同哈希', () => {
        const code1 = ['let total = 0', 'return total'];
        const code2 = ['let average = 0', 'return average'];

        const hash1 = simpleHash(code1.map(normalizeBasic).join('|'));
        const hash2 = simpleHash(code2.map(normalizeBasic).join('|'));

        expect(hash1).not.toBe(hash2);
    });
});

describe('Type-2 克隆检测模拟', () => {
    test('变量名不同但结构相同的代码应产生相同哈希', () => {
        const code1 = [
            'let total = 0',
            'total = total + item',
            'return total'
        ];
        const code2 = [
            'let result = 0',
            'result = result + element',
            'return result'
        ];

        const map1 = new Map<string, string>();
        const map2 = new Map<string, string>();

        const normalized1 = code1.map(line => normalizeIdentifiers(normalizeBasic(line), map1)).join('|');
        const normalized2 = code2.map(line => normalizeIdentifiers(normalizeBasic(line), map2)).join('|');

        const hash1 = simpleHash(normalized1);
        const hash2 = simpleHash(normalized2);

        expect(hash1).toBe(hash2);
    });

    test('结构不同的代码应产生不同哈希', () => {
        const code1 = ['let x = 0', 'x = x + 1', 'return x'];
        const code2 = ['let y = 0', 'y = y * 2', 'return y']; // 操作符不同

        const map1 = new Map<string, string>();
        const map2 = new Map<string, string>();

        const normalized1 = code1.map(line => normalizeIdentifiers(normalizeBasic(line), map1)).join('|');
        const normalized2 = code2.map(line => normalizeIdentifiers(normalizeBasic(line), map2)).join('|');

        const hash1 = simpleHash(normalized1);
        const hash2 = simpleHash(normalized2);

        expect(hash1).not.toBe(hash2);
    });
});

describe('字面量规范化函数', () => {
    test('应将整数替换为 NUM', () => {
        expect(normalizeLiterals('let x = 123')).toBe('let x = NUM');
        expect(normalizeLiterals('let y = 0')).toBe('let y = NUM');
    });

    test('应将小数替换为 NUM', () => {
        expect(normalizeLiterals('let pi = 3.14')).toBe('let pi = NUM');
        expect(normalizeLiterals('let rate = 0.5')).toBe('let rate = NUM');
    });

    test('应将科学计数法替换为 NUM', () => {
        expect(normalizeLiterals('let big = 1e10')).toBe('let big = NUM');
        expect(normalizeLiterals('let small = 1.5e-3')).toBe('let small = NUM');
    });

    test('应将十六进制数替换为 NUM', () => {
        expect(normalizeLiterals('let color = 0xFF')).toBe('let color = NUM');
        expect(normalizeLiterals('let mask = 0x1A2B')).toBe('let mask = NUM');
    });

    test('应将双引号字符串替换为 STR', () => {
        expect(normalizeLiterals('let msg = "hello world"')).toBe('let msg = STR');
        expect(normalizeLiterals('let empty = ""')).toBe('let empty = STR');
    });

    test('应将单引号字符串替换为 STR', () => {
        expect(normalizeLiterals("let msg = 'hello'")).toBe('let msg = STR');
    });

    test('应同时处理多个字面量', () => {
        const input = 'config.set("timeout", 3000)';
        const result = normalizeLiterals(input);
        expect(result).toBe('config.set(STR, NUM)');
    });
});

describe('Type-2 字面量规范化克隆检测', () => {
    // 模拟完整的 Type-2 规范化流程（含字面量）
    function normalizeType2WithLiterals(code: string[], ignoreLiterals: boolean): string {
        const map = new Map<string, string>();
        return code.map(line => {
            let text = normalizeBasic(line);
            text = normalizeIdentifiers(text, map);
            if (ignoreLiterals) {
                text = normalizeLiterals(text);
            }
            return text;
        }).join('|');
    }

    test('ignoreLiterals=false 时，字面量不同的代码应产生不同哈希', () => {
        const code1 = ['let timeout = 3000', 'return timeout'];
        const code2 = ['let timeout = 5000', 'return timeout'];

        const hash1 = simpleHash(normalizeType2WithLiterals(code1, false));
        const hash2 = simpleHash(normalizeType2WithLiterals(code2, false));

        expect(hash1).not.toBe(hash2);
    });

    test('ignoreLiterals=true 时，字面量不同的代码应产生相同哈希', () => {
        const code1 = ['let timeout = 3000', 'return timeout'];
        const code2 = ['let timeout = 5000', 'return timeout'];

        const hash1 = simpleHash(normalizeType2WithLiterals(code1, true));
        const hash2 = simpleHash(normalizeType2WithLiterals(code2, true));

        expect(hash1).toBe(hash2);
    });

    test('ignoreLiterals=true 时，Config1 和 Config2 结构应相同', () => {
        // 模拟 Config1.ets 和 Config2.ets 中的 getTimeout 方法
        const config1 = [
            'let timeout = 3000',
            'if (timeout < 1000)',
            'timeout = 1000',
            'return timeout'
        ];
        const config2 = [
            'let timeout = 5000',
            'if (timeout < 2000)',
            'timeout = 2000',
            'return timeout'
        ];

        const hash1 = simpleHash(normalizeType2WithLiterals(config1, true));
        const hash2 = simpleHash(normalizeType2WithLiterals(config2, true));

        expect(hash1).toBe(hash2);
    });

    test('误报场景：ignoreLiterals=true 时，结构相同但语义不同的代码会被误检', () => {
        // 模拟两个语义不同但结构相同的方法
        // 注意：使用长度 > 1 的变量名，因为单字母变量不会被规范化
        const calculatorAdd = [
            'let result = num1 + num2',
            'if (result > 1000)',
            'result = 1000',
            'return result'
        ];
        const counterIncrement = [
            'let result = step + max',
            'if (result > 100)',
            'result = 100',
            'return result'
        ];

        // 不开启字面量规范化时，应该不同（因为字面量 1000 vs 100 不同）
        const hash1_noLiteral = simpleHash(normalizeType2WithLiterals(calculatorAdd, false));
        const hash2_noLiteral = simpleHash(normalizeType2WithLiterals(counterIncrement, false));
        expect(hash1_noLiteral).not.toBe(hash2_noLiteral);

        // 开启字面量规范化后，会变成相同（误报）
        const hash1_withLiteral = simpleHash(normalizeType2WithLiterals(calculatorAdd, true));
        const hash2_withLiteral = simpleHash(normalizeType2WithLiterals(counterIncrement, true));
        expect(hash1_withLiteral).toBe(hash2_withLiteral);
    });
});

describe('日志语句判断函数', () => {
    test('应识别 console.log 为纯日志语句', () => {
        expect(isLogStatement('console.log("hello")')).toBe(true);
        expect(isLogStatement('console.info("info")')).toBe(true);
        expect(isLogStatement('console.warn("warning")')).toBe(true);
        expect(isLogStatement('console.error("error")')).toBe(true);
        expect(isLogStatement('console.debug("debug")')).toBe(true);
    });

    test('应识别 hilog.* 为纯日志语句', () => {
        expect(isLogStatement('hilog.info("hello")')).toBe(true);
        expect(isLogStatement('hilog.debug("debug")')).toBe(true);
        expect(isLogStatement('hilog.warn("warning")')).toBe(true);
        expect(isLogStatement('hilog.error("error")')).toBe(true);
    });

    test('应识别 Logger.* 为纯日志语句', () => {
        expect(isLogStatement('Logger.info("hello")')).toBe(true);
        expect(isLogStatement('Logger.debug("debug")')).toBe(true);
        expect(isLogStatement('Logger.warn("warning")')).toBe(true);
        expect(isLogStatement('Logger.error("error")')).toBe(true);
    });

    test('不应将业务逻辑语句识别为日志', () => {
        expect(isLogStatement('let x = 1')).toBe(false);
        expect(isLogStatement('return result')).toBe(false);
        expect(isLogStatement('if (x > 0)')).toBe(false);
        expect(isLogStatement('for (let i = 0; i < 10; i++)')).toBe(false);
    });

    test('不应将嵌在复杂表达式中的日志识别为纯日志语句', () => {
        // 日志嵌在逻辑表达式中，不是纯日志语句
        expect(isLogStatement('doSomething() && console.log("done")')).toBe(false);
        expect(isLogStatement('let result = console.log("test") || fallback()')).toBe(false);
    });
});

describe('日志过滤功能', () => {
    test('ignoreLogs=true 时应过滤掉日志语句', () => {
        const statements = [
            'console.log("开始")',
            'let x = 1',
            'console.log("结束")',
            'return x'
        ];
        const filtered = filterLogStatements(statements, true);
        expect(filtered).toEqual(['let x = 1', 'return x']);
    });

    test('ignoreLogs=false 时不应过滤日志语句', () => {
        const statements = [
            'console.log("开始")',
            'let x = 1',
            'return x'
        ];
        const filtered = filterLogStatements(statements, false);
        expect(filtered).toEqual(statements);
    });

    test('应过滤所有类型的日志', () => {
        const statements = [
            'console.log("console日志")',
            'hilog.info("hilog日志")',
            'Logger.debug("Logger日志")',
            'let x = 1',
            'return x'
        ];
        const filtered = filterLogStatements(statements, true);
        expect(filtered).toEqual(['let x = 1', 'return x']);
    });
});

describe('日志过滤后的克隆检测', () => {
    // 模拟完整的规范化流程（含日志过滤）
    function normalizeWithLogFilter(code: string[], ignoreLogs: boolean): string {
        const filtered = filterLogStatements(code, ignoreLogs);
        return filtered.map(normalizeBasic).join('|');
    }

    test('ignoreLogs=true 时，日志不同但业务逻辑相同的代码应产生相同哈希', () => {
        // 模拟 LogFileA 和 LogFileB
        const logFileA = [
            'console.log("开始处理数据")',
            'let result = 0',
            'result = result + data',
            'console.log("处理完成")',
            'return result'
        ];
        const logFileB = [
            'hilog.info("Starting data processing")',
            'let result = 0',
            'result = result + data',
            'hilog.info("Processing completed")',
            'return result'
        ];

        const hash1 = simpleHash(normalizeWithLogFilter(logFileA, true));
        const hash2 = simpleHash(normalizeWithLogFilter(logFileB, true));

        expect(hash1).toBe(hash2);
    });

    test('ignoreLogs=false 时，日志不同的代码应产生不同哈希', () => {
        const logFileA = [
            'console.log("开始")',
            'let x = 1',
            'return x'
        ];
        const logFileB = [
            'hilog.info("Start")',
            'let x = 1',
            'return x'
        ];

        const hash1 = simpleHash(normalizeWithLogFilter(logFileA, false));
        const hash2 = simpleHash(normalizeWithLogFilter(logFileB, false));

        expect(hash1).not.toBe(hash2);
    });
});

describe('测试用例目录结构（日志过滤）', () => {
    test('positive/type1_with_logs 目录应包含测试文件', () => {
        const dir = path.join(SAMPLE_DIR, 'positive/type1_with_logs');
        expect(fs.existsSync(path.join(dir, 'LogFileA.ets'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'LogFileB.ets'))).toBe(true);
    });

    test('positive/type2_with_logs 目录应包含测试文件', () => {
        const dir = path.join(SAMPLE_DIR, 'positive/type2_with_logs');
        expect(fs.existsSync(path.join(dir, 'Type2LogA.ets'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'Type2LogB.ets'))).toBe(true);
    });
});

describe('expected.json 验证（日志过滤）', () => {
    let expected: any;

    beforeAll(() => {
        const expectedPath = path.join(SAMPLE_DIR, 'expected.json');
        const content = fs.readFileSync(expectedPath, 'utf-8');
        expected = JSON.parse(content);
    });

    test('positive.type1_with_logs 应有期望的克隆对', () => {
        expect(expected.positive.type1_with_logs).toBeDefined();
        expect(expected.positive.type1_with_logs.expectedClones.length).toBeGreaterThan(0);
    });

    test('positive.type2_with_logs 应有期望的克隆对', () => {
        expect(expected.positive.type2_with_logs).toBeDefined();
        expect(expected.positive.type2_with_logs.expectedClones.length).toBeGreaterThan(0);
    });
});

// ==================== 片段级克隆检测测试 ====================

describe('测试用例目录结构（片段级克隆）', () => {
    test('positive/fragment_same_method 目录应包含测试文件', () => {
        const dir = path.join(SAMPLE_DIR, 'positive/fragment_same_method');
        expect(fs.existsSync(dir)).toBe(true);
        expect(fs.existsSync(path.join(dir, 'IntraMethodClone.ets'))).toBe(true);
    });

    test('positive/fragment_same_class 目录应包含测试文件', () => {
        const dir = path.join(SAMPLE_DIR, 'positive/fragment_same_class');
        expect(fs.existsSync(dir)).toBe(true);
        expect(fs.existsSync(path.join(dir, 'InterMethodClone.ets'))).toBe(true);
    });

    test('positive/fragment_different_class 目录应包含测试文件', () => {
        const dir = path.join(SAMPLE_DIR, 'positive/fragment_different_class');
        expect(fs.existsSync(dir)).toBe(true);
        expect(fs.existsSync(path.join(dir, 'ClassA.ets'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'ClassB.ets'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'TopLevelFunc.ets'))).toBe(true);
    });
});

describe('expected.json 验证（片段级克隆）', () => {
    let expected: any;

    beforeAll(() => {
        const expectedPath = path.join(SAMPLE_DIR, 'expected.json');
        const content = fs.readFileSync(expectedPath, 'utf-8');
        expected = JSON.parse(content);
    });

    test('positive.fragment_same_method 应有期望的克隆', () => {
        expect(expected.positive.fragment_same_method).toBeDefined();
        expect(expected.positive.fragment_same_method.scope).toBe('SAME_METHOD');
        expect(expected.positive.fragment_same_method.expectedClones.length).toBeGreaterThan(0);
    });

    test('positive.fragment_same_class 应有期望的克隆', () => {
        expect(expected.positive.fragment_same_class).toBeDefined();
        expect(expected.positive.fragment_same_class.scope).toBe('SAME_CLASS');
        expect(expected.positive.fragment_same_class.expectedClones.length).toBeGreaterThan(0);
    });

    test('positive.fragment_different_class 应有期望的克隆', () => {
        expect(expected.positive.fragment_different_class).toBeDefined();
        expect(expected.positive.fragment_different_class.scope).toBe('DIFFERENT_CLASS');
        expect(expected.positive.fragment_different_class.expectedClones.length).toBeGreaterThan(0);
    });

    test('片段级克隆测试应包含重构建议', () => {
        expect(expected.positive.fragment_same_method.refactoringHint).toBeDefined();
        expect(expected.positive.fragment_same_class.refactoringHint).toBeDefined();
        expect(expected.positive.fragment_different_class.refactoringHint).toBeDefined();
    });
});

describe('片段级克隆测试文件标注验证', () => {
    test('所有片段级测试文件应包含正确的标注', () => {
        const fragmentFiles = [
            'positive/fragment_same_method/IntraMethodClone.ets',
            'positive/fragment_same_class/InterMethodClone.ets',
            'positive/fragment_different_class/ClassA.ets',
            'positive/fragment_different_class/ClassB.ets',
            'positive/fragment_different_class/TopLevelFunc.ets',
        ];

        for (const file of fragmentFiles) {
            const filePath = path.join(SAMPLE_DIR, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            // 应包含 @expect 标注
            expect(content).toMatch(/@expect/);
            // 应包含 @scope 标注
            expect(content).toMatch(/@scope/);
            // 应包含 @clone-type: Fragment
            expect(content).toMatch(/@clone-type:\s*Fragment/);
        }
    });

    test('SAME_METHOD 测试文件应标注为方法内部重复', () => {
        const filePath = path.join(SAMPLE_DIR, 'positive/fragment_same_method/IntraMethodClone.ets');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toMatch(/@scope:\s*SAME_METHOD/);
        expect(content).toContain('方法内部');
    });

    test('SAME_CLASS 测试文件应标注为同一类不同方法', () => {
        const filePath = path.join(SAMPLE_DIR, 'positive/fragment_same_class/InterMethodClone.ets');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toMatch(/@scope:\s*SAME_CLASS/);
        expect(content).toContain('同一个类的不同方法');
    });

    test('DIFFERENT_CLASS 测试文件应标注为不同类', () => {
        const filePath = path.join(SAMPLE_DIR, 'positive/fragment_different_class/ClassA.ets');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toMatch(/@scope:\s*DIFFERENT_CLASS/);
    });

    test('TopLevelFunc.ets 应演示类与独立函数之间的克隆', () => {
        const filePath = path.join(SAMPLE_DIR, 'positive/fragment_different_class/TopLevelFunc.ets');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('独立函数');
        expect(content).toContain('顶级函数');
    });
});
