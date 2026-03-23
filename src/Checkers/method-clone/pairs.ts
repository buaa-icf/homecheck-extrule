import { flattenBuckets, groupBy, pairwiseCombinations } from "../shared";
import { ClonePair, MethodInfo } from "./types";

const RATIO_UPPER = 1.25;

/**
 * 从 hash 桶中提取精确克隆对：
 * 先按 normalizedContent 二次分组，再组内两两配对。
 */
export function collectExactClonePairs(methodsByHash: Map<string, MethodInfo[]>): ClonePair[] {
    const pairs: ClonePair[] = [];

    for (const methods of methodsByHash.values()) {
        if (methods.length < 2) {
            continue;
        }

        const contentGroups = groupBy(methods, method => method.normalizedContent);

        for (const group of contentGroups.values()) {
            if (group.length < 2) {
                continue;
            }

            for (const [method1, method2] of pairwiseCombinations(group)) {
                pairs.push({
                    method1,
                    method2
                });
            }
        }
    }

    return pairs;
}

/**
 * 基于长度比例和相似度函数提取近似克隆对。
 */
export function collectNearMissClonePairs(
    methodsByHash: Map<string, MethodInfo[]>,
    threshold: number,
    similarityCalculator: (method1: MethodInfo, method2: MethodInfo) => number
): ClonePair[] {
    const allMethods = flattenMethods(methodsByHash);
    if (allMethods.length < 2) {
        return [];
    }

    allMethods.sort((a, b) => a.stmtCount - b.stmtCount);
    const pairs: ClonePair[] = [];

    for (let i = 0; i < allMethods.length; i++) {
        for (let j = i + 1; j < allMethods.length; j++) {
            const method1 = allMethods[i];
            const method2 = allMethods[j];

            if (method1.stmtCount > 0 && method2.stmtCount / method1.stmtCount > RATIO_UPPER) {
                break;
            }

            if (method1.normalizedContent === method2.normalizedContent) {
                continue;
            }

            const similarity = similarityCalculator(method1, method2);
            if (similarity >= threshold) {
                pairs.push({
                    method1,
                    method2,
                    similarity
                });
            }
        }
    }

    return pairs;
}

/**
 * 将 hash 分桶展开为线性方法列表。
 */
function flattenMethods(methodsByHash: Map<string, MethodInfo[]>): MethodInfo[] {
    return flattenBuckets(methodsByHash);
}
