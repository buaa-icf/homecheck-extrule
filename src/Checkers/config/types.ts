export interface MethodCloneRuleOptions {
    minStmts: number;
    ignoreLiterals: boolean;
    ignoreLogs: boolean;
    ignoreTypes: boolean;
    ignoreDecorators: boolean;
    minComplexity: number;
    similarityThreshold: number;
    enableCloneClasses: boolean;
}

export interface FragmentCloneRuleOptions {
    minimumTokens: number;
    normalizeIdentifiers: boolean;
    normalizeLiterals: boolean;
    ignoreTypes: boolean;
    ignoreDecorators: boolean;
    ignoreLogs: boolean;
    minDistinctTokenTypes: number;
    enableCloneClasses: boolean;
    similarityThreshold: number;
}

export interface LongMethodRuleOptions {
    maxStmts: number;
    maxLines: number;
    maxUIStmtsSoft: number;
    maxUIStmtsHard: number;
}

export interface FeatureEnvyRuleOptions {
    minTotalCalls: number;
    minForeignCalls: number;
    ratioThreshold: number;
}

export interface SwitchStatementRuleOptions {
    minCases: number;
}

export interface ForeachArgsRuleOptions {
    minArgs: number;
}
