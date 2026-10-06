// npm run seal -- --outcome=<key>   (one of the keys of `outcomes` in games/<GAME>/private/ending.config.ts)
// Encrypts the sealed ending (ticket + final card) into public/data/dossier.bin.
// Without a private configuration, uses the committed example games/<GAME>/ending.config.example.ts.
import { webcrypto } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seal, type RevealPayload } from '../src/engine/ending/seal';
import type { EndingConfig } from './seal-types';
import { GAME_DIR } from '../tools/game';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

async function loadConfig(): Promise<{ config: EndingConfig; example: boolean }> {
  const real = resolve(GAME_DIR, 'private/ending.config.ts');
  try {
    await access(real);
  } catch {
    const m = await import(resolve(GAME_DIR, 'ending.config.example.ts'));
    return { config: m.config, example: true };
  }
  const m = await import(real);
  return { config: m.config, example: false };
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--outcome='));
  const outcome = arg?.split('=')[1];
  const { config, example } = await loadConfig();
  const keys = Object.keys(config.outcomes);
  if (!outcome || !config.outcomes[outcome]) {
    console.error(`Usage: npm run seal -- --outcome=<key>   (keys: ${keys.join(', ')})`);
    process.exit(1);
  }
  if (example) console.warn('⚠  games/<GAME>/private/ending.config.ts not found: using the EXAMPLE configuration.');
  const photos: string[] = [];
  for (const p of config.photos) {
    const path = resolve(GAME_DIR, 'private', p);
    const buf = await readFile(path);
    const mime = MIME[extname(p).toLowerCase()] ?? 'application/octet-stream';
    if (buf.length > 800_000) console.warn(`⚠  ${p} is ${(buf.length / 1024).toFixed(0)} KB: consider shrinking it.`);
    photos.push(`data:${mime};base64,${buf.toString('base64')}`);
  }
  const o = config.outcomes[outcome];
  const payload: RevealPayload = {
    ticket: o.ticket,
    headline: o.headline,
    message: config.message,
    photos,
    lines: [...(o.lines ?? []), ...(config.lines ?? [])],
    ...(config.judgeGuess === false ? {} : { outcome }),
  };
  const bytes = await seal(webcrypto.subtle as unknown as SubtleCrypto, payload, config.password, (n: number) =>
    webcrypto.getRandomValues(new Uint8Array(n)),
  );
  const out = resolve(root, 'public/data/dossier.bin');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, bytes);
  console.log(`✔  Sealed file (${outcome}) → public/data/dossier.bin (${(bytes.length / 1024).toFixed(1)} KB)`);
  // The password is never printed (a terminal's scrollback is a leak). Where it lives depends on the game's
  // `ending.password`: `typed` by the player, nowhere in the bundle; `given`, in the bundle, an obfuscation only.
  console.log('   Game password: the one of the private configuration (not printed)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
