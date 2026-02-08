/**
 * Tokenizer - ArkTS 源代码词法分析器
 * 
 * 使用 ArkAnalyzer 暴露的 ts.createScanner() 进行词法分析。
 * 该 Scanner 来自 ohos-typescript（OpenHarmony 定制版），原生支持 ArkTS 语法。
 * 
 * @module FragmentDetection/Tokenizer
 */

import { ts } from 'arkanalyzer';
import { Token, TokenType, createToken } from './Token';

/**
 * Tokenizer 配置选项
 */
export interface TokenizerOptions {
    /** 是否跳过注释（默认 true） */
    skipComments?: boolean;
    
    /** 是否规范化标识符（默认 false，用于 Type-2 检测时开启） */
    normalizeIdentifiers?: boolean;
    
    /** 是否规范化字面量（默认 false，用于 Type-2 检测时开启） */
    normalizeLiterals?: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_OPTIONS: TokenizerOptions = {
    skipComments: true,
    normalizeIdentifiers: false,
    normalizeLiterals: false
};

/**
 * 将 TypeScript SyntaxKind 映射为我们的 TokenType
 * 
 * @param kind TypeScript 的 SyntaxKind
 * @returns 我们定义的 TokenType
 */
export function mapSyntaxKindToTokenType(kind: ts.SyntaxKind): TokenType {
    // 字面量（必须在关键字之前判断，因为 true/false/null 在 TS 中也属于关键字范围）
    if (kind === ts.SyntaxKind.NumericLiteral ||
        kind === ts.SyntaxKind.BigIntLiteral ||
        kind === ts.SyntaxKind.StringLiteral ||
        kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
        kind === ts.SyntaxKind.TemplateHead ||
        kind === ts.SyntaxKind.TemplateMiddle ||
        kind === ts.SyntaxKind.TemplateTail ||
        kind === ts.SyntaxKind.RegularExpressionLiteral ||
        kind === ts.SyntaxKind.TrueKeyword ||
        kind === ts.SyntaxKind.FalseKeyword ||
        kind === ts.SyntaxKind.NullKeyword) {
        return TokenType.LITERAL;
    }
    
    // 关键字（true/false/null 已经在上面处理了）
    if (kind >= ts.SyntaxKind.BreakKeyword && kind <= ts.SyntaxKind.OfKeyword) {
        return TokenType.KEYWORD;
    }
    
    // ArkTS 特有关键字：struct
    if (kind === ts.SyntaxKind.StructKeyword) {
        return TokenType.KEYWORD;
    }
    
    // 标识符
    if (kind === ts.SyntaxKind.Identifier) {
        return TokenType.IDENTIFIER;
    }
    
    // 装饰器 @ 符号
    if (kind === ts.SyntaxKind.AtToken) {
        return TokenType.DECORATOR;
    }
    
    // 操作符
    if (isOperatorKind(kind)) {
        return TokenType.OPERATOR;
    }
    
    // 标点符号
    if (isPunctuationKind(kind)) {
        return TokenType.PUNCTUATION;
    }
    
    // 注释
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia ||
        kind === ts.SyntaxKind.MultiLineCommentTrivia) {
        return TokenType.COMMENT;
    }
    
    return TokenType.UNKNOWN;
}

/**
 * 判断是否为操作符类型
 */
