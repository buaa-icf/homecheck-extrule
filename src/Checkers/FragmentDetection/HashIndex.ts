/**
 * 哈希索引模块
 * 
 * 实现窗口哈希计算和索引存储
 */

import { Token } from './Token';
import { TokenWindow } from './SlidingWindow';
import { djb2Hash } from '../shared';

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

    /** 可选 Token ID 序列引用（兼容手工构造 location；主路径使用文件级缓存） */
    tokenIds?: number[];

    /** 可选 Token 序列引用（兼容手工构造 location；主路径使用文件级缓存） */
    allTokens?: Token[];
}

/**
 * 哈希索引类
 * 
 * 存储每个哈希值对应的所有位置
 */
export class HashIndex {
    /** 哈希值 → 位置列表 */
    private index: Map<string, FragmentLocation | FragmentLocation[]> = new Map();
    
    /**
     * 添加一个位置到索引
     * 
     * @param hash 哈希值
     * @param location 位置信息
     */
    add(hash: string, location: FragmentLocation): void {
        const existing = this.index.get(hash);
        if (existing === undefined) {
            this.index.set(hash, location);
            return;
        }
        if (Array.isArray(existing)) {
            existing.push(location);
            return;
        }
        this.index.set(hash, [existing, location]);
    }
    
    /**
     * 获取某个哈希值对应的所有位置
     * 
     * @param hash 哈希值
     * @returns 位置列表，如果不存在则返回空数组
     */
    get(hash: string): FragmentLocation[] {
        const value = this.index.get(hash);
        if (value === undefined) {
            return [];
        }
        return Array.isArray(value) ? value : [value];
    }
    
    /**
     * 获取所有有重复的哈希值（位置数 >= 2）
     * 
     * @returns [哈希值, 位置列表] 的数组
     */
    getDuplicates(): [string, FragmentLocation[]][] {
        const duplicates: [string, FragmentLocation[]][] = [];
        
        for (const [hash, value] of this.index) {
            if (Array.isArray(value) && value.length >= 2) {
                duplicates.push([hash, value]);
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
