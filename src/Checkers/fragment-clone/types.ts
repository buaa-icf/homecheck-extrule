export enum CloneScope {
    SAME_METHOD = "SAME_METHOD",
    SAME_CLASS = "SAME_CLASS",
    DIFFERENT_CLASS = "DIFFERENT_CLASS"
}

export interface CodeLocation {
    file: string;
    startLine: number;
    endLine: number;
    className?: string;
    methodName?: string;
}

export interface FragmentCloneReport {
    cloneType: "Type-1" | "Type-2" | "Type-3";
    scope: CloneScope;
    location1: CodeLocation;
    location2: CodeLocation;
    tokenCount: number;
    lineCount: number;
    similarity?: number;
}

export interface FragmentCloneClassReport {
    cloneType: "Type-1" | "Type-2" | "Type-3";
    scope: CloneScope;
    classId: number;
    members: CodeLocation[];
}
