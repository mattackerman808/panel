<script lang="ts">
  import { bytes } from '$lib/format';
  import type { DailyUsage } from '$lib/types';

  /** Daily WAN usage, one stacked column per day (download below, upload on
   *  top, a 2px surface gap between). Today is emphasized; the rest sit at
   *  reduced opacity so the shape reads without competing with it. */
  type Props = { days: DailyUsage[]; height?: number };
  let { days, height = 72 }: Props = $props();

  let width = $state(0);
  const GAP = 3;
  const AXIS = 14;

  const geom = $derived.by(() => {
    if (days.length === 0 || width <= 0) return null;
    const n = days.length;
    const slot = width / n;
    const bw = Math.max(2, Math.min(22, slot - GAP));
    const plotH = height - AXIS;
    const max = Math.max(1, ...days.map((d) => d.rxBytes + d.txBytes));
    const bars = days.map((d, i) => {
      const x = i * slot + (slot - bw) / 2;
      const hRx = (d.rxBytes / max) * plotH;
      const hTx = (d.txBytes / max) * plotH;
      return { d, x, w: bw, rxY: plotH - hRx, rxH: hRx, txY: plotH - hRx - hTx - (hTx > 0 && hRx > 0 ? 2 : 0), txH: hTx, today: i === n - 1 };
    });
    const labels = bars
      .filter((b, i) => i === 0 || b.d.date.endsWith('-01') || b.today)
      .map((b) => ({ x: b.x + b.w / 2, text: b.today ? 'today' : dayShort(b.d.date) }));
    return { bars, labels, plotH, max };
  });

  function dayShort(date: string): string {
    const [, m, d] = date.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${Number.parseInt(d ?? '1', 10)} ${months[Number.parseInt(m ?? '1', 10) - 1]}`;
  }
</script>

<div class="usage" bind:clientWidth={width} style="height: {height}px">
  {#if geom}
    <svg {width} {height} aria-label="Daily usage, last {days.length} days">
      {#each geom.bars as b (b.d.date)}
        <g class:today={b.today} class="bar">
          <title>{dayShort(b.d.date)}: ↓ {bytes(b.d.rxBytes)} · ↑ {bytes(b.d.txBytes)}</title>
          {#if b.rxH > 0}
            <rect x={b.x} y={b.rxY} width={b.w} height={b.rxH} fill="var(--rx)" rx={b.txH > 0 ? 0 : 2} />
          {/if}
          {#if b.txH > 0}
            <rect x={b.x} y={b.txY} width={b.w} height={b.txH} fill="var(--tx)" rx="2" />
          {/if}
        </g>
      {/each}
      <line x1="0" x2={width} y1={geom.plotH + 0.5} y2={geom.plotH + 0.5} stroke="var(--line-strong)" />
      {#each geom.labels as l (l.text + l.x)}
        <text x={l.x} y={height - 2} text-anchor="middle" class="axis">{l.text}</text>
      {/each}
    </svg>
  {/if}
</div>

<style>
  .usage {
    width: 100%;
    min-width: 0;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .bar {
    opacity: 0.55;
  }
  .bar.today {
    opacity: 1;
  }
  .axis {
    font-family: var(--font-mono);
    font-size: 9px;
    fill: var(--ink-3);
  }
</style>
