//! Integration tests — drive a *real* `OrderbookApi` over a mocked HTTP server.
//!
//! Unlike the unit tests (pure bot logic) and live smoke (real network + wallet,
//! `#[ignore]`), these run the SDK's actual request building, response decoding,
//! and error classification against [`wiremock`] — deterministically and offline,
//! so they run in CI. The orderbook is pointed at the local mock with
//! `ExternalHostPolicy::Test` (the supported shape for local fixtures).
//!
//! (The telemetry-capture mechanism is covered deterministically in
//! `telemetry.rs`; asserting on a span captured from inside reqwest's async
//! internals over a live socket is environment-dependent, so it is not done here —
//! real-call SDK telemetry is instead demonstrated by the `console` dashboard.)

use cow_sdk::core::SupportedChainId;
use cow_sdk::orderbook::{ApiContext, CowEnv, ExternalHostPolicy, OrderbookApi};
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
