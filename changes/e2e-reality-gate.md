### Changes

- **`e2e:reality` acts on the gate again when the ending does not come (4.1.12)**: an input while the engine is busy is
  dropped, as a player's tap is, and the shed's cutscene could still be running when the harness used the gate; the
  check waited 120 s for an ending that never came (one WebKit run in three on 7 October 2026). Now: wait for the
  engine to be free, act, and act again up to three times, 40 s each.
