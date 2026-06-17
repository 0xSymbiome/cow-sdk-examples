//! `console` — a zero-dependency telemetry dashboard.
//!
//! Serves a small single-page dashboard on `127.0.0.1` (loopback only) that
//! live-tails the per-run NDJSON files the observability layer writes under
//! `telemetry/`. Run it in one terminal and any other command in another; the
//! dashboard streams the events. Stop with Ctrl-C.
//!
//! The HTTP server is hand-rolled on `tokio::net` — no web framework — to keep
//! the dependency surface narrow, and it never binds a non-loopback address.

use std::path::Path;

use cow_sdk::core::CancellationToken;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tracing::{info, warn};

use crate::cli::ConsoleArgs;
use crate::config::BotConfig;
use crate::error::{CmdResult, CommandError};

/// Cap on the events returned per poll, so a long history stays bounded.
const MAX_EVENTS: usize = 2_000;

/// Runs the `console` command.
///
/// # Errors
///
/// Returns [`CommandError::Io`] if the loopback listener cannot be bound, or
/// [`CommandError::Cancelled`] when Ctrl-C stops the server.
pub async fn run(args: ConsoleArgs, config: &BotConfig, cancel: CancellationToken) -> CmdResult {
    let addr = format!("127.0.0.1:{}", args.port);
    let listener = TcpListener::bind(&addr).await.map_err(CommandError::Io)?;
    info!(
        url = format!("http://{addr}/"),
        "console: serving telemetry dashboard (Ctrl-C to stop)"
    );
    println!("Telemetry dashboard: http://{addr}/  (Ctrl-C to stop)");

    loop {
        tokio::select! {
            () = cancel.clone().cancelled_owned() => {
                info!("console: shutting down");
                return Err(CommandError::Cancelled);
            }
            accepted = listener.accept() => match accepted {
                Ok((stream, _addr)) => {
                    if let Err(err) = serve(stream, &config.telemetry_dir).await {
                        warn!(error = %err, "console: request failed");
                    }
                }
                Err(err) => warn!(error = %err, "console: accept failed"),
            },
        }
    }
}

/// Serves one HTTP request: the dashboard page or the events feed.
async fn serve(mut stream: TcpStream, telemetry_dir: &Path) -> std::io::Result<()> {
    let mut buf = [0_u8; 1024];
    let read = stream.read(&mut buf).await?;
    let request = String::from_utf8_lossy(&buf[..read]);
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap_or("/");

    let (status, content_type, body) = match path {
        "/" => (
            "200 OK",
            "text/html; charset=utf-8",
            DASHBOARD_HTML.to_owned(),
        ),
        "/api/events" => ("200 OK", "application/json", events_json(telemetry_dir)),
        _ => (
            "404 Not Found",
            "text/plain; charset=utf-8",
            "not found".to_owned(),
        ),
    };

    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes()).await?;
    stream.write_all(body.as_bytes()).await?;
    stream.flush().await
}

/// Reads every `telemetry/*.ndjson` file, merges the events, and returns the most
/// recent ones as a JSON array sorted by timestamp. Events from different command
/// runs interleave chronologically — sorting by the per-event timestamp (RFC3339
/// UTC, which sorts lexically) rather than by file avoids grouping by command.
fn events_json(telemetry_dir: &Path) -> String {
    let mut events: Vec<serde_json::Value> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(telemetry_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "ndjson")
                && let Ok(body) = std::fs::read_to_string(&path)
            {
                for line in body.lines().filter(|line| !line.trim().is_empty()) {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
                        events.push(value);
                    }
                }
            }
        }
    }
    events.sort_by(|a, b| timestamp_of(a).cmp(timestamp_of(b)));
    let start = events.len().saturating_sub(MAX_EVENTS);
    serde_json::to_string(&events[start..]).unwrap_or_else(|_| "[]".to_owned())
}

/// The `timestamp` field of an event, or an empty string if absent (so untimed
/// events sort first rather than panicking).
fn timestamp_of(event: &serde_json::Value) -> &str {
    event
        .get("timestamp")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
}

