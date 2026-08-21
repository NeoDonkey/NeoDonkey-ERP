// runtime/ui/keys.js - keyboard navigation, as pure decisions. No DOM, no listeners.
//
// Views rebuild wholesale on every state change, so focus state cannot live in the DOM and
// survive. The state machine lives here instead: a cursor is an index, a keypress is the
// input, and the next index is the output. views.js applies the result to real elements
// (roving tabindex on table rows); this file never sees one, which is why
// test/ui-elevation.test.js can exercise every path in Node.
//
// The vocabulary is deliberately small: move, activate, escape. Anything a view needs beyond
// those three is a view bug, not a missing feature.

/** Keys that move a cursor, and by how far within their axis. */
const MOVES = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
  PageDown: 10,
  PageUp: -10,
};

/**
 * The next cursor position for a keypress, or null when the key is not ours (so the caller
 * can leave the event alone and typing in a filter keeps working).
 *
 * Clamped, not wrapped: a ledger table is a document, not a carousel, and running off the
 * end back to the top is how a row gets opened that nobody was looking at. Home and End are
 * the explicit jumps.
 *
 * @param {string} key  the KeyboardEvent.key value
 * @param {number} index  the current cursor, 0-based
 * @param {number} count  how many rows exist
 * @returns {number|null}
 */
export function moveCursor(key, index, count) {
  if (Number.isInteger(count) === false || count <= 0) return null;
  const at = Number.isInteger(index) ? index : 0;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const delta = MOVES[key];
  if (delta === undefined) return null;
  return Math.min(count - 1, Math.max(0, at + delta));
}

/** Enter activates a focused row. Space does not: on a table it scrolls, and it stays scroll. */
export const isActivate = (key) => key === 'Enter';

/** Escape is the universal "take me back": dismiss a refusal, leave a form. */
export const isEscape = (key) => key === 'Escape';
