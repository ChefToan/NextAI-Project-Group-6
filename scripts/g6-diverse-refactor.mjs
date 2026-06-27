/*
 * Wrapper for the fast Group 6 diverse dataset refactor.
 *
 * Usage:
 *   node scripts/g6-diverse-refactor.mjs
 *   node scripts/g6-diverse-refactor.mjs --apply
 *   node scripts/g6-diverse-refactor.mjs --rollback
 */
await import("./g6-diverse-refactor-bulk.mjs");
