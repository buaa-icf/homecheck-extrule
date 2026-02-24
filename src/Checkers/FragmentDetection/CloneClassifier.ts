import { MergedClone } from './CloneMerger';
import { UnionFind } from './UnionFind';

export interface CloneClassMember {
    file: string;
    startLine: number;
    endLine: number;
    startIndex: number;
    endIndex: number;
}

export interface CloneClass {
    classId: number;
    members: CloneClassMember[];
}

/**
 * 将 MergedClone 列表分组为克隆类
 */
export function classifyClones(clones: MergedClone[]): CloneClass[] {
    const uf = new UnionFind();
    const membersByKey = new Map<string, CloneClassMember>();

    const addMember = (location: CloneClassMember): string => {
        const key = `${location.file}:${location.startLine}-${location.endLine}:${location.startIndex}-${location.endIndex}`;
        if (!membersByKey.has(key)) {
            membersByKey.set(key, location);
            uf.find(key);
        }
        return key;
    };

    for (const clone of clones) {
        const key1 = addMember(clone.location1);
        const key2 = addMember(clone.location2);
        uf.union(key1, key2);
    }

    const classes: CloneClass[] = [];
    const groups = uf.getGroups();
    const sortedRoots = [...groups.keys()].sort();

    for (const root of sortedRoots) {
        const keys = groups.get(root) ?? [];
        if (keys.length < 2) {
            continue;
        }

        const members = keys
            .map(key => membersByKey.get(key))
            .filter((member): member is CloneClassMember => member !== undefined)
            .sort((a, b) => {
                if (a.file !== b.file) {
                    return a.file.localeCompare(b.file);
                }
                if (a.startLine !== b.startLine) {
                    return a.startLine - b.startLine;
                }
                return a.startIndex - b.startIndex;
            });

        classes.push({
            classId: classes.length + 1,
            members
        });
    }

    return classes;
}
