/*
 * Copyright (c) 2024 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ArkMethod, Stmt } from "arkanalyzer";
import { Defects, IssueReport, Rule } from "homecheck";

export interface DefectsParams {
    line: number;
    startCol: number;
    endCol: number;
    description: string;
    severity: number;
    ruleId: string;
    filePath: string;
    ruleDocPath: string;
    methodName?: string;
    showIgnoreIcon?: boolean;
    disabled?: boolean;
    checked?: boolean;
    fixable?: boolean;
}

function hasSameType(defaultValue: unknown, candidateValue: unknown): boolean {
    if (defaultValue === null) {
        return candidateValue === null;
    }

    if (Array.isArray(defaultValue)) {
        return Array.isArray(candidateValue);
    }

    if (typeof defaultValue === "object") {
        return typeof candidateValue === "object" && candidateValue !== null && !Array.isArray(candidateValue);
    }

    return typeof candidateValue === typeof defaultValue;
}

export function getRuleOption<T extends Record<string, unknown>>(rule: Rule, defaults: T): T {
    const result: T = { ...defaults };

    if (!rule || !Array.isArray(rule.option) || rule.option.length === 0) {
        return result;
    }

    const firstOption = rule.option[0];
    if (typeof firstOption !== "object" || firstOption === null || Array.isArray(firstOption)) {
        return result;
    }

    const optionObject = firstOption as Record<string, unknown>;
    for (const key of Object.keys(defaults) as Array<keyof T>) {
        const defaultValue = defaults[key];
        if (!(key in optionObject)) {
            continue;
        }

        const candidateValue = optionObject[key as string];
        if (hasSameType(defaultValue, candidateValue)) {
            result[key] = candidateValue as T[keyof T];
        }
    }

    return result;
}

export function createDefects(params: DefectsParams): IssueReport {
    const defects = new Defects(
        params.line,
        params.startCol,
        params.endCol,
        params.description,
        params.severity,
        params.ruleId,
        params.filePath,
        params.ruleDocPath,
        params.disabled ?? true,
        params.checked ?? false,
        params.fixable ?? false,
        params.methodName,
        params.showIgnoreIcon ?? true
    );

    return new IssueReport(defects, undefined);
}

export function djb2Hash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(16);
}

export function getMethodEndLine(method: ArkMethod): number {
    const startLine = method.getLine() ?? 0;
    const body = method.getBody();
    if (!body) {
        return startLine;
    }

    const stmts = body.getCfg().getStmts();
    let maxLine = startLine;
    for (const stmt of stmts) {
        const pos = stmt.getOriginPositionInfo();
        if (pos) {
            const line = pos.getLineNo();
            if (line > maxLine) {
                maxLine = line;
            }
        }
    }

    return maxLine;
}

export function shouldSkipClass(className: string): boolean {
    return className.startsWith("%");
}

export function shouldSkipMethod(methodName: string): boolean {
    return methodName === "constructor" || methodName.startsWith("%");
}

export function normalizeBasic(text: string): string {
    text = text.replace(/\s+/g, " ").trim();
    text = text.replace(/@[^:\s]+\.[a-z]+:/gi, "@FILE:");
    text = text.replace(/this: @FILE: \w+/g, "this: @FILE: CLASS");
    text = text.replace(/%AC\d+/g, "%AC");
    return text;
}

export function isLogStatement(stmt: Stmt): boolean {
    const text = stmt.toString().trim();
    const logPattern = /^(console|hilog|Logger)\.\w+\s*\([\s\S]*\)$/i;
    return logPattern.test(text);
}

/** TypeScript/ArkTS keywords — not normalized */
const TYPE2_KEYWORDS = new Set([
    'let', 'const', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
    'true', 'false', 'null', 'undefined', 'this', 'new', 'class', 'extends',
    'number', 'string', 'boolean', 'void', 'any', 'object',
    'length', 'push', 'pop', 'map', 'filter', 'forEach', 'indexOf',
    'console', 'log', 'toFixed', 'trim', 'toString',
    'parameter0', 'parameter1', 'parameter2'
]);

export function normalizeIdentifiers(text: string, identifierMap: Map<string, string>): string {
    const identifierPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    return text.replace(identifierPattern, (match) => {
        if (TYPE2_KEYWORDS.has(match.toLowerCase()) || match.length <= 1) {
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
    text = text.replace(/\b\d+\.?\d*([eE][+-]?\d+)?\b/g, 'NUM');
    text = text.replace(/\b0x[0-9a-fA-F]+\b/g, 'NUM');
    text = text.replace(/"[^"]*"/g, 'STR');
    text = text.replace(/'[^']*'/g, 'STR');
    return text;
}
