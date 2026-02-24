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

import { ArkMethod, Stmt, ts } from "arkanalyzer";
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

/**
 * 动态构建 TypeScript/ArkTS 关键字集合
 * 
 * 通过遍历 ts.SyntaxKind 枚举（BreakKeyword ~ OfKeyword 范围）自动获取所有关键字，
 * 不再需要手动维护硬编码列表。额外添加常见内置 API 名称和 ArkAnalyzer 参数占位符，
 * 防止它们被规范化。
 */
const TYPE2_KEYWORDS: Set<string> = (() => {
    const keywords = new Set<string>();
    
    // 从 ts.SyntaxKind 枚举中提取所有关键字（BreakKeyword ~ OfKeyword）
    for (let kind = ts.SyntaxKind.BreakKeyword; kind <= ts.SyntaxKind.OfKeyword; kind++) {
        const name = ts.tokenToString(kind as ts.SyntaxKind);
        if (name) {
            keywords.add(name);
        }
    }
    
    // ArkTS 特有关键字
    const structKeyword = ts.tokenToString(ts.SyntaxKind.StructKeyword);
    if (structKeyword) {
        keywords.add(structKeyword);
    }
    
    // 常见内置对象/方法名（不应规范化）
    const builtinNames = [
        'undefined', 'NaN', 'Infinity',
        'length', 'push', 'pop', 'map', 'filter', 'forEach', 'indexOf',
        'console', 'log', 'toFixed', 'trim', 'toString',
        'Array', 'Object', 'String', 'Number', 'Boolean', 'Map', 'Set',
        'Promise', 'Date', 'RegExp', 'Error', 'JSON', 'Math',
    ];
    for (const name of builtinNames) {
        keywords.add(name);
    }
    
    // ArkAnalyzer IR 参数占位符
    for (let i = 0; i <= 9; i++) {
        keywords.add(`parameter${i}`);
    }
    
    return keywords;
})();

export function normalizeIdentifiers(text: string, identifierMap: Map<string, string>, normalizeSingleChar: boolean = false): string {
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
    text = text.replace(/\b\d+\.?\d*([eE][+-]?\d+)?\b/g, 'NUM');
    text = text.replace(/\b0x[0-9a-fA-F]+\b/g, 'NUM');
    text = text.replace(/"[^"]*"/g, 'STR');
    text = text.replace(/'[^']*'/g, 'STR');
    return text;
}

/**
 * 剥离类型注解（用于方法级克隆检测）
 *
 * 移除 ArkTS/TypeScript 中的类型注解，包括：
 * - 变量/参数类型标注 `: Type`
 * - 泛型类型 `: Type<T>`
 * - 数组类型 `: Type[]`
 * - 类型断言 `as Type`
 *
 * 注意：这是基于正则的粗粒度实现，适用于方法级 IR 文本。
 * 片段级检测使用 Tokenizer 中更精确的 Token 过滤。
 */
export function stripTypeAnnotations(text: string): string {
    // 移除 `: Type<T>[]` 模式（含可选泛型和数组标记）
    text = text.replace(/:\s*[A-Za-z_][\w]*(\s*<[^>]*>)?(\s*\[\])*/g, '');
    // 移除 `as Type` 模式
    text = text.replace(/\bas\b\s+[A-Za-z_][\w]*/g, '');
    return text;
}

/**
 * 剥离装饰器（用于方法级克隆检测）
 *
 * 移除 ArkTS/TypeScript 中的装饰器，包括：
 * - 简单装饰器 `@Decorator`
 * - 带参数装饰器 `@Decorator(args)`
 */
export function stripDecorators(text: string): string {
    // 移除 @Decorator 或 @Decorator(...) 模式
    text = text.replace(/@[A-Za-z_][\w]*(\s*\([^)]*\))?/g, '');
    return text;
}
