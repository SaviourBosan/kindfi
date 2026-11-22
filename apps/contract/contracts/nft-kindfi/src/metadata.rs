use soroban_sdk::Env;
use kindfi_ttl::{PERSISTENT_TTL_AMOUNT, PERSISTENT_TTL_THRESHOLD};

use crate::events::MetadataSetEventData;
use crate::types::{NFTMetadata, StorageKey};

/// Validates that the metadata fields meet minimum requirements.
/// Panics if validation fails.
fn require_valid_metadata(metadata: &NFTMetadata) {
    assert!(metadata.name.len() > 0, "name cannot be empty");
    assert!(metadata.image_uri.len() > 0, "image_uri cannot be empty");
}

/// Store metadata for a specific token ID.
/// Uses persistent storage with automatic TTL extension.
pub fn set_metadata(e: &Env, token_id: u32, metadata: &NFTMetadata) {
    require_valid_metadata(metadata);
    let key = StorageKey::TokenMetadata(token_id);
    e.storage().persistent().set(&key, metadata);
    e.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_AMOUNT);
    MetadataSetEventData {
        token_id,
        metadata: metadata.clone(),
    }.publish(e);
}

/// Retrieve metadata for a specific token ID.
/// Returns None if no metadata exists for the token.
pub fn get_metadata(e: &Env, token_id: u32) -> Option<NFTMetadata> {
    let key = StorageKey::TokenMetadata(token_id);
    let metadata: Option<NFTMetadata> = e.storage().persistent().get(&key);

    if metadata.is_some() {
        e.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_AMOUNT);
    }

    metadata
}

/// Remove metadata for a specific token ID.
/// Called when burning an NFT.
pub fn remove_metadata(e: &Env, token_id: u32) {
    let key = StorageKey::TokenMetadata(token_id);
    e.storage().persistent().remove(&key);
}

