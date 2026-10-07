// The code wheel (4.1.15, programme §11.13, "The Extremely Legitimate Pirate Check"): a playful reconstruction of the
// paper code wheels of 1990s adventure games, built from the game's own characters, symbols and answers. Never DRM:
// in a web game the code and its answer can be read by anyone; the wheel is a joke the player is in on.
// Two discs: the large one (fixed) carries the actors around its rim and a track of answers inside; the small one
// (turning) carries the symbols, each with a window cut at its own offset. Turn the small disc until a symbol sits
// under an actor: the window of that symbol shows one answer of the track. The seed draws everything from the
// `copy-protection` stream (ADR 0016), independent of every other stream: the same seed makes the same wheel on every
// runtime, and adding a portrait moves no other puzzle. Pure and integer-only (no Math, ADR 0018).
import { derive } from '../prng';
import { uniform } from './compile';

/** The wheel's layout version: a stored record of another version is replayed as it is, never regenerated. @public */
export const CODE_WHEEL_VERSION = 1;

/** How the check behaves (§11.13): `parody` (the default) lets the player through after a few funny refusals. @public */
export type CodeWheelMode = 'parody' | 'story' | 'strict' | 'cosmetic' | 'disabled' | 'daily';

/** One item of a disc: its id, its name (said to a screen reader, printed), its image (a sprite, a portrait). @public */
export interface WheelItem {
  id: string;
  label: string;
  img?: string;
}

/** What an author writes in `{ minigame: 'code-wheel', params }`. @public */
export interface CodeWheelParams {
  /** Around the large disc: the game's characters (their portraits or sprites). */
  actors: WheelItem[];
  /** On the small disc: objects, animals, symbols of the game. */
  symbols: WheelItem[];
  /** The track the windows show: places, numbers, colours, answers (as many as actors). */
  answers: string[];
  mode?: CodeWheelMode;
  /** Wrong answers before `parody` lets the player through (default 3). */
  tries?: number;
  /** The seed (filled by `applyVariant` from the world's seed; `story` for the story world). */
  seed?: string;
}

/** A wheel as a seed makes it: the order of each disc, the windows' offsets, the question and its answer. @public */
export interface CodeWheel {
  version: typeof CODE_WHEEL_VERSION;
  seed: string;
  n: number;
  /** The large disc: actor ids by position, and the answers' track by position. */
  outer: string[];
  track: string[];
  /**
   * The small disc: symbol ids by position, and each position's window offset: the windows sit at n different places
   * (`j + windows[j]`) and the offsets differ too, so two symbols under one actor never read the same answer.
   */
  inner: string[];
  windows: number[];
  /** The question: put `symbol` under `actor`, read the window of `symbol`. */
  challenge: { actor: string; symbol: string };
  answer: string;
}

/** Everything wrong with a wheel's parameters (the validator's check); empty when it can be built. @public */
export function wheelProblems(p: Partial<CodeWheelParams>): string[] {
  const out: string[] = [];
  const n = p.actors?.length ?? 0;
  // Odd: each symbol's window must sit at its own place AND read another answer under the same actor; on a ring of n
  // places both hold together only when n is odd (a cyclic group has a complete mapping only for an odd order).
  if (n < 3 || n > 11 || n % 2 === 0) out.push('a code wheel has an odd number of actors, 3 to 11');
  if ((p.symbols?.length ?? 0) !== n) out.push('as many symbols as actors');
  if ((p.answers?.length ?? 0) !== n) out.push('as many answers as actors');
  if (new Set(p.answers ?? []).size !== (p.answers?.length ?? 0)) out.push('the answers must differ (one per window)');
  for (const [k, list] of [
    ['actors', p.actors],
    ['symbols', p.symbols],
  ] as const)
    if (new Set((list ?? []).map((x) => x.id)).size !== (list?.length ?? 0)) out.push(`two ${k} share an id`);
  if (p.mode && !['parody', 'story', 'strict', 'cosmetic', 'disabled', 'daily'].includes(p.mode))
    out.push(`unknown mode "${p.mode}"`);
  return out;
}

