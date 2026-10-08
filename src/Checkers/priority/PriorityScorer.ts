import { CloneScope, FragmentCloneReport } from "../fragment-clone";

export type PriorityLevel = "P1" | "P2" | "P3" | "P4";

export interface PriorityResult {
    priorityScore: number;
    priorityLevel: PriorityLevel;
}

interface ScoreParts {
    maintenanceImpact: number;
    smellSpecificEvidence: number;
    changeAmplification: number;
    comprehensionRisk: number;
    thresholdRatio: number;
}

function clamp(value: number, maximum: number): number {
    return Math.max(0, Math.min(maximum, Math.round(Number.isFinite(value) ? value : 0)));
}

export function thresholdScore(ratio: number): number {
    if (ratio <= 1 || !Number.isFinite(ratio)) return 0;
    if (ratio <= 1.25) return 1;
    if (ratio <= 1.5) return 2;
    if (ratio <= 2) return 4;
    if (ratio <= 3) return 7;
    return 10;
}

export function scorePriority(parts: ScoreParts): PriorityResult {
    const priorityScore = clamp(
        clamp(parts.maintenanceImpact, 30)
        + clamp(parts.smellSpecificEvidence, 30)
        + clamp(parts.changeAmplification, 20)
        + clamp(parts.comprehensionRisk, 10)
        + thresholdScore(parts.thresholdRatio),
        100
    );
    const priorityLevel: PriorityLevel = priorityScore >= 75 ? "P1"
        : priorityScore >= 50 ? "P2"
        : priorityScore >= 25 ? "P3" : "P4";
    return { priorityScore, priorityLevel };
}

function countMatches(source: string, pattern: RegExp): number {
    return [...source.matchAll(pattern)].length;
}

/** Scores only evidence visible in the source at scan time. */
export function scoreLongMethod(source: string, lines: number, limit: number, isUi: boolean): PriorityResult {
    const branchCount = countMatches(source, /\b(?:if|switch|case|for|while|catch)\b/g);
    const uiBlocks = isUi ? countMatches(source, /\b(?:Row|Column|ListItem|TextInput|Button|Dialog|ForEach)\s*\(/g) : 0;
    const stateWrites = countMatches(source, /\bthis\.[A-Za-z_$][\w$]*\s*(?:=(?!=)|\+\+|--)/g);
    const singleStream = !isUi
        && countMatches(source, /\b(?:input|reader|stream|buffer)\.(?:read|next|get)[A-Za-z_$]*\s*\(/g) >= 8;
    const distinctStages = isUi ? Math.min(4, Math.floor(uiBlocks / 3))
        : Math.min(4, Math.floor(branchCount / 4));
    if (singleStream) {
        return scorePriority({
            maintenanceImpact: 12,
            smellSpecificEvidence: 4,
            changeAmplification: 4,
            comprehensionRisk: Math.min(10, 3 + Math.floor(branchCount / 5)),
            thresholdRatio: limit > 0 ? lines / limit : 0
        });
    }
    return scorePriority({
        maintenanceImpact: Math.min(30, 5 + distinctStages * 4 + Math.min(8, stateWrites)),
        smellSpecificEvidence: isUi ? Math.min(30, 3 + distinctStages * 6)
            : Math.min(30, 3 + distinctStages * 5),
        changeAmplification: Math.min(20, 2 + distinctStages * 3 + Math.floor(stateWrites / 3)),
        comprehensionRisk: Math.min(10, 1 + Math.floor(branchCount / 4) + Math.floor(stateWrites / 5)),
        thresholdRatio: limit > 0 ? lines / limit : 0
    });
}

export function scoreFeatureEnvy(source: string, atfd: number, lda: number, cpfd: number, threshold: number): PriorityResult {
    const foreignFieldReads = countMatches(source, /\b(?:this\.)?[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*/g);
    const assignments = countMatches(source, /(?:\.|\])\s*[A-Za-z_$]?[\w$]*\s*=(?!=)/g);
    const branches = countMatches(source, /\b(?:if|switch|case|for|while)\b/g);
    const formulaLike = /\b(?:hue|saturation|rgb|hsv|sin|cos|sqrt|pow)\b/i.test(source)
        && countMatches(source, /[+*/%-]/g) >= 5;
    const providerFocused = cpfd <= 1 && lda < 0.2;
    return scorePriority({
        maintenanceImpact: formulaLike ? 8 : Math.min(30, 7 + Math.floor(atfd / 3) + assignments * 2),
        smellSpecificEvidence: formulaLike ? 4 : Math.min(30, 7 + (providerFocused ? 8 : 2) + assignments * 2 + Math.floor(atfd / 8)),
        changeAmplification: formulaLike ? 3 : Math.min(20, 3 + Math.floor(foreignFieldReads / 5) + assignments),
        comprehensionRisk: Math.min(10, 2 + Math.floor(branches / 2) + Math.floor(atfd / 10)),
        thresholdRatio: threshold > 0 ? atfd / threshold : 0
    });
}

export function scoreSwitch(source: string, branches: number, threshold: number, caseLineCounts: number[] = []): PriorityResult {
    const bodyLines = caseLineCounts.filter(lines => lines > 1);
    const longBranches = bodyLines.filter(lines => lines >= 4).length;
    const repeatedCalls = countMatches(source, /\b(?:set|save|update|write|emit)[A-Z][\w$]*\s*\(/g);
    const sharedHandling = countMatches(source, /\b(?:catch|finally|console\.|logger\.)/g);
    const dense = branches > 0 ? longBranches / branches : 0;
    return scorePriority({
        maintenanceImpact: Math.min(30, 4 + longBranches * 2 + Math.floor(repeatedCalls / 2)),
        smellSpecificEvidence: Math.min(30, 3 + Math.floor(dense * 12) + Math.min(10, sharedHandling * 2)),
        changeAmplification: Math.min(20, 2 + Math.floor(longBranches * 1.5) + Math.floor(sharedHandling / 2)),
        comprehensionRisk: Math.min(10, 2 + Math.floor(longBranches / 3) + (source.includes("if") ? 2 : 0)),
        thresholdRatio: threshold > 0 ? branches / threshold : 0
    });
}

export function scoreCodeClone(report: FragmentCloneReport, left: string, right: string, minimumTokens: number): PriorityResult {
    const sameFile = report.location1.file === report.location2.file;
    const sameClass = report.scope === CloneScope.SAME_CLASS || report.scope === CloneScope.SAME_METHOD;
    const content = `${left}\n${right}`;
    const dataOnly = !/\b(?:if|for|while|switch|return|throw|await|onClick|onChange)\b/.test(content)
        && !/\bthis\.[A-Za-z_$]/.test(content);
    const behavior = countMatches(content, /\b(?:if|for|while|switch|return|throw|await|onClick|onChange)\b/g);
    const base = dataOnly ? 2 : sameClass ? 18 : sameFile ? 13 : 8;
    return scorePriority({
        maintenanceImpact: Math.min(30, base + Math.min(8, behavior)),
        smellSpecificEvidence: Math.min(30, dataOnly ? 3 : base + Math.min(8, behavior * 2)),
        changeAmplification: Math.min(20, dataOnly ? 1 : Math.min(20, base - 2 + Math.floor(report.lineCount / 10))),
        comprehensionRisk: Math.min(10, dataOnly ? 1 : 2 + Math.floor(report.lineCount / 12)),
        thresholdRatio: minimumTokens > 0 ? report.tokenCount / minimumTokens : 0
    });
}
