import type { SlotTreeNode } from "../slot-tree/types.ts";

/**
 * Controls when (and in what order) iterable slot work is dispatched,
 * and bounds the number of *in-flight* replacement iterables — not just
 * initiation.
 *
 * The engine calls {@link ConcurrencyStrategy.acquire} once per match.
 * The returned promise resolves to a `release` function once the
 * strategy grants a slot; the engine then awaits the replacement
 * function, drains its iterable, and finally calls `release()` when the
 * producer has pulled the last chunk (or earlier on `Nested` handoff
 * or replacement-fn rejection). `release()` is idempotent.
 */
export interface ConcurrencyStrategy {
  acquire(node: SlotTreeNode): Promise<() => void>;
}
