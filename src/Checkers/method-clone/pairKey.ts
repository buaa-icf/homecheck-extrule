export interface CloneMethodIdentity {
    filePath: string;
    methodName: string;
}

export function getPairKey(method1: CloneMethodIdentity, method2: CloneMethodIdentity): string {
    const key1 = `${method1.filePath}:${method1.methodName}`;
    const key2 = `${method2.filePath}:${method2.methodName}`;
    return [key1, key2].sort().join("|");
}
