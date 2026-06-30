//! A capability-scoped host for the CoW client component.
//!
//! `prove-cap` instantiates the signature guard alone, gives it a stub raw signer,
//! and shows the per-session signature cap deny the fourth request before it
//! reaches the key. Deterministic and offline.
//!
//! `trade` loads the composed `cow-trader-guarded.wasm` (guard plugged onto the
//! published client) and drives a live Sepolia quote, then optionally signs and
//! posts. The host grants only three capabilities — a `signer` (the key stays
//! here), a `contract-read` stub, and `wasi:http` — and inherits no environment,
//! no filesystem, and no other network, so the trading logic cannot read the key,
//! the host environment, or anything off the declared surface.

use anyhow::{Context, Result};
use wasmtime::component::{Component, HasSelf, Linker, ResourceTable};
use wasmtime::{Config, Engine, Store};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};

mod guard_world {
    wasmtime::component::bindgen!({
        path: "../guard/wit",
        world: "signer-guard",
    });
}

mod client_world {
    // A cow-only world: bindgen generates host traits for the cow:protocol imports
    // the host implements and the exports it drives. Standard WASI is satisfied by
    // wasmtime-wasi on the linker, so it is left out of this world.
    wasmtime::component::bindgen!({
        path: "../wit",
        world: "client-sync",
        imports: { default: async },
        exports: { default: async },
    });
}

const SEPOLIA: u64 = 11_155_111;
const WETH: &str = "0xfff9976782d46cc05630d1f6ebab18b2324d6b14";
const COW: &str = "0x0625afb445c3b6b7b929342a04a22599fd5dbb59";

fn main() -> Result<()> {
    match std::env::args().nth(1).as_deref() {
        Some("prove-cap") => prove_cap(),
        Some("trade") => tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()?
            .block_on(trade()),
        other => {
            eprintln!("usage: sandbox <prove-cap|trade>  (got {other:?})");
            std::process::exit(64);
        }
    }
}

// ---------------------------------------------------------------------------
// prove-cap — the guard alone, a stub raw signer, the cap denial (offline)
// ---------------------------------------------------------------------------

struct GuardHost {
    table: ResourceTable,
    wasi: WasiCtx,
    raw_calls: u32,
}

