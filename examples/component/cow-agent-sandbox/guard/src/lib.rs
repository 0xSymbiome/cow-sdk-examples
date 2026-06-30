//! A capability guard composed onto the published CoW client component.
//!
//! It satisfies the client's `cow:protocol/signer` import with a guarded signer
//! that audit-logs every digest and refuses to sign more than `CAP` times per
//! session, then delegates to the raw host signer it imports under the same
//! interface. The large, untrusted trading client never touches the raw signer;
//! only this small guard does. The limit holds in the composed binary, with no
//! host code.

wit_bindgen::generate!({
    world: "signer-guard",
    path: "wit",
});

use core::sync::atomic::{AtomicU32, Ordering};

/// Per-session signature budget. One order post signs exactly once, so a low cap
/// is safe; the `CAP + 1`-th request is denied to show the boundary holds.
const CAP: u32 = 3;
static COUNT: AtomicU32 = AtomicU32::new(0);

struct Guard;

impl exports::cow::protocol::signer::Guest for Guard {
    fn sign_digest(digest: Vec<u8>) -> Result<Vec<u8>, String> {
        let n = COUNT.fetch_add(1, Ordering::Relaxed) + 1;
        eprintln!(
            "[guard] sign-digest #{n}/{CAP} requested ({} bytes)",
            digest.len()
        );
        if n > CAP {
            return Err(format!(
                "signature cap {CAP} exceeded: request #{n} denied by the capability guard"
            ));
        }
        cow::protocol::signer::sign_digest(&digest)
    }
}

export!(Guard);
