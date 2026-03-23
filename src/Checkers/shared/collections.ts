export function appendToBucket<TKey, TValue>(
    buckets: Map<TKey, TValue[]>,
    key: TKey,
    value: TValue
): TValue[] {
    const bucket = buckets.get(key);
    if (bucket) {
        bucket.push(value);
        return bucket;
    }

    const newBucket = [value];
    buckets.set(key, newBucket);
    return newBucket;
}

export function groupBy<TKey, TValue>(
    items: Iterable<TValue>,
    keySelector: (item: TValue) => TKey
): Map<TKey, TValue[]> {
    const buckets = new Map<TKey, TValue[]>();
    for (const item of items) {
        appendToBucket(buckets, keySelector(item), item);
    }
    return buckets;
}

export function flattenBuckets<TKey, TValue>(buckets: Map<TKey, TValue[]>): TValue[] {
    const flattened: TValue[] = [];
    for (const bucket of buckets.values()) {
        flattened.push(...bucket);
    }
    return flattened;
}

export function pairwiseCombinations<TItem>(items: TItem[]): Array<[TItem, TItem]> {
    const pairs: Array<[TItem, TItem]> = [];

    for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
            pairs.push([items[i], items[j]]);
        }
    }

    return pairs;
}
