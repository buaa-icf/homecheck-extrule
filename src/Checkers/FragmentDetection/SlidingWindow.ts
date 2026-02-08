/**
 * 滑动窗口模块
 * 
 * 实现在 Token 序列上的滑动窗口操作
 */

import { Token } from './Token';

/**
 * 窗口信息
 */
export interface TokenWindow {
    /** 窗口在全局 Token 序列中的起始索引 */
    startIndex: number;
    
    /** 窗口内的 Token 列表 */
    tokens: Token[];
    
    /** 窗口的起始行号（取第一个 Token 的行号） */
    startLine: number;
    
    /** 窗口的结束行号（取最后一个 Token 的行号） */
    endLine: number;
    
    /** 所属文件（取第一个 Token 的文件） */
    file?: string;
}

/**
 * 在 Token 序列上创建滑动窗口
 * 
 * @param tokens Token 序列
 * @param windowSize 窗口大小（Token 数量）
 * @returns 窗口列表
 * 
 * @example
 * // 输入：[t1, t2, t3, t4, t5]，窗口大小 3
 * // 输出：
 * // [
 * //   { startIndex: 0, tokens: [t1, t2, t3] },
 * //   { startIndex: 1, tokens: [t2, t3, t4] },
 * //   { startIndex: 2, tokens: [t3, t4, t5] }
 * // ]
 */
export function createSlidingWindows(tokens: Token[], windowSize: number): TokenWindow[] {
    if (tokens.length < windowSize) {
        return [];  // Token 数量不足，无法创建窗口
    }
    
    const windows: TokenWindow[] = [];
    
    for (let i = 0; i <= tokens.length - windowSize; i++) {
        const windowTokens = tokens.slice(i, i + windowSize);
        const firstToken = windowTokens[0];
        const lastToken = windowTokens[windowTokens.length - 1];
        
        windows.push({
            startIndex: i,
            tokens: windowTokens,
            startLine: firstToken.line,
            endLine: lastToken.line,
            file: firstToken.file
        });
    }
    
    return windows;
}

/**
 * 获取窗口数量
 * 
 * @param tokenCount Token 总数
 * @param windowSize 窗口大小
 * @returns 窗口数量
 */
export function getWindowCount(tokenCount: number, windowSize: number): number {
    if (tokenCount < windowSize) {
        return 0;
    }
    return tokenCount - windowSize + 1;
}
