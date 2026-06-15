import { ExactCloneGroup } from './CloneMatcher';
import { MergedClone } from './CloneMerger';
import { FragmentLocation } from './HashIndex';

export interface MergedCloneMember {
    file: string;
    startLine: number;
    endLine: number;
    startIndex: number;
    endIndex: number;
}

export interface MergedCloneClass {
    classId: number;
    members: MergedCloneMember[];
    tokenCount: number;
}

export class ExactCloneClassBuilder {
    build(groups: ExactCloneGroup[]): MergedCloneClass[] {
        const classes: MergedCloneClass[] = [];

        for (const group of groups) {
            const members = this.selectMembers(group);
            if (members.length < 2) {
                continue;
            }

            classes.push({
                classId: classes.length + 1,
                members,
                tokenCount: group.tokenCount
            });
        }

        return classes;
    }

    toRepresentativeClones(classes: MergedCloneClass[]): MergedClone[] {
        const clones: MergedClone[] = [];

        for (const cloneClass of classes) {
            const first = cloneClass.members[0];
            const second = cloneClass.members[1];
            if (first === undefined || second === undefined) {
                continue;
            }

            clones.push({
                location1: { ...first },
                location2: { ...second },
                tokenCount: cloneClass.tokenCount
            });
        }

        return clones;
    }

    private selectMembers(group: ExactCloneGroup): MergedCloneMember[] {
        const selected: MergedCloneMember[] = [];
        const lastSelectedByFile = new Map<string, MergedCloneMember>();

        for (const location of [...group.locations].sort(compareLocation)) {
            const member = toMember(location, group.tokenCount);
            const lastSelected = lastSelectedByFile.get(member.file);
            if (lastSelected !== undefined && intervalsOverlap(lastSelected, member)) {
                continue;
            }
            selected.push(member);
            lastSelectedByFile.set(member.file, member);
        }

        return selected;
    }
}

function toMember(location: FragmentLocation, tokenCount: number): MergedCloneMember {
    return {
        file: location.file,
        startLine: location.startLine,
        endLine: location.endLine,
        startIndex: location.startIndex,
        endIndex: location.startIndex + tokenCount - 1
    };
}

function intervalsOverlap(a: MergedCloneMember, b: MergedCloneMember): boolean {
    return Math.max(a.startIndex, b.startIndex) <= Math.min(a.endIndex, b.endIndex);
}

function compareLocation(a: FragmentLocation, b: FragmentLocation): number {
    if (a.file !== b.file) {
        return a.file.localeCompare(b.file);
    }
    if (a.startIndex !== b.startIndex) {
        return a.startIndex - b.startIndex;
    }
    return a.startLine - b.startLine;
}