impl WasiView for GuardHost {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

impl guard_world::cow::protocol::signer::Host for GuardHost {
    fn sign_digest(&mut self, digest: Vec<u8>) -> Result<Vec<u8>, String> {
        self.raw_calls += 1;
        println!(
            "   [host raw signer] reached for call #{} ({} bytes) — the key would sign here",
            self.raw_calls,
            digest.len()
        );
        let mut sig = vec![0u8; 65];
        sig[64] = 27;
        Ok(sig)
    }
}

fn prove_cap() -> Result<()> {
    let root = env!("CARGO_MANIFEST_DIR");
    let guard = std::env::var("GUARD_WASM").unwrap_or_else(|_| {
        format!("{root}/../guard/target/wasm32-wasip2/release/signer_guard.wasm")
    });

    let mut config = Config::new();
    config.wasm_component_model(true);
    let engine = Engine::new(&config)?;
    let mut linker = Linker::<GuardHost>::new(&engine);
    wasmtime_wasi::p2::add_to_linker_sync(&mut linker)?;
    guard_world::SignerGuard::add_to_linker::<GuardHost, HasSelf<GuardHost>>(&mut linker, |h| h)?;

    let mut store = Store::new(
        &engine,
        GuardHost {
            table: ResourceTable::new(),
            wasi: WasiCtxBuilder::new().inherit_stdio().build(),
            raw_calls: 0,
        },
    );
    let component =
        Component::from_file(&engine, &guard).map_err(|e| anyhow::anyhow!("load {guard}: {e}"))?;
    let bindings = guard_world::SignerGuard::instantiate(&mut store, &component, &linker)?;
    let signer = bindings.cow_protocol_signer();

    println!("capability proof: the composed guard caps money-moving signatures (CAP = 3)\n");
    let digest = vec![0xABu8; 32];
    let mut denied = 0;
    for i in 1..=4 {
        match signer.call_sign_digest(&mut store, &digest)? {
            Ok(sig) => println!("call #{i}: OK     ({}-byte signature)", sig.len()),
            Err(e) => {
                denied += 1;
                println!("call #{i}: DENIED ({e})");
            }
        }
    }

    let raw = store.data().raw_calls;
    anyhow::ensure!(
        raw == 3 && denied == 1,
        "expected 3 delegated + 1 denied, got {raw} delegated / {denied} denied"
    );
    println!(
        "\nPASS: the host key was reached exactly 3 times; the 4th signature was denied in the guard."
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// trade — the composed artifact, real signer, live Sepolia (opt-in write)
// ---------------------------------------------------------------------------

use k256::ecdsa::SigningKey;
use tiny_keccak::{Hasher, Keccak};
use wasmtime_wasi_http::WasiHttpCtx;
use wasmtime_wasi_http::p2::{WasiHttpCtxView, WasiHttpView};

struct TradeHost {
    table: ResourceTable,
    wasi: WasiCtx,
    http: WasiHttpCtx,
    signing_key: SigningKey,
}

impl WasiView for TradeHost {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

impl WasiHttpView for TradeHost {
    fn http(&mut self) -> WasiHttpCtxView<'_> {
        WasiHttpCtxView {
            ctx: &mut self.http,
            table: &mut self.table,
            hooks: Default::default(),
        }
    }
}

// The host holds the key and answers the composed guard's raw signer import.
impl client_world::cow::protocol::signer::Host for TradeHost {
    async fn sign_digest(&mut self, digest: Vec<u8>) -> Result<Vec<u8>, String> {
        if digest.len() != 32 {
            return Err(format!("expected a 32-byte digest, got {}", digest.len()));
        }
        let (sig, recovery_id) = self
            .signing_key
            .sign_prehash_recoverable(&digest)
            .map_err(|e| format!("k256 sign failed: {e}"))?;
        let mut out = Vec::with_capacity(65);
        out.extend_from_slice(&sig.to_bytes());
        out.push(27 + recovery_id.to_byte());
        Ok(out)
    }
}

// Unused on the quote/post path (those drive the orderbook API, not RPC).
impl client_world::cow::protocol::contract_read::Host for TradeHost {
    async fn read_contract(
        &mut self,
        _call: client_world::cow::protocol::contract_read::ContractCall,
    ) -> Result<String, String> {
        Err("contract-read not wired (quote/post use the orderbook API, not RPC)".into())
    }
}

// The cow:protocol order/book/trade imports carry only shared enums and records;
// they declare no functions, so their host traits are empty.
impl client_world::cow::protocol::order::Host for TradeHost {}
impl client_world::cow::protocol::book::Host for TradeHost {}
impl client_world::cow::protocol::trade::Host for TradeHost {}

async fn trade() -> Result<()> {
    let root = env!("CARGO_MANIFEST_DIR");
    let _ = dotenvy::from_path(format!("{root}/../.env"));
    let wasm = std::env::var("COMPOSED_WASM")
        .unwrap_or_else(|_| format!("{root}/../dist/cow-trader-guarded.wasm"));

    let priv_hex = std::env::var("COW_BOT_PRIVATE_KEY")
        .context("set COW_BOT_PRIVATE_KEY (copy .env.example to .env and fill it)")?;
    let key_bytes = hex::decode(priv_hex.trim().trim_start_matches("0x"))
        .context("COW_BOT_PRIVATE_KEY must be 32-byte hex")?;
    let signing_key = SigningKey::from_slice(&key_bytes)?;
    let owner = derive_owner(&signing_key);
    let amount = env_or("COW_BOT_SELL_AMOUNT_WEI", "5000000000000000");
    let app_code = env_or("COW_BOT_APP_CODE", "cow-agent-sandbox");
    let write = env_or("COW_BOT_WRITE", "no") == "yes";

    let mut config = Config::new();
    config.wasm_component_model(true);
    let engine = Engine::new(&config)?;
    let mut linker = Linker::<TradeHost>::new(&engine);
    wasmtime_wasi::p2::add_to_linker_async(&mut linker)?;
    wasmtime_wasi_http::p2::add_only_http_to_linker_async(&mut linker)?;
    client_world::ClientSync::add_to_linker::<TradeHost, HasSelf<TradeHost>>(&mut linker, |h| h)?;

    let mut store = Store::new(
        &engine,
        TradeHost {
            table: ResourceTable::new(),
            // stdio only: no environment (the key lives in the host process env),
            // no filesystem, no network beyond the wasi:http granted below.
            wasi: WasiCtxBuilder::new().inherit_stdio().build(),
            http: WasiHttpCtx::new(),
            signing_key,
        },
    );
    let component =
        Component::from_file(&engine, &wasm).map_err(|e| anyhow::anyhow!("load {wasm}: {e}"))?;
    let bindings =
        client_world::ClientSync::instantiate_async(&mut store, &component, &linker).await?;
    let trading = bindings.cow_protocol_trading();

    println!(
        "host:    native Rust + Wasmtime, capability-scoped (signer + contract-read + wasi:http)"
    );
    println!("artifact: cow-trader-guarded.wasm (published client + composed signature guard)");
    println!("owner:    {owner} (derived from the key; the key never enters the wasm)");
    println!("selling:  {amount} wei WETH -> COW on Sepolia\n");

    let request = client_world::exports::cow::protocol::trading::SwapRequest {
        chain_id: SEPOLIA,
        owner: owner.clone(),
        sell_token: WETH.to_owned(),
        buy_token: COW.to_owned(),
        amount: amount.clone(),
        app_code: app_code.clone(),
        kind: Some(client_world::exports::cow::protocol::trading::OrderKind::Sell),
        slippage_bps: Some(50),
        env: None,
        receiver: None,
        valid_to: None,
        valid_for: None,
        partially_fillable: None,
        sell_token_balance: None,
        buy_token_balance: None,
        settlement_contract_override: None,
        eth_flow_contract_override: None,
        partner_fee: None,
    };

    println!("1) trading.quote — the client fetches a live managed quote over wasi:http");
    let quote_json = trading
        .call_quote(&mut store, &request)
        .await?
        .map_err(|e| anyhow::anyhow!("quote: class={:?} msg={}", e.class, e.message))?;
    println!("   quote: {}\n", truncate(&quote_json, 320));

    if !write {
        println!("2) COW_BOT_WRITE != yes — quote-only run (set it to sign and post live).");
        return Ok(());
    }

    println!("2) trading.post-swap-from-quote — the host signs the digest, the client posts");
    match trading
        .call_post_swap_from_quote(&mut store, &quote_json)
        .await?
    {
        Ok(uid_json) => {
            let uid = uid_json
                .split("\"uid\":\"")
                .nth(1)
                .and_then(|s| s.split('"').next())
                .unwrap_or_else(|| uid_json.trim());
            println!("   posted. uid: {uid}");
            println!("   https://explorer.cow.fi/sepolia/orders/{uid}");
        }
        Err(e) => {
            println!(
                "   rejected (typed): class={:?} retryable={} message={}",
                e.class, e.retryable, e.message
            );
        }
    }
    Ok(())
}

/// Lowercase `0x` address from a k256 key: keccak256(uncompressed pubkey[1..])[12..].
fn derive_owner(key: &SigningKey) -> String {
    let point = key.verifying_key().to_encoded_point(false);
    let pubkey = &point.as_bytes()[1..];
    let mut hasher = Keccak::v256();
    let mut hash = [0u8; 32];
    hasher.update(pubkey);
    hasher.finalize(&mut hash);
    format!("0x{}", hex::encode(&hash[12..]))
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key)
        .map(|s| s.trim().to_owned())
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default.to_owned())
}

fn truncate(s: &str, n: usize) -> String {
    if s.len() <= n {
        s.to_owned()
    } else {
        format!("{}… [{} bytes]", &s[..n], s.len())
    }
}
