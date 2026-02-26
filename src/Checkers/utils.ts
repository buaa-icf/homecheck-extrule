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

import { Rule } from "homecheck";
import { DefectsParams, createIssueReport } from "./reporting";
import {
    djb2Hash,
    getMethodEndLine,
    isLogStatement,
    normalizeBasic,
    normalizeIdentifiers,
    normalizeLiterals,
    shouldSkipClass,
    shouldSkipMethod,
    stripDecorators,
    stripTypeAnnotations
} from "./shared";

/**
 * @deprecated Use parseRuleOptions from ./config directly.
 * Kept for backward compatibility with existing imports.
 */
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

/**
 * @deprecated Use parseRuleOptions from ./config directly.
 */
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

export function createDefects(params: DefectsParams) {
    return createIssueReport(params);
}

export {
    DefectsParams,
    djb2Hash,
    getMethodEndLine,
    isLogStatement,
    normalizeBasic,
    normalizeIdentifiers,
    normalizeLiterals,
    shouldSkipClass,
    shouldSkipMethod,
    stripDecorators,
    stripTypeAnnotations
};
