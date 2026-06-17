//! Integration tests — drive a *real* `OrderbookApi` over a mocked HTTP server.
//!
//! Unlike the unit tests (pure bot logic) and live smoke (real network + wallet,
//! `#[ignore]`), these run the SDK's actual request building, response decoding,
//! error classification, and telemetry against [`wiremock`] — deterministically
//! and offline, so they run in CI. The orderbook is pointed at the local mock
//! with `ExternalHostPolicy::Test` (the supported shape for local fixtures).

mod support;

use cow_sdk::core::SupportedChainId;
use cow_sdk::orderbook::{ApiContext, CowEnv, ExternalHostPolicy, OrderbookApi};
use support::TraceCapture;
use tracing_subscriber::layer::SubscriberExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Builds an `OrderbookApi` aimed at the local mock server.
fn orderbook(base_url: &str) -> OrderbookApi {
    let context = ApiContext::new(SupportedChainId::Sepolia, CowEnv::Prod);
    OrderbookApi::builder_from_context(context)
        .external_host_policy(ExternalHostPolicy::Test)
        .base_url(base_url)
        .build()
        .expect("orderbook builds")
}

#[tokio::test]
async fn version_is_fetched_over_http() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/version"))
        .respond_with(ResponseTemplate::new(200).set_body_string("v1.2.3-mock"))
        .mount(&server)
        .await;

    let version = orderbook(&server.uri())
        .version()
        .await
        .expect("version request succeeds");
    assert_eq!(version, "v1.2.3-mock");
}

#[test]
fn sdk_span_propagates_to_the_subscriber_over_a_real_call() {
    let capture = TraceCapture::default();
    let subscriber = tracing_subscriber::registry().with(capture.clone());

    // Drive the whole async flow on one current-thread runtime *inside* the
    // subscriber scope, so the SDK's spans are deterministically captured on this
    // thread regardless of how the rest of the suite is scheduled.
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime builds");
    tracing::subscriber::with_default(subscriber, || {
        runtime.block_on(async {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/version"))
                .respond_with(ResponseTemplate::new(200).set_body_string("v1"))
                .mount(&server)
                .await;
            let _ = orderbook(&server.uri()).version().await;
        });
    });

    // The SDK instruments both its method calls and the transport dispatch; over
    // a real call at least one span carries the version endpoint and HTTP method,
    // proving SDK telemetry reaches the bot's own subscriber with its fields.
    let spans = capture.spans();
    assert!(
        spans.iter().any(|span| {
            span.field("endpoint") == Some("/api/v1/version") && span.field("method") == Some("GET")
        }),
        "an SDK span for the version request must be captured; got: {spans:?}"
    );
}

#[tokio::test]
async fn client_error_is_classified_as_non_retryable() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/version"))
        .respond_with(ResponseTemplate::new(400).set_body_string("bad request"))
        .mount(&server)
        .await;

    let error = orderbook(&server.uri())
        .version()
        .await
        .expect_err("a 400 response is an error");
    // A permanent client error must not be flagged retryable — the bot relies on
    // this typed verdict instead of parsing messages.
    assert!(
        !error.is_retryable(),
        "a 400 must not be retryable: {error}"
    );
}
