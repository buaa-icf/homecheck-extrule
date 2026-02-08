/**
 * 片段检测模块 单元测试
 * 
 * 测试内容：
 * 1. Token 接口
 * 2. 滑动窗口
 * 3. 哈希计算和索引
 * 4. 克隆匹配器
 */

import {
    Token,
    TokenType,
    createToken,
    isKeyword,
    isIdentifier,
    isLiteral,
    TokenWindow,
    createSlidingWindows,
    getWindowCount,
    HashIndex,
    djb2Hash,
    computeWindowHash,
    computeTokensHash,
    CloneMatcher
} from '../src/Checkers/FragmentDetection';

// ============================================================
// 辅助函数：创建 mock Token
// ============================================================

function mockToken(value: string, type: TokenType = TokenType.IDENTIFIER, line: number = 1): Token {
    return createToken(value, type, line, 0);
}

function mockTokens(values: string[], startLine: number = 1): Token[] {
    return values.map((v, i) => mockToken(v, TokenType.IDENTIFIER, startLine + Math.floor(i / 5)));
}

// ============================================================
// Token 接口测试
// ============================================================

describe('Token 接口', () => {
    test('createToken 应正确创建 Token', () => {
        const token = createToken('let', TokenType.KEYWORD, 1, 0, 'test.ets');
        
        expect(token.value).toBe('let');
        expect(token.type).toBe(TokenType.KEYWORD);
        expect(token.line).toBe(1);
        expect(token.column).toBe(0);
        expect(token.file).toBe('test.ets');
    });
    
    test('isKeyword 应正确判断关键字', () => {
        const keyword = createToken('let', TokenType.KEYWORD, 1, 0);
        const identifier = createToken('x', TokenType.IDENTIFIER, 1, 4);
        
        expect(isKeyword(keyword)).toBe(true);
        expect(isKeyword(identifier)).toBe(false);
    });
    
    test('isIdentifier 应正确判断标识符', () => {
        const identifier = createToken('myVar', TokenType.IDENTIFIER, 1, 0);
        const keyword = createToken('let', TokenType.KEYWORD, 1, 0);
        
        expect(isIdentifier(identifier)).toBe(true);
        expect(isIdentifier(keyword)).toBe(false);
    });
    
    test('isLiteral 应正确判断字面量', () => {
        const literal = createToken('123', TokenType.LITERAL, 1, 0);
        const identifier = createToken('x', TokenType.IDENTIFIER, 1, 0);
        
        expect(isLiteral(literal)).toBe(true);
        expect(isLiteral(identifier)).toBe(false);
    });
});

// ============================================================
// 滑动窗口测试
// ============================================================

describe('滑动窗口', () => {
    test('createSlidingWindows 应正确创建窗口', () => {
        const tokens = mockTokens(['a', 'b', 'c', 'd', 'e']);
        const windows = createSlidingWindows(tokens, 3);
        
        expect(windows.length).toBe(3);
        
        expect(windows[0].startIndex).toBe(0);
        expect(windows[0].tokens.map(t => t.value)).toEqual(['a', 'b', 'c']);
        
        expect(windows[1].startIndex).toBe(1);
        expect(windows[1].tokens.map(t => t.value)).toEqual(['b', 'c', 'd']);
        
        expect(windows[2].startIndex).toBe(2);
        expect(windows[2].tokens.map(t => t.value)).toEqual(['c', 'd', 'e']);
    });
    
    test('Token 数量不足时应返回空数组', () => {
        const tokens = mockTokens(['a', 'b']);
        const windows = createSlidingWindows(tokens, 5);
        
        expect(windows.length).toBe(0);
    });
    
    test('Token 数量等于窗口大小时应返回 1 个窗口', () => {
        const tokens = mockTokens(['a', 'b', 'c']);
        const windows = createSlidingWindows(tokens, 3);
        
        expect(windows.length).toBe(1);
        expect(windows[0].tokens.map(t => t.value)).toEqual(['a', 'b', 'c']);
    });
    
    test('getWindowCount 应正确计算窗口数量', () => {
        expect(getWindowCount(10, 3)).toBe(8);
        expect(getWindowCount(5, 5)).toBe(1);
        expect(getWindowCount(3, 5)).toBe(0);
        expect(getWindowCount(100, 100)).toBe(1);
    });
    
    test('窗口应包含正确的行号信息', () => {
        const tokens = [
            createToken('let', TokenType.KEYWORD, 1, 0),
            createToken('x', TokenType.IDENTIFIER, 1, 4),
            createToken('=', TokenType.OPERATOR, 1, 6),
            createToken('1', TokenType.LITERAL, 2, 0),
            createToken(';', TokenType.PUNCTUATION, 2, 1)
        ];
        
        const windows = createSlidingWindows(tokens, 3);
        
        expect(windows[0].startLine).toBe(1);
        expect(windows[0].endLine).toBe(1);
        
        expect(windows[2].startLine).toBe(1);
        expect(windows[2].endLine).toBe(2);
    });
});

// ============================================================
// 哈希计算测试
// ============================================================

