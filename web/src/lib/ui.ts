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
