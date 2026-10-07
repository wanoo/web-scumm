// The property keys of a TypeScript source, found by a small scanner (4.1.12, the IR's provenance): every
// `key: value` written in an object literal, with its line, the value when it is a string literal (`id: 'x'`), and
// the key or the variable that owns the object it is in (`items` for `key: {…}` inside `items: {…}` or
// `const items = {…}`). Strings, template literals and comments are skipped, so "the key: Grandpa" inside a line is
// never a key. Pure, no compiler: the core runs in the browser too.

/** One `key:` of an object literal: its name, its line (from 1), its string value, and the owner of its object. */
export interface SourceKey {
  key: string;
  line: number;
  value?: string;
  /** The key (`items: {`), the variable (`const items = {`) or the call (`defineRoom({`) whose object holds it. */
  parent?: string;
}

type Tok = { t: 'name' | 'str' | 'punct'; v: string; line: number };

function tokens(text: string): Tok[] {
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
  return toks;
}

/** Every object-literal key of `text`, in order. */
export function sourceKeys(text: string): SourceKey[] {
  const toks = tokens(text);
  const out: SourceKey[] = [];
  /** The owners of the brackets open at this point (the innermost last). */
  const owners: string[] = [];
  let declared: string | undefined;
  for (let k = 0; k < toks.length; k++) {
    const a = toks[k]!,
      prev = toks[k - 1],
      before = toks[k - 2];
    if (a.t === 'name' && prev?.t === 'name' && /^(const|let|var)$/.test(prev.v)) declared = a.v;
    if (a.t === 'punct' && (a.v === '{' || a.v === '[' || a.v === '(')) {
      const owner =
        prev?.t === 'punct' && prev.v === ':' && before && before.t !== 'punct'
          ? before.v
          : prev?.t === 'punct' && prev.v === '='
            ? (declared ?? '')
            : prev?.t === 'punct' && prev.v === '(' && toks[k - 2]?.t === 'name'
              ? toks[k - 2]!.v
              : (owners.at(-1) ?? '');
      owners.push(a.v === '(' && prev?.t === 'name' ? prev.v : owner);
      continue;
    }
    if (a.t === 'punct' && (a.v === '}' || a.v === ']' || a.v === ')')) {
      owners.pop();
      continue;
    }
    const colon = toks[k + 1];
    if (a.t === 'punct' || colon?.v !== ':' || colon.t !== 'punct') continue;
    if (prev && !(prev.t === 'punct' && (prev.v === '{' || prev.v === ','))) continue;
    const next = toks[k + 2];
    const parent = owners.at(-1);
    out.push({
      key: a.v,
      line: a.line,
      ...(next?.t === 'str' ? { value: next.v } : {}),
      ...(parent ? { parent } : {}),
    });
  }
  return out;
}
