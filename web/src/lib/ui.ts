/** Small view-model types shared between components. */

export type RankedRow = {
  id: string;
  label: string;
  sub?: string;
  /** Bar length driver. */
  value: number;
  /** Optional second component (upload) stacked after `value`. */
  value2?: number;
  /** Right-hand figure. */
  text: string;
  unit?: string;
  /** Secondary right-hand figure (smaller). */
  text2?: string;
  /** Optional leading marker: square for wired, circle for wireless. */
  marker?: 'wired' | 'wireless' | null;
};

/** Below the kiosk composition's minimum size (phones, small tablets,
 *  landscape phones) the shell switches to a scrolling, single-column
 *  layout and stops rotating pages. The same query is written out in
 *  `app.css` and in component `<style>` blocks (CSS can't import it) —
 *  search for `max-width: 900px` when changing it. */
export const COMPACT_QUERY = '(max-width: 900px), (max-height: 500px)';
