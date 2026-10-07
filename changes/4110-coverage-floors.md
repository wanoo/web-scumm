### Changes

- **The coverage floors raised to within three points of what the tests reach (4.1.10)**: lines 66, statements 65,
  functions 61, branches 62 (64 / 63 / 59 / 61 before), `reality/protocol.ts` branches 96. The strict ratchet on the
  `v4.1.10-rc.1` tag refused the five floors Constellation's tests had left behind (measured 67.91 / 67.21 / 63.31 /
  64.09 and 98.75); the pull request had only warned.
- **`e2e:reality` waits two minutes for the ending cutscene after the gate (4.1.10)**, 30 s before: on a runner
  carrying five runs the cutscene outlasted it twice today (Chromium and WebKit) with every other check green.
