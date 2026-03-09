/**
 * 近似克隆检测器模块
 *
 * 实现 Type-3 片段级近似克隆检测，采用两阶段策略：
 * 1. 候选生成：Q-gram 轮廓 Jaccard 预筛选（O(n+m)）
 * 2. 精确验证：LCS 相似度计算（O(n*m)）
 *
 * 将文件的 Token 序列分块为固定大小、半重叠步长的块，
 * 跨块对比寻找近似匹配。
 */

import { Token } from './Token';
import { MergedClone } from './CloneMerger';
import { buildQGramProfile, qgramJaccard, lcsSimilarity } from './SimilarityScorer';

/**
 * 近似克隆结果，扩展自 MergedClone
 */
export interface NearMissClone extends MergedClone {
    /** LCS 相似度 [0, 1]，仅 < 1.0 的对会被报告 */
    similarity: number;
}

/**
 * Token 块信息（内部使用）
 */
interface TokenBlock {
    file: string;
    startIndex: number;
    endIndex: number;
    startLine: number;
    endLine: number;
    tokenValues: string[];
    qgramProfile?: Map<string, number>;
}

/**
 * 近似克隆检测器
 *
 * 使用 Q-gram 预筛选 + LCS 精确验证的两阶段策略。
 * 默认 Q-gram 大小为 5，预筛选比率为 0.7（即 Q-gram 阈值 = similarityThreshold × 0.7）。
 */
export class NearMissDetector {
    /** 窗口大小（块大小） */
    private readonly windowSize: number;

    /** 最终相似度阈值 */
    private readonly similarityThreshold: number;

    /** Q-gram 大小 */
    private readonly qgramSize: number;

    /** 预筛选比率 */
    private readonly preFilterRatio: number = 0.7;

    /** 已注册的 Token 块列表 */
    private blocks: TokenBlock[] = [];

    /**
     * 构造函数
     *
     * @param windowSize 窗口大小（块大小）
     * @param similarityThreshold 最终相似度阈值
     * @param qgramSize Q-gram 大小，默认 5
     */
    constructor(windowSize: number, similarityThreshold: number, qgramSize: number = 5) {
        this.windowSize = windowSize;
        this.similarityThreshold = similarityThreshold;
        this.qgramSize = Math.min(qgramSize, windowSize);
    }

    /**
     * 注册文件的 Token 序列
     *
     * 将 Token 序列分块为大小为 windowSize、步长为 windowSize/2 的重叠块。
     *
     * @param tokens Token 序列
     * @param file 文件路径
     */
    addFile(tokens: Token[], file: string): void {
        if (tokens.length < this.windowSize) return;

        const stride = Math.max(1, Math.floor(this.windowSize / 2));

        for (let i = 0; i <= tokens.length - this.windowSize; i += stride) {
            const end = i + this.windowSize;
            const blockTokens = tokens.slice(i, end);

            this.blocks.push({
                file,
                startIndex: i,
                endIndex: end - 1,
                startLine: blockTokens[0].line,
                endLine: blockTokens[blockTokens.length - 1].line,
                tokenValues: blockTokens.map(t => t.value)
            });
        }
    }

    /**
     * 执行近似克隆检测
     *
     * 两阶段策略：
     * 1. 为所有块构建 Q-gram 轮廓
     * 2. 两两比较：先 Q-gram Jaccard 预筛选，通过后 LCS 精确验证
     * 3. 过滤掉完全相同的对（由精确匹配器处理）
     *
     * @returns 近似克隆列表
     */
    detect(): NearMissClone[] {
        if (this.blocks.length < 2) return [];

        // 构建 Q-gram 轮廓
        for (const block of this.blocks) {
            block.qgramProfile = buildQGramProfile(block.tokenValues, this.qgramSize);
        }

        const preFilterThreshold = this.similarityThreshold * this.preFilterRatio;
        const results: NearMissClone[] = [];

        for (let i = 0; i < this.blocks.length; i++) {
            for (let j = i + 1; j < this.blocks.length; j++) {
                const b1 = this.blocks[i];
                const b2 = this.blocks[j];

                // 跳过同文件重叠块
                if (b1.file === b2.file) {
                    if (Math.abs(b1.startIndex - b2.startIndex) < this.windowSize) {
                        continue;
                    }
                }

                // Q-gram 预筛选
                const qSim = qgramJaccard(b1.qgramProfile!, b2.qgramProfile!);
                if (qSim < preFilterThreshold) continue;

                // LCS 精确验证
                const sim = lcsSimilarity(b1.tokenValues, b2.tokenValues);

                // 只报告近似匹配（不完全相同），完全相同的由精确匹配器处理
                if (sim >= this.similarityThreshold && sim < 1.0) {
                    results.push({
                        location1: {
                            file: b1.file,
                            startLine: b1.startLine,
                            endLine: b1.endLine,
                            startIndex: b1.startIndex,
                            endIndex: b1.endIndex
                        },
                        location2: {
                            file: b2.file,
                            startLine: b2.startLine,
                            endLine: b2.endLine,
                            startIndex: b2.startIndex,
                            endIndex: b2.endIndex
                        },
                        tokenCount: this.windowSize,
                        similarity: sim
                    });
                }
            }
        }

        return results;
    }

    /**
     * 清空检测器状态
     */
    clear(): void {
        this.blocks = [];
    }
}
