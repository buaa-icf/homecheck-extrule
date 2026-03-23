import { getBaseName } from "../shared";

export interface MethodCloneLocation {
    filePath: string;
    className: string;
    methodName: string;
    startLine: number;
    endLine: number;
}

export function formatMethodCloneAnchor(method: MethodCloneLocation): string {
    return `Method '${method.methodName}' (lines ${method.startLine}-${method.endLine})`;
}

export function formatMethodCloneTarget(
    method: MethodCloneLocation,
    useFullPath: boolean = false
): string {
    const filePart = useFullPath ? method.filePath : getBaseName(method.filePath);
    return `'${method.className}.${method.methodName}' in ${filePart}:${method.startLine}-${method.endLine}`;
}

export function formatMethodCloneMembers<TMember extends MethodCloneLocation>(members: TMember[]): string {
    return members
        .map(member =>
            `${member.className}.${member.methodName}() in ${getBaseName(member.filePath)}:${member.startLine}-${member.endLine}`
        )
        .join("; ");
}
