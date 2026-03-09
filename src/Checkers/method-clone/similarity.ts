export function buildTokenMultiset(tokens: string[]): Map<string, number> {
    const multiset = new Map<string, number>();
    for (const token of tokens) {
        if (token.length === 0) {
            continue;
        }
        multiset.set(token, (multiset.get(token) ?? 0) + 1);
    }
    return multiset;
}

export function jaccardSimilarityFromMultisets(
    set1: Map<string, number>,
    set2: Map<string, number>
): number {
    const allKeys = new Set([...set1.keys(), ...set2.keys()]);
    let sumMin = 0;
    let sumMax = 0;
    for (const key of allKeys) {
        const c1 = set1.get(key) ?? 0;
        const c2 = set2.get(key) ?? 0;
        sumMin += Math.min(c1, c2);
        sumMax += Math.max(c1, c2);
    }
    return sumMax === 0 ? 0 : sumMin / sumMax;
}
