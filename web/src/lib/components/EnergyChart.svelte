<script lang="ts">
  /** 24h time series for the energy kiosk (SVG, container-sized). At most two
   *  series share a plot — the energy palette is validated for adjacent pairs
   *  only, so grid and battery each get their own chart. `signed` charts
   *  draw a zero baseline and name the two directions on the axis side
   *  (import/export, discharge/charge) so a sign never has to be decoded.
   *  Gaps longer than a few minutes (server down) break the line instead of
   *  bridging it. */
  type Series = { key: string; label: string; color: string; values: Array<number | null>; area?: boolean };
  type Props = {
    ts: number[];
    series: Series[];
    unit: 'W' | '%';
    signed?: boolean;
    posLabel?: string;
    negLabel?: string;
    min?: number;
    max?: number;
    now?: number;
    windowMs?: number;
  };
  let { ts, series, unit, signed = false, posLabel = '', negLabel = '', min, max, now = Date.now(), windowMs = 24 * 3_600_000 }: Props = $props();

  let width = $state(0);
  let height = $state(0);
  const PAD = { l: 44, r: 10, t: 10, b: 20 };
  const GAP_MS = 3 * 60_000;

  function niceStep(raw: number): number {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }

  function fmtTick(v: number): string {
    if (unit === '%') return `${v}%`;
    if (v === 0) return '0';
    const k = Math.abs(v) / 1000;
    return `${k >= 10 || Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k`;
  }

  const geom = $derived.by(() => {
    if (width < 60 || height < 40 || ts.length === 0) return null;
    const x0 = now - windowMs;
    const pw = width - PAD.l - PAD.r;
    const ph = height - PAD.t - PAD.b;
    const vals = series.flatMap((s) => s.values.filter((v): v is number => v != null && Number.isFinite(v)));
    let lo = min ?? Math.min(0, ...vals);
    let hi = max ?? Math.max(signed ? 0 : 1, ...vals);
    if (signed && min == null) lo = Math.min(lo, -hi * 0.15);
    if (hi - lo < 1e-9) hi = lo + 1;
    const step = unit === '%' ? 25 : niceStep((hi - lo) / 4);
    if (min == null) lo = Math.floor(lo / step) * step;
    if (max == null) hi = Math.ceil(hi / step) * step;
    const sx = (t: number) => PAD.l + ((t - x0) / windowMs) * pw;
    const sy = (v: number) => PAD.t + ph - ((v - lo) / (hi - lo)) * ph;

    const yTicks: number[] = [];
    for (let v = lo; v <= hi + 1e-6; v += step) yTicks.push(Math.round(v * 1000) / 1000);

    // Hour ticks every 3h, on local hour boundaries.
    const xTicks: Array<{ x: number; text: string }> = [];
    const first = new Date(x0);
    first.setMinutes(0, 0, 0);
    for (let t = first.getTime() + 3_600_000; t <= now; t += 3_600_000) {
      const h = new Date(t).getHours();
      if (h % 3 === 0) xTicks.push({ x: sx(t), text: `${String(h).padStart(2, '0')}:00` });
    }

    const baseY = sy(Math.max(lo, Math.min(hi, 0)));
    const paths = series.map((s) => {
      let line = '';
      let area = '';
      let runStart: number | null = null;
      let prevX = 0;
      let prevT = -Infinity;
      let last: { x: number; y: number } | null = null;
      const close = () => {
        if (runStart != null) area += `L${prevX.toFixed(1)} ${baseY.toFixed(1)}L${runStart.toFixed(1)} ${baseY.toFixed(1)}Z`;
        runStart = null;
      };
      for (let i = 0; i < ts.length; i++) {
        const t = ts[i]!;
        const v = s.values[i];
        if (t < x0 || v == null || !Number.isFinite(v)) {
          close();
          prevT = -Infinity;
          continue;
        }
        const x = sx(t);
        const y = sy(Math.max(lo, Math.min(hi, v)));
        const cont = t - prevT <= GAP_MS && runStart != null;
        if (!cont) {
          close();
          line += `M${x.toFixed(1)} ${y.toFixed(1)}`;
          area += `M${x.toFixed(1)} ${baseY.toFixed(1)}L${x.toFixed(1)} ${y.toFixed(1)}`;
          runStart = x;
        } else {
          line += `L${x.toFixed(1)} ${y.toFixed(1)}`;
          area += `L${x.toFixed(1)} ${y.toFixed(1)}`;
        }
        prevX = x;
        prevT = t;
        last = { x, y };
      }
      close();
      return { ...s, lineD: line, areaD: area, last };
    });
    return { pw, ph, yTicks: yTicks.map((v) => ({ v, y: sy(v) })), xTicks, baseY, paths };
  });
</script>

<div class="chart" bind:clientWidth={width} bind:clientHeight={height}>
  {#if geom}
    <svg {width} {height} role="img" aria-label="{series.map((s) => s.label).join(' and ')}, last 24 hours">
      {#each geom.yTicks as t (t.v)}
        <line class="grid" class:zero={signed && t.v === 0} x1={PAD.l} x2={width - PAD.r} y1={t.y} y2={t.y} />
        <text class="ytick" x={PAD.l - 6} y={t.y + 3}>{fmtTick(t.v)}</text>
      {/each}
      {#each geom.xTicks as t (t.text + t.x)}
        <text class="xtick" x={t.x} y={height - 4}>{t.text}</text>
      {/each}
      {#each geom.paths as p (p.key)}
        {#if p.area !== false}<path d={p.areaD} fill={p.color} opacity="0.16" />{/if}
        <path d={p.lineD} fill="none" stroke={p.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        {#if p.last}<circle cx={p.last.x} cy={p.last.y} r="4" fill={p.color} stroke="var(--surface)" stroke-width="2" />{/if}
      {/each}
      {#if signed}
        {#if posLabel}<text class="side" x={PAD.l + 6} y={PAD.t + 12}>▲ {posLabel}</text>{/if}
        {#if negLabel}<text class="side" x={PAD.l + 6} y={height - PAD.b - 6}>▼ {negLabel}</text>{/if}
      {/if}
    </svg>
  {/if}
</div>

<style>
  .chart {
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
  .ytick,
  .xtick,
  .side {
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
    fill: var(--ink-2);
    font-family: var(--font-ui);
    font-size: 11px;
  }
</style>