function isOperatorKind(kind: ts.SyntaxKind): boolean {
    return (
        kind === ts.SyntaxKind.PlusToken ||
        kind === ts.SyntaxKind.MinusToken ||
        kind === ts.SyntaxKind.AsteriskToken ||
        kind === ts.SyntaxKind.SlashToken ||
        kind === ts.SyntaxKind.PercentToken ||
        kind === ts.SyntaxKind.AsteriskAsteriskToken ||
        kind === ts.SyntaxKind.PlusPlusToken ||
        kind === ts.SyntaxKind.MinusMinusToken ||
        kind === ts.SyntaxKind.LessThanToken ||
        kind === ts.SyntaxKind.LessThanEqualsToken ||
        kind === ts.SyntaxKind.GreaterThanToken ||
        kind === ts.SyntaxKind.GreaterThanEqualsToken ||
        kind === ts.SyntaxKind.EqualsEqualsToken ||
        kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        kind === ts.SyntaxKind.ExclamationEqualsToken ||
        kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        kind === ts.SyntaxKind.EqualsToken ||
        kind === ts.SyntaxKind.PlusEqualsToken ||
        kind === ts.SyntaxKind.MinusEqualsToken ||
        kind === ts.SyntaxKind.AsteriskEqualsToken ||
        kind === ts.SyntaxKind.SlashEqualsToken ||
        kind === ts.SyntaxKind.PercentEqualsToken ||
        kind === ts.SyntaxKind.AmpersandToken ||
        kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        kind === ts.SyntaxKind.BarToken ||
        kind === ts.SyntaxKind.BarBarToken ||
        kind === ts.SyntaxKind.CaretToken ||
        kind === ts.SyntaxKind.TildeToken ||
        kind === ts.SyntaxKind.ExclamationToken ||
        kind === ts.SyntaxKind.QuestionToken ||
        kind === ts.SyntaxKind.QuestionQuestionToken ||
        kind === ts.SyntaxKind.QuestionDotToken ||
        kind === ts.SyntaxKind.DotToken ||
        kind === ts.SyntaxKind.DotDotDotToken ||
        kind === ts.SyntaxKind.EqualsGreaterThanToken
    );
}

/**
 * 判断是否为标点符号类型
 */
function isPunctuationKind(kind: ts.SyntaxKind): boolean {
    return (
        kind === ts.SyntaxKind.OpenParenToken ||
        kind === ts.SyntaxKind.CloseParenToken ||
        kind === ts.SyntaxKind.OpenBraceToken ||
        kind === ts.SyntaxKind.CloseBraceToken ||
        kind === ts.SyntaxKind.OpenBracketToken ||
        kind === ts.SyntaxKind.CloseBracketToken ||
        kind === ts.SyntaxKind.SemicolonToken ||
        kind === ts.SyntaxKind.ColonToken ||
        kind === ts.SyntaxKind.CommaToken
    );
}

/**
 * 将字符偏移量转换为行号和列号
 * 
 * @param text 源代码文本
 * @param offset 字符偏移量
 * @returns { line, column } 行号（1-based）和列号（0-based）
 */
export function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
    let line = 1;
    let lastNewlinePos = -1;
    
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === '\n') {
            line++;
            lastNewlinePos = i;
        }
    }
    
    const column = offset - lastNewlinePos - 1;
    return { line, column };
}

/**
 * Tokenizer 类
 * 
 * 将 ArkTS 源代码转换为 Token 序列
 */
export class Tokenizer {
    private options: TokenizerOptions;
    private identifierCounter: number = 0;
    private identifierMap: Map<string, string> = new Map();
    
    constructor(options: TokenizerOptions = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }
    
    /**
     * 将源代码转换为 Token 序列
     * 
     * @param sourceCode 源代码文本
     * @param filePath 文件路径（可选）
     * @returns Token 数组
     */
    public tokenize(sourceCode: string, filePath?: string): Token[] {
        // 每次 tokenize 重置标识符计数器
        this.identifierCounter = 0;
        this.identifierMap.clear();
        
        const tokens: Token[] = [];
        
        // 创建 Scanner
        const scanner = ts.createScanner(
            ts.ScriptTarget.Latest,
            true  // skipTrivia: 跳过空白
        );
        
        // 设置源代码
        scanner.setText(sourceCode);
        
        // 开启 ArkTS/ETS 模式
        if (typeof scanner.setEtsContext === 'function') {
            scanner.setEtsContext(true);
        }
        
        // 扫描所有 Token
        let kind = scanner.scan();
        
        while (kind !== ts.SyntaxKind.EndOfFileToken) {
            const tokenType = mapSyntaxKindToTokenType(kind);
            
            // 跳过注释（如果配置了）
            if (this.options.skipComments && tokenType === TokenType.COMMENT) {
                kind = scanner.scan();
                continue;
            }
            
            // 跳过未知类型
            if (tokenType === TokenType.UNKNOWN) {
                kind = scanner.scan();
                continue;
            }
            
            // 获取 Token 文本
            let tokenValue = scanner.getTokenText();
            
            // 规范化处理
            tokenValue = this.normalizeToken(tokenValue, tokenType, kind);
            
            // 计算位置
            const pos = scanner.getTokenPos();
            const { line, column } = offsetToLineColumn(sourceCode, pos);
            
            // 创建 Token
            const token = createToken(tokenValue, tokenType, line, column, filePath);
            tokens.push(token);
            
            // 继续扫描
            kind = scanner.scan();
        }
        
        return tokens;
    }
    
