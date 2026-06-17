//! Telemetry tests.
//!
//! These exercise the reusable [`support::TraceCapture`] harness the same way a
//! consumer asserts the SDK's telemetry: install the capturing layer, run code,
//! then assert on the captured spans and events. The SDK instruments its public
//! methods with the same `#[tracing::instrument]` mechanism proved here, so the
//! identical assertions apply to the SDK's `quote` / `send_order` /
//! `transport.dispatch` spans and its `cow_sdk::cancel` / retry events when a
//! real call is driven (see the integration suite and live smoke).

mod support;

use support::TraceCapture;
use tracing_subscriber::layer::SubscriberExt;

/// A function instrumented exactly like the bot's command handlers: a named span
/// with an explicit field, `skip_all` so arguments are never captured wholesale.
#[tracing::instrument(name = "trade_cycle", skip_all, fields(cycle = cycle))]
async fn instrumented_cycle(cycle: u32) {
    tracing::info!("cycle body ran");
}

#[tokio::test(flavor = "current_thread")]
async fn trace_capture_records_instrumented_spans_with_fields() {
    let capture = TraceCapture::default();
    let subscriber = tracing_subscriber::registry().with(capture.clone());

    {
        let _guard = tracing::subscriber::set_default(subscriber);
        instrumented_cycle(7).await;
    }

    let spans = capture.spans();
    let span = spans
        .iter()
        .find(|span| span.name == "trade_cycle")
        .expect("the instrumented span must be captured");
    assert_eq!(span.field("cycle"), Some("7"));
}

#[test]
fn trace_capture_records_events_with_target_and_fields() {
    let capture = TraceCapture::default();
    let subscriber = tracing_subscriber::registry().with(capture.clone());

    // Shape mirrors the SDK's cooperative-cancellation event
    // (target `cow_sdk::cancel`, `cancelled = true`): the same assertion the
    // consumer makes against the real event when a fired token unwinds a call.
    tracing::subscriber::with_default(subscriber, || {
        tracing::debug!(target: "cow_sdk::cancel", cancelled = true, "cancellation fired");
    });

    let events = capture.events();
    assert!(
        events.iter().any(|event| {
            event.target == "cow_sdk::cancel"
                && event.level == "DEBUG"
                && event.field("cancelled") == Some("true")
        }),
        "expected a cow_sdk::cancel debug event, got: {events:?}"
    );
}

#[test]
fn trace_capture_sees_no_secret_in_redacted_fields() {
    let capture = TraceCapture::default();
    let subscriber = tracing_subscriber::registry().with(capture.clone());

    // The SDK records credentials only through `Redacted<T>`, whose `Debug`
    // renders `[redacted]`. A consumer asserts the secret never reaches a field.
    let secret = cow_sdk::core::Redacted::new("super-secret-key".to_owned());
    tracing::subscriber::with_default(subscriber, || {
        tracing::info!(api_key = ?secret, "configured client");
    });

    let events = capture.events();
    let event = events.first().expect("one event captured");
    assert_eq!(event.field("api_key"), Some("[redacted]"));
    assert!(
        !events.iter().any(|event| event
            .fields
            .values()
            .any(|value| value.contains("super-secret-key"))),
        "no captured field may contain the secret"
    );
}