const DASHBOARD_HTML: &str = r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cow-trading-bot telemetry</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
         background: #0b0f14; color: #d7dde4; }
  header { display: flex; gap: .75rem; align-items: center; flex-wrap: wrap;
           padding: .6rem .9rem; background: #11161d; border-bottom: 1px solid #1e2630;
           position: sticky; top: 0; }
  header h1 { font-size: 14px; margin: 0 .5rem 0 0; color: #8ad; }
  input, select, button { background: #0b0f14; color: #d7dde4; border: 1px solid #28323d;
           border-radius: 6px; padding: .3rem .5rem; font: inherit; }
  #count { margin-left: auto; color: #7a8694; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: .3rem .6rem; border-bottom: 1px solid #161c24;
           vertical-align: top; white-space: pre-wrap; word-break: break-word; }
  th { position: sticky; top: 49px; background: #11161d; color: #7a8694; font-weight: 600;
       white-space: nowrap; }
  tr:hover { background: #10161d; }
  .lvl { font-weight: 700; }
  .ERROR { color: #ff6b6b; } .WARN { color: #ffc857; } .INFO { color: #5fd3a0; }
  .DEBUG { color: #6ea8fe; } .TRACE { color: #9aa4af; }
  .tgt { color: #7a8694; } .fields { color: #9aa4af; }
  td.ts { color: #7a8694; white-space: nowrap; }
</style>
</head>
<body>
<header>
  <h1>cow-trading-bot</h1>
  <label>level <select id="level">
    <option value="">all</option><option>ERROR</option><option>WARN</option>
    <option>INFO</option><option>DEBUG</option><option>TRACE</option>
  </select></label>
  <label>target <select id="target"><option value="">all targets</option></select></label>
  <input id="search" type="search" placeholder="filter text…" size="24">
  <label><input id="auto" type="checkbox" checked> auto-refresh</label>
  <span id="count"></span>
</header>
<table>
  <thead><tr><th>time</th><th>level</th><th>target</th><th>message</th><th>fields</th></tr></thead>
  <tbody id="rows"></tbody>
</table>
<script>
// The most recent fetch is cached so the filter controls re-render instantly
// from memory rather than re-fetching — selecting a level or typing filters
// immediately.
let latest = [];
const rows = document.getElementById('rows');
const count = document.getElementById('count');
const levelSel = document.getElementById('level');
const search = document.getElementById('search');
const targetSel = document.getElementById('target');
const auto = document.getElementById('auto');

function esc(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function detail(ev) {
  // The event's own fields (minus the message) plus the current span's fields,
  // so an SDK span shows its telemetry (chain, endpoint, method, status, timing).
  const parts = [];
  const fields = Object.assign({}, ev.fields || {});
  const msg = fields.message || '';
  delete fields.message;
  for (const [k, v] of Object.entries(fields)) parts.push(k + '=' + v);
  if (ev.span) {
    for (const [k, v] of Object.entries(ev.span)) if (k !== 'name') parts.push(k + '=' + v);
  }
  const name = ev.span && ev.span.name ? ev.span.name : '';
  return { label: name ? name + ': ' + msg : msg, fields: parts.join('  ') };
}
function render() {
  const lvl = levelSel.value;
  const tgt = targetSel.value;
  const q = search.value.trim().toLowerCase();
  const frag = document.createDocumentFragment();
  let shown = 0;
  for (const ev of latest) {
    if (lvl && ev.level !== lvl) continue;
    if (tgt && ev.target !== tgt) continue;
    if (q && !JSON.stringify(ev).toLowerCase().includes(q)) continue;
    shown++;
    const d = detail(ev);
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="ts">' + esc(ev.timestamp || '') + '</td>' +
      '<td class="lvl ' + esc(ev.level || '') + '">' + esc(ev.level || '') + '</td>' +
      '<td class="tgt">' + esc(ev.target || '') + '</td>' +
      '<td>' + esc(d.label) + '</td>' +
      '<td class="fields">' + esc(d.fields) + '</td>';
    frag.appendChild(tr);
  }
  rows.replaceChildren(frag);
  count.textContent = shown + ' / ' + latest.length + ' events';
}
// Rebuild the target dropdown from the targets currently in the feed, preserving
// the selection. Only touches the DOM when the set of targets actually changes.
function syncTargets() {
  const seen = [...new Set(latest.map(ev => ev.target).filter(Boolean))].sort();
  const existing = [...targetSel.options].slice(1).map(o => o.value);
  if (existing.length === seen.length && existing.every((v, i) => v === seen[i])) return;
  const current = targetSel.value;
  targetSel.innerHTML = '<option value="">all targets</option>' +
    seen.map(t => '<option>' + esc(t) + '</option>').join('');
  targetSel.value = seen.includes(current) ? current : '';
}
async function refresh() {
  try {
    latest = await (await fetch('/api/events')).json();
    syncTargets();
    render();
  } catch (_) { /* server stopped */ }
}
levelSel.onchange = render;
targetSel.onchange = render;
search.oninput = render;
refresh();
setInterval(() => { if (auto.checked) refresh(); }, 2000);
</script>
</body>
</html>
"#;

#[cfg(test)]
mod tests {
    use super::timestamp_of;
    use serde_json::json;

    #[test]
    fn events_sort_chronologically_across_commands() {
        // Out of order, and from different commands, to catch the regression
        // where files were sorted by name (command-first) instead of by time.
        let mut events = [
            json!({ "timestamp": "2026-06-16T23:33:34.0Z", "fields": { "message": "daemon" } }),
            json!({ "timestamp": "2026-06-16T23:33:03.0Z", "fields": { "message": "inspect" } }),
            json!({ "timestamp": "2026-06-16T23:26:19.0Z", "fields": { "message": "console" } }),
        ];
        events.sort_by(|a, b| timestamp_of(a).cmp(timestamp_of(b)));
        let order: Vec<&str> = events.iter().map(timestamp_of).collect();
        assert_eq!(
            order,
            [
                "2026-06-16T23:26:19.0Z",
                "2026-06-16T23:33:03.0Z",
                "2026-06-16T23:33:34.0Z",
            ]
        );
    }

    #[test]
    fn untimed_event_sorts_first() {
        assert_eq!(timestamp_of(&json!({})), "");
    }
}
