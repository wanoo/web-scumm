### Changes

- **The Bridge's `reality` mutation set is gated again (4.1.10)**: the 20 survivors the `v4.1.10-rc.1` run left
  unnamed (18 in `bridge.ts`, 2 in `lock.ts`): 19 killed by tests (`tests/bridge-mutants-tenant.test.ts`: the slow
  pass's timer and its `clearInterval`, a pairing's origin and session id, a code confirmed or claimed twice, a claim
  racing a confirmation, the `backlog` and `propose.ms` values recorded, the V1 payload, a row whose sequence is not its
  own, a fetch whose last page is exactly full, an export past 1000 rows, a third section queued on a keyed lock), 1
  named with its reason (`if (this.timer)` forced true: `clearInterval(undefined)` does nothing).
