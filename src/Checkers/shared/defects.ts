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

import { Defects, IssueReport } from "homecheck";

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

export function createDefects(params: DefectsParams) {
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
