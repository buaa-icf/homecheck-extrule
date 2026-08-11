import { TokenType } from '../src/Checkers/FragmentDetection/Token';
import { tokenize } from '../src/Checkers/FragmentDetection/Tokenizer';

describe('Tokenizer template continuation regression', () => {
    test('continues scanning after a template expression', () => {
        const tokens = tokenize('const text = `hello ${name}`; const afterTemplate = 1;');
        expect(tokens.some(token => token.value === 'afterTemplate')).toBe(true);
    });

    test('handles multiple substitutions and nested templates', () => {
        const source = 'const text = `a ${x} b ${{ value: `nested ${y}` }.value} c`; const done = true;';
        const tokens = tokenize(source);

        expect(tokens.some(token => token.value === 'done')).toBe(true);
        expect(tokens.filter(token => token.type === TokenType.LITERAL).length).toBeGreaterThanOrEqual(5);
    });

    test('continues after multiline and escaped template contents', () => {
        const source = 'const text = `line 1\n\\`escaped\\` \\${literal} ${value}`;\nconst tailMarker = 2;';
        const tokens = tokenize(source);
        expect(tokens.some(token => token.value === 'tailMarker')).toBe(true);
    });
});
