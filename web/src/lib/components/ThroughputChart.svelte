<script lang="ts">
  import { onMount } from 'svelte';
  import { panel } from '$lib/store.svelte';
  import { theme, cssVar } from '$lib/theme.svelte';

  /** Rolling WAN throughput, canvas-drawn. Download is an area + line, upload
   *  a line; both scroll continuously. Axis chrome is recessive: hairline
   *  gridlines with nice-number labels in the muted ink, minute ticks along
   *  the bottom. */
  type Props = { wanId: string; windowMs?: number; showAxis?: boolean; active?: boolean };
  let { wanId, windowMs = 15 * 60_000, showAxis = true, active = true }: Props = $props();

  // Render slightly behind wall clock so the newest sample sits just past the
  // right edge and slides in smoothly instead of "stopping" between polls.
  const RENDER_DELAY_MS = 2_000;
  const AXIS_H = 18;

  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let raf = 0;
  let dpr = 1;
  let cssW = 0;
  let cssH = 0;

  let colors = {
    rx: '#2d96dd',
    tx: '#bf8526',
    line: 'rgba(163,184,210,0.11)',
    lineStrong: 'rgba(163,184,210,0.22)',
    label: '#65798f',
    surface: '#10161e',
  };

  function refreshColors(): void {
    colors = {
      rx: cssVar('--rx', colors.rx),
      tx: cssVar('--tx', colors.tx),
      line: cssVar('--line', colors.line),
      lineStrong: cssVar('--line-strong', colors.lineStrong),
      label: cssVar('--ink-3', colors.label),
      surface: cssVar('--surface', colors.surface),
    };
  }

  $effect(() => {
    void theme.current;
    refreshColors();
  });

  function resize(): void {
    if (!canvas || !container) return;
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    cssW = container.clientWidth;
    cssH = container.clientHeight;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
  }

  /** Round a bits/s ceiling up to a 1/2/5 × 10^n step so gridlines land on
   *  clean numbers. */
  function niceCeil(v: number): number {
    if (v <= 0) return 1;
    const exp = Math.floor(Math.log10(v));
    const base = Math.pow(10, exp);
    const m = v / base;
    const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
    return step * base;
  }

  function fmtBits(bits: number): string {
    if (bits >= 1e9) return `${+(bits / 1e9).toFixed(bits >= 10e9 ? 0 : 1)} Gbps`;
    if (bits >= 1e6) return `${+(bits / 1e6).toFixed(bits >= 10e6 ? 0 : 1)} Mbps`;
    if (bits >= 1e3) return `${+(bits / 1e3).toFixed(0)} Kbps`;
    return `${bits.toFixed(0)} bps`;
  }

  function draw(now: number): void {
    const ctx = canvas.getContext('2d');
    if (!ctx || cssW === 0 || cssH === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const plotH = showAxis ? cssH - AXIS_H : cssH;
    const renderNow = now - RENDER_DELAY_MS;
    const tMin = renderNow - windowMs;
    const samples = panel.histories[wanId] ?? [];

    // Scale from the visible peak, in bits.
    let peakBits = 0;
    for (const s of samples) {
      if (s.ts < tMin - 5000) continue;
      peakBits = Math.max(peakBits, s.rxBps * 8, s.txBps * 8);
    }
    const yMax = niceCeil(Math.max(peakBits * 1.15, 1e6));

    const xOf = (ts: number) => ((ts - tMin) / windowMs) * cssW;
    const yOf = (bytesPerSec: number) => plotH - 2 - ((bytesPerSec * 8) / yMax) * (plotH - 14);

    // Gridlines: 0 (baseline), 1/2, 1.
    ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = colors.label;
    for (const frac of [0.5, 1]) {
      const y = Math.round(yOf((yMax * frac) / 8)) + 0.5;
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cssW, y);
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillText(fmtBits(yMax * frac), 6, y - 2);
    }
    const baseY = Math.round(plotH - 2) + 0.5;
    ctx.strokeStyle = colors.lineStrong;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    ctx.lineTo(cssW, baseY);
    ctx.stroke();

    // Time ticks every 5 minutes (or every minute for short windows).
    if (showAxis) {
      const stepMs = windowMs > 6 * 60_000 ? 5 * 60_000 : 60_000;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      const firstTick = Math.ceil(tMin / stepMs) * stepMs;
      for (let t = firstTick; t <= renderNow; t += stepMs) {
        const x = Math.round(xOf(t)) + 0.5;
        ctx.strokeStyle = colors.line;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, plotH);
        ctx.stroke();
        const d = new Date(t);
        const label = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        if (x > 24 && x < cssW - 24) ctx.fillText(label, x, plotH + 4);
      }
    }

    if (samples.length < 2) return;

    drawSeries(ctx, samples, (s) => s.rxBps, xOf, yOf, colors.rx, plotH, true);
    drawSeries(ctx, samples, (s) => s.txBps, xOf, yOf, colors.tx, plotH, false);

    // Fade the leading edge into the surface so the curve "enters" smoothly.
    const grad = ctx.createLinearGradient(cssW - 40, 0, cssW, 0);
    grad.addColorStop(0, withAlpha(colors.surface, 0));
    grad.addColorStop(1, withAlpha(colors.surface, 0.85));
    ctx.fillStyle = grad;
    ctx.fillRect(cssW - 40, 0, 40, plotH);

    // End markers at the interpolated "now" value, with a surface ring.
    const tipRx = sampleAt(samples, renderNow, (s) => s.rxBps);
    const tipTx = sampleAt(samples, renderNow, (s) => s.txBps);
    if (tipTx !== null) drawTip(ctx, cssW - 8, yOf(tipTx), colors.tx);
    if (tipRx !== null) drawTip(ctx, cssW - 8, yOf(tipRx), colors.rx);
  }

  type S = { ts: number; rxBps: number; txBps: number };

  function drawSeries(
    ctx: CanvasRenderingContext2D,
    samples: S[],
    pick: (s: S) => number,
    xOf: (ts: number) => number,
    yOf: (v: number) => number,
    color: string,
    plotH: number,
    area: boolean,
  ): void {
    const pts: [number, number][] = samples.map((s) => [xOf(s.ts), yOf(pick(s))]);
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    if (area) {
      ctx.beginPath();
      ctx.moveTo(first[0], plotH);
      ctx.lineTo(first[0], first[1]);
      smoothSegments(ctx, pts);
      ctx.lineTo(last[0], plotH);
      ctx.closePath();
      ctx.fillStyle = withAlpha(color, 0.12);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(first[0], first[1]);
    smoothSegments(ctx, pts);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // Monotonic cubic Hermite (Fritsch–Carlson): never overshoots the samples,
  // so bursty spikes don't grow shark fins.
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
      if (ml * mr > 0) t[i] = (2 * ml * mr) / (ml + mr);
    }
    for (let i = 0; i < n - 1; i++) {
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      const dx = p2[0] - p1[0];
      ctx.bezierCurveTo(p1[0] + dx / 3, p1[1] + (t[i]! * dx) / 3, p2[0] - dx / 3, p2[1] - (t[i + 1]! * dx) / 3, p2[0], p2[1]);
    }
  }

  function sampleAt(samples: S[], t: number, pick: (s: S) => number): number | null {
    let pre: S | null = null;
    let post: S | null = null;
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

  function drawTip(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.surface;
    ctx.stroke();
  }

  function withAlpha(color: string, alpha: number): string {
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

  const FRAME_MIN_MS = 1000 / 30;
  let lastFrameTs = 0;
  let idleDrawn = false;

  onMount(() => {
    refreshColors();
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      // A page that isn't showing still gets one frame (so it's current when
      // it fades in) but doesn't burn CPU on the Pi every frame.
      if (!active) {
        if (idleDrawn) return;
        idleDrawn = true;
      } else {
        idleDrawn = false;
        if (ts - lastFrameTs < FRAME_MIN_MS) return;
      }
      lastFrameTs = ts;
      draw(Date.now());
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  });
</script>

<div bind:this={container} class="chart">
  <canvas bind:this={canvas}></canvas>
</div>

<style>
  .chart {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  canvas {
    position: absolute;
    inset: 0;
    display: block;
  }
</style>
