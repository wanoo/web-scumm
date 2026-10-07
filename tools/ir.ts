// npm run ir [-- --game <id>] [--json] (4.1.12, ADR 0013): the game's intermediate representation, compiled from its
// sources (`compileIR`), with the provenance of every id (`file:line`) and the hash of its trusted extensions. Without
// `--json`: a readable outline (rooms and what stands in them, rules, scripts, objectives, each with where it is
// written); with it, the whole IR as JSON, the same text for the same sources.
import { resolve } from 'node:path';

const at = process.argv.indexOf('--game');
if (at > 0 && process.argv[at + 1]) process.env.GAME = process.argv[at + 1];
const asJson = process.argv.includes('--json');

const { GAME_DIR, loadGameModule } = await import('./game');
const { gameIR } = await import('./extensions');
const mod = await loadGameModule();
const ir = gameIR(mod, resolve(GAME_DIR));

if (asJson) {
  console.log(JSON.stringify(ir, null, 2));
} else {
  const where = (id: string) => {
    const p = ir.provenance[id];
    return p ? `  ${p.file}:${p.line}` : '';
  };
  console.log(
    `${ir.gameId} · schema ${ir.schema} · ${ir.rooms.length} rooms · ${ir.entities.length} entities · ${ir.rules.length} rules · ${ir.scripts.length} scripts · ${ir.objectives.length} objectives · engine ${ir.engine}`,
  );
  console.log(
    `trusted extensions ${ir.extensions.trusted.slice(0, 16) || '(none)'}: ${ir.extensions.commands.map((c) => c.name).join(', ') || 'no custom command'}`,
  );
  for (const r of ir.rooms) {
    console.log(`\nroom ${r.id} "${r.name}"${where(r.id)}`);
    for (const key of r.entities) {
      const e = ir.entities.find((x) => x.key === key)!;
      console.log(`  ${e.kind.padEnd(8)} ${e.id}${e.name ? ` "${e.name}"` : ''}${where(key)}`);
    }
    for (const x of ir.rules)
      if ((x.kind === 'rule' || x.kind === 'listener') && x.scope === r.id)
        console.log(`  ${x.kind.padEnd(8)} ${x.id}${where(x.id)}`);
      else if (x.kind === 'topic' && x.room === r.id) console.log(`  topic    ${x.id}${where(x.id)}`);
    for (const s of ir.scripts) if (s.scope === r.id) console.log(`  script   ${s.id} (${s.trigger})${where(s.id)}`);
  }
  console.log('\ngame');
  for (const x of ir.rules)
    if ((x.kind === 'rule' || x.kind === 'listener') && x.scope === 'game')
      console.log(`  ${x.kind.padEnd(8)} ${x.id}${where(x.id)}`);
  for (const s of ir.scripts) if (s.scope === 'game') console.log(`  script   ${s.id} (${s.trigger})${where(s.id)}`);
  for (const o of ir.objectives)
    console.log(
      `  objective ${o.id}${o.parent ? ` (under ${o.parent})` : ''}${o.optional ? ' (optional)' : ''} "${o.title}"${where(`objective:${o.id}`)}`,
    );
}
