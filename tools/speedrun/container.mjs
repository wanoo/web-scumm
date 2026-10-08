// The speedrun worker's container (4.1.17, plan §10.3): the `docker run` arguments of the profile REALITY-OPS documents,
// as one function the Bridge's configuration, CI's `worker-container` job and its test share. No network unless asked
// (`network` other than `none` is said on stderr); a read-only root; a bounded /tmp; no capability; no new privilege;
// an unprivileged user; limits on processes, memory and CPU; the game packages read-only; nothing of the host's
// environment but what is named; and `timeout -s KILL` inside, because killing the docker client does not stop a
// container.
//
//   node tools/speedrun/container.mjs --image=<image> --app=<dir> [--games=<dir>] [--timeout=70] [--allow-network]
//   prints the `worker` command of a configuration's `runs` section, as JSON.
import { pathToFileURL } from 'node:url';

/** Processes and threads one worker may have: Node's own threads (libuv, V8, the inspector) and a margin. */
export const PIDS_LIMIT = 64;

/**
 * The arguments of `docker run` for one worker, then the command inside. `app` is the engine's folder (mounted at
 * /app), `games` the approved packages (mounted at /srv/games), both read-only.
 */
export function workerContainerArgs({
  image,
  app,
  games,
  timeoutS = 70,
  network = 'none',
  user = '65534:65534',
  memory = '512m',
  cpus = '1',
  name,
  command = ['node', '--import', 'tsx', 'tools/speedrun/worker.ts'],
}) {
  if (!image || !app) throw new Error('a worker container needs an image and the engine folder');
  if (network !== 'none')
    console.error(`⚠  the speedrun worker runs WITH a network (${network}): a run's code can call out`);
  return [
    'docker',
    'run',
    '--rm',
    '-i',
    ...(name ? ['--name', name] : []),
    '--network',
    network,
    '--read-only',
    '--tmpfs',
    '/tmp:rw,size=64m',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    user,
    '--pids-limit',
    String(PIDS_LIMIT),
    '--memory',
    memory,
    '--cpus',
    cpus,
    '-v',
    `${app}:/app:ro`,
    ...(games ? ['-v', `${games}:/srv/games:ro`] : []),
    '-w',
    '/app',
    '-e',
    'GAME_DIR',
    '-e',
    'NODE_OPTIONS',
    image,
    'timeout',
    '-s',
    'KILL',
    String(timeoutS),
    ...command,
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const flag = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  console.log(
    JSON.stringify(
      workerContainerArgs({
        image: flag('image'),
        app: flag('app'),
        games: flag('games'),
        timeoutS: Number(flag('timeout') ?? 70),
        network: process.argv.includes('--allow-network') ? 'bridge' : 'none',
      }),
    ),
  );
}
