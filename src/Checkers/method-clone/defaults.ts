import { RuleOptionSchema } from "../config/parseRuleOptions";
import { MethodCloneRuleOptions } from "../config/types";

export const DEFAULT_METHOD_CLONE_OPTIONS: MethodCloneRuleOptions = {
    minStmts: 5,
    ignoreLiterals: false,
    ignoreLogs: true,
    ignoreTypes: false,
    ignoreDecorators: false,
    minComplexity: 0,
    similarityThreshold: 1.0,
    enableCloneClasses: false
};

export const METHOD_CLONE_OPTIONS_SCHEMA: RuleOptionSchema<MethodCloneRuleOptions> = {
    minStmts: { type: "number", min: 1 },
    ignoreLiterals: { type: "boolean" },
    ignoreLogs: { type: "boolean" },
    ignoreTypes: { type: "boolean" },
    ignoreDecorators: { type: "boolean" },
    minComplexity: { type: "number", min: 0 },
    similarityThreshold: { type: "number", min: 0, max: 1 },
    enableCloneClasses: { type: "boolean" }
};
