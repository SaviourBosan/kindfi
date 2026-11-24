use std::{env, path::Path};

fn main() {
    let account_wasm = Path::new(&env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("../../../target/wasm32v1-none/release/account_contract.wasm");

    println!("cargo:rerun-if-changed={}", account_wasm.display());
    println!("cargo:rustc-check-cfg=cfg(account_contract_wasm)");

    if account_wasm.is_file() {
        println!("cargo:rustc-cfg=account_contract_wasm");
    }
}
