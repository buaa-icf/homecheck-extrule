/**
 * Token 类型枚举
 * 
 * 定义代码中各种 Token 的类型
 */
export enum TokenType {
    /** 关键字：let, const, if, else, for, while, return, function, class, ... */
    KEYWORD = 'KEYWORD',
    
    /** 标识符：变量名、函数名、类名等 */
    IDENTIFIER = 'IDENTIFIER',
    
    /** 字面量：数字、字符串、布尔值 */
    LITERAL = 'LITERAL',
    
    /** 操作符：+, -, *, /, =, ==, ===, <, >, !, &, |, ... */
    OPERATOR = 'OPERATOR',
    
    /** 标点符号：(, ), {, }, [, ], ;, :, , */
    PUNCTUATION = 'PUNCTUATION',
    
    /** 装饰器：@Component, @State, @Entry, ... */
    DECORATOR = 'DECORATOR',
    
    /** 注释（通常会被过滤，但保留类型定义） */
    COMMENT = 'COMMENT',
    
    /** 未知类型 */
    UNKNOWN = 'UNKNOWN'
}

/**
 * Token 接口
 * 
 * 代表代码中的一个最小语义单元
 */
export interface Token {
    /** Token 的原始值，如 "let", "x", "123", "+" */
    value: string;
    
    /** Token 类型 */
    type: TokenType;
    
    /** 所在行号（1-based） */
    line: number;
    
    /** 所在列号（0-based） */
    column: number;
    
    /** 所属文件路径（可选，用于跨文件检测） */
    file?: string;
}

/**
 * 创建 Token 的辅助函数
 */
export function createToken(
    value: string,
    type: TokenType,
    line: number,
    column: number,
    file?: string
): Token {
    return { value, type, line, column, file };
}

/**
 * 判断 Token 是否为关键字
 */
export function isKeyword(token: Token): boolean {
    return token.type === TokenType.KEYWORD;
}

/**
 * 判断 Token 是否为标识符
 */
export function isIdentifier(token: Token): boolean {
    return token.type === TokenType.IDENTIFIER;
}

/**
 * 判断 Token 是否为字面量
 */
export function isLiteral(token: Token): boolean {
    return token.type === TokenType.LITERAL;
}