describe('哈希计算', () => {
    test('djb2Hash 相同输入应产生相同输出', () => {
        const hash1 = djb2Hash('hello world');
        const hash2 = djb2Hash('hello world');
        
        expect(hash1).toBe(hash2);
    });
    
    test('djb2Hash 不同输入应产生不同输出', () => {
        const hash1 = djb2Hash('hello');
        const hash2 = djb2Hash('world');
        
        expect(hash1).not.toBe(hash2);
    });
    
    test('computeTokensHash 应正确计算 Token 数组哈希', () => {
        const tokens1 = mockTokens(['let', 'x', '=', '1']);
        const tokens2 = mockTokens(['let', 'x', '=', '1']);
        const tokens3 = mockTokens(['let', 'y', '=', '2']);
        
        expect(computeTokensHash(tokens1)).toBe(computeTokensHash(tokens2));
        expect(computeTokensHash(tokens1)).not.toBe(computeTokensHash(tokens3));
    });
    
    test('computeWindowHash 应基于 Token value 计算', () => {
        const tokens = mockTokens(['a', 'b', 'c']);
        const windows = createSlidingWindows(tokens, 3);
        
        const hash = computeWindowHash(windows[0]);
        const expectedHash = djb2Hash('a|b|c');
        
        expect(hash).toBe(expectedHash);
    });
});

// ============================================================
// 哈希索引测试
// ============================================================

describe('哈希索引', () => {
    test('add 和 get 应正确存取', () => {
        const index = new HashIndex();
        const location = { file: 'test.ets', startIndex: 0, startLine: 1, endLine: 5 };
        
        index.add('hash1', location);
        
        expect(index.get('hash1')).toEqual([location]);
        expect(index.get('hash2')).toEqual([]);
    });
    
    test('相同哈希应累积位置', () => {
        const index = new HashIndex();
        const loc1 = { file: 'a.ets', startIndex: 0, startLine: 1, endLine: 5 };
        const loc2 = { file: 'b.ets', startIndex: 100, startLine: 10, endLine: 15 };
        
        index.add('hash1', loc1);
        index.add('hash1', loc2);
        
        expect(index.get('hash1').length).toBe(2);
    });
    
    test('getDuplicates 应只返回有重复的哈希', () => {
        const index = new HashIndex();
        
        // 添加一个只出现一次的哈希
        index.add('unique', { file: 'a.ets', startIndex: 0, startLine: 1, endLine: 5 });
        
        // 添加一个出现两次的哈希
        index.add('duplicate', { file: 'a.ets', startIndex: 10, startLine: 10, endLine: 15 });
        index.add('duplicate', { file: 'b.ets', startIndex: 20, startLine: 20, endLine: 25 });
        
        const duplicates = index.getDuplicates();
        
        expect(duplicates.length).toBe(1);
        expect(duplicates[0][0]).toBe('duplicate');
        expect(duplicates[0][1].length).toBe(2);
    });
    
    test('size 应返回不同哈希的数量', () => {
        const index = new HashIndex();
        
        index.add('hash1', { file: 'a.ets', startIndex: 0, startLine: 1, endLine: 5 });
        index.add('hash2', { file: 'a.ets', startIndex: 10, startLine: 10, endLine: 15 });
        index.add('hash1', { file: 'b.ets', startIndex: 20, startLine: 20, endLine: 25 });
        
        expect(index.size()).toBe(2);
    });
    
    test('clear 应清空索引', () => {
        const index = new HashIndex();
        
        index.add('hash1', { file: 'a.ets', startIndex: 0, startLine: 1, endLine: 5 });
        index.clear();
        
        expect(index.size()).toBe(0);
    });
});

// ============================================================
// 克隆匹配器测试
// ============================================================

