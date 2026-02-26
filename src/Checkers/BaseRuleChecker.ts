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

import { BaseMetaData, BaseChecker, Rule, IssueReport, MatcherCallback } from "homecheck";
import { RuleOptionSchema, parseRuleOptions } from "./config/parseRuleOptions";
import { createDefects, DefectsParams } from "./shared";

/**
 * Issue 上报参数（ruleId / ruleDocPath / severity 由基类自动填充）。
 */
export type IssueParams = Omit<DefectsParams, 'severity' | 'ruleId' | 'ruleDocPath'> & {
    severity?: number;
};

/**
 * 文件级 BaseChecker 通用基类，消除各 Checker 中重复的样板代码。
 *
 * 提供：
 * - 配置解析与惰性初始化（beforeCheck / getOptions）
 * - 统一 Issue 上报入口（reportIssue / getSeverity）
 *
 * 子类只需声明 metaData / optionSchema / defaultOptions，
 * 并实现 registerMatchers() 与具体 check 逻辑。
 */
export abstract class BaseRuleChecker<TOptions extends object> implements BaseChecker {
    abstract readonly metaData: BaseMetaData;
    public rule: Rule;
    public issues: IssueReport[] = [];

    protected abstract readonly optionSchema: RuleOptionSchema<TOptions>;
    protected abstract readonly defaultOptions: TOptions;

    private _resolvedOptions: TOptions | null = null;
    private _optionsInitialized = false;

    /**
     * 每轮检测开始时重置状态并解析配置。
     */
    public beforeCheck(): void {
        this.issues = [];
        this._resolvedOptions = parseRuleOptions(this.rule, this.optionSchema, this.defaultOptions);
        this._optionsInitialized = true;
    }

    /**
     * 获取已解析的配置；未初始化时自动解析（测试场景兜底）。
     */
    protected getOptions(): TOptions {
        if (!this._optionsInitialized) {
            this._resolvedOptions = parseRuleOptions(this.rule, this.optionSchema, this.defaultOptions);
            this._optionsInitialized = true;
        }
        return this._resolvedOptions!;
    }

    /**
     * 统一 severity 解析：支持 rule 覆盖与手动 override。
     */
    protected getSeverity(override?: number): number {
        return override ?? this.rule?.alert ?? this.metaData.severity;
    }

    /**
     * 统一 Issue 上报入口，自动填充 ruleId / ruleDocPath / severity。
     */
    protected reportIssue(params: IssueParams): void {
        this.issues.push(createDefects({
            ...params,
            severity: params.severity ?? this.getSeverity(),
            ruleId: this.rule.ruleId,
            ruleDocPath: this.metaData.ruleDocPath,
        }));
    }

    abstract registerMatchers(): MatcherCallback[];

    /**
     * 子类通过 registerMatchers 的 callback 实现检测逻辑，
     * 此处提供空默认实现以满足 BaseChecker 接口约束。
     * 子类可自由覆盖签名（如接受 ArkMethod 参数）。
     */
    public check = (_target?: any): void => {}
}
