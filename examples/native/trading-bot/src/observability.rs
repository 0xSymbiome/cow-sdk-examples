//! Tracing subscriber install.
//!
//! Routes the bot's spans and events — and the SDK's, which nest under them when
//! the `tracing` feature is on — to the console (pretty or JSON) and, always, to
//! a per-run newline-delimited JSON file under `telemetry/`. The `console`
//! command live-tails those files.
//!
//! Default filter: `info,cow_sdk=debug,cow_sdk_subgraph=debug,cow_trading_bot=debug`.
//! Override with the standard `RUST_LOG` environment variable.

use std::fs::OpenOptions;
use std::io::Write;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::fmt::format::FmtSpan;
use tracing_subscriber::{EnvFilter, Layer, fmt, layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::{BotConfig, LogFormat};

/// Installs the process-wide tracing subscriber for the lifetime of the run.
///
/// `command` names the per-run telemetry file (`telemetry/<command>-<UTC>.ndjson`).
pub fn install(config: &BotConfig, command: &str) {
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        EnvFilter::new("info,cow_sdk=debug,cow_sdk_subgraph=debug,cow_trading_bot=debug")
    });

    let console = match config.log_format {
        LogFormat::Pretty => fmt::layer().with_target(true).with_ansi(true).boxed(),
        LogFormat::Json => fmt::layer()
            .json()
            .with_target(true)
            .with_current_span(true)
            .boxed(),
    };

    // Always-on NDJSON sink for the telemetry console. `with_span_events` emits a
    // line when each span opens and closes, so the SDK's own spans (transport
    // dispatch, quote, send_order, ...) surface in the dashboard — not just the
    // bot's events. Best-effort: if the file cannot be opened the bot still runs
    // with console logging only.
    let ndjson = ndjson_writer(config, command).map(|writer| {
        fmt::layer()
            .json()
            .with_ansi(false)
            .with_target(true)
            .with_current_span(true)
            .with_span_events(FmtSpan::NEW | FmtSpan::CLOSE)
            .with_writer(writer)
    });

    tracing_subscriber::registry()
        .with(env_filter)
        .with(console)
        .with(ndjson)
        .init();
}

/// Opens (creating `telemetry/`) the per-run NDJSON file and wraps it as a
/// `MakeWriter`, or returns `None` if it cannot be created.
fn ndjson_writer(config: &BotConfig, command: &str) -> Option<NdjsonWriter> {
    std::fs::create_dir_all(&config.telemetry_dir).ok()?;
    let stamp = Utc::now().format("%Y-%m-%dT%H-%M-%S").to_string();
    let path = config
        .telemetry_dir
        .join(format!("{command}-{stamp}.ndjson"));
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .ok()?;
    Some(NdjsonWriter {
        file: Arc::new(Mutex::new(file)),
    })
}

/// A `MakeWriter` that appends each formatted event line to a shared file.
#[derive(Clone)]
struct NdjsonWriter {
    file: Arc<Mutex<std::fs::File>>,
}

impl<'a> MakeWriter<'a> for NdjsonWriter {
    type Writer = NdjsonHandle;
    fn make_writer(&'a self) -> Self::Writer {
        NdjsonHandle {
            file: self.file.clone(),
        }
    }
}

struct NdjsonHandle {
    file: Arc<Mutex<std::fs::File>>,
}

impl Write for NdjsonHandle {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.file
            .lock()
            .expect("telemetry file poisoned")
            .write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.file.lock().expect("telemetry file poisoned").flush()
    }
}