describe('克隆匹配器', () => {
    test('processFile 应正确处理单个文件', () => {
        const matcher = new CloneMatcher(3);  // 窗口大小 = 3
        const tokens = mockTokens(['a', 'b', 'c', 'd', 'e']);
        
        matcher.processFile(tokens, 'test.ets');
        
        // 5 个 Token，窗口大小 3，应该有 3 个窗口
        expect(matcher.getIndexSize()).toBe(3);
    });
    
    test('应能检测到同一文件内的克隆', () => {
        const matcher = new CloneMatcher(3);
        
        // 创建包含重复片段的 Token 序列
        // ['a', 'b', 'c', 'd', 'a', 'b', 'c', 'e']
        // 位置 0-2 和 位置 4-6 都是 ['a', 'b', 'c']
        const tokens = mockTokens(['a', 'b', 'c', 'd', 'a', 'b', 'c', 'e']);
        
        matcher.processFile(tokens, 'test.ets');
        
        const matches = matcher.getMatches();
        
        // 应该检测到 1 个重复（['a', 'b', 'c']）
        expect(matches.length).toBe(1);
        expect(matches[0].locations.length).toBe(2);
        expect(matches[0].locations[0].startIndex).toBe(0);
        expect(matches[0].locations[1].startIndex).toBe(4);
    });
    
    test('应能检测到跨文件的克隆', () => {
        const matcher = new CloneMatcher(3);
        
        const tokensA = mockTokens(['let', 'x', '=', '1']);
        const tokensB = mockTokens(['let', 'x', '=', '2']);  // 前 3 个相同
        
        matcher.processFile(tokensA, 'a.ets');
        matcher.processFile(tokensB, 'b.ets');
        
        const matches = matcher.getMatches();
        
        // ['let', 'x', '='] 在两个文件中都出现
        expect(matches.length).toBe(1);
        expect(matches[0].locations[0].file).toBe('a.ets');
        expect(matches[0].locations[1].file).toBe('b.ets');
    });
    
    test('getClonePairs 应正确生成克隆对', () => {
        const matcher = new CloneMatcher(3);
        
        // 创建只有一组重复的序列（3 个相同的片段，中间用不同内容隔开）
        // ['a', 'b', 'c', 'x', 'y', 'z', 'a', 'b', 'c', 'p', 'q', 'r', 'a', 'b', 'c']
        const tokens = mockTokens(['a', 'b', 'c', 'x', 'y', 'z', 'a', 'b', 'c', 'p', 'q', 'r', 'a', 'b', 'c']);
        // 位置 0, 6, 12 都是 ['a', 'b', 'c']
        
        matcher.processFile(tokens, 'test.ets');
        
        const matches = matcher.getMatches();
        const pairs = matcher.getClonePairs();
        
        // 验证：只有 ['a', 'b', 'c'] 这一组重复
        // 3 个位置两两配对 = 3 对 (0-6, 0-12, 6-12)
        const abcPairs = pairs.filter(p => 
            p.location1.startIndex === 0 || p.location1.startIndex === 6 || p.location1.startIndex === 12
        );
        expect(abcPairs.length).toBe(3);
    });
    
    test('没有克隆时应返回空数组', () => {
        const matcher = new CloneMatcher(3);
        
        const tokens = mockTokens(['a', 'b', 'c', 'd', 'e']);  // 没有重复
        
        matcher.processFile(tokens, 'test.ets');
        
        expect(matcher.getMatches().length).toBe(0);
        expect(matcher.getClonePairs().length).toBe(0);
    });
    
    test('Token 数量不足时应正常处理', () => {
        const matcher = new CloneMatcher(10);  // 窗口大小 = 10
        
        const tokens = mockTokens(['a', 'b', 'c']);  // 只有 3 个
        
        matcher.processFile(tokens, 'test.ets');
        
        expect(matcher.getIndexSize()).toBe(0);
        expect(matcher.getMatches().length).toBe(0);
    });
    
    test('clear 应清空匹配器状态', () => {
        const matcher = new CloneMatcher(3);
        
        matcher.processFile(mockTokens(['a', 'b', 'c', 'd']), 'test.ets');
        expect(matcher.getIndexSize()).toBeGreaterThan(0);
        
        matcher.clear();
        expect(matcher.getIndexSize()).toBe(0);
    });
});

// ============================================================
// 导入克隆合并器
// ============================================================

import {
    MergedClone,
    isConsecutive,
    createMergedClone,
    extendMergedClone,
    mergeClonePairs,
    CloneMerger
} from '../src/Checkers/FragmentDetection';

import { ClonePair } from '../src/Checkers/FragmentDetection';

// ============================================================
// 克隆合并器测试
// ============================================================

describe('连续匹配检测', () => {
    // 辅助函数：创建克隆对
    function makePair(
        file1: string, startIndex1: number, startLine1: number,
        file2: string, startIndex2: number, startLine2: number
    ): ClonePair {
        return {
            location1: { file: file1, startIndex: startIndex1, startLine: startLine1, endLine: startLine1 + 2 },
            location2: { file: file2, startIndex: startIndex2, startLine: startLine2, endLine: startLine2 + 2 },
            tokenCount: 3
        };
    }
    
    test('相同文件对、连续位置应判定为连续', () => {
        const pair1 = makePair('a.ets', 0, 1, 'b.ets', 10, 5);
        const pair2 = makePair('a.ets', 1, 1, 'b.ets', 11, 5);
        
        expect(isConsecutive(pair1, pair2)).toBe(true);
    });
    
    test('不同文件对应判定为不连续', () => {
        const pair1 = makePair('a.ets', 0, 1, 'b.ets', 10, 5);
        const pair2 = makePair('a.ets', 1, 1, 'c.ets', 11, 5);  // 不同的 file2
        
        expect(isConsecutive(pair1, pair2)).toBe(false);
    });
    
    test('位置不连续应判定为不连续', () => {
        const pair1 = makePair('a.ets', 0, 1, 'b.ets', 10, 5);
        const pair2 = makePair('a.ets', 2, 1, 'b.ets', 12, 5);  // startIndex 相差 2
        
        expect(isConsecutive(pair1, pair2)).toBe(false);
    });
    
    test('只有一边连续应判定为不连续', () => {
        const pair1 = makePair('a.ets', 0, 1, 'b.ets', 10, 5);
        const pair2 = makePair('a.ets', 1, 1, 'b.ets', 15, 5);  // location1 连续，location2 不连续
        
        expect(isConsecutive(pair1, pair2)).toBe(false);
    });
});

