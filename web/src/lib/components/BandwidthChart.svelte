<script lang="ts">
  import { onMount } from 'svelte';
  import { panel } from '$lib/store.svelte';
  import { theme, cssColor } from '$lib/theme.svelte';
  import { formatBps } from '$lib/format';

  type Props = { wanId: string };
  let { wanId }: Props = $props();

  const WINDOW_MS = 90_000;
  // Render slightly behind wall clock so the most recent sample sits just
  // past the right edge and slides smoothly into view. With a 2s server
  // poll, ~2s of delay means the curve always extends past the right edge
  // and we never see the line "stop and wait" for the next tick.
  const RENDER_DELAY_MS = 2000;

  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let raf = 0;
  let dpr = 1;
  let cssW = 0;
  let cssH = 0;

  let colorPrimary = '#00d9ff';
  let colorSecondary = '#ffb000';
  let colorLine = 'rgba(42, 66, 88, 0.35)';
  let colorBg = '#06080c';
  let colorTextDim = '#4a5d75';
  let glowMult = 1;

  function refreshColors() {
    colorPrimary = cssColor('--c-primary', '#00d9ff');
    colorSecondary = cssColor('--c-secondary', '#ffb000');
    colorLine = cssColor('--c-line', '#1a2838');
    colorBg = cssColor('--c-bg', '#06080c');
    colorTextDim = cssColor('--c-text-dim', '#4a5d75');
    const m = parseFloat(cssColor('--glow-mult', '1'));
    glowMult = Number.isFinite(m) && m > 0 ? m : 1;
  }

  $effect(() => {
    void theme.current;
    refreshColors();
  });

  function resize() {
    if (!canvas || !container) return;
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    cssW = container.clientWidth;
    cssH = container.clientHeight;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
  }

  function draw(now: number) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    ctx.strokeStyle = colorLine;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const y = (cssH / 4) * i + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(cssW, y);
    }
    for (let i = 1; i < 6; i++) {
      const x = (cssW / 6) * i + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cssH);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    const samples = panel.histories[wanId] ?? [];
    if (samples.length < 2) return;

    const renderNow = now - RENDER_DELAY_MS;
    const tMin = renderNow - WINDOW_MS;

    let peak = 1;
    for (const s of samples) {
      if (s.ts < tMin - 5000) continue;
      if (s.rxBps > peak) peak = s.rxBps;
      if (s.txBps > peak) peak = s.txBps;
    }
    peak = peak * 1.2;

    const xOf = (ts: number) => ((ts - tMin) / WINDOW_MS) * cssW;
    const yOf = (v: number) => cssH - (v / peak) * (cssH - 4) - 2;

    drawSeries(ctx, samples, (s) => s.rxBps, xOf, yOf, colorPrimary, 0.18);
    drawSeries(ctx, samples, (s) => s.txBps, xOf, yOf, colorSecondary, 0.14);

    const grad = ctx.createLinearGradient(cssW - 60, 0, cssW, 0);
    grad.addColorStop(0, colorWithAlpha(colorBg, 0));
    grad.addColorStop(1, colorWithAlpha(colorBg, 0.7));
    ctx.fillStyle = grad;
    ctx.fillRect(cssW - 60, 0, 60, cssH);

    // Tip dots: place at the right edge with the curve's value at renderNow,
    // interpolated linearly between the bracketing samples.
    const tipRx = sampleAt(samples, renderNow, (s) => s.rxBps);
    const tipTx = sampleAt(samples, renderNow, (s) => s.txBps);
    if (tipRx !== null) drawTip(ctx, cssW - 6, yOf(tipRx), colorPrimary);
    if (tipTx !== null) drawTip(ctx, cssW - 6, yOf(tipTx), colorSecondary);

    ctx.fillStyle = colorTextDim;
    ctx.font = '10px "JetBrains Mono Variable", monospace';
    const peakBits = peak * 8;
    const peakLabel =
      peakBits >= 1e9
        ? `${(peakBits / 1e9).toFixed(1)} Gbps`
        : peakBits >= 1e6
          ? `${(peakBits / 1e6).toFixed(0)} Mbps`
          : `${(peakBits / 1e3).toFixed(0)} Kbps`;
    ctx.fillText(peakLabel, 6, 12);
    ctx.fillText('0', 6, cssH - 4);
  }

  function drawSeries(
    ctx: CanvasRenderingContext2D,
    samples: { ts: number; rxBps: number; txBps: number }[],
    pick: (s: { ts: number; rxBps: number; txBps: number }) => number,
    xOf: (ts: number) => number,
    yOf: (v: number) => number,
    color: string,
    alphaFill: number,
  ) {
    const pts: [number, number][] = samples.map((s) => [xOf(s.ts), yOf(pick(s))]);
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;

    ctx.beginPath();
    ctx.moveTo(first[0], cssH);
    ctx.lineTo(first[0], first[1]);
    smoothSegments(ctx, pts);
    ctx.lineTo(last[0], cssH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, cssH);
    grad.addColorStop(0, colorWithAlpha(color, alphaFill));
    grad.addColorStop(1, colorWithAlpha(color, 0));
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(first[0], first[1]);
    smoothSegments(ctx, pts);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    if (glowMult > 0.4) {
      ctx.shadowBlur = 6 * glowMult;
      ctx.shadowColor = color;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Monotonic cubic Hermite (Fritsch-Carlson). Connects points with cubic
  // Beziers using a per-point tangent that's the harmonic mean of the two
  // adjacent secant slopes, dropped to zero at local extrema. Guarantees
  // the curve never overshoots the source points — no shark fins on bursty
  // traffic spikes the way uniform Catmull-Rom produced.
  function smoothSegments(ctx: CanvasRenderingContext2D, pts: [number, number][]): void {
    const n = pts.length;
    if (n < 2) return;

    const m: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = pts[i + 1]![0] - pts[i]![0];
      const dy = pts[i + 1]![1] - pts[i]![1];
      m.push(dx !== 0 ? dy / dx : 0);
    }

    const t: number[] = new Array(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      const ml = m[i - 1]!;
      const mr = m[i]!;
      // Sign change or zero → local extremum → flat tangent (no overshoot).
      // Otherwise weighted harmonic mean keeps the slope between the two
      // secants, so the curve stays bounded by adjacent samples.
      if (ml * mr > 0) t[i] = (2 * ml * mr) / (ml + mr);
    }
    // Endpoints: enter and exit flat. The leading edge sits past the right
    // edge of the canvas thanks to RENDER_DELAY_MS, so the flat exit isn't
    // visible.

    for (let i = 0; i < n - 1; i++) {
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      const dx = p2[0] - p1[0];
      const cp1x = p1[0] + dx / 3;
      const cp1y = p1[1] + (t[i]! * dx) / 3;
      const cp2x = p2[0] - dx / 3;
      const cp2y = p2[1] - (t[i + 1]! * dx) / 3;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
    }
  }

  function sampleAt(
    samples: { ts: number; rxBps: number; txBps: number }[],
    t: number,
    pick: (s: { ts: number; rxBps: number; txBps: number }) => number,
  ): number | null {
    let pre = null;
    let post = null;
    for (const s of samples) {
      if (s.ts <= t) pre = s;
      else {
        post = s;
        break;
      }
    }
    if (pre && post) {
      const k = (t - pre.ts) / (post.ts - pre.ts);
      return pick(pre) + k * (pick(post) - pick(pre));
    }
    return pre ? pick(pre) : post ? pick(post) : null;
  }

  function drawTip(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    if (glowMult > 0.4) {
      ctx.shadowBlur = 8 * glowMult;
      ctx.shadowColor = color;
    }
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function colorWithAlpha(color: string, alpha: number): string {
    const c = color.trim();
    if (c.startsWith('#')) {
      const hex = c.length === 4 ? c.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : c;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1]!.split(',').map((p) => p.trim());
      return `rgba(${parts[0]},${parts[1]},${parts[2]},${alpha})`;
    }
    return c;
  }

  const TARGET_FPS = 60;
  const FRAME_MIN_MS = 1000 / TARGET_FPS;
  let lastFrameTs = 0;

  onMount(() => {
    refreshColors();
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (ts - lastFrameTs < FRAME_MIN_MS) return;
      lastFrameTs = ts;
      draw(Date.now());
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  });

  const wan = $derived(panel.wans.find((w) => w.id === wanId));
  const rx = $derived(wan ? formatBps(wan.rxBps) : { value: '0', unit: 'bps' });
  const tx = $derived(wan ? formatBps(wan.txBps) : { value: '0', unit: 'bps' });
</script>

<div class="flex h-full flex-col gap-2">
  <div class="flex items-baseline justify-between gap-3 text-[10px] uppercase tracking-widest text-[var(--c-text-dim)]">
    <div class="flex items-baseline gap-3 min-w-0">
      <span class="hud-label text-[11px]" style="color: var(--c-primary);">{wan?.label ?? wanId}</span>
      <span class="text-[var(--c-text)] truncate">{wan?.ifName ?? ''}</span>
      {#if wan?.wanIp}
        <span class="text-[var(--c-text-dim)] truncate">{wan.wanIp}</span>
      {/if}
    </div>
    <div class="flex items-baseline gap-4 whitespace-nowrap">
      <span>
        <span style="color: var(--c-primary);">▼</span>
        <span class="hud-value-primary font-display text-[18px] leading-none">{rx.value}</span>
        <span>{rx.unit}</span>
      </span>
      <span>
        <span style="color: var(--c-secondary);">▲</span>
        <span class="hud-value-secondary font-display text-[18px] leading-none">{tx.value}</span>
        <span>{tx.unit}</span>
      </span>
    </div>
  </div>

  <div bind:this={container} class="relative min-h-0 flex-1 overflow-hidden">
    <canvas bind:this={canvas} class="absolute inset-0 block"></canvas>
  </div>
</div>
