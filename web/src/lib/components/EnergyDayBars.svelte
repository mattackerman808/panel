<script lang="ts">
  import type { EnergyDay } from '$lib/types';
  import { kwh } from '$lib/format';

  /** Daily energy columns. With two bars that both count up, they sit side by
   *  side per day (e.g. solar produced vs home used). A bar with sign -1 hangs
   *  below a zero line instead (e.g. grid export under import) and the two
   *  directions are named on the axis side. Today is emphasized; past days
   *  sit at reduced opacity, as on the network kiosk's usage bars. */
  type Bar = { key: string; label: string; color: string; value: (d: EnergyDay) => number; sign?: 1 | -1 };
  type Props = { days: EnergyDay[]; bars: Bar[]; posLabel?: string; negLabel?: string };
  let { days, bars, posLabel = '', negLabel = '' }: Props = $props();

  let width = $state(0);
  let height = $state(0);
  const PAD = { l: 40, r: 6, t: 8, b: 18 };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const signed = $derived(bars.some((b) => b.sign === -1));

  function niceStep(raw: number): number {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function dayShort(date: string): string {
    const [, m, d] = date.split('-');
    return `${Number.parseInt(d ?? '1', 10)} ${MONTHS[Number.parseInt(m ?? '1', 10) - 1]}`;
  }

  const geom = $derived.by(() => {
    if (days.length === 0 || width < 80 || height < 50) return null;
    const pw = width - PAD.l - PAD.r;
    const ph = height - PAD.t - PAD.b;
    const up = bars.filter((b) => b.sign !== -1);
    const down = bars.filter((b) => b.sign === -1);
    const hiRaw = Math.max(1, ...days.flatMap((d) => up.map((b) => b.value(d))));
    const loRaw = down.length ? Math.max(0, ...days.flatMap((d) => down.map((b) => b.value(d)))) : 0;
    const step = niceStep((hiRaw + loRaw) / 3);
    const hi = Math.ceil(hiRaw / step) * step;
    const lo = down.length ? Math.ceil(loRaw / step) * step : 0;
    const sy = (v: number) => PAD.t + ((hi - v) / (hi + lo)) * ph;
    const zeroY = sy(0);

    const n = days.length;
    const slot = pw / n;
    const groupW = Math.max(3, Math.min(34, slot - 6));
    const lanes = signed ? 1 : up.length;
    const bw = Math.max(2, (groupW - (lanes - 1) * 2) / lanes);

    const cols = days.map((d, i) => {
      const gx = PAD.l + i * slot + (slot - groupW) / 2;
      const rects = [
        ...up.map((b, j) => {
          const v = Math.max(0, b.value(d));
          const y = sy(v);
          return { key: b.key, color: b.color, x: signed ? gx : gx + j * (bw + 2), y, h: Math.max(0, zeroY - y) };
        }),
        ...down.map((b) => {
          const v = Math.max(0, b.value(d));
          return { key: b.key, color: b.color, x: gx, y: zeroY + (v > 0 ? 2 : 0), h: Math.max(0, sy(-v) - zeroY - (v > 0 ? 2 : 0)) };
        }),
      ];
      return { d, rects, today: i === n - 1, cx: gx + groupW / 2 };
    });

    const labels = cols.filter((c, i) => i === 0 || c.today || i % 7 === (n - 1) % 7).map((c) => ({ x: c.cx, text: c.today ? 'today' : dayShort(c.d.date) }));
    const yTicks: Array<{ y: number; text: string; zero: boolean }> = [];
    for (let v = -lo; v <= hi + 1e-6; v += step) yTicks.push({ y: sy(v), text: v === 0 ? '0' : `${Math.round(Math.abs(v) / 1000)}`, zero: v === 0 });
    return { cols, labels, yTicks, bw, zeroY, ph };
  });
</script>

<div class="bars" bind:clientWidth={width} bind:clientHeight={height}>
  {#if geom}
    <svg {width} {height} role="img" aria-label="{bars.map((b) => b.label).join(' and ')} per day, last {days.length} days">
      {#each geom.yTicks as t (t.y)}
        <line class="grid" class:zero={t.zero} x1={PAD.l} x2={width - PAD.r} y1={t.y} y2={t.y} />
        <text class="ytick" x={PAD.l - 6} y={t.y + 3}>{t.text}</text>
      {/each}
      {#each geom.cols as c (c.d.date)}
        <g class="col" class:today={c.today}>
          <title>{dayShort(c.d.date)}: {bars.map((b) => `${b.label} ${kwh(b.value(c.d))}`).join(' · ')}</title>
          {#each c.rects as r (r.key)}
            {#if r.h > 0}<rect x={r.x} y={r.y} width={geom.bw} height={r.h} fill={r.color} rx="2" />{/if}
          {/each}
        </g>
      {/each}
      {#each geom.labels as l (l.text + l.x)}
        <text class="xtick" x={l.x} y={height - 4}>{l.text}</text>
      {/each}
      {#if signed}
        {#if posLabel}<text class="side" x={PAD.l + 6} y={PAD.t + 12}>▲ {posLabel}</text>{/if}
        {#if negLabel}<text class="side" x={PAD.l + 6} y={height - PAD.b - 6}>▼ {negLabel}</text>{/if}
      {/if}
    </svg>
  {/if}
</div>

<style>
  .bars {
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  svg {
    display: block;
  }
  .grid {
    stroke: var(--line);
  }
  .grid.zero {
    stroke: var(--line-strong);
    stroke-width: 1.5;
  }
  .col {
    opacity: 0.6;
  }
  .col.today {
    opacity: 1;
  }
  .ytick,
  .xtick {
    font-family: var(--font-mono);
    font-size: 10px;
    fill: var(--ink-3);
  }
  .ytick {
    text-anchor: end;
  }
  .xtick {
    text-anchor: middle;
  }
  .side {
    font-family: var(--font-ui);
    font-size: 11px;
    fill: var(--ink-2);
  }
</style>
