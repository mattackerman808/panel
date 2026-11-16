<script lang="ts">
  import type { Flow, FlowNode } from '$lib/derive';
  import { formatW } from '$lib/format';

  /** Whole-home power flow as a Sankey: sources (left) → the panel's bus
   *  (middle) → circuits, battery charging and grid export (right). Ribbon
   *  width is power on one shared scale for both sides. Every node carries
   *  its name and value in ink; color identifies the series only on the
   *  node bar and ribbon. Container-sized SVG. */
  type Props = { flow: Flow; busLabel?: string };
  let { flow, busLabel = 'Panel' }: Props = $props();

  let width = $state(0);
  let height = $state(0);

  const PAD = { t: 26, b: 10 };
  const NODE_W = 10;
  const BUS_W = 16;
  const GAP_L = 18;
  const GAP_R = 5;
  /** Each node reserves at least this much height so its label never
   *  collides with a neighbor's, however small the flow. */
  const SLOT_L = 44;
  const SLOT_R = 17;

  type Placed = FlowNode & { y: number; h: number };

  const geom = $derived.by(() => {
    if (width < 300 || height < 120) return null;
    const leftLabel = Math.min(200, width * 0.18);
    const rightLabel = Math.min(260, width * 0.27);
    const xL = leftLabel;
    const xR = width - rightLabel - NODE_W;
    const xB = xL + (xR - xL) * 0.42;
    const avail = height - PAD.t - PAD.b;
    const nL = flow.sources.length;
    const nR = flow.sinks.length;
    const total = Math.max(flow.inW, flow.outW, 1);
    // Column height at scale k, with every node padded to its label slot.
    const columnH = (nodes: FlowNode[], gap: number, slot: number, kk: number) =>
      nodes.reduce((a, n) => a + Math.max(slot, n.watts * kk), 0) + gap * Math.max(0, nodes.length - 1);
    let k = avail / total;
    for (let i = 0; i < 40 && (columnH(flow.sources, GAP_L, SLOT_L, k) > avail || columnH(flow.sinks, GAP_R, SLOT_R, k) > avail); i++) k *= 0.93;
    const place = (nodes: FlowNode[], gap: number, slot: number): Placed[] => {
      let y = PAD.t + (avail - columnH(nodes, gap, slot, k)) / 2;
      return nodes.map((n) => {
        const h = Math.max(2, n.watts * k);
        const box = Math.max(slot, h);
        const p = { ...n, y: y + (box - h) / 2, h };
        y += box + gap;
        return p;
      });
    };
    const left = place(flow.sources, GAP_L, SLOT_L);
    const right = place(flow.sinks, GAP_R, SLOT_R);
    const busH = Math.max(2, total * k);
    const busY = PAD.t + (avail - busH) / 2;

    const band = (x1: number, y1: number, x2: number, y2: number, h: number) => {
      const xm = (x1 + x2) / 2;
      return `M${x1} ${y1}C${xm} ${y1} ${xm} ${y2} ${x2} ${y2}L${x2} ${y2 + h}C${xm} ${y2 + h} ${xm} ${y1 + h} ${x1} ${y1 + h}Z`;
    };
    let yb = busY + (busH - flow.inW * k) / 2;
    const inRibbons = left.map((n) => {
      const h = Math.max(2, n.watts * k);
      const d = band(xL + NODE_W, n.y, xB, yb, h);
      yb += h;
      return { key: n.key, d, color: n.color };
    });
    yb = busY + (busH - flow.outW * k) / 2;
    const outRibbons = right.map((n) => {
      const h = Math.max(2, n.watts * k);
      const d = band(xB + BUS_W, yb, xR, n.y, h);
      yb += h;
      return { key: n.key, d, color: n.color };
    });
    return { xL, xR, xB, left, right, busY, busH, inRibbons, outRibbons };
  });

  const fmt = (w: number) => {
    const f = formatW(w);
    return `${f.value} ${f.unit}`;
  };
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
</script>

<div class="sankey" bind:clientWidth={width} bind:clientHeight={height}>
  {#if geom}
    <svg {width} {height} role="img" aria-label="Power flow: {flow.sources.map((n) => `${n.label} ${fmt(n.watts)}`).join(', ')} into the panel; out to {flow.sinks.map((n) => `${n.label} ${fmt(n.watts)}`).join(', ')}">
      {#each geom.inRibbons as r (r.key)}
        <path d={r.d} fill={r.color} opacity="0.3" />
      {/each}
      {#each geom.outRibbons as r (r.key)}
        <path d={r.d} fill={r.color} opacity="0.3" />
      {/each}

      <rect class="bus" x={geom.xB} y={geom.busY} width={BUS_W} height={geom.busH} rx="3" />
      <text class="bus-label" x={geom.xB + BUS_W / 2} y={geom.busY - 8}>{busLabel} · {fmt(Math.max(flow.inW, flow.outW))}</text>

      {#each geom.left as n (n.key)}
        <rect x={geom.xL} y={n.y} width={NODE_W} height={n.h} rx="2" fill={n.color} />
        <text class="name" x={geom.xL - 10} y={n.y + n.h / 2 - 4} text-anchor="end">{n.label}</text>
        <text class="value" x={geom.xL - 10} y={n.y + n.h / 2 + 15} text-anchor="end">{fmt(n.watts)}{#if n.detail}<tspan class="detail" dx="6">{n.detail}</tspan>{/if}</text>
      {/each}

      {#each geom.right as n (n.key)}
        <rect x={geom.xR} y={n.y} width={NODE_W} height={n.h} rx="2" fill={n.color} />
        <text class="row" x={geom.xR + NODE_W + 10} y={n.y + n.h / 2 + 4}>
          <tspan class="row-value">{fmt(n.watts)}</tspan><tspan class="row-name" dx="8">{clip(n.label, 30)}{n.detail ? ` · ${n.detail}` : ''}</tspan>
        </text>
      {/each}
    </svg>
  {/if}
</div>

<style>
  .sankey {
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  svg {
    display: block;
  }
  .bus {
    fill: var(--ink-3);
  }
  .bus-label {
    text-anchor: middle;
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    fill: var(--ink-2);
  }
  .name {
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    fill: var(--ink-2);
  }
  .value {
    font-family: var(--font-display);
    font-size: 20px;
    fill: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .detail {
    font-family: var(--font-ui);
    font-size: 12px;
    fill: var(--ink-3);
  }
  .row {
    font-family: var(--font-ui);
    font-size: 13px;
  }
  .row-value {
    font-family: var(--font-display);
    font-size: 15px;
    fill: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .row-name {
    fill: var(--ink-2);
  }
</style>
