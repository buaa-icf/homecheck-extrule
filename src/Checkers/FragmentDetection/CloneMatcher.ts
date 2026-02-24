/**
 * 克隆匹配器模块
 * 
 * 实现克隆片段的检测和匹配
 */

import { Token } from './Token';
import { createSlidingWindows } from './SlidingWindow';
import { HashIndex, FragmentLocation, computeWindowHash, createLocationFromWindow } from './HashIndex';

/**
 * 克隆匹配结果
 */
export interface CloneMatch {
    /** 匹配的哈希值 */
    hash: string;
    
    /** 所有匹配的位置（至少 2 个） */
    locations: FragmentLocation[];
}

/**
 * 克隆片段对
 */
export interface ClonePair {
    /** 第一个片段的位置 */
    location1: FragmentLocation;
    
    /** 第二个片段的位置 */
    location2: FragmentLocation;
    
    /** 匹配的 Token 数量 */
    tokenCount: number;
}

/**
 * 克隆匹配器
 * 
 * 使用滑动窗口 + 哈希的方式检测代码克隆
 */
export class CloneMatcher {
    /** 哈希索引 */
    private hashIndex: HashIndex = new HashIndex();
    
    /** 窗口大小（最小重复 Token 数） */
    private windowSize: number;
    
    /**
     * 构造函数
     * 
     * @param windowSize 窗口大小，默认 100
     */
    constructor(windowSize: number = 100) {
        this.windowSize = windowSize;
    }
    
    /**
     * 处理单个文件的 Token 序列
     * 
     * 将文件中所有窗口的哈希添加到索引
     * 
     * @param tokens Token 序列
     * @param file 文件路径
     */
    processFile(tokens: Token[], file: string): void {
        const windows = createSlidingWindows(tokens, this.windowSize);
        for (const window of windows) {
            const { hash, tokenFingerprint } = computeWindowHash(window);
            const location = createLocationFromWindow(window, file, tokenFingerprint);
            this.hashIndex.add(hash, location);
        }
    }
    
    /**
     * 获取所有克隆匹配
     * 
     * @returns 克隆匹配列表
     */
    getMatches(): CloneMatch[] {
        const duplicates = this.hashIndex.getDuplicates();
        
        return duplicates.map(([hash, locations]) => ({
            hash,
            locations
        }));
    }
    
    /**
     * 获取所有克隆对
     * 
     * 将每个匹配展开为两两配对
     * 
     * @returns 克隆对列表
     */
    getClonePairs(): ClonePair[] {
        const matches = this.getMatches();
        const pairs: ClonePair[] = [];
        for (const match of matches) {
            // 按 tokenFingerprint 分组，验证哈希碰撞
            const fingerprintGroups = new Map<string, FragmentLocation[]>();
            for (const loc of match.locations) {
                const existing = fingerprintGroups.get(loc.tokenFingerprint);
                if (existing) {
                    existing.push(loc);
                } else {
                    fingerprintGroups.set(loc.tokenFingerprint, [loc]);
                }
            }
            // 只有 tokenFingerprint 完全相同的位置才是真正的克隆
            for (const group of fingerprintGroups.values()) {
                if (group.length < 2) {
                    continue;  // 哈希碰撞，跳过
                }
                for (let i = 0; i < group.length; i++) {
                    for (let j = i + 1; j < group.length; j++) {
                        pairs.push({
                            location1: group[i],
                            location2: group[j],
                            tokenCount: this.windowSize
                        });
                    }
                }
            }
        }
        return pairs;
    }
    
    /**
     * 获取索引大小
     */
    getIndexSize(): number {
        return this.hashIndex.size();
    }
    
    /**
     * 清空索引
     */
    clear(): void {
        this.hashIndex.clear();
    }
    
    /**
     * 获取窗口大小
     */
    getWindowSize(): number {
        return this.windowSize;
    }
}
