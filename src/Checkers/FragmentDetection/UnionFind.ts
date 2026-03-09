/**
 * Union-Find（并查集）数据结构
 *
 * 用于将克隆对分组为等价类（克隆类）。
 */
export class UnionFind {
    private parent: Map<string, string> = new Map();
    private rank: Map<string, number> = new Map();

    /**
     * 查找节点所在集合的根（带路径压缩）
     */
    find(x: string): string {
        if (!this.parent.has(x)) {
            this.parent.set(x, x);
            this.rank.set(x, 0);
            return x;
        }

        const px = this.parent.get(x)!;
        if (px !== x) {
            const root = this.find(px);
            this.parent.set(x, root);
            return root;
        }

        return px;
    }

    /**
     * 合并两个节点所在的集合（按秩合并）
     */
    union(x: string, y: string): void {
        const rootX = this.find(x);
        const rootY = this.find(y);

        if (rootX === rootY) {
            return;
        }

        const rankX = this.rank.get(rootX) ?? 0;
        const rankY = this.rank.get(rootY) ?? 0;

        if (rankX < rankY) {
            this.parent.set(rootX, rootY);
            return;
        }

        if (rankX > rankY) {
            this.parent.set(rootY, rootX);
            return;
        }

        this.parent.set(rootY, rootX);
        this.rank.set(rootX, rankX + 1);
    }

    /**
     * 获取所有等价类分组
     */
    getGroups(): Map<string, string[]> {
        const groups = new Map<string, string[]>();

        for (const node of this.parent.keys()) {
            const root = this.find(node);
            const group = groups.get(root);
            if (group) {
                group.push(node);
            } else {
                groups.set(root, [node]);
            }
        }

        return groups;
    }
}
