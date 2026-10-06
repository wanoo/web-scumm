# Surviving mutants, explained

`npm run test:mutation:core [-- --set=core|reality|all]` (`tools/mutate.ts`, 4.1.0 "Clarity"; the sets and the gate
by identity since 4.1.2) mutates the code a save, a session, a condition and a migration rest on (`core`), and the
code a signal from the world outside rests on (`reality`: the engine's receive, the protocol, the client, the Bridge,
its store, its lock and its policy), and runs the tests that judge each set against each mutant. The survivors below
are equivalent mutants: no input the engine or the Bridge can receive tells them from the original. Each one is
named in `docs/dev/mutants.json` (file, operator, from, to, why), which is what the gate reads: a survivor not named
there fails the run, in every mode, whatever the count; a name whose mutant no longer survives is reported as
stale. This page explains them; the JSON file is the list. Measured on 2026-10-06 (4.1.2): the counts are in the
sections below.

| Where | Mutant | Why it is equivalent |
|---|---|---|
| `core/save.ts` `props` pruning, `const r = cut > 0 ? …` | `cut > 0` → `true` | Alone, the next line still reads `cut > 0` for the prop and finds none: the key is dropped either way. Mutating both lines together is killed (`critical-save`, "a prop or actor key without its room"). |
| same line | `>` → `>=` | Differs only for a key starting with a dot (`.x`), whose room part is `''`: no room has an empty id (the validator refuses it). |
| `core/save.ts` `props` pruning, `const p = cut > 0 ? …` | `cut > 0` → `true` | Alone, `r` is undefined for a key without a dot, so `p` is too. |
| same line | `>` → `>=` | As above: only for a room id `''`. |
| `core/save.ts` `actors` pruning | `>` → `>=` | As above: only for a room id `''`. |
| `core/migrate.ts` room prefix, `if (i < 0)` | `<` → `<=` | Differs only for a key starting with a dot: its room part `''` is never in `renameRoom`. |
| `core/migrate.ts` script steps, `if (st.step)` | → `true` | With no step, `renameScriptStep[id][undefined]` is looked up and is undefined, so `st.step` stays undefined. |
| `core/migrate.ts` players, `s.active ? …` | → `true` | With no active player, `renamePlayer[undefined]` is undefined and the value stays undefined. |

## The core set (4.1.0, measured again 2026-10-06)

**340 of 348 mutants killed**; the 8 survivors are the table above, each named in `mutants.json`.

## The reality set (4.1.2, measured 2026-10-06)

**382 of 484 mutants killed** (`reality-runtime` 42/44, `protocol` 70/75, `client` 52/65, `bridge` 142/178, `store`
61/103, `lock` 2/3, `policy` 13/16), up from 338 before this release's tests. 14 survivors are equivalent and named
in `mutants.json`: the save bound to a player with `||`, `fast` on the emitted event, defence-in-depth checks of the
JWS decoder, the UTF-8 decoder's `fatal`, an extractable public key, lenient base64url padding, the lock's
bookkeeping, the Bridge's two checks of a player (each covers the other), a stream ended twice, the wording of a
corruption message. **88 survivors remain** (38 in `store.ts`: compaction and journal parsing; 33 in `bridge.ts`:
validation of a proposal's optional fields, the exact edge of expiries, revocations landing while a proposal waits on
the lock; 12 in `client.ts`: stop while waiting or busy, the results that are not acknowledged; 3 in `policy.ts`:
`pair`, `players` and `expiresAt` absent from a grant; 2 in `protocol.ts`: the exact size limit, the wording of a
payload refusal). They are missing tests, not equivalents, and this page does not pretend otherwise: the nightly
runs the set and lists them (`continue-on-error`), the step gates once they are killed or named here.

Stryker was tried first: with Vitest 5 its mutants were never activated (739 of 749 survived, a function emptied
included), so the score meant nothing; `tools/mutate.ts` writes each mutant into the source, runs
`vitest.mutation.config.ts`, and restores the file.
