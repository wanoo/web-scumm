// Room files as source code: find the texts of `defineRoom({...})` by JSON path, and edit them in place.
// Every edit replaces or inserts the smallest span of text (one literal, one list item, one property), so the file
// stays the code a human or an AI wrote: same quotes, same indentation, same comments. Pure: string in, string out.
import ts from 'typescript';
import type { TextKind } from './types';

export type Seg = string | number;

export class SourceError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** ['on', 3, 'do', 0] → `on[3].do[0]`; keys that are not identifiers become `["a.b"]`. */
export function formatPath(segs: Seg[]): string {
  let out = '';
  for (const s of segs) {
    if (typeof s === 'number' || s === '+') out += `[${s}]`;
    else if (IDENT.test(s)) out += out ? `.${s}` : s;
    else out += `[${JSON.stringify(s)}]`;
  }
  return out;
}

/** The reverse of formatPath. `[+]` (append) is returned as the string '+'. */
export function parsePath(path: string): Seg[] {
  const segs: Seg[] = [];
  let rest = path.trim();
  const re = /^(?:\.?([A-Za-z_$][\w$]*)|\[(\d+)\]|\[(\+)\]|\[("(?:[^"\\]|\\.)*")\])/;
  while (rest) {
    const m = re.exec(rest);
    if (!m || (m[1] !== undefined && segs.length === 0 && rest.startsWith('.'))) throw new SourceError(`invalid path: "${path}"`);
    if (m[1] !== undefined) segs.push(m[1]);
    else if (m[2] !== undefined) segs.push(Number(m[2]));
    else if (m[3] !== undefined) segs.push('+');
    else segs.push(JSON.parse(m[4]) as string);
    rest = rest.slice(m[0].length);
  }
  if (!segs.length) throw new SourceError('empty path');
  return segs;
}

// ---------------------------------------------------------------------------
// Which string literals are texts
// ---------------------------------------------------------------------------

/** Command lists: a bare string element is a hero line. */
const HERO_LISTS = new Set(['do', 'once', 'then', 'else', 'cutscene', 'after', 'onEnter']);
/** Lists of command lists: `nth[0][1]` is a hero line too. */
const HERO_LISTS2 = new Set(['nth', 'cycle', 'random', 'parallel']);

/** The kind of text at this path, or null for ids, image refs, flags and other non-text strings. */
export function classify(segs: Seg[]): TextKind | null {
  const n = segs.length;
  const last = segs[n - 1];
  const prev = segs[n - 2];
  if (last === 'name') return 'name';
  if (last === 'topic') return 'topic';
  if (last === 'toast') return 'toast';
  if (last === 'say' && prev === 'guide') return 'guide';
  if (last === 'text' && typeof prev === 'number' && segs[n - 3] === 'choice') return 'choice';
  if (typeof last === 'number') {
    if (prev === 'lines') return 'hint';
    if ((prev === 'say' || prev === 'shout') && last === 1) return 'say';
    if (segs[0] === 'look' && n === 3) return 'look';
    if (typeof prev === 'string' && HERO_LISTS.has(prev)) return 'hero';
    if (typeof prev === 'number' && typeof segs[n - 3] === 'string' && HERO_LISTS2.has(segs[n - 3] as string)) return 'hero';
  }
  if (segs[0] === 'look' && n === 2) return 'look';
  return null;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Lit = ts.StringLiteral | ts.NoSubstitutionTemplateLiteral;
const isLit = (n: ts.Node): n is Lit => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);

export function unwrap(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression;
  return e;
}

export function propKey(p: ts.ObjectLiteralElementLike): string | undefined {
  if (!ts.isPropertyAssignment(p)) return undefined;
  const k = p.name;
  if (ts.isIdentifier(k) || ts.isStringLiteral(k) || ts.isNumericLiteral(k) || ts.isNoSubstitutionTemplateLiteral(k)) return k.text;
  return undefined;
}

export interface Parsed { sf: ts.SourceFile; root: ts.ObjectLiteralExpression }

/** Parses a room file and finds the object given to `defineRoom(...)` (or a plain `export default {...}`). */
export function parseRoom(code: string, fileName = 'room.ts'): Parsed {
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let root: ts.ObjectLiteralExpression | undefined;
  const visit = (n: ts.Node) => {
    if (root) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'defineRoom' && n.arguments[0]) {
      const a = unwrap(n.arguments[0]);
      if (ts.isObjectLiteralExpression(a)) { root = a; return; }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!root) {
    for (const st of sf.statements) {
      if (ts.isExportAssignment(st)) { const e = unwrap(st.expression); if (ts.isObjectLiteralExpression(e)) root = e; }
    }
  }
  if (!root) throw new SourceError(`${fileName}: no defineRoom({...}) object found`, 422);
  return { sf, root };
}

export interface FoundText { segs: Seg[]; path: string; value: string; line: number; kind: TextKind; who?: string }

/** Every text literal under the room object, in file order. */
export function extractTexts(code: string, fileName?: string): FoundText[] {
  const { sf, root } = parseRoom(code, fileName);
  const out: FoundText[] = [];
  const walk = (node: ts.Expression, segs: Seg[]) => {
    const e = unwrap(node);
    if (ts.isObjectLiteralExpression(e)) {
      for (const p of e.properties) { const k = propKey(p); if (k !== undefined) walk((p as ts.PropertyAssignment).initializer, [...segs, k]); }
    } else if (ts.isArrayLiteralExpression(e)) {
      e.elements.forEach((el, i) => { if (!ts.isSpreadElement(el) && !ts.isOmittedExpression(el)) walk(el, [...segs, i]); });
    } else if (isLit(e)) {
      const kind = classify(segs);
      if (!kind) return;
      const t: FoundText = { segs, path: formatPath(segs), value: e.text, line: sf.getLineAndCharacterOfPosition(e.getStart(sf)).line + 1, kind };
      if (kind === 'say' && ts.isArrayLiteralExpression(e.parent)) {
        const w = e.parent.elements[0];
        if (w && isLit(w)) t.who = w.text;
      }
      out.push(t);
    }
  };
  walk(root, []);
  return out;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

interface Hit { node: ts.Expression; prop?: ts.PropertyAssignment; parentObj?: ts.ObjectLiteralExpression; parentArr?: ts.ArrayLiteralExpression; index?: number }

function resolve(root: ts.ObjectLiteralExpression, segs: Seg[]): Hit | undefined {
  let hit: Hit = { node: root };
  for (const s of segs) {
    const e = unwrap(hit.node);
    if (typeof s === 'string') {
      if (!ts.isObjectLiteralExpression(e)) return undefined;
      const p = e.properties.find((q) => propKey(q) === s) as ts.PropertyAssignment | undefined;
      if (!p) return undefined;
      hit = { node: p.initializer, prop: p, parentObj: e };
    } else {
      if (!ts.isArrayLiteralExpression(e)) return undefined;
      const el = e.elements[s];
      if (!el || ts.isSpreadElement(el) || ts.isOmittedExpression(el)) return undefined;
      hit = { node: el, parentArr: e, index: s };
    }
  }
  return hit;
}

// ---------------------------------------------------------------------------
// Writing literals
// ---------------------------------------------------------------------------

export function encodeString(value: string, q: string): string {
  let s = value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  if (q === '`') s = s.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  else s = s.split(q).join('\\' + q);
  return q + s + q;
}

/** The quote most used by the file's string literals (single by default). */
export function fileQuote(sf: ts.SourceFile): string {
  let single = 0, double = 0;
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n)) { if (sf.text[n.getStart(sf)] === '"') double++; else single++; }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return double > single ? '"' : "'";
}

