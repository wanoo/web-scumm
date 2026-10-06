// cargo run --release -- <samples dir>: one line of JSON per validation of Biscuit's official samples, with the
// verdict of the Rust implementation (Ok, Format, FailedLogic, Execution) and the revocation ids, for
// scripts/reality-xcheck.mjs to compare with the JavaScript implementation and with the expected verdicts.
use biscuit_auth::{error::Token, AuthorizerBuilder, Biscuit, PublicKey};
use std::{env, fs, path::Path};

fn class(e: &Token) -> &'static str {
    match e {
        Token::FailedLogic(_) => "FailedLogic",
        Token::RunLimit(_) | Token::Execution(_) => "Execution",
        _ => "Format",
    }
}

fn main() {
    let dir = env::args().nth(1).expect("samples dir");
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
                    let r = AuthorizerBuilder::new().code(code).and_then(|b| b.build(&token)).and_then(|mut a| a.authorize());
                    (match r { Ok(_) => "Ok".to_string(), Err(e) => class(&e).to_string() }, ids)
                }
            };
            println!("{}", serde_json::json!({ "file": file, "validation": name, "verdict": verdict, "revocation": revocation }));
        }
    }
}