describe('片段合并算法', () => {
    function makePair(
        file1: string, startIndex1: number, startLine1: number,
        file2: string, startIndex2: number, startLine2: number
    ): ClonePair {
        return {
            location1: { file: file1, startIndex: startIndex1, startLine: startLine1, endLine: startLine1 + 2 },
            location2: { file: file2, startIndex: startIndex2, startLine: startLine2, endLine: startLine2 + 2 },
            tokenCount: 3
        };
    }
    
    test('空输入应返回空数组', () => {
        const result = mergeClonePairs([], 3);
        expect(result).toEqual([]);
    });
    
    test('单个克隆对应返回单个合并结果', () => {
        const pairs = [makePair('a.ets', 0, 1, 'b.ets', 10, 5)];
        const result = mergeClonePairs(pairs, 3);
        
        expect(result.length).toBe(1);
        expect(result[0].tokenCount).toBe(3);
        expect(result[0].location1.startIndex).toBe(0);
        expect(result[0].location2.startIndex).toBe(10);
    });
    
    test('连续克隆对应合并成一个', () => {
        const pairs = [
            makePair('a.ets', 0, 1, 'b.ets', 10, 5),
            makePair('a.ets', 1, 1, 'b.ets', 11, 5),
            makePair('a.ets', 2, 1, 'b.ets', 12, 5)
        ];
        const result = mergeClonePairs(pairs, 3);
        
        expect(result.length).toBe(1);
        expect(result[0].tokenCount).toBe(5);  // 3 + 2 = 5（窗口大小 + 滑动次数）
        expect(result[0].location1.startIndex).toBe(0);
        expect(result[0].location1.endIndex).toBe(4);  // 0 + 5 - 1 = 4
    });
    
    test('不连续克隆对应分别合并', () => {
        const pairs = [
            makePair('a.ets', 0, 1, 'b.ets', 10, 5),
            makePair('a.ets', 1, 1, 'b.ets', 11, 5),
            // 断开
            makePair('a.ets', 10, 10, 'b.ets', 20, 15),
            makePair('a.ets', 11, 10, 'b.ets', 21, 15)
        ];
        const result = mergeClonePairs(pairs, 3);
        
        expect(result.length).toBe(2);
        expect(result[0].location1.startIndex).toBe(0);
        expect(result[1].location1.startIndex).toBe(10);
    });
    
    test('不同文件对应分别合并', () => {
        const pairs = [
            makePair('a.ets', 0, 1, 'b.ets', 10, 5),
            makePair('a.ets', 1, 1, 'c.ets', 11, 5)  // 不同的 file2
        ];
        const result = mergeClonePairs(pairs, 3);
        
        expect(result.length).toBe(2);
    });
    
    test('乱序输入应正确排序后合并', () => {
        const pairs = [
            makePair('a.ets', 2, 1, 'b.ets', 12, 5),  // 第 3 个
            makePair('a.ets', 0, 1, 'b.ets', 10, 5),  // 第 1 个
            makePair('a.ets', 1, 1, 'b.ets', 11, 5)   // 第 2 个
        ];
        const result = mergeClonePairs(pairs, 3);
        
        expect(result.length).toBe(1);
        expect(result[0].tokenCount).toBe(5);
    });
});

describe('CloneMerger 类', () => {
    test('应正确合并克隆对', () => {
        const merger = new CloneMerger(3);
        
        const pairs: ClonePair[] = [
            {
                location1: { file: 'a.ets', startIndex: 0, startLine: 1, endLine: 3 },
                location2: { file: 'b.ets', startIndex: 10, startLine: 5, endLine: 7 },
                tokenCount: 3
            },
            {
                location1: { file: 'a.ets', startIndex: 1, startLine: 1, endLine: 3 },
                location2: { file: 'b.ets', startIndex: 11, startLine: 5, endLine: 7 },
                tokenCount: 3
            }
        ];
        
        const result = merger.merge(pairs);
        
        expect(result.length).toBe(1);
        expect(result[0].tokenCount).toBe(4);
    });
    
    test('getWindowSize 应返回窗口大小', () => {
        const merger = new CloneMerger(100);
        expect(merger.getWindowSize()).toBe(100);
    });
});

// ============================================================
// 第三阶段：Tokenizer 测试
// ============================================================

import {
    Tokenizer,
    tokenize,
    tokenizeNormalized,
    mapSyntaxKindToTokenType,
    offsetToLineColumn
} from '../src/Checkers/FragmentDetection/Tokenizer';
import { ts } from 'arkanalyzer';

describe('Tokenizer - offsetToLineColumn 位置转换', () => {
    test('单行代码的位置计算', () => {
        const code = 'let x = 1;';
        
        expect(offsetToLineColumn(code, 0)).toEqual({ line: 1, column: 0 });  // 'l'
        expect(offsetToLineColumn(code, 4)).toEqual({ line: 1, column: 4 });  // 'x'
        expect(offsetToLineColumn(code, 8)).toEqual({ line: 1, column: 8 });  // '1'
    });
    
    test('多行代码的位置计算', () => {
        const code = 'let x = 1;\nlet y = 2;\nlet z = 3;';
        
        expect(offsetToLineColumn(code, 0)).toEqual({ line: 1, column: 0 });   // 第1行 'l'
        expect(offsetToLineColumn(code, 11)).toEqual({ line: 2, column: 0 });  // 第2行 'l'
        expect(offsetToLineColumn(code, 22)).toEqual({ line: 3, column: 0 });  // 第3行 'l'
    });
    
    test('空代码的位置计算', () => {
        expect(offsetToLineColumn('', 0)).toEqual({ line: 1, column: 0 });
    });
});

