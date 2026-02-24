/**
 * 滚动哈希模块
 *
 * 基于 Rabin-Karp 实现 Token 序列的 O(1) 窗口滑动哈希。
 * 使用双哈希降低碰撞概率。
 */

/**
 * 滚动哈希类
 */
export class RollingHash {
    /** 第一个哈希值 */
    private hash1: number = 0;

    /** 第二个哈希值 */
    private hash2: number = 0;

    /** 第一个哈希的基数 */
    private readonly base1: number = 131;

    /** 第二个哈希的基数 */
    private readonly base2: number = 137;

    /** 第一个哈希的模数 */
    private readonly mod1: number = 1_000_000_007;

    /** 第二个哈希的模数 */
    private readonly mod2: number = 1_000_000_009;

    /** 窗口大小 */
    private readonly windowSize: number;

    /** base1^(windowSize-1) % mod1 */
    private readonly pow1: number;

    /** base2^(windowSize-1) % mod2 */
    private readonly pow2: number;

    /**
     * 构造函数
     *
     * @param windowSize 窗口大小
     */
    constructor(windowSize: number) {
        if (windowSize <= 0) {
            throw new Error('windowSize must be greater than 0');
        }

        this.windowSize = windowSize;
        this.pow1 = this.computePower(this.base1, windowSize - 1, this.mod1);
        this.pow2 = this.computePower(this.base2, windowSize - 1, this.mod2);
    }

    /**
     * 初始化首个窗口哈希
     *
     * @param tokenIds 首个窗口的 Token ID 列表
     * @returns 组合哈希键
     */
    init(tokenIds: number[]): string {
        if (tokenIds.length !== this.windowSize) {
            throw new Error(`tokenIds length must equal windowSize (${this.windowSize})`);
        }

        this.hash1 = 0;
        this.hash2 = 0;

        for (const tokenId of tokenIds) {
            const normalized1 = this.normalizeMod(tokenId, this.mod1);
            const normalized2 = this.normalizeMod(tokenId, this.mod2);

            this.hash1 = this.normalizeMod(
                this.mulMod(this.hash1, this.base1, this.mod1) + normalized1,
                this.mod1
            );
            this.hash2 = this.normalizeMod(
                this.mulMod(this.hash2, this.base2, this.mod2) + normalized2,
                this.mod2
            );
        }

        return this.getHashKey();
    }

    /**
     * 滑动窗口并更新哈希
     *
     * @param removeId 被移出窗口的 Token ID
     * @param addId 新加入窗口的 Token ID
     * @returns 组合哈希键
     */
    slide(removeId: number, addId: number): string {
        const removeContribution1 = this.mulMod(
            this.normalizeMod(removeId, this.mod1),
            this.pow1,
            this.mod1
        );
        const removeContribution2 = this.mulMod(
            this.normalizeMod(removeId, this.mod2),
            this.pow2,
            this.mod2
        );

        this.hash1 = this.normalizeMod(
            this.mulMod(this.normalizeMod(this.hash1 - removeContribution1, this.mod1), this.base1, this.mod1) +
                this.normalizeMod(addId, this.mod1),
            this.mod1
        );
        this.hash2 = this.normalizeMod(
            this.mulMod(this.normalizeMod(this.hash2 - removeContribution2, this.mod2), this.base2, this.mod2) +
                this.normalizeMod(addId, this.mod2),
            this.mod2
        );

        return this.getHashKey();
    }

    /**
     * 获取当前哈希键
     */
    getHashKey(): string {
        return `${this.hash1}_${this.hash2}`;
    }

    /**
     * 计算 (a * b) % mod
     */
    private mulMod(a: number, b: number, mod: number): number {
        return (a * b) % mod;
    }

    /**
     * 计算 base^exp % mod
     */
    private computePower(base: number, exp: number, mod: number): number {
        let result = 1;
        for (let i = 0; i < exp; i++) {
            result = this.mulMod(result, base, mod);
        }
        return result;
    }

    /**
     * 将值规范到 [0, mod) 范围
     */
    private normalizeMod(value: number, mod: number): number {
        const normalized = value % mod;
        return normalized < 0 ? normalized + mod : normalized;
    }
}