const keyText = (k: string) => (IDENT.test(k) ? k : `'${k.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

interface Edit { code: string; at: number }
const splice = (code: string, start: number, end: number, text: string): Edit => ({ code: code.slice(0, start) + text + code.slice(end), at: start });
const lineOf = (code: string, pos: number) => code.slice(0, pos).split('\n').length;
const lineStart = (code: string, pos: number) => code.lastIndexOf('\n', pos - 1) + 1;
const indentAt = (code: string, pos: number) => /^[ \t]*/.exec(code.slice(lineStart(code, pos)))![0];
/** True if only whitespace sits between the start of the line and pos. */
const firstOnLine = (code: string, pos: number) => /^[ \t]*$/.test(code.slice(lineStart(code, pos), pos));

/** Position just after the comma that follows `end` (skipping whitespace and comments), or -1. */
function commaAfter(sf: ts.SourceFile, end: number, limit: number): number {
  const sc = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, sf.text.slice(end, limit));
  let t = sc.scan();
  while (t === ts.SyntaxKind.WhitespaceTrivia || t === ts.SyntaxKind.NewLineTrivia || t === ts.SyntaxKind.SingleLineCommentTrivia || t === ts.SyntaxKind.MultiLineCommentTrivia) t = sc.scan();
  return t === ts.SyntaxKind.CommaToken ? end + sc.getTokenEnd() : -1;
}

/** Removes one list item (array element or object property) with its separator, keeping the neighbours' layout. */
function removeItem(sf: ts.SourceFile, item: ts.Node, list: ts.NodeArray<ts.Node>, container: ts.Node): Edit {
  const code = sf.text;
  const i = list.indexOf(item);
  let start = item.getStart(sf);
  let end = item.end;
  const comma = commaAfter(sf, end, container.end - 1);
  if (comma >= 0) end = comma;
  const eol = code.indexOf('\n', end);
  const restOfLine = code.slice(end, eol < 0 ? code.length : eol);
  if (firstOnLine(code, start) && /^[ \t]*$/.test(restOfLine)) {
    // The item owns its line(s): remove them whole.
    return splice(code, lineStart(code, start), eol < 0 ? code.length : eol + 1, '');
  }
  if (comma >= 0) {
    while (code[end] === ' ' || code[end] === '\t') end++;
    return splice(code, start, end, '');
  }
  if (i > 0) start = list[i - 1].end; // last item, inline: remove ", item"
  return splice(code, start, end, '');
}

/**
 * Inserts `text` as a new last item of a list (array elements or object properties), formatted like the
 * neighbours: on its own line with the same indentation if the last item has its own line, inline otherwise.
 * `after` inserts after that item instead of the last one.
 */
function insertItem(sf: ts.SourceFile, list: ts.NodeArray<ts.Node>, container: ts.Node, text: string, after?: ts.Node): Edit {
  const code = sf.text;
  const open = container.getStart(sf);
  if (!list.length) {
    const inner = code.slice(open + 1, container.end - 1);
    if (inner.includes('\n')) {
      const ind = indentAt(code, open);
      return splice(code, open + 1, container.end - 1, `\n${ind}  ${text},\n${ind}`);
    }
    const pad = ts.isObjectLiteralExpression(container) ? ' ' : '';
    return splice(code, open + 1, container.end - 1, `${pad}${text}${pad}`);
  }
  const anchor = after ?? list[list.length - 1];
  const isLast = anchor === list[list.length - 1];
  const s = anchor.getStart(sf);
  const prevStart = list.indexOf(anchor) > 0 ? list[list.indexOf(anchor) - 1].getStart(sf) : open;
  const ownLine = firstOnLine(code, s) && lineOf(code, s) !== lineOf(code, prevStart);
  const comma = commaAfter(sf, anchor.end, container.end - 1);
  if (ownLine) {
    const ind = indentAt(code, s);
    const trailing = isLast ? comma >= 0 : true;
    // A blank line between the anchor and the next item (sections of a room): keep that rhythm.
    const next = isLast ? undefined : list[list.indexOf(anchor) + 1];
    const blank = next ? /\n[ \t]*\n/.test(code.slice(anchor.end, next.getStart(sf))) : false;
    if (comma >= 0) return { code: code.slice(0, comma) + `${blank ? '\n' : ''}\n${ind}${text}${trailing ? ',' : ''}` + code.slice(comma), at: comma + (blank ? 2 : 1) + ind.length };
    const ins = `,\n${ind}${text}`;
    return { code: code.slice(0, anchor.end) + ins + code.slice(anchor.end), at: anchor.end + 2 + ind.length };
  }
  if (comma >= 0 && !isLast) return { code: code.slice(0, comma) + ` ${text},` + code.slice(comma), at: comma + 1 };
  return { code: code.slice(0, anchor.end) + `, ${text}` + code.slice(anchor.end), at: anchor.end + 2 };
}

// ---------------------------------------------------------------------------
// Public edits
// ---------------------------------------------------------------------------

export interface SourceEdit { code: string; line: number; changed: boolean }

/**
 * Replaces the string literal at `path` with `value` (same quote style). `value: null` deletes it (an array
 * element, or a whole `look.<id>`); a path ending in `[+]` appends a line (`look.<id>[+]` creates the entry if absent,
 * and turns a single look line into a list).
 */
export function setTextInSource(code: string, path: string, value: string | null, fileName?: string): SourceEdit {
  const segs = parsePath(path);
  const { sf, root } = parseRoom(code, fileName);
  if (segs.slice(0, -1).includes('+')) throw new SourceError(`invalid path: "${path}" ([+] must come last)`);

  if (segs[segs.length - 1] === '+') {
    if (typeof value !== 'string') throw new SourceError('append needs a string value');
    return appendText(sf, root, segs.slice(0, -1) as Seg[], value, path);
  }

  const hit = resolve(root, segs);
  if (!hit) throw new SourceError(`path not found: "${path}"`, 404);
  const node = unwrap(hit.node);

  if (value === null) {
    const isLook = segs[0] === 'look';
    if (hit.parentArr) {
      // The last line of a look list: remove the whole entry rather than leave an empty list.
      if (hit.parentArr.elements.length === 1 && isLook && segs.length === 3) return deleteText(sf, root, segs.slice(0, 2), path);
      if (!isLit(node) || !classify(segs)) throw new SourceError(`not a text: "${path}"`);
      const e = removeItem(sf, hit.node, hit.parentArr.elements, hit.parentArr);
      return { code: e.code, line: lineOf(e.code, e.at), changed: true };
    }
    if (isLook && segs.length === 2) return deleteText(sf, root, segs, path);
    throw new SourceError(`cannot delete "${path}": only list lines and look entries can be deleted`);
  }

  if (!isLit(node)) throw new SourceError(`not a string literal: "${path}"`);
  if (!classify(segs)) throw new SourceError(`not a text: "${path}" (ids, images and flags are not edited here)`);
  const start = node.getStart(sf);
  const line = lineOf(code, start);
  if (node.text === value) return { code, line, changed: false };
  const q = code[start];
  return { code: code.slice(0, start) + encodeString(value, q) + code.slice(node.end), line, changed: true };
}

function deleteText(sf: ts.SourceFile, root: ts.ObjectLiteralExpression, segs: Seg[], path: string): SourceEdit {
  const hit = resolve(root, segs);
  if (!hit?.prop || !hit.parentObj) throw new SourceError(`path not found: "${path}"`, 404);
  const e = removeItem(sf, hit.prop, hit.parentObj.properties, hit.parentObj);
  return { code: e.code, line: lineOf(e.code, e.at), changed: true };
}

function appendText(sf: ts.SourceFile, root: ts.ObjectLiteralExpression, segs: Seg[], value: string, path: string): SourceEdit {
  const q = fileQuote(sf);
  if (!classify([...segs, 0])) throw new SourceError(`cannot append to "${path}": its lines are not texts`);
  const hit = resolve(root, segs);
  if (!hit) {
    // look.<id>[+] on an entity with no look yet: create the entry (and the look object if needed).
    if (segs.length === 2 && segs[0] === 'look' && typeof segs[1] === 'string') {
      return addProperty(sf, root, ['look'], segs[1], encodeString(value, q));
    }
    throw new SourceError(`path not found: "${formatPath(segs)}"`, 404);
  }
  const node = unwrap(hit.node);
  if (ts.isArrayLiteralExpression(node)) {
    const sib = [...node.elements].reverse().find(isLit);
    const lit = encodeString(value, sib ? sf.text[sib.getStart(sf)] : q);
    const e = insertItem(sf, node.elements, node, lit);
    return { code: e.code, line: lineOf(e.code, e.at), changed: true };
  }
  if (isLit(node) && segs[0] === 'look' && segs.length === 2) {
    const start = node.getStart(sf);
    const raw = sf.text.slice(start, node.end);
    const text = `[${raw}, ${encodeString(value, sf.text[start])}]`;
    return { code: sf.text.slice(0, start) + text + sf.text.slice(node.end), line: lineOf(sf.text, start), changed: true };
  }
  throw new SourceError(`cannot append to "${path}": not a list`);
}

/** Canonical order of a room's sections, to place a new one. */
const SECTION_ORDER = ['id', 'name', 'decor', 'music', 'hero', 'props', 'actors', 'hotspots', 'look', 'on', 'talk', 'hints', 'onEnter'];

/**
 * Adds `key: valueText` to the object at `objPath` (['props'], ['look']…), creating that object in the room if
 * absent (at its usual place among the sections). Error if the key already exists.
 */
export function addProperty(sf: ts.SourceFile, root: ts.ObjectLiteralExpression, objPath: Seg[], key: string, valueText: string): SourceEdit {
  const hit = resolve(root, objPath);
  if (hit) {
    const obj = unwrap(hit.node);
    if (!ts.isObjectLiteralExpression(obj)) throw new SourceError(`"${formatPath(objPath)}" is not an object`);
    if (obj.properties.some((p) => propKey(p) === key)) throw new SourceError(`"${formatPath([...objPath, key])}" already exists`, 409);
    const e = insertItem(sf, obj.properties, obj, `${keyText(key)}: ${valueText}`);
    return { code: e.code, line: lineOf(e.code, e.at), changed: true };
  }
  if (objPath.length !== 1 || typeof objPath[0] !== 'string') throw new SourceError(`path not found: "${formatPath(objPath)}"`, 404);
  // A new section of the room object, written on several lines like the others.
  const section = objPath[0];
  const code = sf.text;
  const props = root.properties;
  const rank = (k?: string) => { const i = SECTION_ORDER.indexOf(k ?? ''); return i < 0 ? SECTION_ORDER.length : i; };
  let anchor: ts.ObjectLiteralElementLike | undefined;
  for (const p of props) if (rank(propKey(p)) < rank(section)) anchor = p;
  const ind = props.length ? indentAt(code, props[0].getStart(sf)) : indentAt(code, root.getStart(sf)) + '  ';
  const unit = ind.slice(indentAt(code, root.getStart(sf)).length) || '  ';
  const text = `${section}: {\n${ind}${unit}${keyText(key)}: ${valueText},\n${ind}}`;
  const e = insertItem(sf, props, root, text, anchor);
  const line = lineOf(e.code, e.at) + 1;
  return { code: e.code, line, changed: true };
}

/** Adds an entry to a room section (`props`, `hotspots`, `actors`, `look`), creating the section if needed. */
export function addToSection(code: string, section: string, key: string, valueText: string, fileName?: string): SourceEdit {
  const { sf, root } = parseRoom(code, fileName);
  return addProperty(sf, root, [section], key, valueText);
}

/** `{ name: 'x', img: 'y' }` from plain values, in the file's quote style. */
export function objectText(code: string, fields: Record<string, string | undefined>, fileName?: string): string {
  const { sf } = parseRoom(code, fileName);
  const q = fileQuote(sf);
  const parts = Object.entries(fields).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${keyText(k)}: ${encodeString(v!, q)}`);
  return parts.length ? `{ ${parts.join(', ')} }` : '{}';
}

export function quoteOf(code: string, fileName?: string): string { return fileQuote(parseRoom(code, fileName).sf); }
