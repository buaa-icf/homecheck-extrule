import { ts } from "arkanalyzer";

export function normalizeBasic(text: string): string {
    text = text.replace(/\s+/g, " ").trim();
    text = text.replace(/@[^:\s]+\.[a-z]+:/gi, "@FILE:");
    text = text.replace(/this: @FILE: \w+/g, "this: @FILE: CLASS");
    text = text.replace(/%AC\d+/g, "%AC");
    return text;
}

const TYPE2_KEYWORDS: Set<string> = (() => {
    const keywords = new Set<string>();

    for (let kind = ts.SyntaxKind.BreakKeyword; kind <= ts.SyntaxKind.OfKeyword; kind++) {
        const name = ts.tokenToString(kind as ts.SyntaxKind);
        if (name) {
            keywords.add(name);
        }
    }

    const structKeyword = ts.tokenToString(ts.SyntaxKind.StructKeyword);
    if (structKeyword) {
        keywords.add(structKeyword);
    }

    const builtinNames = [
        "undefined", "NaN", "Infinity",
        "length", "push", "pop", "map", "filter", "forEach", "indexOf",
        "console", "log", "toFixed", "trim", "toString",
        "Array", "Object", "String", "Number", "Boolean", "Map", "Set",
        "Promise", "Date", "RegExp", "Error", "JSON", "Math"
    ];
    for (const name of builtinNames) {
        keywords.add(name.toLowerCase());
    }

    for (let i = 0; i <= 9; i++) {
        keywords.add(`parameter${i}`);
    }

    return keywords;
})();

export function normalizeIdentifiers(
    text: string,
    identifierMap: Map<string, string>,
    normalizeSingleChar: boolean = false
): string {
    const identifierPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    return text.replace(identifierPattern, (match) => {
        if (TYPE2_KEYWORDS.has(match.toLowerCase()) || (!normalizeSingleChar && match.length <= 1)) {
            return match;
        }
        if (match === match.toUpperCase() && match.length > 1) {
            return match;
        }
        if (identifierMap.has(match)) {
            return identifierMap.get(match)!;
        }
        const normalized = `ID_${identifierMap.size + 1}`;
        identifierMap.set(match, normalized);
        return normalized;
    });
}

export function normalizeLiterals(text: string): string {
    text = text.replace(/\b\d+\.?\d*([eE][+-]?\d+)?\b/g, "NUM");
    text = text.replace(/\b0x[0-9a-fA-F]+\b/g, "NUM");
    text = text.replace(/"[^"]*"/g, "STR");
    text = text.replace(/'[^']*'/g, "STR");
    return text;
}

export function stripTypeAnnotations(text: string): string {
    text = text.replace(/:\s*[A-Za-z_][\w]*(\s*<[^>]*>)?(\s*\[\])*/g, "");
    text = text.replace(/\bas\b\s+[A-Za-z_][\w]*/g, "");
    return text;
}

export function stripDecorators(text: string): string {
    text = text.replace(/@[A-Za-z_][\w]*(\s*\([^)]*\))?/g, "");
    return text;
}
