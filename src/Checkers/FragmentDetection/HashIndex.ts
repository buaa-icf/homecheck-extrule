/**
 * 哈希索引模块
 * 
 * 实现窗口哈希计算和索引存储
 */

import { Token } from './Token';
import { TokenWindow } from './SlidingWindow';
import { djb2Hash } from '../shared';

type StoredLocationRef = number | number[];

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
    /** 哈希值 → 紧凑位置索引；单次出现时不提前分配数组 */
    private index: Map<string, StoredLocationRef> = new Map();

    private files: string[] = [];
    private startIndexes: number[] = [];
    private startLines: number[] = [];
    private endLines: number[] = [];
    private tokenFingerprints: Array<string | undefined> = [];
    private tokenIdRefs: Array<number[] | undefined> = [];
    private tokenRefs: Array<Token[] | undefined> = [];
    
    /**
     * 添加一个位置到索引
     * 
     * @param hash 哈希值
     * @param location 位置信息
     */
    add(hash: string, location: FragmentLocation): void {
        this.addStoredLocation(
            hash,
            location.file,
            location.startIndex,
            location.startLine,
            location.endLine,
            location.tokenFingerprint,
            location.tokenIds,
            location.allTokens
        );
    }

    /**
     * 添加一个未物化的窗口位置到索引。
     *
     * CloneMatcher 热路径会为每个滑动窗口调用这里；多数窗口不会成为重复候选，
     * 因此先存储紧凑字段，直到 get()/getDuplicates() 再物化 FragmentLocation。
     */
    addWindow(hash: string, file: string, startIndex: number, startLine: number, endLine: number): void {
        this.addStoredLocation(hash, file, startIndex, startLine, endLine);
    }

    private addStoredLocation(
        hash: string,
        file: string,
        startIndex: number,
        startLine: number,
        endLine: number,
        tokenFingerprint?: string,
        tokenIds?: number[],
        allTokens?: Token[]
    ): void {
        const locationIndex = this.files.length;
        this.files.push(file);
        this.startIndexes.push(startIndex);
        this.startLines.push(startLine);
        this.endLines.push(endLine);
        this.tokenFingerprints.push(tokenFingerprint);
        this.tokenIdRefs.push(tokenIds);
        this.tokenRefs.push(allTokens);

        const existing = this.index.get(hash);
        if (existing === undefined) {
            this.index.set(hash, locationIndex);
            return;
        }
        if (Array.isArray(existing)) {
            existing.push(locationIndex);
            return;
        }
        this.index.set(hash, [existing, locationIndex]);
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
        return Array.isArray(value)
            ? value.map(index => this.toLocation(index))
            : [this.toLocation(value)];
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
                duplicates.push([hash, value.map(index => this.toLocation(index))]);
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
        this.files = [];
        this.startIndexes = [];
        this.startLines = [];
        this.endLines = [];
        this.tokenFingerprints = [];
        this.tokenIdRefs = [];
        this.tokenRefs = [];
    }

    private toLocation(index: number): FragmentLocation {
        const location: FragmentLocation = {
            file: this.files[index],
            startIndex: this.startIndexes[index],
            startLine: this.startLines[index],
            endLine: this.endLines[index]
        };

        const tokenFingerprint = this.tokenFingerprints[index];
        if (tokenFingerprint !== undefined) {
            location.tokenFingerprint = tokenFingerprint;
        }

        const tokenIds = this.tokenIdRefs[index];
        if (tokenIds !== undefined) {
            location.tokenIds = tokenIds;
        }

        const allTokens = this.tokenRefs[index];
        if (allTokens !== undefined) {
            location.allTokens = allTokens;
        }

        return location;
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
