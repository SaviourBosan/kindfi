#![no_std]

use soroban_sdk::Env;

/// Approximate ledgers in a day at a five-second ledger close time.
pub const DAY_IN_LEDGERS: u32 = 17_280;

pub const INSTANCE_TTL_THRESHOLD: u32 = 29 * DAY_IN_LEDGERS;
pub const INSTANCE_TTL_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;

pub const PERSISTENT_TTL_THRESHOLD: u32 = 29 * DAY_IN_LEDGERS;
pub const PERSISTENT_TTL_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;

pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_AMOUNT);
}
