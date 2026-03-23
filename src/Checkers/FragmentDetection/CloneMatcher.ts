/**
 * 克隆匹配器模块
 * 
 * 使用 Rabin-Karp 滚动哈希实现 O(n) 的克隆片段检测和匹配。
 * 指纹验证采用惰性计算，仅在哈希碰撞时才生成指纹。
 */

import { Token } from './Token';
import { HashIndex, FragmentLocation, computeFingerprint } from './HashIndex';
import { RollingHash } from './RollingHash';
import { groupBy, pairwiseCombinations } from '../shared';

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
 * 使用 Rabin-Karp 滚动哈希 + 惰性指纹验证检测代码克隆。
 * 相比旧的 O(n*k) 滑动窗口方案，哈希计算降为 O(n)。
 */
export class CloneMatcher {
    /** 哈希索引 */
    private hashIndex: HashIndex = new HashIndex();
    
    /** 窗口大小（最小重复 Token 数） */
    private windowSize: number;

    /** Token 词汇表：token value → 整数 ID */
    private tokenVocab: Map<string, number> = new Map();

    /** 每个文件的 Token 序列引用（用于惰性指纹计算） */
    private fileTokens: Map<string, Token[]> = new Map();
    
    /**
     * 构造函数
     * 
     * @param windowSize 窗口大小，默认 100
     */
    constructor(windowSize: number = 100) {
        this.windowSize = windowSize;
    }

    /**
     * 将 Token 值映射为整数 ID
     * 
     * @param tokenValue Token 的值
     * @returns 整数 ID
     */
    private getTokenId(tokenValue: string): number {
        const existing = this.tokenVocab.get(tokenValue);
        if (existing !== undefined) {
            return existing;
        }
        // ID 从 1 开始，避免 0 导致哈希退化
        const id = this.tokenVocab.size + 1;
        this.tokenVocab.set(tokenValue, id);
        return id;
    }
    
    /**
     * 处理单个文件的 Token 序列
     * 
     * 使用 Rabin-Karp 滚动哈希在 O(n) 时间内计算所有窗口哈希，
     * 不再需要逐个创建滑动窗口。指纹验证延迟到 getClonePairs() 阶段。
     * 
     * @param tokens Token 序列
     * @param file 文件路径
     */
    processFile(tokens: Token[], file: string): void {
        if (tokens.length < this.windowSize) {
            return;
        }

        // 保存 Token 序列引用，用于惰性指纹计算
        this.fileTokens.set(file, tokens);

        // 将 Token 值映射为整数 ID
        const tokenIds = tokens.map(t => this.getTokenId(t.value));

        const rollingHash = new RollingHash(this.windowSize);

        // 初始化首个窗口
        const firstHash = rollingHash.init(tokenIds.slice(0, this.windowSize));
        const firstEndLine = tokens[this.windowSize - 1].line;

        this.hashIndex.add(firstHash, {
            file,
            startIndex: 0,
            startLine: tokens[0].line,
            endLine: firstEndLine,
            allTokens: tokens
        });

        // 滑动计算后续窗口（每步 O(1)）
        for (let i = 1; i <= tokens.length - this.windowSize; i++) {
            const hash = rollingHash.slide(
                tokenIds[i - 1],
                tokenIds[i + this.windowSize - 1]
            );

            this.hashIndex.add(hash, {
                file,
                startIndex: i,
                startLine: tokens[i].line,
                endLine: tokens[i + this.windowSize - 1].line,
                allTokens: tokens
            });
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
     * 惰性指纹验证：仅当同一哈希值下有多个位置时，
     * 才计算 tokenFingerprint 进行碰撞排除。
     * 
     * @returns 克隆对列表
     */
    getClonePairs(): ClonePair[] {
        const matches = this.getMatches();
        const pairs: ClonePair[] = [];
        for (const match of matches) {
            // 惰性计算指纹，按指纹分组验证碰撞
            const fingerprintGroups = groupBy(match.locations, loc => this.resolveFingerprint(loc));
            // 只有指纹完全相同的位置才是真正的克隆
            for (const group of fingerprintGroups.values()) {
                if (group.length < 2) {
                    continue;  // 哈希碰撞，跳过
                }

                for (const [location1, location2] of pairwiseCombinations(group)) {
                    // 跳过同文件重叠窗口（自身克隆误报）
                    if (location1.file === location2.file &&
                        Math.abs(location1.startIndex - location2.startIndex) < this.windowSize) {
                        continue;
                    }

                    pairs.push({
                        location1,
                        location2,
                        tokenCount: this.windowSize
                    });
                }
            }
        }
        return pairs;
    }

    /**
     * 解析位置的 Token 指纹
     * 
     * 如果已有 tokenFingerprint 则直接使用，
     * 否则从 allTokens 惰性计算。
     */
    private resolveFingerprint(loc: FragmentLocation): string {
        if (loc.tokenFingerprint) {
            return loc.tokenFingerprint;
        }
        if (loc.allTokens) {
            const fp = computeFingerprint(loc.allTokens, loc.startIndex, this.windowSize);
            loc.tokenFingerprint = fp;
            return fp;
        }
        // 兜底：从 fileTokens 中获取
        const tokens = this.fileTokens.get(loc.file);
        if (tokens) {
            const fp = computeFingerprint(tokens, loc.startIndex, this.windowSize);
            loc.tokenFingerprint = fp;
            return fp;
        }
        return '';
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
        this.tokenVocab.clear();
        this.fileTokens.clear();
    }
    
    /**
     * 获取窗口大小
     */
    getWindowSize(): number {
        return this.windowSize;
    }
}
