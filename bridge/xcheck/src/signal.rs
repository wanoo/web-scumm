// The signed signal of src/engine/reality/protocol.ts, checked in Rust in the same order with the same refusal codes:
// size, shape, header, algorithm, key, key window, signature on the exact bytes, then the payload and what it says.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde_json::{Map, Value};

pub const MAX_SIGNAL_CHARS: usize = 4096;

/// The clock tolerance of src/engine/reality/protocol.ts (CLOCK_SKEW_MS), in milliseconds.
const CLOCK_SKEW_MS: f64 = 300_000.0;

pub struct Key { pub kid: String, pub raw: Vec<u8>, pub not_before: Option<f64>, pub not_after: Option<f64> }
pub struct Expect { pub game: String, pub player: String, pub signals: Vec<String>, pub now: f64 }

fn b64(s: &str) -> Option<Vec<u8>> {
    if s.is_empty() || !s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') { return None; }
    URL_SAFE_NO_PAD.decode(s).ok()
}

fn ident(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::String(s)) if !s.is_empty() && s.len() <= 128 && s.bytes().all(|c| c.is_ascii_alphanumeric() || b"_.:-".contains(&c)))
}
fn int(v: Option<&Value>, min: i64) -> bool { v.and_then(Value::as_i64).map_or(false, |n| n >= min) && v.and_then(Value::as_f64).map_or(false, |f| f.fract() == 0.0) }

fn payload_ok(o: &Map<String, Value>) -> bool {
    const KNOWN: [&str; 14] = ["format", "schema", "id", "sequence", "gameId", "playerId", "signal", "source", "occurredAt", "receivedAt", "expiresAt", "dedupeKey", "policyVersion", "evidenceHash"];
    if o.keys().any(|k| !KNOWN.contains(&k.as_str())) { return false; }
    let s = |k: &str, max: usize| matches!(o.get(k), Some(Value::String(v)) if !v.is_empty() && v.len() <= max);
    o.get("format") == Some(&Value::from("web-scumm-world-signal"))
        && ident(o.get("id")) && int(o.get("sequence"), 1) && ident(o.get("gameId")) && ident(o.get("playerId"))
        && ident(o.get("signal")) && ident(o.get("source")) && int(o.get("receivedAt"), 0)
        && o.get("occurredAt").map_or(true, |_| int(o.get("occurredAt"), 0))
        && o.get("expiresAt").map_or(true, |_| int(o.get("expiresAt"), 0))
        && s("dedupeKey", 256) && s("policyVersion", 64)
        && o.get("evidenceHash").map_or(true, |v| matches!(v, Value::String(h) if h.len() == 64 && h.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))))
}

pub fn verify(jws: &str, keys: &[Key], e: &Expect) -> &'static str {
    if jws.chars().count() > MAX_SIGNAL_CHARS { return "size"; }
    let parts: Vec<&str> = jws.split('.').collect();
    if parts.len() != 3 || parts.iter().any(|p| p.is_empty() || !p.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')) { return "shape"; }
    let header: Map<String, Value> = match b64(parts[0]).and_then(|b| serde_json::from_slice::<Value>(&b).ok()) {
        Some(Value::Object(m)) => m,
        _ => return "header",
    };
    if header.get("alg") != Some(&Value::from("EdDSA")) { return "algorithm"; }
    if header.keys().any(|k| k != "alg" && k != "kid" && k != "typ") { return "header"; }
    let kid = header.get("kid").and_then(Value::as_str);
    let Some(key) = keys.iter().find(|k| Some(k.kid.as_str()) == kid) else { return "key" };
    if key.not_before.map_or(false, |t| e.now < t - CLOCK_SKEW_MS) || key.not_after.map_or(false, |t| e.now > t + CLOCK_SKEW_MS) { return "key-window"; }
    let Some(sig) = b64(parts[2]).and_then(|b| Signature::from_slice(&b).ok()) else { return "signature" };
    let Ok(vk) = VerifyingKey::from_bytes(key.raw.as_slice().try_into().unwrap_or(&[0u8; 32])) else { return "key" };
    if vk.verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &sig).is_err() { return "signature"; }
    let payload: Value = match b64(parts[1]).and_then(|b| String::from_utf8(b).ok()).and_then(|t| serde_json::from_str(&t).ok()) {
        Some(v) => v,
        None => return "payload",
    };
    if let Value::Object(o) = &payload { if o.get("schema") != Some(&Value::from(1)) { return "schema"; } }
    let Value::Object(o) = &payload else { return "payload" };
    if !payload_ok(o) { return "payload"; }
    if o.get("gameId").and_then(Value::as_str) != Some(e.game.as_str()) { return "game"; }
    if o.get("playerId").and_then(Value::as_str) != Some(e.player.as_str()) { return "player"; }
    if !e.signals.iter().any(|s| Some(s.as_str()) == o.get("signal").and_then(Value::as_str)) { return "signal"; }
    if o.get("expiresAt").and_then(Value::as_f64).map_or(false, |t| e.now > t + CLOCK_SKEW_MS) { return "expired"; }
    "ok"
}
