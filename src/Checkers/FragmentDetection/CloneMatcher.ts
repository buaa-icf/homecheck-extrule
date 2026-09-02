/**
 * 克隆匹配器模块
 * 
 * 使用 Rabin-Karp 滚动哈希实现 O(n) 的克隆片段检测和匹配。
 * 指纹验证采用惰性计算，仅在哈希碰撞时才生成指纹。
 */

import { Token } from './Token';
import { HashIndex, FragmentLocation, computeFingerprint } from './HashIndex';
import { RollingHash } from './RollingHash';
import { groupBy } from '../shared';

const DEFAULT_MAX_PAIRS_PER_FINGERPRINT = 5000;

export interface CloneMatcherOptions {
    maxPairsPerFingerprint?: number;
}

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
 * 精确克隆窗口组。
 *
 * 表示同一个规范化 Token 指纹出现的所有位置，不预先展开两两候选对。
 */
export interface ExactCloneGroup {
    /** 克隆组内部标识：主路径使用滚动哈希键，兼容兜底路径可使用规范化 Token 指纹 */
    fingerprint: string;
    locations: FragmentLocation[];
    tokenCount: number;
}

interface VerifiedLocationGroup {
    representative: FragmentLocation;
    locations: FragmentLocation[];
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

    /** 每个文件的 Token ID 序列引用（用于窗口等价校验） */
    private fileTokenIds: Map<string, Uint32Array> = new Map();

    /** 单个规范化指纹最多展开的候选克隆对数量 */
    private readonly maxPairsPerFingerprint: number;
    
    /**
     * 构造函数
     * 
     * @param windowSize 窗口大小，默认 100
     */
    constructor(windowSize: number = 100, options: CloneMatcherOptions = {}) {
        this.windowSize = windowSize;
        this.maxPairsPerFingerprint = normalizePairLimit(options.maxPairsPerFingerprint);
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
        const tokenIds = new Uint32Array(tokens.length);
        const tokenVocab = this.tokenVocab;
        for (let index = 0; index < tokens.length; index++) {
            const tokenValue = tokens[index].value;
            let tokenId = tokenVocab.get(tokenValue);
            if (tokenId === undefined) {
                tokenId = tokenVocab.size + 1;
                tokenVocab.set(tokenValue, tokenId);
            }
            tokenIds[index] = tokenId;
        }
        this.fileTokenIds.set(file, tokenIds);

        const rollingHash = new RollingHash(this.windowSize);

        // 初始化首个窗口
        const firstHash = rollingHash.initWindowNumeric(tokenIds, 0);
        const firstEndLine = tokens[this.windowSize - 1].line;

        this.hashIndex.addNumericWindow(firstHash, rollingHash.getSecondHash(), file, 0, tokens[0].line, firstEndLine);

        // 滑动计算后续窗口（每步 O(1)）
        for (let i = 1; i <= tokens.length - this.windowSize; i++) {
            const hash = rollingHash.slidePositiveNumeric(
                tokenIds[i - 1],
                tokenIds[i + this.windowSize - 1]
            );

            this.hashIndex.addNumericWindow(
                hash,
                rollingHash.getSecondHash(),
                file,
                i,
                tokens[i].line,
                tokens[i + this.windowSize - 1].line
            );
        }
    }
    
    /**
     * 获取所有克隆匹配
     * 
     * @returns 克隆匹配列表
     */
    getMatches(): CloneMatch[] {
        const duplicates = [
            ...this.hashIndex.getDuplicates(),
            ...this.hashIndex.getNumericDuplicates()
        ];
        
        return duplicates.map(([hash, locations]) => ({
            hash,
            locations
        }));
    }

