<script lang="ts">
  import type { PowerwallInfo } from '$lib/types';
  import { batteryDirection, gridDirection } from '$lib/derive';
  import { formatW, num } from '$lib/format';
  import { MediaQuery } from 'svelte/reactivity';

  /** Live power flow: solar (top), grid (left), home (right) and the
   *  Powerwall (bottom) meet at a hub. A moving dash shows each active flow's
   *  direction; its speed and weight follow the power. Every node carries its
   *  value and a direction word, so the color is never the only cue. The
   *  animation pauses while the page is hidden (all pages stay mounted).
   *  With plug-in microinverters configured (pw.plugInSolarW present), they
   *  get their own smaller node top-right and the top node becomes the
   *  Tesla (roof) system alone. */
  type Props = { pw: PowerwallInfo; active?: boolean; plugInAwake?: boolean };
  let { pw, active = true, plugInAwake = true }: Props = $props();

  /** On a portrait phone the drawing is narrowed and its type enlarged (the
   *  `big` class), so it doesn't scale down to unreadable 6px labels. A
   *  landscape phone has the width; there the drawing is only capped in
   *  height (see the styles). */
  const narrow = new MediaQuery('(max-width: 600px)', false);
  const W = $derived(narrow.current ? 480 : 640);
  const H = 440;
  const R = 54;
  /** Baseline gap from a node's name to its direction word. */
  const LINE = $derived(narrow.current ? 22 : 17);
  type Key = 'solar' | 'plugin' | 'grid' | 'home' | 'battery';
  const hasPlugIn = $derived(pw.plugInSolarW != null);
  const plugInW = $derived(pw.plugInSolarW ?? 0);
  const roofW = $derived(hasPlugIn ? Math.max(0, pw.solarW - plugInW) : pw.solarW);
  const hub = $derived({ x: W / 2, y: H / 2 });
  const nodes = $derived.by(() => {
    const side = narrow.current ? 76 : 104;
    const n: Partial<Record<Key, { x: number; y: number }>> = {
      solar: { x: W / 2, y: 74 },
      grid: { x: side, y: H / 2 },
      home: { x: W - side, y: H / 2 },
      battery: { x: W / 2, y: H - 74 },
    };
    if (hasPlugIn) n.plugin = { x: W - side, y: 66 };
    return n as Record<Key, { x: number; y: number }>;
  });
  const keys = $derived(Object.keys(nodes) as Key[]);
  /** The plug-in node is smaller: it is a fraction of the roof's output. */
  const rOf = (k: Key) => (k === 'plugin' ? 40 : R);

  /** Flow in watts along node→hub (positive) or hub→node (negative). */
  const flows = $derived<Record<Key, number>>({
    solar: roofW,
    plugin: plugInW,
    grid: pw.gridW,
    battery: pw.batteryW,
    home: -pw.homeW,
  });

  function edge(k: Key, w: number) {
    const R = rOf(k);
    const n = nodes[k];
    const dx = hub.x - n.x;
    const dy = hub.y - n.y;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    // From the node's rim to just short of the hub.
    const a = { x: n.x + ux * (R + 6), y: n.y + uy * (R + 6) };
    const b = { x: hub.x - ux * 10, y: hub.y - uy * 10 };
    const into = w >= 0;
    const [p, q] = into ? [a, b] : [b, a];
    const kw = Math.abs(w) / 1000;
    return {
      d: `M${p.x.toFixed(1)} ${p.y.toFixed(1)}L${q.x.toFixed(1)} ${q.y.toFixed(1)}`,
      active: Math.abs(w) >= 20,
      width: 2 + Math.min(4, kw * 0.8),
      // Faster dashes for more power, within a calm range.
      dur: Math.max(0.45, Math.min(2.4, 1.8 / (0.35 + kw))),
    };
  }

  const edges = $derived(keys.map((k) => ({ k, ...edge(k, flows[k]) })));

  const soc = $derived(pw.chargePct ?? 0);
  /** SoC ring around the Powerwall node, drawn clockwise from the top. */
  const socArc = $derived.by(() => {
    const frac = Math.max(0, Math.min(1, soc / 100));
    const r = R + 1;
    const c = 2 * Math.PI * r;
    return { r, c, dash: `${(c * frac).toFixed(1)} ${c.toFixed(1)}` };
  });

  /** Solar and Powerwall are labeled beside their node (above/below would
   *  leave the drawing); grid and home underneath. With a plug-in node in
   *  the top-right corner, the roof's label moves to the left of its node. */
  function labelAt(k: Key): { x: number; y: number; anchor: 'start' | 'middle' | 'end' } {
    const n = nodes[k];
    if (k === 'solar' && hasPlugIn) return { x: n.x - R - 18, y: n.y - 4, anchor: 'end' };
    if (k === 'solar' || k === 'battery') return { x: n.x + R + 18, y: n.y - 4, anchor: 'start' };
    if (k === 'plugin') return { x: n.x, y: n.y + rOf(k) + 20, anchor: 'middle' };
    return { x: n.x, y: n.y + R + 26, anchor: 'middle' };
  }

  const label = $derived<Record<Key, string>>({
    solar: hasPlugIn ? 'Tesla solar' : 'Solar',
    plugin: 'Plug-in solar',
    grid: 'Grid',
    home: 'Home',
    battery: 'Powerwall',
  });
  const direction = $derived<Record<Key, string>>({
    solar: roofW >= 20 ? 'producing' : 'idle',
    plugin: plugInW >= 20 ? 'producing' : plugInAwake ? 'idle' : 'asleep',
    grid: pw.grid === 'islanded' ? 'off grid' : gridDirection(pw.gridW),
    home: 'using',
    battery: batteryDirection(pw.batteryW),
  });
  const value = $derived<Record<Key, ReturnType<typeof formatW>>>({
    solar: formatW(roofW),
    plugin: formatW(plugInW),
    grid: formatW(pw.gridW),
    home: formatW(pw.homeW),
    battery: formatW(pw.batteryW),
  });
