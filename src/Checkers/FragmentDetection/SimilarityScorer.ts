/**
 * 相似度计算模块
 *
 * 提供 Token 序列间的相似度计算算法，用于 Type-3 近似克隆检测。
 *
 * 算法：
 * - LCS（最长公共子序列）：精确但 O(n*m)，用于验证阶段
 * - Q-gram 轮廓 Jaccard：O(n+m)，用于候选筛选阶段
 */

/**
 * 计算两个序列的 LCS 长度
 *
 * 使用空间优化的动态规划，空间 O(min(n,m))。
 *
 * @param seq1 序列 1
 * @param seq2 序列 2
 * @returns LCS 长度
 */
export function lcsLength(seq1: string[], seq2: string[]): number {
    // 确保 seq2 是较短的，节省空间
    if (seq1.length < seq2.length) {
        return lcsLength(seq2, seq1);
    }

    const m = seq2.length;
    let prev = new Array<number>(m + 1).fill(0);
    let curr = new Array<number>(m + 1).fill(0);

    for (let i = 1; i <= seq1.length; i++) {
        for (let j = 1; j <= m; j++) {
            if (seq1[i - 1] === seq2[j - 1]) {
                curr[j] = prev[j - 1] + 1;
            } else {
                curr[j] = Math.max(prev[j], curr[j - 1]);
            }
        }
        [prev, curr] = [curr, prev];
        curr.fill(0);
    }

    return prev[m];
}

/**
 * 计算两个 Token 序列的 LCS 相似度
 *
 * 公式：2 * LCS(a, b) / (|a| + |b|)
 * 范围：[0, 1]，1.0 = 完全相同
 *
 * @param seq1 序列 1
 * @param seq2 序列 2
 * @returns 相似度 [0, 1]
 */
export function lcsSimilarity(seq1: string[], seq2: string[]): number {
    if (seq1.length === 0 && seq2.length === 0) return 1.0;
    if (seq1.length === 0 || seq2.length === 0) return 0.0;

    const lcs = lcsLength(seq1, seq2);
    return (2 * lcs) / (seq1.length + seq2.length);
}

/**
 * 构建 Q-gram 轮廓
 *
 * 将 Token 序列切分为长度为 q 的连续子序列，
 * 统计每个子序列出现的次数。
 *
 * @param tokens Token 值序列
 * @param q q-gram 大小
 * @returns q-gram → 出现次数
 */
export function buildQGramProfile(tokens: string[], q: number): Map<string, number> {
    const profile = new Map<string, number>();
    if (tokens.length < q) return profile;

    for (let i = 0; i <= tokens.length - q; i++) {
        const gram = tokens.slice(i, i + q).join('\x00');
        profile.set(gram, (profile.get(gram) ?? 0) + 1);
    }
    return profile;
}

/**
 * 计算两个 Q-gram 轮廓的 Jaccard 相似度
 *
 * 使用多重集合 Jaccard：Σmin / Σmax
 *
 * @param profile1 轮廓 1
 * @param profile2 轮廓 2
 * @returns 相似度 [0, 1]
 */
export function qgramJaccard(profile1: Map<string, number>, profile2: Map<string, number>): number {
    const allKeys = new Set([...profile1.keys(), ...profile2.keys()]);

    let sumMin = 0;
    let sumMax = 0;
    for (const key of allKeys) {
        const c1 = profile1.get(key) ?? 0;
        const c2 = profile2.get(key) ?? 0;
        sumMin += Math.min(c1, c2);
        sumMax += Math.max(c1, c2);
    }

    return sumMax === 0 ? 0 : sumMin / sumMax;
}
