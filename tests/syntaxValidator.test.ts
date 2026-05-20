/**
 * Strong syntax validator tests — TS compiler path + brace-balance fallback.
 */

import { validateSyntax, validateBraceBalance } from '../src/core/syntaxValidator.js';

describe('validateSyntax: TypeScript', () => {
  it('accepts well-formed TS', () => {
    const code = `
      function add(a: number, b: number): number {
        return a + b;
      }
      const x = add(1, 2);
    `;
    const result = validateSyntax('test.ts', code);
    expect(result.valid).toBe(true);
    expect(result.strategy).toBe('typescript-compiler');
  });

  it('rejects parse errors', () => {
    const code = `
      function add(a: number, b: number) {
        return a +;
      }
    `;
    const result = validateSyntax('test.ts', code);
    expect(result.valid).toBe(false);
    expect(result.strategy).toBe('typescript-compiler');
    expect(result.error).toBeDefined();
  });

  it('accepts well-formed TSX', () => {
    const code = `
      import React from 'react';
      export const Hello = ({ name }: { name: string }) => <div>{name}</div>;
    `;
    const result = validateSyntax('test.tsx', code);
    expect(result.valid).toBe(true);
  });

  it('rejects malformed JSX', () => {
    const code = `
      import React from 'react';
      export const Hello = () => <div></span>;
    `;
    const result = validateSyntax('test.tsx', code);
    expect(result.valid).toBe(false);
  });
});

describe('validateSyntax: brace balance fallback', () => {
  it('accepts balanced braces', () => {
    const r = validateBraceBalance('function () { return { a: [1, 2, 3] }; }');
    expect(r.valid).toBe(true);
  });
  it('rejects unbalanced braces', () => {
    const r = validateBraceBalance('function () { return { a: 1; }');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('Unbalanced');
  });
  it('ignores braces inside strings and comments', () => {
    const r = validateBraceBalance('const s = "}}}";\n// {{{\n/* { */\n');
    expect(r.valid).toBe(true);
  });
});

describe('validateSyntax: unknown extensions', () => {
  it('falls back to brace balance for .xyz', () => {
    const result = validateSyntax('weird.xyz', 'a { b { c } }');
    expect(result.valid).toBe(true);
    expect(result.strategy).toBe('brace-balance');
  });
});
