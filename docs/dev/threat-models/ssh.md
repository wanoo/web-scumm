# SSH connector: threat model (4.1.9)

**What it does.** An SSH server (`ssh2`, MIT, pure JavaScript; its optional native parts refused) with a virtual
terminal: the commands the game declares, and a virtual disk (`reality.connectors.ssh.files`) read with `ls`, `cd`,
`pwd` and `cat`. A player authenticates with a password that is a pairing code (or a resume word), or with a public key
the operator declared for a player.

**Assets.** The game's state; the host key; the connector's process; the players' pairing codes.

**Adversaries.** SSH scanners and brute-forcers, clients asking for an `exec`, `sftp`, port forwarding or an agent,
hostile terminals, huge lines.

| Threat | Answer | Test |
|---|---|---|
| A host shell, process or file | No `exec`, `subsystem` (sftp), `env`, X11, agent or TCP forwarding: every such request is rejected; `shell` opens the virtual terminal only; the disk is an in-memory tree per session, built from the game's data | `tests/connectors-ssh.test.ts` |
| Path traversal (`cat ../../etc/passwd`, `cd /..`) | Paths are normalised inside the virtual tree: `..` above `/` stays at `/`; no host path is ever built | `tests/connectors-ssh.test.ts` |
| Shell syntax (`$(…)`, backticks, `;`, `&&`, NUL bytes) | Not a shell: a line is words looked up in a table; NUL and control bytes are dropped | hostile commands test |
| A 1 MB line | 512 bytes per line; beyond, discarded | test |
| Brute force | 3 authentication attempts per connection; a password is accepted only as an 8-character pairing code or a resume word | test |
| Terminal resizing abuse | `pty-req` and `window-change`: the width is clamped (10 to 500 columns) and only used to wrap output; nothing else of them is read | `tests/connectors-ssh.test.ts` |
| Escape sequences in output | The output is the game's own text and the disk's; nothing typed is printed back but the line being edited (printable characters only) | — |
| Long sessions, many sessions | One session and one shell per connection (more are refused); 30 minutes per session; 20 seconds to authenticate; 60 s idle before the first line, and after authentication without a shell; 3 connections per address, 20 in all; wrong passwords counted per address across reconnections | `tests/connectors-ssh.test.ts` (shortened limits) |
| Leaking the host key or codes | The host key is read from a file (mode 600 recommended), never logged; the log names events and counts only | log test |
| Native code in the dependency | `cpu-features` and `nan` are replaced by a refusing stub (`connectors/vendor/refused-native`, root `overrides`), so ssh2's own install script, which `npm ci` still runs, attempts `node-gyp rebuild` of its optional crypto binding and fails for lack of the `nan` headers: no `.node` file results (`tests/connectors-ssh.test.ts` checks none exists under `node_modules/ssh2`; the package is installed with `--ignore-scripts`) | test |

**Residual risks.** `ssh2` itself parses the transport: a flaw there is a flaw here (pinned, audited by
`npm run audit:deps`). Resume words live in memory: a restart forgets them and the player pairs again.
