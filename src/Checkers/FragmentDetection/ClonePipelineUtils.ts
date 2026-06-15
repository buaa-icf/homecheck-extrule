/**
 * 克隆检测管线共享工具
 *
 * 提供方法级和片段级克隆检测共用的去重、重叠判断等逻辑，
 * 减少两条管线之间的代码重复。
 */

import { MergedClone } from './CloneMerger';

const LINE_BUCKET_SIZE = 128;

interface CloneSelectionIndex {
    byFirstLineBucket: Map<number, MergedClone[]>;
}

/**
 * 判断两个行范围是否重叠
 *
 * @param s1 范围1起始行
 * @param e1 范围1结束行
 * @param s2 范围2起始行
 * @param e2 范围2结束行
 * @returns 是否重叠
 */
export function linesOverlap(s1: number, e1: number, s2: number, e2: number): boolean {
    return Math.max(s1, s2) <= Math.min(e1, e2);
}

/**
 * 过滤同文件自身重叠克隆
 *
 * 同文件内行范围重叠的克隆对属于自身克隆误报，应该排除。
 *
 * @param clones 合并后的克隆列表
 * @returns 过滤后的列表
 */
export function filterSelfOverlappingClones(clones: MergedClone[]): MergedClone[] {
    return clones.filter(clone => {
        if (clone.location1.file !== clone.location2.file) {
            return true;
        }
        const overlapStart = Math.max(clone.location1.startLine, clone.location2.startLine);
        const overlapEnd = Math.min(clone.location1.endLine, clone.location2.endLine);
        return overlapStart > overlapEnd;
    });
}

/**
 * 去重合并克隆：同一文件对、行范围重叠的克隆只保留 tokenCount 最大的
 *
 * 算法：
 * 1. 按文件对和起始行排序，tokenCount 大的排前面
 * 2. 顺序遍历，跳过与已有结果行范围重叠的克隆
 *
 * @param clones 合并后的克隆列表
 * @returns 去重后的列表
 */
export function deduplicateMergedClones(clones: MergedClone[]): MergedClone[] {
    if (clones.length <= 1) {
        return clones;
    }

    const sorted = [...clones].sort(compareCloneForSelection);
    const selectedByFilePair = new Map<string, CloneSelectionIndex>();
    const selected: MergedClone[] = [];

    for (const clone of sorted) {
        const filePairKey = getFilePairKey(clone);
        let index = selectedByFilePair.get(filePairKey);
        if (index === undefined) {
            index = { byFirstLineBucket: new Map<number, MergedClone[]>() };
            selectedByFilePair.set(filePairKey, index);
        }

        if (hasOverlappingSelection(index, clone)) {
            continue;
        }

        selected.push(clone);
        addToSelectionIndex(index, clone);
    }

    return selected.sort(compareCloneForOutput);
}

function compareCloneForSelection(a: MergedClone, b: MergedClone): number {
    const pairOrder = compareFilePair(a, b);
    if (pairOrder !== 0) return pairOrder;

    const tokenOrder = b.tokenCount - a.tokenCount;
    if (tokenOrder !== 0) return tokenOrder;

    return compareCloneForOutput(a, b);
}

function compareCloneForOutput(a: MergedClone, b: MergedClone): number {
    const pairOrder = compareFilePair(a, b);
    if (pairOrder !== 0) return pairOrder;

    const location1Order = compareLocation(a.location1, b.location1);
    if (location1Order !== 0) return location1Order;

    const location2Order = compareLocation(a.location2, b.location2);
    if (location2Order !== 0) return location2Order;

    return b.tokenCount - a.tokenCount;
}

function compareFilePair(a: MergedClone, b: MergedClone): number {
    const f1 = a.location1.file.localeCompare(b.location1.file);
    if (f1 !== 0) return f1;
    return a.location2.file.localeCompare(b.location2.file);
}

function compareLocation(a: MergedClone['location1'], b: MergedClone['location1']): number {
    const startLine = a.startLine - b.startLine;
    if (startLine !== 0) return startLine;

    const endLine = a.endLine - b.endLine;
    if (endLine !== 0) return endLine;

    const startIndex = a.startIndex - b.startIndex;
    if (startIndex !== 0) return startIndex;

    return a.endIndex - b.endIndex;
}

function getFilePairKey(clone: MergedClone): string {
    return `${clone.location1.file}\0${clone.location2.file}`;
}

function hasOverlappingSelection(index: CloneSelectionIndex, clone: MergedClone): boolean {
    const seen = new Set<MergedClone>();
    const startBucket = toLineBucket(clone.location1.startLine);
    const endBucket = toLineBucket(clone.location1.endLine);

    for (let bucket = startBucket; bucket <= endBucket; bucket++) {
        const candidates = index.byFirstLineBucket.get(bucket);
        if (candidates === undefined) {
            continue;
        }

        for (const existing of candidates) {
            if (seen.has(existing)) {
                continue;
            }
            seen.add(existing);

            if (
                linesOverlap(
                    existing.location1.startLine, existing.location1.endLine,
                    clone.location1.startLine, clone.location1.endLine
                ) &&
                linesOverlap(
                    existing.location2.startLine, existing.location2.endLine,
                    clone.location2.startLine, clone.location2.endLine
                )
            ) {
                return true;
            }
        }
    }

    return false;
}

function addToSelectionIndex(index: CloneSelectionIndex, clone: MergedClone): void {
    const startBucket = toLineBucket(clone.location1.startLine);
    const endBucket = toLineBucket(clone.location1.endLine);

    for (let bucket = startBucket; bucket <= endBucket; bucket++) {
        let bucketClones = index.byFirstLineBucket.get(bucket);
        if (bucketClones === undefined) {
            bucketClones = [];
            index.byFirstLineBucket.set(bucket, bucketClones);
        }
        bucketClones.push(clone);
    }
}

function toLineBucket(line: number): number {
    return Math.floor(line / LINE_BUCKET_SIZE);
}