describe('Tokenizer - mapSyntaxKindToTokenType 类型映射', () => {
    test('关键字映射', () => {
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.LetKeyword)).toBe(TokenType.KEYWORD);
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.ConstKeyword)).toBe(TokenType.KEYWORD);
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.IfKeyword)).toBe(TokenType.KEYWORD);
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.ReturnKeyword)).toBe(TokenType.KEYWORD);
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.FunctionKeyword)).toBe(TokenType.KEYWORD);
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.ClassKeyword)).toBe(TokenType.KEYWORD);
    });
    
    test('struct 关键字映射（ArkTS 特有）', () => {
        // struct 是 ArkTS 特有的关键字
        if (ts.SyntaxKind.StructKeyword !== undefined) {
            expect(mapSyntaxKindToTokenType(ts.SyntaxKind.StructKeyword)).toBe(TokenType.KEYWORD);
        }
    });
    
    test('标识符映射', () => {
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.Identifier)).toBe(TokenType.IDENTIFIER);
    });
    
    test('字面量映射', () => {
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.NumericLiteral)).toBe(TokenType.LITERAL);
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.StringLiteral)).toBe(TokenType.LITERAL);
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.TrueKeyword)).toBe(TokenType.LITERAL);
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.FalseKeyword)).toBe(TokenType.LITERAL);
    });
    
    test('操作符映射', () => {
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.PlusToken)).toBe(TokenType.OPERATOR);
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.MinusToken)).toBe(TokenType.OPERATOR);
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.EqualsToken)).toBe(TokenType.OPERATOR);
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.EqualsEqualsEqualsToken)).toBe(TokenType.OPERATOR);
    });
    
    test('标点符号映射', () => {
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.OpenParenToken)).toBe(TokenType.PUNCTUATION);
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.CloseParenToken)).toBe(TokenType.PUNCTUATION);
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.OpenBraceToken)).toBe(TokenType.PUNCTUATION);
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.CloseBraceToken)).toBe(TokenType.PUNCTUATION);
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.SemicolonToken)).toBe(TokenType.PUNCTUATION);
    });
    
    test('装饰器 @ 符号映射', () => {
        expect(mapSyntaxKindToTokenType(ts.SyntaxKind.AtToken)).toBe(TokenType.DECORATOR);
    });
});

describe('Tokenizer - 基础 tokenize 功能', () => {
    test('简单变量声明', () => {
        const code = 'let x = 1;';
        const tokens = tokenize(code);
        
        expect(tokens.length).toBeGreaterThan(0);
        
        // 验证 Token 类型
        const values = tokens.map(t => t.value);
        expect(values).toContain('let');
        expect(values).toContain('x');
        expect(values).toContain('=');
        expect(values).toContain('1');
        expect(values).toContain(';');
    });
    
    test('函数声明', () => {
        const code = 'function add(a, b) { return a + b; }';
        const tokens = tokenize(code);
        
        const values = tokens.map(t => t.value);
        expect(values).toContain('function');
        expect(values).toContain('add');
        expect(values).toContain('return');
        expect(values).toContain('+');
    });
    
    test('if 语句', () => {
        const code = 'if (x > 0) { return true; }';
        const tokens = tokenize(code);
        
        const values = tokens.map(t => t.value);
        expect(values).toContain('if');
        expect(values).toContain('x');
        expect(values).toContain('>');
        expect(values).toContain('0');
        expect(values).toContain('return');
        expect(values).toContain('true');
    });
    
    test('类声明', () => {
        const code = 'class MyClass { constructor() {} }';
        const tokens = tokenize(code);
        
        const values = tokens.map(t => t.value);
        expect(values).toContain('class');
        expect(values).toContain('MyClass');
        expect(values).toContain('constructor');
    });
    
    test('箭头函数', () => {
        const code = 'const fn = (x) => x * 2;';
        const tokens = tokenize(code);
        
        const values = tokens.map(t => t.value);
        expect(values).toContain('const');
        expect(values).toContain('fn');
        expect(values).toContain('=>');
        expect(values).toContain('*');
    });
    
    test('文件路径记录', () => {
        const code = 'let x = 1;';
        const tokens = tokenize(code, 'test.ets');
        
        tokens.forEach(token => {
            expect(token.file).toBe('test.ets');
        });
    });
    
    test('行号和列号记录', () => {
        const code = 'let x = 1;\nlet y = 2;';
        const tokens = tokenize(code);
        
        // 第一行的 token
        const letToken1 = tokens.find(t => t.value === 'let' && t.line === 1);
        expect(letToken1).toBeDefined();
        expect(letToken1?.line).toBe(1);
        expect(letToken1?.column).toBe(0);
        
        // 第二行的 token
        const letToken2 = tokens.find(t => t.value === 'let' && t.line === 2);
        expect(letToken2).toBeDefined();
        expect(letToken2?.line).toBe(2);
    });
});

describe('Tokenizer - ArkTS 特有语法', () => {
    test('装饰器语法 @Component', () => {
        const code = '@Component struct MyComponent {}';
        const tokens = tokenize(code);
        
        const values = tokens.map(t => t.value);
        expect(values).toContain('@');
        expect(values).toContain('Component');
        
        // 验证 @ 被识别为 DECORATOR 类型
        const atToken = tokens.find(t => t.value === '@');
        expect(atToken?.type).toBe(TokenType.DECORATOR);
    });
    
    test('@State 装饰器', () => {
        const code = '@State count: number = 0;';
        const tokens = tokenize(code);
        
        const values = tokens.map(t => t.value);
        expect(values).toContain('@');
        expect(values).toContain('State');
        expect(values).toContain('count');
        expect(values).toContain('number');
    });
    
    test('struct 关键字（ArkTS 特有）', () => {
        const code = 'struct MyStruct { build() {} }';
        const tokens = tokenize(code);
        
        const values = tokens.map(t => t.value);
        // struct 可能被识别为关键字或标识符，取决于 ohos-typescript 的实现
        expect(values).toContain('struct');
        expect(values).toContain('MyStruct');
        expect(values).toContain('build');
    });
    
    test('完整的 ArkTS 组件', () => {
        const code = `
@Entry
@Component
struct HelloWorld {
    @State message: string = "Hello";
    
    build() {
        Column() {
            Text(this.message)
        }
    }
}`;
        const tokens = tokenize(code);
        
        const values = tokens.map(t => t.value);
        expect(values).toContain('@');
        expect(values).toContain('Entry');
        expect(values).toContain('Component');
        expect(values).toContain('struct');
        expect(values).toContain('HelloWorld');
        expect(values).toContain('State');
        expect(values).toContain('message');
        expect(values).toContain('build');
        expect(values).toContain('Column');
        expect(values).toContain('Text');
    });
});