    /**
     * 规范化 Token 值
     */
    private normalizeToken(value: string, type: TokenType, kind: ts.SyntaxKind): string {
        // 规范化标识符
        if (this.options.normalizeIdentifiers && type === TokenType.IDENTIFIER) {
            return this.normalizeIdentifier(value);
        }
        
        // 规范化字面量
        if (this.options.normalizeLiterals && type === TokenType.LITERAL) {
            return this.normalizeLiteral(value, kind);
        }
        
        return value;
    }
    
    /**
     * 规范化标识符
     * 
     * 将变量名、函数名等替换为 ID_0, ID_1, ...
     * 相同的标识符会映射到相同的 ID
     * 
     * 注意：单字母标识符不规范化（如 i, j, x），因为它们通常是循环变量
     */
    private normalizeIdentifier(value: string): string {
        // 单字母不规范化
        if (value.length <= 1) {
            return value;
        }
        
        // 检查是否已有映射
        if (this.identifierMap.has(value)) {
            return this.identifierMap.get(value)!;
        }
        
        // 创建新映射
        const normalizedId = `ID_${this.identifierCounter++}`;
        this.identifierMap.set(value, normalizedId);
        return normalizedId;
    }
    
    /**
     * 规范化字面量
     * 
     * - 数字 → NUM
     * - 字符串 → STR
     * - 布尔值 → BOOL
     */
    private normalizeLiteral(value: string, kind: ts.SyntaxKind): string {
        if (kind === ts.SyntaxKind.NumericLiteral || kind === ts.SyntaxKind.BigIntLiteral) {
            return 'NUM';
        }
        
        if (kind === ts.SyntaxKind.StringLiteral ||
            kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
            kind === ts.SyntaxKind.TemplateHead ||
            kind === ts.SyntaxKind.TemplateMiddle ||
            kind === ts.SyntaxKind.TemplateTail) {
            return 'STR';
        }
        
        if (kind === ts.SyntaxKind.TrueKeyword || kind === ts.SyntaxKind.FalseKeyword) {
            return 'BOOL';
        }
        
        if (kind === ts.SyntaxKind.NullKeyword) {
            return 'NULL';
        }
        
        if (kind === ts.SyntaxKind.RegularExpressionLiteral) {
            return 'REGEX';
        }
        
        return value;
    }
    
    /**
     * 获取当前配置
     */
    public getOptions(): TokenizerOptions {
        return { ...this.options };
    }
    
    /**
     * 更新配置
     */
    public setOptions(options: Partial<TokenizerOptions>): void {
        this.options = { ...this.options, ...options };
    }
}

/**
 * 便捷函数：直接 tokenize 源代码
 */
export function tokenize(sourceCode: string, filePath?: string, options?: TokenizerOptions): Token[] {
    const tokenizer = new Tokenizer(options);
    return tokenizer.tokenize(sourceCode, filePath);
}

/**
 * 便捷函数：tokenize 并规范化（用于 Type-2 检测）
 */
export function tokenizeNormalized(sourceCode: string, filePath?: string): Token[] {
    const tokenizer = new Tokenizer({
        normalizeIdentifiers: true,
        normalizeLiterals: true
    });
    return tokenizer.tokenize(sourceCode, filePath);
}
