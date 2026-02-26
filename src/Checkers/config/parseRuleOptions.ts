import { Rule } from "homecheck";

type PrimitiveType = "boolean" | "number" | "string";

interface RuleOptionFieldSchema<TValue> {
    type: PrimitiveType;
    aliases?: string[];
    min?: number;
    max?: number;
    allowNaN?: boolean;
    validate?: (value: TValue) => boolean;
    transform?: (value: TValue) => TValue;
}

export type RuleOptionSchema<TOptions extends object> = {
    [K in keyof TOptions]: RuleOptionFieldSchema<TOptions[K]>;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesType(expected: PrimitiveType, value: unknown): boolean {
    if (expected === "boolean") {
        return typeof value === "boolean";
    }

    if (expected === "number") {
        return typeof value === "number";
    }

    return typeof value === "string";
}

export function parseRuleOptions<TOptions extends object>(
    rule: Rule | undefined,
    schema: RuleOptionSchema<TOptions>,
    defaults: TOptions
): TOptions {
    const result = { ...defaults } as TOptions;
    if (!rule || !Array.isArray(rule.option) || rule.option.length === 0) {
        return result;
    }

    const firstOption = rule.option[0];
    if (!isObjectRecord(firstOption)) {
        return result;
    }

    for (const key of Object.keys(schema) as Array<keyof TOptions>) {
        const field = schema[key];
        const candidateKeys = [String(key), ...(field.aliases ?? [])];
        let rawValue: unknown = undefined;
        let found = false;

        for (const candidateKey of candidateKeys) {
            if (candidateKey in firstOption) {
                rawValue = firstOption[candidateKey];
                found = true;
                break;
            }
        }

        if (!found || !matchesType(field.type, rawValue)) {
            continue;
        }

        let typedValue = rawValue as TOptions[typeof key];
        if (field.type === "number") {
            const numberValue = typedValue as number;
            if (!field.allowNaN && !Number.isFinite(numberValue)) {
                continue;
            }
            if (field.min !== undefined && numberValue < field.min) {
                continue;
            }
            if (field.max !== undefined && numberValue > field.max) {
                continue;
            }
        }

        const validate = field.validate as ((value: TOptions[typeof key]) => boolean) | undefined;
        if (validate && !validate(typedValue)) {
            continue;
        }

        const transform = field.transform as ((value: TOptions[typeof key]) => TOptions[typeof key]) | undefined;
        if (transform) {
            typedValue = transform(typedValue);
        }

        result[key] = typedValue;
    }

    return result;
}
