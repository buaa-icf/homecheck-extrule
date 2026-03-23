import { CodeLocation, CloneScope, FragmentCloneReport } from "./types";
import { FragmentCloneRuleOptions } from "../config/types";
import { getBaseName } from "../shared";

/**
 * 判定两段代码的克隆范围（同方法/同类/跨类）。
 */
export function determineScope(loc1: CodeLocation, loc2: CodeLocation): CloneScope {
    if (
        loc1.file === loc2.file &&
        loc1.className === loc2.className &&
        loc1.methodName === loc2.methodName &&
        loc1.methodName !== undefined
    ) {
        return CloneScope.SAME_METHOD;
    }

    if (
        loc1.file === loc2.file &&
        loc1.className === loc2.className &&
        loc1.className !== undefined
    ) {
        return CloneScope.SAME_CLASS;
    }

    return CloneScope.DIFFERENT_CLASS;
}

/**
 * 基于克隆类成员集合判定该类的整体范围。
 */
export function determineClassScope(members: CodeLocation[]): CloneScope {
    if (members.length < 2) {
        return CloneScope.DIFFERENT_CLASS;
    }

    const first = members[0];
    const allSameMethod = members.every(member =>
        member.file === first.file &&
        member.className === first.className &&
        member.methodName === first.methodName &&
        member.methodName !== undefined
    );
    if (allSameMethod) {
        return CloneScope.SAME_METHOD;
    }

    const allSameClass = members.every(member =>
        member.file === first.file &&
        member.className === first.className &&
        member.className !== undefined
    );
    if (allSameClass) {
        return CloneScope.SAME_CLASS;
    }

    return CloneScope.DIFFERENT_CLASS;
}

/**
 * 将范围枚举映射为报告描述文本。
 */
export function getScopeDescription(scope: CloneScope): string {
    switch (scope) {
        case CloneScope.SAME_METHOD:
            return "same method";
        case CloneScope.SAME_CLASS:
            return "same class";
        case CloneScope.DIFFERENT_CLASS:
            return "different classes";
        default:
            return "unknown";
    }
}

/**
 * 格式化代码位置。
 *
 * 约定：左侧可读性优先（文件名），右侧可定位性优先（完整路径）。
 */
export function formatLocation(loc: CodeLocation, useFullPath: boolean = false): string {
    const filePart = useFullPath ? loc.file : getBaseName(loc.file);

    if (loc.className && loc.methodName) {
        return `${filePart} > ${loc.className}.${loc.methodName}():${loc.startLine}-${loc.endLine}`;
    }
    if (loc.className) {
        return `${filePart} > ${loc.className}:${loc.startLine}-${loc.endLine}`;
    }
    return `${filePart}:${loc.startLine}-${loc.endLine}`;
}

/**
 * 统一格式化片段克隆描述消息。
 */
export function formatDescription(report: FragmentCloneReport): string {
    const { cloneType, scope, location1, location2, tokenCount, lineCount, similarity } = report;
    const scopeDesc = getScopeDescription(scope);
    const left = formatLocation(location1, false);
    const right = formatLocation(location2, true);

    if (similarity !== undefined && similarity < 1.0) {
        const pct = Math.round(similarity * 100);
        return `Code Clone ${cloneType} (${scopeDesc}): ${left} is similar to ${right}. (${tokenCount} tokens, ${lineCount} lines, ${pct}% similar)`;
    }

    return `Code Clone ${cloneType} (${scopeDesc}): ${left} is similar to ${right}. (${tokenCount} tokens, ${lineCount} lines)`;
}

/**
 * 根据规范化配置判定 Type-1 / Type-2。
 */
export function detectCloneType(options: Pick<FragmentCloneRuleOptions, "normalizeIdentifiers" | "normalizeLiterals">): "Type-1" | "Type-2" {
    if (!options.normalizeIdentifiers && !options.normalizeLiterals) {
        return "Type-1";
    }
    return "Type-2";
}
