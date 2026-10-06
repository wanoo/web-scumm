# 0004 · A session is the unit of reproduction

**Context.** A bug seen on a tester's phone has to be reproduced on the maintainer's machine, without the tester.

**Decision.** Every input is an entry of the engine's session (`src/engine/core/session-runtime.ts`) with the answers
given while it ran (choices, random draws, map picks) and the digest of the state after it. A session file is the bug
report: `replay` (`src/engine/tools/replay.ts`) plays it in Node and names the first entry whose state differs.
Playtests, golden saves and the solver's witnesses are sessions too.

**Cost.** Everything that changes state must go through an input the session records; a timer that changed state on
its own would break replay, so the engine's clock is recorded, not read.

**Would change it.** A source of input that cannot be recorded as an entry (none so far).
