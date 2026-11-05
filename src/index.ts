/**
 * dsh-record: node half.
 *
 * This is a CLIENT-ONLY plugin — all behavior (microphone entry, recording,
 * draft attachment) lives in the browser half (src/client). The node half
 * exists only so the bundle has a valid `main` entry and satisfies the harness
 * loader; it registers nothing. Keeping this half dependency-free (no
 * schemastery Config) is deliberate: the 2026-11-04 startup failure was caused
 * by a Config schema API mismatch aborting the whole profile.
 *
 * @module dsh-record
 */

export const name = 'dsh-record'

// No node-side extension points. The plugin's value is entirely client-side.
export function apply(_ctx: unknown, _config: unknown): void {
  // intentionally empty
}
