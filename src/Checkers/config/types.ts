export interface FragmentCloneRuleOptions {
    minimumTokens: number;
    normalizeIdentifiers: boolean;
    normalizeLiterals: boolean;
    ignoreTypes: boolean;
    ignoreDecorators: boolean;
    ignoreLogs: boolean;
    ignoreImports: boolean;
    minDistinctTokenTypes: number;
    enableCloneClasses: boolean;
    similarityThreshold: number;
    maxPairsPerFingerprint: number;
}

export interface LongMethodRuleOptions {
    maxStmts: number;
    maxLines: number;
    maxUIStmtsSoft: number;
    maxUIStmtsHard: number;
}

export interface FeatureEnvyRuleOptions {
    atfdThreshold: number;
    ldaThreshold: number;
    cpfdThreshold: number;
}

export interface SwitchStatementRuleOptions {
    minCases: number;
}

export interface ForeachArgsRuleOptions {
    minArgs: number;
}