describe('Tokenizer - 规范化功能', () => {
    test('标识符规范化', () => {
        const code = 'let myVariable = 1; let anotherVar = myVariable;';
        const tokens = tokenize(code, undefined, { normalizeIdentifiers: true });
        
        const values = tokens.map(t => t.value);
        
        // myVariable 应该被规范化为 ID_0
        // anotherVar 应该被规范化为 ID_1
        // 相同的标识符应该映射到相同的 ID
        expect(values).toContain('ID_0');
        expect(values).toContain('ID_1');
        
        // 验证相同标识符映射到相同 ID
        const idTokens = tokens.filter(t => t.value.startsWith('ID_'));
        const firstOccurrence = idTokens[0].value;
        const thirdOccurrence = idTokens[2].value;  // myVariable 的第二次出现
        expect(firstOccurrence).toBe(thirdOccurrence);
    });
    
    test('单字母标识符不规范化', () => {
        const code = 'for (let i = 0; i < n; i++) {}';
        const tokens = tokenize(code, undefined, { normalizeIdentifiers: true });
        
        const values = tokens.map(t => t.value);
        
        // i 是单字母，不应该被规范化
        expect(values).toContain('i');
        // n 是单字母，不应该被规范化
        expect(values).toContain('n');
    });
    
    test('字面量规范化 - 数字', () => {
        const code = 'let x = 123; let y = 3.14; let z = 0xFF;';
        const tokens = tokenize(code, undefined, { normalizeLiterals: true });
        
        const values = tokens.map(t => t.value);
        
        // 所有数字应该被规范化为 NUM
        const numTokens = values.filter(v => v === 'NUM');
        expect(numTokens.length).toBe(3);
    });
    
    test('字面量规范化 - 字符串', () => {
        const code = 'let s1 = "hello"; let s2 = \'world\';';
        const tokens = tokenize(code, undefined, { normalizeLiterals: true });
        
        const values = tokens.map(t => t.value);
        
        // 所有字符串应该被规范化为 STR
        const strTokens = values.filter(v => v === 'STR');
        expect(strTokens.length).toBe(2);
    });
    
    test('字面量规范化 - 布尔值', () => {
        const code = 'let a = true; let b = false;';
        const tokens = tokenize(code, undefined, { normalizeLiterals: true });
        
        const values = tokens.map(t => t.value);
        
        // 布尔值应该被规范化为 BOOL
        const boolTokens = values.filter(v => v === 'BOOL');
        expect(boolTokens.length).toBe(2);
    });
    
    test('tokenizeNormalized 便捷函数', () => {
        const code = 'let myVar = 123;';
        const tokens = tokenizeNormalized(code);
        
        const values = tokens.map(t => t.value);
        
        // 标识符和字面量都应该被规范化
        expect(values).toContain('ID_0');
        expect(values).toContain('NUM');
    });
});

describe('Tokenizer - Tokenizer 类', () => {
    test('创建默认配置的 Tokenizer', () => {
        const tokenizer = new Tokenizer();
        const options = tokenizer.getOptions();
        
        expect(options.skipComments).toBe(true);
        expect(options.normalizeIdentifiers).toBe(false);
        expect(options.normalizeLiterals).toBe(false);
    });
    
    test('创建自定义配置的 Tokenizer', () => {
        const tokenizer = new Tokenizer({
            normalizeIdentifiers: true,
            normalizeLiterals: true
        });
        const options = tokenizer.getOptions();
        
        expect(options.normalizeIdentifiers).toBe(true);
        expect(options.normalizeLiterals).toBe(true);
    });
    
    test('动态更新配置', () => {
        const tokenizer = new Tokenizer();
        
        tokenizer.setOptions({ normalizeIdentifiers: true });
        const options = tokenizer.getOptions();
        
        expect(options.normalizeIdentifiers).toBe(true);
        expect(options.normalizeLiterals).toBe(false);
    });
    
    test('多次 tokenize 重置标识符映射', () => {
        const tokenizer = new Tokenizer({ normalizeIdentifiers: true });
        
        // 第一次 tokenize
        const tokens1 = tokenizer.tokenize('let myVar = 1;');
        const values1 = tokens1.map(t => t.value);
        expect(values1).toContain('ID_0');
        
        // 第二次 tokenize - 应该重置计数器
        const tokens2 = tokenizer.tokenize('let anotherVar = 2;');
        const values2 = tokens2.map(t => t.value);
        // 新的 tokenize 应该从 ID_0 开始
        expect(values2).toContain('ID_0');
    });
});