</script>

<div class="flow" class:paused={!active} class:big={narrow.current}>
  <svg viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Power flow: {label.solar} {value.solar.value} {value.solar.unit},{hasPlugIn ? ` plug-in solar ${value.plugin.value} ${value.plugin.unit},` : ''} home {value.home.value} {value.home.unit}, grid {direction.grid} {value.grid.value} {value.grid.unit}, Powerwall {direction.battery} at {num(pw.chargePct)}%">
    {#each edges as e (e.k)}
      <line class="track" x1={nodes[e.k].x} y1={nodes[e.k].y} x2={hub.x} y2={hub.y} />
      {#if e.active}
        <path class="dash {e.k}" d={e.d} stroke-width={e.width} style="animation-duration: {e.dur}s" />
      {/if}
    {/each}
    <circle class="hub" cx={hub.x} cy={hub.y} r="8" />

    {#each keys as k (k)}
      {@const n = nodes[k]}
      {@const at = labelAt(k)}
      {@const r = rOf(k)}
      <g class="node {k}" class:idle={k !== 'battery' && Math.abs(flows[k]) < 20} class:off={k === 'grid' && pw.grid === 'islanded'}>
        <circle class="disc" cx={n.x} cy={n.y} r={r} />
        {#if k === 'battery'}
          <circle class="soc-track" cx={n.x} cy={n.y} r={socArc.r} />
          <circle
            class="soc"
            cx={n.x}
            cy={n.y}
            r={socArc.r}
            stroke-dasharray={socArc.dash}
            transform="rotate(-90 {n.x} {n.y})"
          />
          <text class="v" x={n.x} y={n.y + 4}>{num(pw.chargePct)}<tspan class="u" dx="2">%</tspan></text>
          <text class="v2" x={n.x} y={n.y + 26}>{value.battery.value} {value.battery.unit}</text>
        {:else}
          <circle class="ring" cx={n.x} cy={n.y} r={r} />
          <text class="v" class:small={k === 'plugin'} x={n.x} y={n.y + (k === 'plugin' ? 6 : 8)}>{value[k].value}<tspan class="u" dx="3">{value[k].unit}</tspan></text>
        {/if}
        <text class="name" x={at.x} y={at.y} text-anchor={at.anchor}>{label[k]}</text>
        <text class="dir" x={at.x} y={at.y + LINE} text-anchor={at.anchor}>{direction[k]}</text>
      </g>
    {/each}
  </svg>
</div>

<style>
  .flow {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: grid;
  }
  svg {
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .track {
    stroke: var(--line-strong);
    stroke-width: 1.5;
  }
  .hub {
    fill: var(--surface-3);
    stroke: var(--line-strong);
  }
  .dash {
    fill: none;
    stroke-linecap: round;
    stroke-dasharray: 2 12;
    animation: flow linear infinite;
  }
  .paused .dash {
    animation-play-state: paused;
  }
  .dash.solar,
  .dash.plugin {
    stroke: var(--solar);
  }
  .dash.home {
    stroke: var(--home);
  }
  .dash.grid {
    stroke: var(--grid);
  }
  .dash.battery {
    stroke: var(--battery);
  }
  @keyframes flow {
    to {
      stroke-dashoffset: -14;
    }
  }
  .disc {
    fill: var(--surface-2);
  }
  .ring {
    fill: none;
    stroke-width: 3;
  }
  .solar .ring,
  .plugin .ring {
    stroke: var(--solar);
  }
  .home .ring {
    stroke: var(--home);
  }
  .grid .ring {
    stroke: var(--grid);
  }
  .idle .ring {
    stroke: var(--line-strong);
  }
  .off .ring {
    stroke: var(--crit);
    stroke-dasharray: 4 5;
  }
  .soc-track {
    fill: none;
    stroke: var(--battery-soft);
    stroke-width: 5;
  }
  .soc {
    fill: none;
    stroke: var(--battery);
    stroke-width: 5;
    stroke-linecap: round;
  }
  .v,
  .v2 {
    text-anchor: middle;
  }
  .v {
    font-family: var(--font-display);
    font-size: 30px;
    fill: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .u {
    font-family: var(--font-ui);
    font-size: 13px;
    fill: var(--ink-3);
  }
  .v2 {
    font-family: var(--font-ui);
    font-size: 13px;
    fill: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  .name {
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    fill: var(--ink-2);
  }
  .dir {
    font-family: var(--font-ui);
    font-size: 13px;
    fill: var(--ink-3);
  }
  /* Compact: the narrower drawing scales down less; the type scales up. */
  .big .v {
    font-size: 32px;
  }
  .v.small {
    font-size: 20px;
  }
  .big .v.small {
    font-size: 22px;
  }
  .big .u,
  .big .v2 {
    font-size: 15px;
  }
  .big .name {
    font-size: 18px;
  }
  .big .dir {
    font-size: 17px;
  }
  @media (max-width: 900px), (max-height: 500px) {
    .flow {
      height: auto;
    }
    svg {
      height: auto;
      max-height: 26rem;
    }
  }
</style>