/** A permutation of `xs` drawn from the stream (Fisher–Yates, integers only). */
function shuffle<T>(xs: readonly T[], next: (n: number) => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = next(i + 1);
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** The wheel of a seed (the `copy-protection` stream of `<seed>|code-wheel|<id>`). Throws on parameters `wheelProblems` refuses. @public */
export function generateWheel(p: CodeWheelParams, seed: string, id = 'wheel'): CodeWheel {
  const problems = wheelProblems(p);
  if (problems.length) throw new Error(`code-wheel: ${problems.join('; ')}`);
  const rng = derive(`${seed}|code-wheel|${id}`, 'copy-protection');
  const next = (n: number) => uniform(rng, n);
  const n = p.actors.length;
  const outer = shuffle(
    p.actors.map((a) => a.id),
    next,
  );
  const track = shuffle(p.answers, next);
  const inner = shuffle(
    p.symbols.map((s) => s.id),
    next,
  );
  // σ(j) = a·j + b with a and a − 1 both prime to n: σ places the windows apart, σ(j) − j makes the offsets apart.
  const gcd = (x: number, y: number): number => (y ? gcd(y, x % y) : x);
  const as = Array.from({ length: n }, (_, a) => a).filter((a) => a > 1 && gcd(a, n) === 1 && gcd(a - 1, n) === 1);
  const a = as[next(as.length)]!;
  const b = next(n);
  const windows = Array.from({ length: n }, (_, j) => mod((a - 1) * j + b, n));
  const challenge = { actor: outer[next(n)]!, symbol: inner[next(n)]! };
  const w: Omit<CodeWheel, 'answer'> = {
    version: CODE_WHEEL_VERSION,
    seed,
    n,
    outer,
    track,
    inner,
    windows,
    challenge,
  };
  return { ...w, answer: readWindow(w, challenge.actor, challenge.symbol) };
}

/** The rotation (in positions) of the small disc that puts `symbol` under `actor`. */
export function rotationFor(w: Pick<CodeWheel, 'n' | 'outer' | 'inner'>, actor: string, symbol: string): number {
  return mod(w.outer.indexOf(actor) - w.inner.indexOf(symbol), w.n);
}

/** What the window of the small disc's position `j` shows when the disc is turned by `rotation`. */
export function windowAt(w: Pick<CodeWheel, 'n' | 'track' | 'windows'>, j: number, rotation: number): string {
  return w.track[mod(j + rotation + w.windows[j]!, w.n)]!;
}

/** What the window of `symbol` shows once `symbol` sits under `actor` (the printed wheel's reading). */
export function readWindow(w: Omit<CodeWheel, 'answer'>, actor: string, symbol: string): string {
  return windowAt(w, w.inner.indexOf(symbol), rotationFor(w, actor, symbol));
}

/**
 * The wheel's solution, checked the way a player reads it (turn, then read): a solution exists, it is unique (one
 * rotation aligns the pair), and different symbols under the same actor read different answers. @public
 */
export function checkWheel(w: CodeWheel): string[] {
  const out: string[] = [];
  const r = rotationFor(w, w.challenge.actor, w.challenge.symbol);
  if (windowAt(w, w.inner.indexOf(w.challenge.symbol), r) !== w.answer) out.push('the window does not show the answer');
  const aligned = Array.from({ length: w.n }, (_, k) => k).filter(
    (k) => w.outer[mod(w.inner.indexOf(w.challenge.symbol) + k, w.n)] === w.challenge.actor,
  );
  if (aligned.length !== 1) out.push('more than one rotation aligns the pair');
  for (const actor of w.outer) {
    const seen = new Set(w.inner.map((s) => readWindow(w, actor, s)));
    if (seen.size !== w.n) out.push(`two symbols under ${actor} show the same answer`);
  }
  if (new Set(w.windows.map((o, j) => mod(j + o, w.n))).size !== w.n) out.push('two windows are cut at the same place');
  return out;
}

/** The full table the wheel encodes: for each actor and symbol, the answer (the accessible list, the booklet). @public */
export function wheelTable(w: CodeWheel): { actor: string; symbol: string; answer: string }[] {
  return w.outer.flatMap((actor) => w.inner.map((symbol) => ({ actor, symbol, answer: readWindow(w, actor, symbol) })));
}

/** What a played wheel records for a replay and a speedrun (§11.13). @public */
export interface WheelRecord {
  seed: string;
  version: number;
  wheel: CodeWheel;
  mode: CodeWheelMode;
  rotations: number[];
  answers: string[];
  tries: number;
  result: 'won' | 'passed' | 'skipped' | 'disabled';
}

/**
 * The outcome of an answer under a mode: accepted (right, or `cosmetic`), refused, or let through (`parody` after
 * `tries` wrong answers; `story` after `tries`, the failure recorded for the story to read). `strict` never lets
 * through.
 */
export function judge(
  w: CodeWheel,
  mode: CodeWheelMode,
  answer: string,
  wrongSoFar: number,
  tries = 3,
): 'won' | 'wrong' | 'passed' {
  if (answer === w.answer || mode === 'cosmetic') return 'won';
  if ((mode === 'parody' || mode === 'story' || mode === 'daily') && wrongSoFar + 1 >= tries) return 'passed';
  return 'wrong';
}
