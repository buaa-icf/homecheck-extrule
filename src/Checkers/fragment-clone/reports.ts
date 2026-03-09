import { MergedClone } from "../FragmentDetection";
import { CodeLocation, FragmentCloneReport } from "./types";

type CloneLike = Pick<MergedClone, "location1" | "location2" | "tokenCount"> & {
    similarity?: number;
};

type LocationResolver = (file: string, startLine: number, endLine: number) => CodeLocation;

export function buildFragmentCloneReport(
    clone: CloneLike,
    cloneType: "Type-1" | "Type-2" | "Type-3",
    scopeResolver: (location1: CodeLocation, location2: CodeLocation) => FragmentCloneReport["scope"],
    resolveLocation: LocationResolver
): FragmentCloneReport {
    const location1 = resolveLocation(
        clone.location1.file,
        clone.location1.startLine,
        clone.location1.endLine
    );
    const location2 = resolveLocation(
        clone.location2.file,
        clone.location2.startLine,
        clone.location2.endLine
    );

    const lineCount = Math.max(
        clone.location1.endLine - clone.location1.startLine + 1,
        clone.location2.endLine - clone.location2.startLine + 1
    );

    return {
        cloneType,
        scope: scopeResolver(location1, location2),
        location1,
        location2,
        tokenCount: clone.tokenCount,
        lineCount,
        similarity: clone.similarity
    };
}
