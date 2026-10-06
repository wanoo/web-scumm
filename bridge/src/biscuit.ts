// Biscuit for the Bridge (4.1.1 "Reality Bridge"): the official WebAssembly build (@biscuit-auth/biscuit-wasm),
// loaded by hand so Node runs it without --experimental-wasm-modules: the module is compiled, each of its imports (the
// wasm-bindgen glue and its snippets) is imported from the package, then the instance is handed to the glue. The
// player never imports this file (tests/boundaries.test.ts): Biscuit authorises connectors on the server only.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type Glue = typeof import('@biscuit-auth/biscuit-wasm');

let loading: Promise<Glue> | undefined;

/** The package's `module/` folder, found the way Node resolves it (its `exports` hide package.json). */
function moduleDir(): string {
  const req = createRequire(import.meta.url);
  const roots = req.resolve.paths('@biscuit-auth/biscuit-wasm') ?? [];
  const pkg = roots
    .map((p) => join(p, '@biscuit-auth', 'biscuit-wasm'))
    .find((p) => existsSync(join(p, 'package.json')));
  if (!pkg) throw new Error('@biscuit-auth/biscuit-wasm is not installed');
  return join(pkg, 'module');
}

/** The Biscuit library, once (classes `KeyPair`, `Biscuit`, `AuthorizerBuilder`…). */
export function biscuitLib(): Promise<Glue> {
  loading ??= (async () => {
    const dir = moduleDir();
    const glue = (await import(pathToFileURL(join(dir, 'biscuit_bg.js')).href)) as Glue & {
      __wbg_set_wasm(exports: WebAssembly.Exports): void;
    };
    const mod = new WebAssembly.Module(readFileSync(join(dir, 'biscuit_bg.wasm')));
    const imports: WebAssembly.Imports = {};
    for (const { module } of WebAssembly.Module.imports(mod))
      imports[module] ??= module === './biscuit_bg.js' ? glue : await import(pathToFileURL(join(dir, module)).href);
    const instance = new WebAssembly.Instance(mod, imports);
    glue.__wbg_set_wasm(instance.exports);
    // The wasm-bindgen start function logs "biscuit-wasm loading": silenced, a server's log is for its own lines.
    const log = console.log;
    console.log = () => {};
    try {
      (instance.exports.__wbindgen_start as (() => void) | undefined)?.();
    } finally {
      console.log = log;
    }
    return glue;
  })();
  return loading;
}

/** The class of a Biscuit error, as the specification's samples name them: Format, FailedLogic, Execution. */
export function errorClass(e: unknown): 'Format' | 'FailedLogic' | 'Execution' {
  const kind = e && typeof e === 'object' ? Object.keys(e)[0] : undefined;
  if (kind === 'FailedLogic') return 'FailedLogic';
  if (kind === 'RunLimit' || kind === 'Execution') return 'Execution';
  return 'Format';
}
