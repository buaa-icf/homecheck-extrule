import * as fs from "fs";

export interface ReadSourceResult {
    content: string | null;
    errorMessage?: string;
}

export function readSourceFile(filePath: string): ReadSourceResult {
    try {
        return {
            content: fs.readFileSync(filePath, "utf-8")
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "unknown read error";
        return {
            content: null,
            errorMessage: message
        };
    }
}
