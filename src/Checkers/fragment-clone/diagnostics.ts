export interface FragmentCloneDiagnostics {
    filesReadFailed: number;
    filesProcessFailed: number;
    errors: Array<{ filePath: string; phase: "read" | "process"; message: string }>;
}

export function createEmptyDiagnostics(): FragmentCloneDiagnostics {
    return {
        filesReadFailed: 0,
        filesProcessFailed: 0,
        errors: []
    };
}
