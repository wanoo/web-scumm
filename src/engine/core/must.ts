// An index read the code knows is there (a bounded loop, a key just listed): `must` says so, and throws with what was
// missing if that ever stops being true, instead of carrying `undefined` further (tsconfig.strictest.json, 4.1.0).
export function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`internal: ${what} is missing`);
  return value;
}