    /**
     * 获取精确克隆窗口组。
     *
     * 与 getClonePairs() 不同，这里按规范化指纹聚合重复窗口，
     * 避免高重复代码在后续阶段立即展开成 O(n²) 候选对。
     *
     * @returns 精确克隆窗口组列表
     */
    getExactCloneGroups(): ExactCloneGroup[] {
        const groups: ExactCloneGroup[] = [];

        for (const match of this.getMatches()) {
            const verifiedGroups = this.groupByVerifiedWindow(match.locations);
            for (let groupIndex = 0; groupIndex < verifiedGroups.length; groupIndex++) {
                const group = verifiedGroups[groupIndex];
                if (group.locations.length < 2) {
                    continue;
                }

                const fingerprint = this.resolveExactGroupFingerprint(match.hash, group.representative, groupIndex);
                if (fingerprint === '') {
                    continue;
                }

                groups.push({
                    fingerprint,
                    locations: sortFragmentLocations(group.locations),
                    tokenCount: this.windowSize
                });
            }
        }

        return groups;
    }

    private resolveExactGroupFingerprint(hash: string, representative: FragmentLocation, groupIndex: number): string {
        const tokenIds = representative.tokenIds ?? this.fileTokenIds.get(representative.file);
        if (tokenIds !== undefined) {
            return groupIndex === 0 ? hash : `${hash}:${groupIndex}`;
        }

        return this.resolveFingerprint(representative);
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

                const locations = sortFragmentLocations(group);
                let emittedPairs = 0;
                for (let i = 0; i < locations.length - 1; i++) {
                    for (let j = i + 1; j < locations.length; j++) {
                        if (emittedPairs >= this.maxPairsPerFingerprint) {
                            break;
                        }

                        const location1 = locations[i];
                        const location2 = locations[j];

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
                        emittedPairs++;
                    }
                    if (emittedPairs >= this.maxPairsPerFingerprint) {
                        break;
                    }
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

    private groupByVerifiedWindow(locations: FragmentLocation[]): VerifiedLocationGroup[] {
        const groups: VerifiedLocationGroup[] = [];

        for (const location of locations) {
            const existing = groups.find(group => this.haveSameTokenWindow(group.representative, location));
            if (existing !== undefined) {
                existing.locations.push(location);
                continue;
            }

            groups.push({
                representative: location,
                locations: [location]
            });
        }

        return groups;
    }

    private haveSameTokenWindow(a: FragmentLocation, b: FragmentLocation): boolean {
        const firstIds = a.tokenIds ?? this.fileTokenIds.get(a.file);
        const secondIds = b.tokenIds ?? this.fileTokenIds.get(b.file);
        if (firstIds !== undefined && secondIds !== undefined) {
            return sameTokenIdWindow(firstIds, a.startIndex, secondIds, b.startIndex, this.windowSize);
        }

        return this.resolveFingerprint(a) === this.resolveFingerprint(b);
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
        this.fileTokenIds.clear();
    }
    
    /**
     * 获取窗口大小
     */
    getWindowSize(): number {
        return this.windowSize;
    }
}

function normalizePairLimit(value: number | undefined): number {
    if (value === undefined) {
        return DEFAULT_MAX_PAIRS_PER_FINGERPRINT;
    }
    if (!Number.isFinite(value) || value <= 0) {
        return DEFAULT_MAX_PAIRS_PER_FINGERPRINT;
    }
    return Math.floor(value);
}

function sortFragmentLocations(locations: FragmentLocation[]): FragmentLocation[] {
    return [...locations].sort((a, b) => {
        if (a.file !== b.file) {
            return a.file.localeCompare(b.file);
        }
        if (a.startIndex !== b.startIndex) {
            return a.startIndex - b.startIndex;
        }
        return a.startLine - b.startLine;
    });
}

function sameTokenIdWindow(
    firstIds: ArrayLike<number>,
    firstStart: number,
    secondIds: ArrayLike<number>,
    secondStart: number,
    windowSize: number
): boolean {
    for (let offset = 0; offset < windowSize; offset++) {
        if (firstIds[firstStart + offset] !== secondIds[secondStart + offset]) {
            return false;
        }
    }
    return true;
}
