import { TokenType } from "../FragmentDetection/Token";
import { Tokenizer } from "../FragmentDetection/Tokenizer";

export type ConditionalTokenKind = "if" | "elseIf" | "else";

export interface ConditionalToken {
    kind: ConditionalTokenKind;
    depth: number;
    line: number;
    column: number;
}

export interface CaseLineCount {
    label: string;
    lines: number;
}

export interface SourceSwitchBlock {
    startLineIndex: number;
    switchColumn: number;
    text: string;
}

function countBraceDelta(text: string): number {
    return (text.match(/\{/g)?.length ?? 0) - (text.match(/\}/g)?.length ?? 0);
}

export function buildSwitchKey(line: number, caseCount: number): string {
    return `${line}-${caseCount}`;
}

export function containsSwitch(text: string): boolean {
    return /\bswitch\s*\(/.test(text);
}

export function countCases(text: string): number {
    const matches = text.match(/\bcase\b|\bdefault\b/g);
    return matches ? matches.length : 0;
}

export function collectBraceDelimitedBlock(lines: string[], startIdx: number): string {
    const blockLines: string[] = [];
    let braceDepth = 0;
    let started = false;

    for (let i = startIdx; i < lines.length; i++) {
        const text = lines[i];
        const delta = countBraceDelta(text);

        if (!started) {
            started = true;
            braceDepth += delta;
            blockLines.push(text);
            continue;
        }

        braceDepth += delta;
        blockLines.push(text);

        if (braceDepth <= 0) {
            break;
        }
    }

    return blockLines.join("\n");
}

export function collectSourceSwitchBlocks(lines: string[]): SourceSwitchBlock[] {
    const blocks: SourceSwitchBlock[] = [];
    let inSwitch = false;
    let braceDepth = 0;
    let blockLines: string[] = [];
    let startLineIndex = 0;

    const flushBlock = (): void => {
        if (blockLines.length === 0) {
            return;
        }

        const switchColumn = lines[startLineIndex].indexOf("switch");
        blocks.push({
            startLineIndex,
            switchColumn: switchColumn >= 0 ? switchColumn : 0,
            text: blockLines.join("\n")
        });

        inSwitch = false;
        braceDepth = 0;
        blockLines = [];
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (!inSwitch) {
            if (!containsSwitch(line)) {
                continue;
            }

            inSwitch = true;
            startLineIndex = i;
            blockLines = [line];
            braceDepth = countBraceDelta(line);

            if (braceDepth < 0) {
                inSwitch = false;
                blockLines = [];
                braceDepth = 0;
            }

            continue;
        }

        blockLines.push(line);
        braceDepth += countBraceDelta(line);

        if (braceDepth <= 0) {
            flushBlock();
        }
    }

    if (inSwitch) {
        flushBlock();
    }

    return blocks;
}

export function calculateCaseLineCounts(text: string): CaseLineCount[] {
    const lines = text.split(/\r?\n/);
    const result: CaseLineCount[] = [];

    let currentLabel: string | null = null;
    let startLineIdx = 0;

    const pushCase = (endIdx: number, isFinal: boolean): void => {
        if (currentLabel === null) {
            return;
        }

        let trimmedEnd = endIdx;
        if (isFinal) {
            while (trimmedEnd > startLineIdx && /^[\s}]*$/.test(lines[trimmedEnd - 1])) {
                trimmedEnd--;
            }
        }

        const count = Math.max(1, trimmedEnd - startLineIdx);
        result.push({ label: currentLabel, lines: count });
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const caseMatch = line.match(/\bcase\s+([^:]+):/);
        const isDefault = /\bdefault\s*:/.test(line);

        if (caseMatch || isDefault) {
            pushCase(i, false);
            currentLabel = caseMatch ? caseMatch[1].trim() : "default";
            startLineIdx = i;
        }
    }

    pushCase(lines.length, true);

    return result;
}

export function scanConditionalTokens(code: string): ConditionalToken[] {
    const rawTokens = new Tokenizer({ skipComments: true }).tokenize(code);
    const conditionalTokens: ConditionalToken[] = [];
    let depth = 0;

    for (let i = 0; i < rawTokens.length; i++) {
        const token = rawTokens[i];

        if (token.type === TokenType.PUNCTUATION && token.value === "{") {
            depth++;
            continue;
        }

        if (token.type === TokenType.PUNCTUATION && token.value === "}") {
            depth = Math.max(0, depth - 1);
            continue;
        }

        if (token.type !== TokenType.KEYWORD) {
            continue;
        }

        if (token.value === "else") {
            const next = rawTokens[i + 1];
            if (next && next.type === TokenType.KEYWORD && next.value === "if") {
                conditionalTokens.push({ kind: "elseIf", depth, line: token.line, column: token.column });
                i++;
            } else {
                conditionalTokens.push({ kind: "else", depth, line: token.line, column: token.column });
            }
            continue;
        }

        if (token.value === "if") {
            conditionalTokens.push({ kind: "if", depth, line: token.line, column: token.column });
        }
    }

    return conditionalTokens;
}

export function isNestedInsideElseBlock(tokens: ConditionalToken[], startIndex: number): boolean {
    const current = tokens[startIndex];
    if (current.depth <= 0) {
        return false;
    }

    for (let i = startIndex - 1; i >= 0; i--) {
        const candidate = tokens[i];
        if (candidate.depth < current.depth) {
            return candidate.kind === "else" && candidate.depth === current.depth - 1;
        }
    }

    return false;
}

export function countElseIfChainBranches(tokens: ConditionalToken[], startIndex: number): number {
    const chainDepth = tokens[startIndex].depth;
    let branches = 1;

    for (let i = startIndex + 1; i < tokens.length; i++) {
        const candidate = tokens[i];
        if (candidate.depth < chainDepth) {
            break;
        }
        if (candidate.depth > chainDepth) {
            continue;
        }
        if (candidate.kind === "elseIf") {
            branches++;
            continue;
        }
        if (candidate.kind === "else" || candidate.kind === "if") {
            break;
        }
    }

    return branches;
}
