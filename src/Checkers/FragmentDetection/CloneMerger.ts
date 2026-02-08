/**
 * 克隆合并器模块
 * 
 * 将连续的克隆匹配合并成更大的克隆区域
 */

import { ClonePair } from './CloneMatcher';
import { FragmentLocation } from './HashIndex';

/**
 * 合并后的克隆区域
 */
export interface MergedClone {
    /** 第一个克隆区域 */
    location1: {
        file: string;
        startLine: number;
        endLine: number;
        startIndex: number;
        endIndex: number;
    };
    
    /** 第二个克隆区域 */
    location2: {
        file: string;
        startLine: number;
        endLine: number;
        startIndex: number;
        endIndex: number;
    };
    
    /** 合并后的总 Token 数 */
    tokenCount: number;
}

/**
 * 判断两个克隆对是否连续
 * 
 * 连续的条件：
 * 1. 来自同一对文件
 * 2. 两个位置的 startIndex 都相差 1
 * 
 * @param pair1 第一个克隆对
 * @param pair2 第二个克隆对
 * @returns 是否连续
 */
export function isConsecutive(pair1: ClonePair, pair2: ClonePair): boolean {
    // 检查是否是同一对文件
    const sameFiles = 
        pair1.location1.file === pair2.location1.file &&
        pair1.location2.file === pair2.location2.file;
    
    if (!sameFiles) {
        return false;
    }
    
    // 检查位置是否连续（两边都相差 1）
    const consecutive = 
        pair2.location1.startIndex === pair1.location1.startIndex + 1 &&
        pair2.location2.startIndex === pair1.location2.startIndex + 1;
    
    return consecutive;
}

/**
 * 从克隆对创建初始的合并克隆
 * 
 * @param pair 克隆对
 * @param windowSize 窗口大小
 * @returns 合并克隆
 */
export function createMergedClone(pair: ClonePair, windowSize: number): MergedClone {
    return {
        location1: {
            file: pair.location1.file,
            startLine: pair.location1.startLine,
            endLine: pair.location1.endLine,
            startIndex: pair.location1.startIndex,
            endIndex: pair.location1.startIndex + windowSize - 1
        },
        location2: {
            file: pair.location2.file,
            startLine: pair.location2.startLine,
            endLine: pair.location2.endLine,
            startIndex: pair.location2.startIndex,
            endIndex: pair.location2.startIndex + windowSize - 1
        },
        tokenCount: windowSize
    };
}

/**
 * 扩展合并克隆（将连续的克隆对合并进来）
 * 
 * @param merged 当前合并克隆
 * @param pair 要合并的克隆对
 */
export function extendMergedClone(merged: MergedClone, pair: ClonePair): void {
    // Token 数量 +1（因为窗口滑动了一个位置）
    merged.tokenCount += 1;
    
    // 扩展 endIndex（startIndex + tokenCount - 1）
    merged.location1.endIndex = merged.location1.startIndex + merged.tokenCount - 1;
    merged.location2.endIndex = merged.location2.startIndex + merged.tokenCount - 1;
    
    // 更新 endLine
    merged.location1.endLine = Math.max(merged.location1.endLine, pair.location1.endLine);
    merged.location2.endLine = Math.max(merged.location2.endLine, pair.location2.endLine);
}

/**
 * 克隆对排序比较函数
 * 
 * 按 (file1, file2, startIndex1, startIndex2) 排序
 */
function compareClonePairs(a: ClonePair, b: ClonePair): number {
    // 先按 file1 排序
    if (a.location1.file !== b.location1.file) {
        return a.location1.file.localeCompare(b.location1.file);
    }
    
    // 再按 file2 排序
    if (a.location2.file !== b.location2.file) {
        return a.location2.file.localeCompare(b.location2.file);
    }
    
    // 再按 startIndex1 排序
    if (a.location1.startIndex !== b.location1.startIndex) {
        return a.location1.startIndex - b.location1.startIndex;
    }
    
    // 最后按 startIndex2 排序
    return a.location2.startIndex - b.location2.startIndex;
}

/**
 * 合并克隆对列表
 * 
 * 将连续的克隆对合并成更大的克隆区域
 * 
 * @param pairs 克隆对列表
 * @param windowSize 窗口大小
 * @returns 合并后的克隆区域列表
 */
export function mergeClonePairs(pairs: ClonePair[], windowSize: number): MergedClone[] {
    if (pairs.length === 0) {
        return [];
    }
    
    // 1. 排序
    const sorted = [...pairs].sort(compareClonePairs);
    
    // 2. 遍历合并
    const merged: MergedClone[] = [];
    let current: MergedClone = createMergedClone(sorted[0], windowSize);
    
    for (let i = 1; i < sorted.length; i++) {
        if (isConsecutive(sorted[i - 1], sorted[i])) {
            // 扩展当前区域
            extendMergedClone(current, sorted[i]);
        } else {
            // 保存当前区域，开始新的
            merged.push(current);
            current = createMergedClone(sorted[i], windowSize);
        }
    }
    
    // 不要忘记最后一个
    merged.push(current);
    
    return merged;
}

/**
 * 克隆合并器类
 * 
 * 封装合并逻辑，提供更友好的 API
 */
export class CloneMerger {
    private windowSize: number;
    
    constructor(windowSize: number) {
        this.windowSize = windowSize;
    }
    
    /**
     * 合并克隆对
     * 
     * @param pairs 克隆对列表
     * @returns 合并后的克隆区域列表
     */
    merge(pairs: ClonePair[]): MergedClone[] {
        return mergeClonePairs(pairs, this.windowSize);
    }
    
    /**
     * 获取窗口大小
     */
    getWindowSize(): number {
        return this.windowSize;
    }
}
