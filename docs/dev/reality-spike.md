# Reality Bridge: the spike (4.1.1, lot A)

The measures the protocol's irreversible choices rest on (`docs/dev/PLAN-4.1-REALITY-BRIDGE.md` §10 lot A, §15).
Reproduce with `npm run reality:spike` (the table) and `npm run reality:xcheck` (Biscuit in two implementations).
Measured on 2026-10-06, macOS arm64, Node 22.14, Playwright's Chromium 153 and WebKit 26.6.

## Ed25519 and the signed envelope

| Where | Ed25519 present | verify a JWS (ms) | a flipped byte | an unknown key |
|---|---|---|---|---|
| Node v22.14.0 | yes | 0.068 | refused | refused |
| Chromium 153.0.8010.12 | yes | 0.046 | refused | refused |
| WebKit 26.6 | yes | 0.15 | refused | refused |

The player's verifier (split a compact JWS, check the EdDSA signature on the transported bytes, then decode): 583
bytes minified, **381 bytes gzipped**, no library. WebCrypto needs a secure context (HTTPS or localhost), which a PWA
already is.

**Decision (D15): a compact JWS, `alg: EdDSA`, `kid` naming the key, verified with WebCrypto.** COSE would need a CBOR
decoder in the player for nothing the JWS lacks here; it stays the fallback if a supported browser drops Ed25519.
The payload is the exact base64url bytes the Bridge signed: the player verifies before it parses, never a
re-serialised object.

## Biscuit

`@biscuit-auth/biscuit-wasm` 0.6.0, loaded by `bridge/src/biscuit.ts` (the WebAssembly module instantiated by hand, so
Node runs it without `--experimental-wasm-modules`):

- create a token and attenuate it with an expiry block: 4.7 ms (first call), 524 characters in base64;
- parse, verify and authorise it: **0.235 ms**;
- another player, an expired token: refused.

Biscuit's official samples (`bridge/test-vectors/biscuit`, 50 validations): the JavaScript build and the Rust crate
`biscuit-auth` 6.0.0 (`bridge/xcheck`) give the specification's verdict on 49, the same in both, with the same
revocation ids. Excluded: `test035_ffi.bc`, which needs host functions the Bridge does not register.

**Decision (D16): Biscuit on the Bridge only, the JavaScript (WebAssembly) build in production, cross-checked by the
Rust crate in CI** (`npm run reality:xcheck -- --require-rust`, the `reality-xcheck` job). The player never sees a
Biscuit: it holds a narrow read-and-acknowledge capability, and verifies the Bridge's signature on each event.

## Transport

**Decision (D17): Server-Sent Events, and an HTTP fetch by cursor that returns the same events.** One-way delivery is
all the player needs (its acknowledgements are plain requests); SSE reconnects by itself with `Last-Event-ID`, which is
the cursor, passes HTTP proxies, and has nothing to negotiate. The fetch serves a reconnection after a long time away
and the tests. WebSocket brings nothing more here.

## What the spike does not settle

The Bridge's storage (a JSONL journal behind an interface, decided with the plan: no native dependency), the size of
`applied` before compaction (measured by the engine's tests), and the latency over a real network (a reported gate:
a deployed Bridge).
