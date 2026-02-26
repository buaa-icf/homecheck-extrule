import { UnionFind } from "../FragmentDetection";

export interface MethodCloneMember {
    filePath: string;
    className: string;
    methodName: string;
    startLine: number;
    endLine: number;
}

export interface MethodCloneClass<TMember extends MethodCloneMember> {
    classId: number;
    members: TMember[];
}

interface MethodClonePair<TMember extends MethodCloneMember> {
    method1: TMember;
    method2: TMember;
}

function getMethodKey(member: MethodCloneMember): string {
    return `${member.filePath}:${member.className}.${member.methodName}:${member.startLine}`;
}

export function classifyMethodClonePairs<TMember extends MethodCloneMember>(
    pairs: MethodClonePair<TMember>[]
): Array<MethodCloneClass<TMember>> {
    const uf = new UnionFind();
    const methodByKey = new Map<string, TMember>();

    for (const pair of pairs) {
        const key1 = getMethodKey(pair.method1);
        const key2 = getMethodKey(pair.method2);
        methodByKey.set(key1, pair.method1);
        methodByKey.set(key2, pair.method2);
        uf.find(key1);
        uf.find(key2);
        uf.union(key1, key2);
    }

    const classes: Array<MethodCloneClass<TMember>> = [];
    const groups = uf.getGroups();
    const sortedRoots = [...groups.keys()].sort();

    for (const root of sortedRoots) {
        const keys = groups.get(root) ?? [];
        if (keys.length < 2) {
            continue;
        }

        const members = keys
            .map(key => methodByKey.get(key))
            .filter((member): member is TMember => member !== undefined)
            .sort((a, b) => {
                if (a.filePath !== b.filePath) {
                    return a.filePath.localeCompare(b.filePath);
                }
                return a.startLine - b.startLine;
            });

        classes.push({
            classId: classes.length + 1,
            members
        });
    }

    return classes;
}
