## `fix/e2e-reality-gate`: the gate acted on while the engine was busy

- Seen on the `v4.1.11-rc.1` tag (WebKit, 16:30 UTC): the replays' signals applied and the shed door open at 16:30:39,
  `use gate` sent at once, the ending not reached at 16:32:39 after the 120 s of PR #52: not a slow cutscene, a
  dropped input. The harness now waits for `engine.busy` to clear and retries. Not reproduced locally (no e2e here).
→ next: Claude · the tags of 4.1.10 and 4.1.11 on commits carrying this
