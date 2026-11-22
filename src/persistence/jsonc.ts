/**
 * JSON with `//` and block comments and trailing commas (the config.json editor's dialect).
 * Written by hand because browsers no longer report where JSON.parse failed: a syntax error carries
 * its 1-based line and column so the editor can point at it.
 */

export interface JsoncError {
  message: string;
  line: number;
  column: number;
}

export type JsoncResult = { ok: true; value: unknown } | { ok: false; error: JsoncError };

class Fail extends Error {
  constructor(
    msg: string,
    readonly at: number,
  ) {
    super(msg);
  }
}

const put = (o: Record<string, unknown>, k: string, v: unknown): void => {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
};

export function parseJsonc(src: string): JsoncResult {
  let i = 0;
  const fail = (msg: string, at = i): never => {
    throw new Fail(msg, at);
  };

  const ws = (): void => {
    for (;;) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '﻿') i++;
      else if (c === '/' && src[i + 1] === '/') {
        while (i < src.length && src[i] !== '\n') i++;
      } else if (c === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        if (end < 0) fail('this /* comment is never closed');
        i = end + 2;
      } else return;
    }
  };

  const str = (): string => {
    const start = i++;
    while (i < src.length && src[i] !== '"') {
      if (src[i] === '\n') fail('this string is never closed', start);
      i += src[i] === '\\' ? 2 : 1;
    }
    if (i >= src.length) fail('this string is never closed', start);
    i++;
    try {
      return JSON.parse(src.slice(start, i)) as string;
    } catch {
      return fail('invalid text in this string', start);
    }
  };

  const value = (): unknown => {
    ws();
    const c = src[i];
    if (c === '{') {
      i++;
      const o: Record<string, unknown> = {};
      for (;;) {
        ws();
        if (src[i] === '}') {
          i++;
          return o;
        }
        if (src[i] !== '"') fail('expected a "key" in double quotes, or "}"');
        const k = str();
        ws();
        if (src[i] !== ':') fail('expected ":" after the key');
        i++;
        put(o, k, value());
        ws();
        if (src[i] === ',') {
          i++;
          continue;
        }
        if (src[i] === '}') {
          i++;
          return o;
        }
        fail('expected "," or "}" (is a comma missing?)');
      }
    }
    if (c === '[') {
      i++;
      const a: unknown[] = [];
      for (;;) {
        ws();
        if (src[i] === ']') {
          i++;
          return a;
        }
        a.push(value());
        ws();
        if (src[i] === ',') {
          i++;
          continue;
        }
        if (src[i] === ']') {
          i++;
          return a;
        }
        fail('expected "," or "]"');
      }
    }
    if (c === '"') return str();
    for (const [word, v] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (src.startsWith(word, i)) {
        i += word.length;
        return v;
      }
    }
    const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i, i + 40));
    if (m) {
      i += m[0].length;
      return Number(m[0]);
    }
    return fail(c === undefined ? 'the text ends too early' : `unexpected "${c}" (values are numbers, true, false, null, "text", [ ] or { })`);
  };

  try {
    ws();
    if (i >= src.length) return { ok: false, error: { message: 'empty: write a { ... } object', line: 1, column: 1 } };
    const v = value();
    ws();
    if (i < src.length) fail('unexpected text after the closing brace');
    return { ok: true, value: v };
  } catch (e) {
    if (e instanceof Fail) {
      const before = src.slice(0, e.at);
      const line = before.split('\n').length;
      const column = e.at - before.lastIndexOf('\n');
      return { ok: false, error: { message: e.message, line, column } };
    }
    throw e;
  }
}

export const formatJsoncError = (e: JsoncError): string => `line ${e.line}, column ${e.column}: ${e.message}`;
