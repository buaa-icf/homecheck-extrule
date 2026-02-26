import { ArkFile } from "arkanalyzer";
import { getMethodEndLine, shouldSkipClass, shouldSkipMethod } from "../shared";
import { CodeLocation } from "./types";

export function resolveCodeLocationFromCache(
    fileCache: Map<string, ArkFile>,
    file: string,
    startLine: number,
    endLine: number
): CodeLocation {
    const location: CodeLocation = {
        file,
        startLine,
        endLine
    };

    const arkFile = fileCache.get(file);
    if (!arkFile) {
        return location;
    }

    for (const arkClass of arkFile.getClasses()) {
        const className = arkClass.getName();
        if (shouldSkipClass(className)) {
            continue;
        }

        for (const method of arkClass.getMethods()) {
            const methodName = method.getName();
            if (shouldSkipMethod(methodName)) {
                continue;
            }

            const methodStartLine = method.getLine() ?? 0;
            const methodEndLine = getMethodEndLine(method);
            if (startLine >= methodStartLine && endLine <= methodEndLine) {
                location.className = className;
                location.methodName = methodName;
                return location;
            }
        }
    }

    return location;
}
