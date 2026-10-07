# Telnet connector: threat model (4.1.9)

**What it does.** A TCP server, apart from the Bridge, speaking the least Telnet a client needs. A player connects,
types a pairing code (or the resume word printed at a previous pairing), then the commands the game declares
(`reality.connectors.telnet.commands`); a command with a `signal` proposes it. The shell is entirely virtual: a
table of declared words and answers, plus `help`, `clear` and `exit`. Nothing reaches the host.

**Assets.** The game's state through the signals; the connector's process (availability); the pairing codes typed.

**Adversaries.** Anyone on the network: scanners, bots trying shells, slowloris, binary garbage, floods.

| Threat | Answer | Test |
|---|---|---|
| A command reaching the host (`; rm`, `$(…)`, backticks, `../`) | No host process, no `child_process`, no path: a line is lower-cased, split on spaces and looked up whole in the declared table; anything else is "unknown command" | `tests/connectors-terminal.test.ts`, the static test of `tests/connectors-abuse.test.ts` |
| Telnet negotiation abuse (IAC floods, endless subnegotiation) | IAC sequences are filtered; options are refused once each (`WONT`/`DONT`); a subnegotiation longer than 64 bytes closes the connection | `tests/connectors-terminal.test.ts` |
| Binary input, control and escape characters | Bytes outside printable UTF-8 are dropped from a line; nothing typed is ever echoed back by the server (the client echoes) | binary and escape fixtures |
| Long lines | A line is at most 512 bytes: beyond, the line is discarded and the player told | 1 MB line test |
| Floods | 64 KB/s per connection (beyond: closed), 100 lines a minute (beyond: "slow down", lines dropped) | flood test |
| Slowloris | A connection must send a complete line every 60 s and pair within 2 minutes; a session lasts 30 minutes | slow test (shortened limits) |
| Too many connections | 20 at once: the 21st is told "busy" and closed; 1 000 simultaneous attempts are refused without a crash | 1 000-connection test |
| Guessing pairing codes | 3 wrong codes close the connection; the Bridge rate-limits failed confirmations per token | `tests/connectors-terminal.test.ts` |
| A repeated command proposing twice | `dedupeKey = sha256('telnet:' + sessionId + ':' + lineNo)`; a retry after a lost answer is a duplicate at the Bridge | contract tests |

**Residual risks.** Telnet is clear text: the pairing code and the commands cross the network unencrypted. Run it on
a local network, a VPN or behind TLS (stunnel), or prefer SSH. Windows: the tests are excluded from the `windows` job
until ported (they assume POSIX socket timing; said in `.github/workflows/ci.yml`).
