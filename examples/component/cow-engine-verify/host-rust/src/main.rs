//! Reproduce a CoW order identity from the published engine component, in a
//! native Rust host, and assert it equals the committed golden — byte for byte.
//!
//! The engine declares no host imports, so this host wires only standard WASI
//! (for the component's incidental std use) and calls the pure exports. No key,
//! no node, no network.

use anyhow::{Context, Result};
use serde::Deserialize;
use wasmtime::component::{Component, Linker, ResourceTable};
use wasmtime::{Config, Engine, Store};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};

wasmtime::component::bindgen!({
    path: "../wit",
    world: "root",
});

use exports::cow::protocol::order::{OrderData, OrderKind};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Golden {
    chain_id: u64,
    owner: String,
    order: GoldenOrder,
    expected: Expected,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenOrder {
    sell_token: String,
    buy_token: String,
    sell_amount: String,
    buy_amount: String,
    valid_to: u32,
    app_data: String,
    kind: String,
}

#[derive(Deserialize)]
struct Expected {
    uid: String,
    digest: String,
}

struct Host {
    table: ResourceTable,
    wasi: WasiCtx,
}

impl WasiView for Host {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

fn main() -> Result<()> {
    let root = env!("CARGO_MANIFEST_DIR");
    let golden: Golden =
        serde_json::from_str(&std::fs::read_to_string(format!("{root}/../golden.json"))?)
            .context("parse golden.json")?;
    let wasm =
        std::env::var("ENGINE_WASM").unwrap_or_else(|_| format!("{root}/../vendor/engine.wasm"));

    let mut config = Config::new();
    config.wasm_component_model(true);
    let engine = Engine::new(&config)?;
    let mut linker = Linker::<Host>::new(&engine);
    wasmtime_wasi::p2::add_to_linker_sync(&mut linker)?;

    let mut store = Store::new(
        &engine,
        Host {
            table: ResourceTable::new(),
            wasi: WasiCtxBuilder::new().inherit_stdio().build(),
        },
    );
    let component =
        Component::from_file(&engine, &wasm).map_err(|e| anyhow::anyhow!("load {wasm}: {e}"))?;
    let bindings = Root::instantiate(&mut store, &component, &linker)?;

    let order = OrderData {
        sell_token: golden.order.sell_token.clone(),
        buy_token: golden.order.buy_token.clone(),
        receiver: None,
        sell_amount: golden.order.sell_amount.clone(),
        buy_amount: golden.order.buy_amount.clone(),
        fee_amount: None,
        valid_to: golden.order.valid_to,
        app_data: golden.order.app_data.clone(),
        kind: match golden.order.kind.as_str() {
            "buy" => OrderKind::Buy,
            _ => OrderKind::Sell,
        },
        partially_fillable: None,
        sell_token_balance: None,
        buy_token_balance: None,
    };

    let order_api = bindings.cow_protocol_order();
    let uid = order_api
        .call_uid(&mut store, golden.chain_id, &golden.owner, &order)?
        .map_err(|e| anyhow::anyhow!("order.uid: {e}"))?;
    let digest = order_api
        .call_digest(&mut store, golden.chain_id, &order)?
        .map_err(|e| anyhow::anyhow!("order.digest: {e}"))?;
    let chains = bindings
        .cow_protocol_chains()
        .call_supported_chain_ids(&mut store)?;

    println!("host:   native Rust + Wasmtime");
    println!("engine: published cow-sdk-component-engine (OCI), zero host imports");
    println!("chains ({}): {chains:?}", chains.len());
    println!("order.uid   : {uid}");
    println!("order.digest: {digest}");

    let mut failures = Vec::new();
    if uid != golden.expected.uid {
        failures.push(format!("uid mismatch: got {uid}"));
    }
    if digest != golden.expected.digest {
        failures.push(format!("digest mismatch: got {digest}"));
    }
    if uid.len() == 114 && uid[2..66] != digest[2..] {
        failures.push("uid does not embed the digest".to_owned());
    }
    if !chains.contains(&golden.chain_id) {
        failures.push(format!("chain {} not in supported set", golden.chain_id));
    }
    if let Some(first) = failures.first() {
        anyhow::bail!("verification failed: {first}");
    }

    println!("\nPASS: the published engine reproduced the committed order identity byte for byte.");
    Ok(())
}
