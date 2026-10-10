// What a field report or a bundled log must not carry (4.1.18, plan §3.4 and §5.2): keys and tokens are refused, an
// address or a bearer is redacted. A report is data a person typed: a secret there is refused, never quietly cut.
// A log is a machine's output: its addresses and bearers are replaced, but a key in it still refuses the bundle.

/** Secrets whose presence refuses the file: a redaction would hide that one leaked. */
const HARD: [string, RegExp][] = [
  ['a private key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['a GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/],
  ['an AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['a Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['an npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['a JWT or JWS', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['a private JWK', /"d"\s*:\s*"[A-Za-z0-9_-]{20,}"/],
];

/** What is replaced in a log: what it says about a person or a session, not about the run. */
const SOFT: [string, RegExp, string][] = [
  ['an email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>'],
  ['a bearer', /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 <redacted>'],
  // The name may be inside an identifier: `access_token`, `client_secret`, `DB_PASSWORD`, `accessToken` (4.1.18,
  // second reading: `\b` before the name missed every one of them).
  [
    'a password or token value',
    /([A-Za-z0-9_-]*(?:password|passwd|secret|token|api[_-]?key)[A-Za-z0-9_]*)(["']?\s*[:=]\s*["']?)[^\s"',;&]{4,}/gi,
    '$1$2<redacted>',
  ],
  ['credentials in a URL', /\b([a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)[^@\s/]+@/gi, '$1<redacted>@'],
  ['an IPv4 address', /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>'],
];

/** The hard secrets found in `s` (their kind only, never the value). */
export function hardSecrets(s: string): string[] {
  return HARD.filter(([, re]) => re.test(s)).map(([what]) => what);
}

/**
 * What a report's own text must not hold: the hard secrets, and an address, a bearer, a password value or a URL's
 * credentials a person typed (IPs are allowed: a device's address may be the point). JSON is read decoded too: a
 * `\u0067hp_…` escape would hide a token from the raw text and come back whole in the sheet.
 */
export function reportLeaks(s: string): string[] {
  // Every key and string of the JSON, decoded, beside the raw text: a `\u0067hp_…` escape hides a token from the raw
  // text only, and a free record's key (a version's name) is text a person typed too.
  const parts = [s];
  try {
    JSON.parse(s, (k, v) => {
      parts.push(k);
      if (typeof v === 'string') parts.push(v);
      return v;
    });
  } catch {
    /* not JSON: the raw text is what is read */
  }
  const text = parts.join('\n');
  const out = hardSecrets(text);
  for (const [what, re] of SOFT.filter(([w]) => w !== 'an IPv4 address'))
    if (new RegExp(re.source, re.flags.replace('g', '')).test(text)) out.push(what);
  return out;
}

/** A log with its addresses, bearers, password values and IPs replaced; the kinds that were. */
export function redact(s: string): { text: string; redacted: string[] } {
  let text = s;
  const redacted: string[] = [];
  for (const [what, re, by] of SOFT) {
    const next = text.replace(re, by);
    if (next !== text) redacted.push(what);
    text = next;
  }
  return { text, redacted };
}
