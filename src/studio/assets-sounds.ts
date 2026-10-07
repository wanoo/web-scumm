// Assets tab, the sounds (4.1.8, programme §4.7: the Studio's biggest owners split into model / IO / view): the music
// or the sound effects as a table (player, where each is used, Replace), the ones referenced without a file, and the
// uploads (POST assets/sound: a replaced file keeps its extension, Add sound takes any format ffmpeg reads). The tab
// (assets.ts) owns the selection and hands an `AssetsHost`.
import type { AssetSound, UploadResult } from './api';
import { pickFile, post, readFile } from './assets-io';
import { plural, unprepared } from './assets-model';
import { type AssetsHost, nodes } from './assets-view';
import { h, toast } from './ui';

/** The centre for the music or the sound effects. */
export function renderSounds(host: AssetsHost, kind: 'music' | 'sfx'): (Node | string)[] {
  const d = host.data();
  const list = d.sounds[kind];
  const missing = d.missing.filter((m) => m.startsWith(`audio/${kind}/`));
  return nodes(
    h(
      'header',
      { class: 'as-head' },
      h('h2', null, kind === 'music' ? 'Music' : 'Sound effects'),
      h('span', { class: 'muted' }, `games/${host.info.id}/audio/${kind}/ · ${plural(list.length, 'file')}`),
      host.demo ? null : h('button', { class: 'primary', onclick: () => void addSound(host, kind) }, 'Add sound…'),
    ),
    missing.length
      ? h(
          'p',
          { class: 'error small' },
          `Referenced without a file: ${missing.map((m) => m.split('/').pop()).join(', ')}`,
        )
      : null,
    list.length
      ? h(
          'table',
          { class: 'as-sounds' },
          h(
            'thead',
            null,
            h('tr', null, h('th', null, 'File'), h('th', null, 'Play'), h('th', null, 'Used by'), h('th', null, '')),
          ),
          h(
            'tbody',
            null,
            list.map((s) => soundRow(host, s)),
          ),
        )
      : h(
          'p',
          { class: 'muted' },
          kind === 'music'
            ? 'No music yet. Add a file, then list it in audio.music (game.ts).'
            : 'No sound effect yet.',
        ),
    h(
      'p',
      { class: 'muted small' },
      'Any format ffmpeg reads; Prepare assets encodes what the game references (audio.music / audio.sfx in game.ts). Replace keeps the old file as a backup.',
    ),
  );
}

/** One row: the file (and its backups), its player, where it is used, Replace. */
export function soundRow(host: AssetsHost, s: AssetSound) {
  const src = host.url(s);
  return h(
    'tr',
    { class: s.used.length ? undefined : 'unused' },
    h(
      'td',
      null,
      h('code', null, s.id),
      unprepared(s) ? h('span', { class: 'as-b unprep', title: 'not prepared' }, '!') : null,
      s.backups.length
        ? h('div', { class: 'muted small' }, `backups: ${s.backups.map((b) => b.split('/').pop()).join(', ')}`)
        : null,
    ),
    h(
      'td',
      null,
      src
        ? h('audio', { controls: true, preload: 'none', src, 'aria-label': `Play ${s.id}` })
        : h('span', { class: 'muted small' }, 'not prepared'),
    ),
    h(
      'td',
      null,
      s.used.length
        ? s.used.map((u) => h('code', { class: 'as-usechip' }, u))
        : h('span', { class: 'muted small' }, 'unused'),
    ),
    h(
      'td',
      null,
      host.demo ? null : h('button', { class: 'small', onclick: () => void replaceSound(host, s) }, 'Replace…'),
    ),
  );
}

async function replaceSound(host: AssetsHost, s: AssetSound) {
  const ext = s.id.slice(s.id.lastIndexOf('.'));
  const f = await pickFile(`audio/*,${ext}`);
  if (!f.name.toLowerCase().endsWith(ext)) {
    toast(`Pick a ${ext} file to replace ${s.id} (or use Add sound for another format).`, 'error');
    return;
  }
  await sendSound(host, s.kind, s.id, f);
}

async function addSound(host: AssetsHost, kind: 'music' | 'sfx') {
  const f = await pickFile('audio/*');
  const name = f.name.replace(/[^\w.-]+/g, '_').replace(/^[^A-Za-z0-9_]+/, '');
  if (
    host.data().sounds[kind].some((x) => x.id === name) &&
    !confirm(`${name} exists: replace it (the old file is kept as a backup)?`)
  )
    return;
  await sendSound(host, kind, name, f);
}

async function sendSound(host: AssetsHost, kind: 'music' | 'sfx', file: string, f: File) {
  try {
    host.ownWrite();
    const r = await post<UploadResult>('sound', { kind, file, data: await readFile(f) });
    toast(`${r.file} saved${r.backup ? `, old one kept as ${r.backup.split('/').pop()}` : ''}`);
    await host.reload();
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}
