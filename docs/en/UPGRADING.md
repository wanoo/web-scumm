# Upgrading a game from v2 to v3

v3 deliberately breaks the authoring contract once so saves can become durable afterwards. Migrate on a branch, keep
a representative v2 save, and do not change prose or reorder content until the ids below have been assigned.

## 1. Establish the baseline

On the last v2 commit, export saves at important checkpoints and keep one complete session. Record:

```bash
GAME=<id> npm run validate
GAME=<id> npm run solve
GAME=<id> npm test
```

Do not commit private game material or exported player saves to this public repository.

## 2. Opt into the v3 schema

Add `schemaVersion: 3` to `defineGame({...})`. `compileGame` clones and normalises the source; the compiled v3 value is
frozen, so integrations must not rely on `engine.game === source` or mutate it after construction.

Run `GAME=<id> npm run validate`. Fix every stable-id error:

- every room and game `Rule`: `id`;
- every `TalkTopic`: `id`;
- every `Choice`: `id` (especially `once` choices);
- every room and game `EventRule`: `id`;
- every persistent `{ once }`, `{ nth }`, `{ cycle }`, `{ random }` block: `id`;
- every script: one `stepIds` value per top-level command, in the same order.

Use semantic ids (`pantry.open`, `grandma.ask_key`, `clock.wait`) rather than numbers or translated text. They are
unique across the game. Generated exit rules receive deterministic ids automatically.

## 3. Migrate saves deliberately

The browser stores a `web-scumm-save` envelope with schema 3 in IndexedDB. The first v3 run imports the legacy
`<game>.save` localStorage autosave once and removes it only after a verified write. Manual slots remain importable.

Increase `saveVersion` for a state change and supply one `Migration` per integer step. Besides v2 fields, v3 supports:

```ts
migrations: [{
  from: 2,
  renameCounter: { 'house:on3.0': 'pantry.first_open' },
  renameSeen: { 'topic.house/grandma[0]': 'topic.grandma.ask_key' },
  renameScript: { old_clock: 'clock' },
  renameScriptStep: { clock: { 'step.1': 'chime' } },
  renamePlayer: { kid: 'laverne' },
  renameCharacter: { old_grandma: 'grandma' },
  dropCounter: ['temporary_gag'],
  dropSeen: ['removed_choice'],
  dropScript: ['removed_patrol'],
}],
```

Map positional v2 counter/topic/script keys only when the old content and its meaning are known. There is no universal
safe conversion after content has already been reordered or translated. An unmapped stale optional reference is
pruned with a player-visible warning; malformed JSON, a foreign game, a missing current room or an unknown active
player is rejected without replacing the current session.

## 4. Update translations and minigames

Run `npm run i18n -- extract --lang <xx>` for every shipped language. v3 also extracts verb labels/join words and the
text paths declared by each minigame's `textParams`. Then run `npm run i18n -- status` and translate every new entry.

Custom minigames should declare `required` and `textParams` so validation and translation tools understand their
parameters. Asset ids keep the existing `sheet/cell` convention and are discovered by the asset tools.

## 5. Update development and CI commands

- `npm run dev` and `npm run studio` are loopback-only.
- Use `dev:lan` / `studio:lan` for a phone and open the printed token URL.
- `npm test` is the Node suite; `npm run test:assets` is the Python-backed asset suite.
- `npm run build` requires validation and a winning witness, but not an unbounded state-space proof.
- `npm run prove:game` proves global and chapter state graphs and fails on softlocks or truncation.
- `npm run release-check` includes prerequisites, build, exhaustive proof and dependency audit.

Do not enable a partial-order reduction in proof mode until equivalence with the reference exploration is demonstrated
for the relevant game class.

## 6. Verify the migrated game

```bash
GAME=<id> npm run doctor
GAME=<id> npm run build
GAME=<id> npm run prove:game
GAME=<id> npm run e2e -- http://127.0.0.1:5173/ --prod
```

Load every representative v2 save and verify its room, active player, inventories, persistent choices and script step.
Reorder one rule, topic, choice and script step in a test fixture; the same v3 save must retain its meaning. Finally,
test the production PWA online, offline in cached rooms, and through an update. Unvisited rooms are not promised offline.