describe('Tokenizer - 边界情况', () => {
    test('空代码', () => {
        const tokens = tokenize('');
        expect(tokens.length).toBe(0);
    });
    
    test('只有空白', () => {
        const tokens = tokenize('   \n\t\n   ');
        expect(tokens.length).toBe(0);
    });
    
    test('只有注释', () => {
        const tokens = tokenize('// this is a comment');
        // 默认跳过注释
        expect(tokens.length).toBe(0);
    });
    
    test('多行注释', () => {
        const tokens = tokenize('/* multi\nline\ncomment */');
        expect(tokens.length).toBe(0);
    });
    
    test('模板字符串', () => {
        const code = 'let s = `hello ${name}`;';
        const tokens = tokenize(code);
        
        // 应该能正确处理模板字符串
        expect(tokens.length).toBeGreaterThan(0);
    });
    
    test('正则表达式', () => {
        const code = 'let re = /abc/g;';
        const tokens = tokenize(code);
        
        expect(tokens.length).toBeGreaterThan(0);
    });
});

// ==================== CodeCloneFragmentCheck 测试 ====================

import { CodeCloneFragmentCheck, CloneScope, CodeLocation, FragmentCloneReport } from '../src/Checkers/CodeCloneFragmentCheck';

describe('CodeCloneFragmentCheck - CloneScope 枚举', () => {
    test('CloneScope 枚举值正确', () => {
        expect(CloneScope.SAME_METHOD).toBe('SAME_METHOD');
        expect(CloneScope.SAME_CLASS).toBe('SAME_CLASS');
        expect(CloneScope.DIFFERENT_CLASS).toBe('DIFFERENT_CLASS');
    });
});

describe('CodeCloneFragmentCheck - 规则类创建', () => {
    test('创建 CodeCloneFragmentCheck 实例', () => {
        const check = new CodeCloneFragmentCheck();
        
        expect(check).toBeDefined();
        expect(check.metaData).toBeDefined();
        expect(check.metaData.severity).toBe(2);
        expect(check.metaData.description).toContain('Code Clone Fragment');
    });
    
    test('issues 数组初始为空', () => {
        const check = new CodeCloneFragmentCheck();
        
        expect(check.issues).toBeDefined();
        expect(check.issues.length).toBe(0);
    });
    
    test('registerMatchers 返回回调数组', () => {
        const check = new CodeCloneFragmentCheck();
        const matchers = check.registerMatchers();
        
        expect(Array.isArray(matchers)).toBe(true);
        expect(matchers.length).toBeGreaterThan(0);
        expect(matchers[0].matcher).toBeDefined();
        expect(matchers[0].callback).toBeDefined();
    });
});

describe('CodeCloneFragmentCheck - 范围判定逻辑', () => {
    // 创建一个测试用的私有方法访问器
    const createTestCheck = () => {
        const check = new CodeCloneFragmentCheck();
        return check as any; // 允许访问私有方法
    };
    
    test('同一方法内 - SAME_METHOD', () => {
        const check = createTestCheck();
        
        const loc1: CodeLocation = {
            file: '/test/file.ts',
            startLine: 10,
            endLine: 15,
            className: 'MyClass',
            methodName: 'myMethod'
        };
        const loc2: CodeLocation = {
            file: '/test/file.ts',
            startLine: 20,
            endLine: 25,
            className: 'MyClass',
            methodName: 'myMethod'
        };
        
        const scope = check.determineScope(loc1, loc2);
        expect(scope).toBe(CloneScope.SAME_METHOD);
    });
    
    test('同一类不同方法 - SAME_CLASS', () => {
        const check = createTestCheck();
        
        const loc1: CodeLocation = {
            file: '/test/file.ts',
            startLine: 10,
            endLine: 15,
            className: 'MyClass',
            methodName: 'method1'
        };
        const loc2: CodeLocation = {
            file: '/test/file.ts',
            startLine: 30,
            endLine: 35,
            className: 'MyClass',
            methodName: 'method2'
        };
        
        const scope = check.determineScope(loc1, loc2);
        expect(scope).toBe(CloneScope.SAME_CLASS);
    });
    
    test('不同类 - DIFFERENT_CLASS', () => {
        const check = createTestCheck();
        
        const loc1: CodeLocation = {
            file: '/test/file1.ts',
            startLine: 10,
            endLine: 15,
            className: 'ClassA',
            methodName: 'method1'
        };
        const loc2: CodeLocation = {
            file: '/test/file2.ts',
            startLine: 10,
            endLine: 15,
            className: 'ClassB',
            methodName: 'method1'
        };
        
        const scope = check.determineScope(loc1, loc2);
        expect(scope).toBe(CloneScope.DIFFERENT_CLASS);
    });
    
    test('没有方法名 - DIFFERENT_CLASS', () => {
        const check = createTestCheck();
        
        const loc1: CodeLocation = {
            file: '/test/file.ts',
            startLine: 10,
            endLine: 15
            // 没有 className 和 methodName
        };
        const loc2: CodeLocation = {
            file: '/test/file.ts',
            startLine: 30,
            endLine: 35
        };
        
        const scope = check.determineScope(loc1, loc2);
        expect(scope).toBe(CloneScope.DIFFERENT_CLASS);
    });
});

