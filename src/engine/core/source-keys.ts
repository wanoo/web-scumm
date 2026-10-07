// The property keys of a TypeScript source, found by a small scanner (4.1.12, the IR's provenance): every
// `key: value` written in an object literal, with its line, and the value when it is a string literal (`id: 'x'`).
// Strings, template literals and comments are skipped, so "the key: Grandpa" inside a line is never a key. Pure, no
// compiler: the core runs in the browser too.

/** One `key:` of an object literal: its name, its line (from 1), and its value when that is a plain string. */
export interface SourceKey {
  key: string;
  line: number;
  value?: string;
}

type Tok = { t: 'name' | 'str' | 'punct'; v: string; line: number };

/** Every object-literal key of `text`, in order. */
export function sourceKeys(text: string): SourceKey[] {
  const toks: Tok[] = [];
  let line = 1;
  for (let i = 0; i < text.length; ) {
    const c = text[i]!;
    if (c === '\n') {
      line++;
      i++;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      for (; i < stop; i++) if (text[i] === '\n') line++;
    } else if (c === "'" || c === '"' || c === '`') {
      const start = line;
      let v = '';
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') {
          const n = text[i + 1] ?? '';
          v += n === 'n' ? '\n' : n;
          i += 2;
          continue;
        }
        if (text[i] === '\n') line++;
        v += text[i];
        i++;
      }
      i++;
      toks.push({ t: 'str', v, line: start });
    } else if (/[A-Za-z_$0-9]/.test(c)) {
      let v = '';
      while (i < text.length && /[A-Za-z_$0-9]/.test(text[i]!)) v += text[i++];
      toks.push({ t: 'name', v, line });
    } else {
      if (!/\s/.test(c)) toks.push({ t: 'punct', v: c, line });
      i++;
    }
  }
  const out: SourceKey[] = [];
  for (let k = 0; k < toks.length - 1; k++) {
    const a = toks[k]!,
      colon = toks[k + 1]!,
      before = toks[k - 1];
    if (a.t === 'punct' || colon.v !== ':' || colon.t !== 'punct') continue;
    if (before && !(before.t === 'punct' && (before.v === '{' || before.v === ','))) continue;
    const next = toks[k + 2];
    out.push({ key: a.v, line: a.line, ...(next?.t === 'str' ? { value: next.v } : {}) });
  }
  return out;
}
