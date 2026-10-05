<script lang="ts">
  /** Horizontal meter. The fill carries severity (accent → warning → critical)
   *  and the unfilled track is a faint step of the same color, so state reads
   *  across the whole bar. */
  type Tone = 'auto' | 'accent' | 'ok' | 'warn' | 'crit' | 'rx' | 'tx' | 'neutral';
  type Props = {
    /** 0–100 */
    value: number | null | undefined;
    warn?: number;
    crit?: number;
    tone?: Tone;
    height?: number;
    class?: string;
  };
  let { value, warn = 75, crit = 90, tone = 'auto', height = 6, class: cls = '' }: Props = $props();

  const resolved = $derived.by((): Exclude<Tone, 'auto'> => {
    if (tone !== 'auto') return tone;
    if (value == null || !Number.isFinite(value)) return 'neutral';
    if (value >= crit) return 'crit';
    if (value >= warn) return 'warn';
    return 'accent';
  });
  const color = $derived(
    resolved === 'ok'
      ? 'var(--ok)'
      : resolved === 'warn'
        ? 'var(--warn)'
        : resolved === 'crit'
          ? 'var(--crit)'
          : resolved === 'rx'
            ? 'var(--rx)'
            : resolved === 'tx'
              ? 'var(--tx)'
              : resolved === 'neutral'
                ? 'var(--ink-3)'
                : 'var(--accent)',
  );
  const width = $derived(value == null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(100, value)));
</script>

<div class="meter {cls}" style="height: {height}px; --meter-color: {color}">
  <div class="fill" style="width: {width}%"></div>
</div>

<style>
  .meter {
    width: 100%;
    min-width: 2rem;
    border-radius: 999px;
    background: color-mix(in oklab, var(--meter-color) 16%, transparent);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: 999px;
    background: var(--meter-color);
    transition: width 600ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    .fill {
      transition: none;
    }
  }
</style>
