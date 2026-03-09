/**
 * 克隆检测管线共享工具
 *
 * 提供方法级和片段级克隆检测共用的去重、重叠判断等逻辑，
 * 减少两条管线之间的代码重复。
 */

import { MergedClone } from './CloneMerger';

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

    const sorted = [...clones].sort((a, b) => {
        const f1 = a.location1.file.localeCompare(b.location1.file);
        if (f1 !== 0) return f1;
        const f2 = a.location2.file.localeCompare(b.location2.file);
        if (f2 !== 0) return f2;
        const s1 = a.location1.startLine - b.location1.startLine;
        if (s1 !== 0) return s1;
        const s2 = a.location2.startLine - b.location2.startLine;
        if (s2 !== 0) return s2;
        return b.tokenCount - a.tokenCount;
    });

    const result: MergedClone[] = [];
    for (const clone of sorted) {
        const isDuplicate = result.some(existing =>
            existing.location1.file === clone.location1.file &&
            existing.location2.file === clone.location2.file &&
            linesOverlap(
                existing.location1.startLine, existing.location1.endLine,
                clone.location1.startLine, clone.location1.endLine
            ) &&
            linesOverlap(
                existing.location2.startLine, existing.location2.endLine,
                clone.location2.startLine, clone.location2.endLine
            )
        );
        if (!isDuplicate) {
            result.push(clone);
        }
    }
    return result;
}
