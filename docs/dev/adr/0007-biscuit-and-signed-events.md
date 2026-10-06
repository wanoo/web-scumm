# 0007 · Biscuit authorises a connector; a signature attests an event

**Context.** A signal from the world outside crosses three hands: a connector (an email reader, a webhook), the
Bridge, the player's browser. Each must be able to check the one before, and a token stolen at one step must not open
the others. (Decided with the 4.1.1 plan, D15–D16, after the spike, `docs/dev/reality-spike.md`.)

**Decision.** Two mechanisms, each for one question. **Biscuit** (on the Bridge only, `bridge/src/policy.ts`) says
who may propose what: a connector's token names its game, sources, signals, players, audience and expiry, can be
attenuated by its holder, never widened, and is revoked by id. **An Ed25519 signature** (`src/engine/reality/protocol.ts`)
says what the Bridge accepted: a compact JWS over the exact bytes, verified by the player before it parses them. The
player holds neither Biscuit nor key: only a capability to read and acknowledge its own signals.

**Cost.** Two formats to keep, a Rust cross-check of Biscuit in CI (`npm run reality:xcheck`), keys to rotate.

**Would change it.** A browser that drops Ed25519 from WebCrypto (COSE stays the fallback), or a Biscuit
implementation the cross-check no longer agrees with.
