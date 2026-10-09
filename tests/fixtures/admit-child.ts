// One "instance" of tests/bridge-admission.test.ts: opens the SQLite file, then at the given instant admits its runs
// and takes its quota tokens as fast as it can; prints what it got as one JSON line.
import { SqlLimiter } from '../../bridge/src/runs-limiter';
import { SqlRunStore } from '../../bridge/src/runs-store';
import { SqliteRealityStore } from '../../bridge/src/store-sqlite';

const [file, who, startAt, maxQueued] = process.argv.slice(2);
const s = await SqliteRealityStore.open(file!, { pollMs: 0 });
const store = new SqlRunStore(s.db);
const limiter = new SqlLimiter(s.db, { perMinute: 6, secret: 'shared', keyVersion: 'k1' });
while (Date.now() < Number(startAt)) await new Promise((ok) => setTimeout(ok, 2));
const admitted: string[] = [];
for (let i = 0; i < 10; i++)
  admitted.push(
    await store.admit(
      {
        id: `run_${who}_${i}`,
        tenantId: 't',
        gameId: 'g',
        categoryId: 'c',
        player: 'P',
        submittedAt: Date.now(),
        status: 'queued',
        trust: 'local',
        // Every instance also sends the run `same`: one row in all.
        runKey: i === 0 ? 'same' : `${who}-${i}`,
        deleteTokenHash: '0',
        envelope: '{}',
      },
      Number(maxQueued),
    ),
  );
const quota: boolean[] = [];
for (let i = 0; i < 4; i++) quota.push((await limiter.take('t', '203.0.113.7', Number(startAt))).ok);
console.log(JSON.stringify({ admitted, quota }));
await s.close();
