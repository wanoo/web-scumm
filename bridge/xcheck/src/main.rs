// cargo run --release -- <samples dir>: one line of JSON per validation of Biscuit's official samples, with the
// verdict of the Rust implementation (Ok, Format, FailedLogic, Execution) and the revocation ids, for
// scripts/reality-xcheck.mjs to compare with the JavaScript implementation and with the expected verdicts.
use biscuit_auth::{error::Token, AuthorizerBuilder, Biscuit, PublicKey};
use std::{env, fs, path::Path, time::Duration};
use biscuit_auth::AuthorizerLimits as RunLimits;
mod signal;

/// One second, not the default millisecond: a slow CI runner must not turn a verdict into a timeout.
fn limits() -> RunLimits {
    RunLimits { max_time: Duration::from_secs(1), ..RunLimits::default() }
}

fn class(e: &Token) -> &'static str {
    match e {
        Token::FailedLogic(_) => "FailedLogic",
        Token::RunLimit(_) | Token::Execution(_) => "Execution",
        _ => "Format",
    }
}

/// `conformance <file>`: tests/fixtures/reality/conformance.json, one line per case with the Rust verdict.
fn conformance(file: &str) {
    use base64::Engine;
    let c: serde_json::Value = serde_json::from_str(&fs::read_to_string(file).unwrap()).unwrap();
    let keys: Vec<signal::Key> = c["keys"].as_array().unwrap().iter().map(|k| signal::Key {
        kid: k["kid"].as_str().unwrap().to_string(),
        raw: base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(k["raw"].as_str().unwrap()).unwrap(),
        not_before: k["notBefore"].as_f64(),
        not_after: k["notAfter"].as_f64(),
    }).collect();
    let e = &c["expect"];
    for case in c["cases"].as_array().unwrap() {
        let exp = signal::Expect {
            game: e["gameId"].as_str().unwrap().into(),
            player: e["playerId"].as_str().unwrap().into(),
            signals: e["signals"].as_array().unwrap().iter().map(|s| s.as_str().unwrap().into()).collect(),
            now: case["expect"]["now"].as_f64().unwrap_or(e["now"].as_f64().unwrap()),
        };
        let v = signal::verify(case["jws"].as_str().unwrap(), &keys, &exp);
        println!("{}", serde_json::json!({ "name": case["name"], "verdict": v }));
    }
}

/// `policy <file> <policy.datalog>`: tests/fixtures/reality/policy.json, the Bridge's tokens and requests authorised
/// by the Rust implementation with the same policy and parameters.
fn policy(file: &str, policy_file: &str) {
    use biscuit_auth::builder::Term;
    use std::collections::HashMap;
    let c: serde_json::Value = serde_json::from_str(&fs::read_to_string(file).unwrap()).unwrap();
    let code = fs::read_to_string(policy_file).unwrap();
    let root = PublicKey::from_bytes_hex(c["rootPublicKey"].as_str().unwrap().trim_start_matches("ed25519/"), biscuit_auth::Algorithm::Ed25519).unwrap();
    for case in c["cases"].as_array().unwrap() {
        let verdict = match Biscuit::from_base64(case["token"].as_str().unwrap(), root) {
            Err(_) => "format",
            Ok(token) => {
                let r = &case["request"];
                let mut params: HashMap<String, Term> = HashMap::new();
                for (k, f) in [("game", "gameId"), ("player", "playerId"), ("source", "source"), ("signal", "signal"), ("audience", "audience")] {
                    params.insert(k.into(), Term::Str(r[f].as_str().unwrap().into()));
                }
                params.insert("now".into(), Term::Date(case["now"].as_u64().unwrap() / 1000));
                match AuthorizerBuilder::new().set_limits(RunLimits { max_time: Duration::from_millis(200), ..RunLimits::default() }).code_with_params(&code, params, HashMap::new()).and_then(|b| b.build(&token)).and_then(|mut a| a.authorize()) {
                    Ok(_) => "ok",
                    Err(_) => "denied",
                }
            }
        };
        println!("{}", serde_json::json!({ "name": case["name"], "verdict": verdict }));
    }
}

fn main() {
    let first = env::args().nth(1).expect("samples dir, or conformance <file>");
    if first == "conformance" { return conformance(&env::args().nth(2).expect("file")); }
    if first == "policy" { return policy(&env::args().nth(2).expect("file"), &env::args().nth(3).expect("policy")); }
    let dir = first;
    let samples: serde_json::Value = serde_json::from_str(&fs::read_to_string(Path::new(&dir).join("samples.json")).unwrap()).unwrap();
    let root = PublicKey::from_bytes_hex(samples["root_public_key"].as_str().unwrap().trim_start_matches("ed25519/"), biscuit_auth::Algorithm::Ed25519).unwrap();
    for t in samples["testcases"].as_array().unwrap() {
        let file = t["filename"].as_str().unwrap();
        let bytes = fs::read(Path::new(&dir).join(file)).unwrap();
        for (name, v) in t["validations"].as_object().unwrap() {
            let (verdict, revocation) = match Biscuit::from(&bytes, root) {
                Err(e) => (class(&e).to_string(), vec![]),
                Ok(token) => {
                    let ids: Vec<String> = token.revocation_identifiers().iter().map(hex::encode).collect();
                    let code = v["authorizer_code"].as_str().unwrap_or("");
                    let r = AuthorizerBuilder::new().set_limits(limits()).code(code).and_then(|b| b.build(&token)).and_then(|mut a| a.authorize());
                    (match r { Ok(_) => "Ok".to_string(), Err(e) => class(&e).to_string() }, ids)
                }
            };
            println!("{}", serde_json::json!({ "file": file, "validation": name, "verdict": verdict, "revocation": revocation }));
        }
    }
}
