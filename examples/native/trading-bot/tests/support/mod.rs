//! A minimal `tracing` capture layer for tests.
//!
//! The SDK's own span/event assertions use an internal, unpublished helper, so a
//! downstream consumer cannot reuse it. This is the consumer-side
//! equivalent, built on only `tracing` + `tracing-subscriber`: install it for
//! the duration of a test, run code, then assert on the captured spans and
//! events. Copy it into your own test suite to assert that the SDK's spans
//! propagate and that no secret is ever recorded.

// Reusable test scaffolding: not every accessor is exercised by every suite.
#![allow(
    dead_code,
    reason = "reusable trace-capture harness; suites use different subsets"
)]

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id};
use tracing::{Event, Subscriber};
use tracing_subscriber::layer::{Context, Layer};
use tracing_subscriber::registry::LookupSpan;

/// A captured span: its name, target, and stringified fields.
#[derive(Debug, Clone)]
pub struct CapturedSpan {
    pub name: String,
    pub target: String,
    pub fields: BTreeMap<String, String>,
}

impl CapturedSpan {
    /// The stringified value of a recorded field, if present.
    pub fn field(&self, key: &str) -> Option<&str> {
        self.fields.get(key).map(String::as_str)
    }
}

/// A captured event: its target, level, and stringified fields.
#[derive(Debug, Clone)]
pub struct CapturedEvent {
    pub target: String,
    pub level: String,
    pub fields: BTreeMap<String, String>,
}

impl CapturedEvent {
    /// The stringified value of a recorded field, if present.
    pub fn field(&self, key: &str) -> Option<&str> {
        self.fields.get(key).map(String::as_str)
    }
}

#[derive(Default)]
struct Store {
    spans: Vec<CapturedSpan>,
    events: Vec<CapturedEvent>,
}

/// A cloneable `tracing` layer that records every span and event into shared
/// storage. Install with `tracing::subscriber::set_default` (async) or
/// `with_default` (sync), then read back with [`TraceCapture::spans`] /
/// [`TraceCapture::events`].
#[derive(Clone, Default)]
pub struct TraceCapture {
    store: Arc<Mutex<Store>>,
}

impl TraceCapture {
    /// All spans captured so far, in creation order.
    pub fn spans(&self) -> Vec<CapturedSpan> {
        self.store
            .lock()
            .expect("trace store poisoned")
            .spans
            .clone()
    }

    /// All events captured so far, in emission order.
    pub fn events(&self) -> Vec<CapturedEvent> {
        self.store
            .lock()
            .expect("trace store poisoned")
            .events
            .clone()
    }
}

struct FieldVisitor(BTreeMap<String, String>);

impl Visit for FieldVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0.insert(field.name().to_owned(), format!("{value:?}"));
    }
    fn record_str(&mut self, field: &Field, value: &str) {
        self.0.insert(field.name().to_owned(), value.to_owned());
    }
}

impl<S> Layer<S> for TraceCapture
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_new_span(&self, attrs: &Attributes<'_>, _id: &Id, _ctx: Context<'_, S>) {
        let mut visitor = FieldVisitor(BTreeMap::new());
        attrs.record(&mut visitor);
        let meta = attrs.metadata();
        self.store
            .lock()
            .expect("trace store poisoned")
            .spans
            .push(CapturedSpan {
                name: meta.name().to_owned(),
                target: meta.target().to_owned(),
                fields: visitor.0,
            });
    }

    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let mut visitor = FieldVisitor(BTreeMap::new());
        event.record(&mut visitor);
        let meta = event.metadata();
        self.store
            .lock()
            .expect("trace store poisoned")
            .events
            .push(CapturedEvent {
                target: meta.target().to_owned(),
                level: meta.level().to_string(),
                fields: visitor.0,
            });
    }
}
