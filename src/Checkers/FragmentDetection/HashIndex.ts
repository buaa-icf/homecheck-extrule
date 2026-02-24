/**
 * 哈希索引模块
 * 
 * 实现窗口哈希计算和索引存储
 */

import { Token } from './Token';
import { TokenWindow } from './SlidingWindow';
import { djb2Hash } from '../utils';

/**
 * 片段位置信息
 */
export interface FragmentLocation {
    /** 所属文件路径 */
    file: string;
    
    /** 在全局 Token 序列中的起始索引 */
    startIndex: number;
    
    /** 起始行号 */
    startLine: number;
    
    /** 结束行号 */
    endLine: number;

    /** Token 指纹（规范化后的 Token 序列拼接），用于哈希碰撞验证 */
    tokenFingerprint?: string;

    /** 当前文件的 Token ID 序列引用（用于惰性校验） */
    tokenIds?: number[];

    /** 当前文件的 Token 序列引用（用于惰性生成指纹） */
    allTokens?: Token[];
}

/**
 * 哈希索引类
 * 
 * 存储每个哈希值对应的所有位置
 */
export class HashIndex {
    /** 哈希值 → 位置列表 */
    private index: Map<string, FragmentLocation[]> = new Map();
    
    /**
     * 添加一个位置到索引
     * 
     * @param hash 哈希值
     * @param location 位置信息
     */
    add(hash: string, location: FragmentLocation): void {
        const existing = this.index.get(hash);
        if (existing) {
            existing.push(location);
        } else {
            this.index.set(hash, [location]);
        }
    }
    
    /**
     * 获取某个哈希值对应的所有位置
     * 
     * @param hash 哈希值
     * @returns 位置列表，如果不存在则返回空数组
     */
    get(hash: string): FragmentLocation[] {
        return this.index.get(hash) || [];
    }
    
    /**
     * 获取所有有重复的哈希值（位置数 >= 2）
     * 
     * @returns [哈希值, 位置列表] 的数组
     */
    getDuplicates(): [string, FragmentLocation[]][] {
        const duplicates: [string, FragmentLocation[]][] = [];
        
        for (const [hash, locations] of this.index) {
            if (locations.length >= 2) {
                duplicates.push([hash, locations]);
            }
        }
        
        return duplicates;
    }
    
    /**
     * 获取索引大小（不同哈希值的数量）
     */
    size(): number {
        return this.index.size;
    }
    
    /**
     * 清空索引
     */
    clear(): void {
        this.index.clear();
    }
}

/**
 * 计算指定窗口范围的 Token 指纹
 *
 * 仅拼接 Token 的 value 字段，保持与历史逻辑一致。
 *
 * @param tokens 完整 Token 序列
 * @param startIndex 窗口起始索引
 * @param windowSize 窗口大小
 * @returns 指纹字符串
 */
export function computeFingerprint(tokens: Token[], startIndex: number, windowSize: number): string {
    return tokens.slice(startIndex, startIndex + windowSize).map(t => t.value).join('|');
}

/**
 * 计算窗口的哈希值和 Token 指纹
 * 
 * 将窗口内的 Token 值拼接后计算哈希，同时返回拼接字符串作为指纹
 * 
 * @param window 窗口
 * @returns { hash, tokenFingerprint } 哈希值和 Token 指纹
 * @deprecated 该函数仅用于兼容旧逻辑与测试，新实现请优先使用 RollingHash
 */
export function computeWindowHash(window: TokenWindow): { hash: string; tokenFingerprint: string } {
    const combined = computeFingerprint(window.tokens, 0, window.tokens.length);
    return { hash: djb2Hash(combined), tokenFingerprint: combined };
}

/**
 * 计算 Token 数组的哈希值
 * 
 * @param tokens Token 数组
 * @returns 哈希值
 */
export function computeTokensHash(tokens: Token[]): string {
    const combined = tokens.map(t => t.value).join('|');
    return djb2Hash(combined);
}

/**
 * 从窗口创建位置信息
 * 
 * @param window 窗口
 * @param defaultFile 默认文件路径（如果窗口没有文件信息）
 * @returns 位置信息
 */
export function createLocationFromWindow(window: TokenWindow, defaultFile: string = '', tokenFingerprint: string = ''): FragmentLocation {
    return {
        file: window.file || defaultFile,
        startIndex: window.startIndex,
        startLine: window.startLine,
        endLine: window.endLine,
        tokenFingerprint
    };
}
