import { Rule } from "homecheck";
import { RuleOptionSchema, parseRuleOptions } from "../config/parseRuleOptions";
import { FragmentCloneRuleOptions } from "../config/types";

export const DEFAULT_FRAGMENT_CLONE_OPTIONS: FragmentCloneRuleOptions = {
    minimumTokens: 100,
    normalizeIdentifiers: true,
    normalizeLiterals: false,
    ignoreTypes: false,
    ignoreDecorators: false,
    ignoreLogs: true,
    minDistinctTokenTypes: 0,
    enableCloneClasses: false,
    similarityThreshold: 1.0
};

const FRAGMENT_CLONE_OPTIONS_SCHEMA: RuleOptionSchema<FragmentCloneRuleOptions> = {
    minimumTokens: { type: "number", min: 1 },
    normalizeIdentifiers: { type: "boolean" },
    normalizeLiterals: { type: "boolean" },
    ignoreTypes: { type: "boolean" },
    ignoreDecorators: { type: "boolean" },
    ignoreLogs: { type: "boolean" },
    minDistinctTokenTypes: { type: "number", min: 0 },
    enableCloneClasses: { type: "boolean" },
    similarityThreshold: { type: "number", min: 0, max: 1 }
};

export function parseFragmentCloneOptions(rule?: Rule): FragmentCloneRuleOptions {
    return parseRuleOptions(rule, FRAGMENT_CLONE_OPTIONS_SCHEMA, DEFAULT_FRAGMENT_CLONE_OPTIONS);
}
