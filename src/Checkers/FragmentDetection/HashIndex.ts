/**
 * 哈希索引模块
 * 
 * 实现窗口哈希计算和索引存储
 */

import { Token } from './Token';
import { TokenWindow } from './SlidingWindow';
import { djb2Hash } from '../shared';

type StoredLocationRef = number | number[];
type TokenIdSequence = number[] | Uint32Array;

class GrowableUint32Array {
    private values = new Uint32Array(4096);
    public length = 0;

    push(value: number): void {
        if (this.length === this.values.length) {
            const next = new Uint32Array(this.values.length * 2);
            next.set(this.values);
            this.values = next;
        }
        this.values[this.length++] = value;
    }

    get(index: number): number {
        return this.values[index];
    }

    set(index: number, value: number): void {
        this.values[index] = value;
    }

    clear(): void {
        this.values = new Uint32Array(4096);
        this.length = 0;
    }
}

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
    tokenIds?: TokenIdSequence;

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
    /** 主扫描路径以首哈希为数值键；只有首哈希碰撞时才创建二级 Map。 */
    private numericIndex: Map<number, StoredLocationRef> = new Map();
    private numericCollisions: Map<number, Map<number, StoredLocationRef>> = new Map();
    private locationHash2 = new GrowableUint32Array();

    /** 每个窗口只保存4字节fileId，路径字符串每个文件仅保留一份。 */
    private fileIds = new GrowableUint32Array();
    private fileIdByPath: Map<string, number> = new Map();
    private filePaths: string[] = [];
    private startIndexes = new GrowableUint32Array();
    private startLines = new GrowableUint32Array();
    private endLines = new GrowableUint32Array();
    /** 仅兼容 add() 手工传入的附加信息；addWindow() 热路径不分配空槽。 */
    private tokenFingerprints: Map<number, string> = new Map();
    private tokenIdRefs: Map<number, TokenIdSequence> = new Map();
    private tokenRefs: Map<number, Token[]> = new Map();
    
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

    /** CloneMatcher 热路径：使用双数值哈希添加窗口。 */
    addNumericWindow(hash1: number, hash2: number, file: string, startIndex: number, startLine: number, endLine: number): void {
        const locationIndex = this.storeLocation(file, startIndex, startLine, endLine);
        this.locationHash2.set(locationIndex, hash2);

        const collisionBucket = this.numericCollisions.get(hash1);
        if (collisionBucket !== undefined) {
            collisionBucket.set(hash2, appendLocationRef(collisionBucket.get(hash2), locationIndex));
            return;
        }

        const existing = this.numericIndex.get(hash1);
        if (existing === undefined) {
            this.numericIndex.set(hash1, locationIndex);
            return;
        }

        const existingIndex = Array.isArray(existing) ? existing[0] : existing;
        const existingHash2 = this.locationHash2.get(existingIndex);
        if (existingHash2 === hash2) {
            this.numericIndex.set(hash1, appendLocationRef(existing, locationIndex));
            return;
        }

        const secondary = new Map<number, StoredLocationRef>();
        secondary.set(existingHash2, existing);
        secondary.set(hash2, locationIndex);
        this.numericIndex.delete(hash1);
        this.numericCollisions.set(hash1, secondary);
    }

    private addStoredLocation(
        hash: string,
        file: string,
        startIndex: number,
        startLine: number,
        endLine: number,
        tokenFingerprint?: string,
        tokenIds?: TokenIdSequence,
        allTokens?: Token[]
    ): void {
        const locationIndex = this.storeLocation(file, startIndex, startLine, endLine);
        if (tokenFingerprint !== undefined) {
            this.tokenFingerprints.set(locationIndex, tokenFingerprint);
        }
        if (tokenIds !== undefined) {
            this.tokenIdRefs.set(locationIndex, tokenIds);
        }
        if (allTokens !== undefined) {
            this.tokenRefs.set(locationIndex, allTokens);
        }

        this.index.set(hash, appendLocationRef(this.index.get(hash), locationIndex));
    }

    private storeLocation(file: string, startIndex: number, startLine: number, endLine: number): number {
        const locationIndex = this.fileIds.length;
        let fileId = this.fileIdByPath.get(file);
        if (fileId === undefined) {
            fileId = this.filePaths.length;
            this.fileIdByPath.set(file, fileId);
            this.filePaths.push(file);
        }
        this.fileIds.push(fileId);
        this.startIndexes.push(startIndex);
        this.startLines.push(startLine);
        this.endLines.push(endLine);
        this.locationHash2.push(0);
        return locationIndex;
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

    /** 获取主扫描数值索引中的重复窗口；只为实际重复项生成字符串标识。 */
    getNumericDuplicates(): [string, FragmentLocation[]][] {
        const duplicates: [string, FragmentLocation[]][] = [];
        for (const [hash1, value] of this.numericIndex) {
            if (Array.isArray(value) && value.length >= 2) {
                const hash2 = this.locationHash2.get(value[0]);
                duplicates.push([`${hash1}_${hash2}`, value.map(index => this.toLocation(index))]);
            }
        }
        for (const [hash1, secondary] of this.numericCollisions) {
            for (const [hash2, value] of secondary) {
                if (Array.isArray(value) && value.length >= 2) {
                    duplicates.push([`${hash1}_${hash2}`, value.map(index => this.toLocation(index))]);
                }
            }
        }
        return duplicates;
    }

    /**
     * 逐个访问重复窗口桶，避免调用方同时物化全仓所有重复位置。
     * 回调中的位置数组只在当前桶处理期间存在。
     */
    forEachDuplicate(visitor: (hash: string, locations: FragmentLocation[]) => void): void {
        for (const [hash, value] of this.index) {
            if (Array.isArray(value) && value.length >= 2) {
                visitor(hash, value.map(index => this.toLocation(index)));
            }
        }

        for (const [hash1, value] of this.numericIndex) {
            if (Array.isArray(value) && value.length >= 2) {
                const hash2 = this.locationHash2.get(value[0]);
                visitor(`${hash1}_${hash2}`, value.map(index => this.toLocation(index)));
            }
        }

        for (const [hash1, secondary] of this.numericCollisions) {
            for (const [hash2, value] of secondary) {
                if (Array.isArray(value) && value.length >= 2) {
                    visitor(`${hash1}_${hash2}`, value.map(index => this.toLocation(index)));
                }
            }
        }
    }
    
    /**
     * 获取索引大小（不同哈希值的数量）
     */
    size(): number {
        let numericSize = this.numericIndex.size;
        for (const secondary of this.numericCollisions.values()) {
            numericSize += secondary.size;
        }
        return this.index.size + numericSize;
    }
    
    /**
     * 清空索引
     */
    clear(): void {
        this.index.clear();
        this.numericIndex.clear();
        this.numericCollisions.clear();
        this.locationHash2.clear();
        this.fileIds.clear();
        this.fileIdByPath.clear();
        this.filePaths = [];
        this.startIndexes.clear();
        this.startLines.clear();
        this.endLines.clear();
        this.tokenFingerprints.clear();
        this.tokenIdRefs.clear();
        this.tokenRefs.clear();
    }

    private toLocation(index: number): FragmentLocation {
        const location: FragmentLocation = {
            file: this.filePaths[this.fileIds.get(index)],
            startIndex: this.startIndexes.get(index),
            startLine: this.startLines.get(index),
            endLine: this.endLines.get(index)
        };

        const tokenFingerprint = this.tokenFingerprints.get(index);
        if (tokenFingerprint !== undefined) {
            location.tokenFingerprint = tokenFingerprint;
        }

        const tokenIds = this.tokenIdRefs.get(index);
        if (tokenIds !== undefined) {
            location.tokenIds = tokenIds;
        }

        const allTokens = this.tokenRefs.get(index);
        if (allTokens !== undefined) {
            location.allTokens = allTokens;
        }

        return location;
    }
}

function appendLocationRef(existing: StoredLocationRef | undefined, locationIndex: number): StoredLocationRef {
    if (existing === undefined) {
        return locationIndex;
    }
    if (Array.isArray(existing)) {
        existing.push(locationIndex);
        return existing;
    }
    return [existing, locationIndex];
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
        file: defaultFile,
        startIndex: window.startIndex,
        startLine: window.startLine,
        endLine: window.endLine,
        tokenFingerprint
    };
}
