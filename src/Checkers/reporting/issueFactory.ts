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

export function createIssueReport(params: DefectsParams): IssueReport {
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
