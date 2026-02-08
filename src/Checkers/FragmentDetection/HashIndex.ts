/**
 * 哈希索引模块
 * 
 * 实现窗口哈希计算和索引存储
 */

import { Token } from './Token';
import { TokenWindow } from './SlidingWindow';

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
 * DJB2 哈希函数
 * 
 * 复用现有的哈希算法
 */
export function djb2Hash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;  // Convert to 32bit integer
    }
    return hash.toString(16);
}

/**
 * 计算窗口的哈希值
 * 
 * 将窗口内的 Token 值拼接后计算哈希
 * 
 * @param window 窗口
 * @returns 哈希值
 */
export function computeWindowHash(window: TokenWindow): string {
    // 使用 Token 的 value 拼接
    const combined = window.tokens.map(t => t.value).join('|');
    return djb2Hash(combined);
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
export function createLocationFromWindow(window: TokenWindow, defaultFile: string = ''): FragmentLocation {
    return {
        file: window.file || defaultFile,
        startIndex: window.startIndex,
        startLine: window.startLine,
        endLine: window.endLine
    };
}
