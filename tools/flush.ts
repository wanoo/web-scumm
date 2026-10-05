// Exits once everything written to stdout has left: `process.exit` right after a large `console.log` cuts it at the
// pipe's buffer (8 KB) when a parent process reads it (`solve --json` for a bigger game, found by the 3.4 chapter).
export async function flushExit(code: number): Promise<never> {
  await new Promise<void>((done) => process.stdout.write('', () => done()));
  process.exit(code);
}