describe('CodeCloneFragmentCheck - 克隆类型判定', () => {
    test('未规范化 - Type-1', () => {
        const check = new CodeCloneFragmentCheck() as any;
        check.rule = {
            option: [{ normalizeIdentifiers: false, normalizeLiterals: false }]
        };
        check.beforeCheck();
        
        const type = check.determineCloneType();
        expect(type).toBe('Type-1');
    });
    
    test('规范化标识符 - Type-2', () => {
        const check = new CodeCloneFragmentCheck() as any;
        check.rule = {
            option: [{ normalizeIdentifiers: true, normalizeLiterals: false }]
        };
        check.beforeCheck();
        
        const type = check.determineCloneType();
        expect(type).toBe('Type-2');
    });
    
    test('规范化字面量 - Type-2', () => {
        const check = new CodeCloneFragmentCheck() as any;
        check.rule = {
            option: [{ normalizeIdentifiers: false, normalizeLiterals: true }]
        };
        check.beforeCheck();
        
        const type = check.determineCloneType();
        expect(type).toBe('Type-2');
    });
    
    test('两者都规范化 - Type-2', () => {
        const check = new CodeCloneFragmentCheck() as any;
        check.rule = {
            option: [{ normalizeIdentifiers: true, normalizeLiterals: true }]
        };
        check.beforeCheck();
        
        const type = check.determineCloneType();
        expect(type).toBe('Type-2');
    });
});

describe('CodeCloneFragmentCheck - 配置读取', () => {
    test('默认 minimumTokens', () => {
        const check = new CodeCloneFragmentCheck() as any;
        
        const value = check.getMinimumTokens();
        expect(value).toBe(100);
    });
    
    test('自定义 minimumTokens', () => {
        const check = new CodeCloneFragmentCheck() as any;
        check.rule = {
            option: [{ minimumTokens: 50 }]
        };
        
        const value = check.getMinimumTokens();
        expect(value).toBe(50);
    });
    
    test('默认 normalizeIdentifiers', () => {
        const check = new CodeCloneFragmentCheck() as any;
        
        const value = check.getNormalizeIdentifiers();
        expect(value).toBe(true);
    });
    
    test('自定义 normalizeIdentifiers', () => {
        const check = new CodeCloneFragmentCheck() as any;
        check.rule = {
            option: [{ normalizeIdentifiers: false }]
        };
        
        const value = check.getNormalizeIdentifiers();
        expect(value).toBe(false);
    });
    
    test('默认 normalizeLiterals', () => {
        const check = new CodeCloneFragmentCheck() as any;
        
        const value = check.getNormalizeLiterals();
        expect(value).toBe(false);
    });
    
    test('自定义 normalizeLiterals', () => {
        const check = new CodeCloneFragmentCheck() as any;
        check.rule = {
            option: [{ normalizeLiterals: true }]
        };
        
        const value = check.getNormalizeLiterals();
        expect(value).toBe(true);
    });
});

describe('CodeCloneFragmentCheck - 描述格式化', () => {
    test('格式化范围描述 - SAME_METHOD', () => {
        const check = new CodeCloneFragmentCheck() as any;
        
        const desc = check.getScopeDescription(CloneScope.SAME_METHOD);
        expect(desc).toBe('same method');
    });
    
    test('格式化范围描述 - SAME_CLASS', () => {
        const check = new CodeCloneFragmentCheck() as any;
        
        const desc = check.getScopeDescription(CloneScope.SAME_CLASS);
        expect(desc).toBe('same class');
    });
    
    test('格式化范围描述 - DIFFERENT_CLASS', () => {
        const check = new CodeCloneFragmentCheck() as any;
        
        const desc = check.getScopeDescription(CloneScope.DIFFERENT_CLASS);
        expect(desc).toBe('different classes');
    });
    
    test('格式化位置 - 带类和方法', () => {
        const check = new CodeCloneFragmentCheck() as any;
        
        const loc: CodeLocation = {
            file: '/path/to/file.ts',
            startLine: 10,
            endLine: 20,
            className: 'MyClass',
            methodName: 'myMethod'
        };
        
        const formatted = check.formatLocation(loc);
        expect(formatted).toBe('file.ts > MyClass.myMethod():10-20');
    });
    
    test('格式化位置 - 只有类', () => {
        const check = new CodeCloneFragmentCheck() as any;
        
        const loc: CodeLocation = {
            file: '/path/to/file.ts',
            startLine: 10,
            endLine: 20,
            className: 'MyClass'
        };
        
        const formatted = check.formatLocation(loc);
        expect(formatted).toBe('file.ts > MyClass:10-20');
    });
    
    test('格式化位置 - 无类无方法', () => {
        const check = new CodeCloneFragmentCheck() as any;
        
        const loc: CodeLocation = {
            file: '/path/to/file.ts',
            startLine: 10,
            endLine: 20
        };
        
        const formatted = check.formatLocation(loc);
        expect(formatted).toBe('file.ts:10-20');
    });
    
    test('格式化完整描述', () => {
        const check = new CodeCloneFragmentCheck() as any;
        
        const report: FragmentCloneReport = {
            cloneType: 'Type-2',
            scope: CloneScope.SAME_CLASS,
            location1: {
                file: '/path/to/file.ts',
                startLine: 10,
                endLine: 20,
                className: 'MyClass',
                methodName: 'method1'
            },
            location2: {
                file: '/path/to/file.ts',
                startLine: 30,
                endLine: 40,
                className: 'MyClass',
                methodName: 'method2'
            },
            tokenCount: 150,
            lineCount: 11
        };
        
        const desc = check.formatDescription(report);
        expect(desc).toContain('Code Clone Type-2');
        expect(desc).toContain('same class');
        expect(desc).toContain('150 tokens');
        expect(desc).toContain('11 lines');
    });
});
