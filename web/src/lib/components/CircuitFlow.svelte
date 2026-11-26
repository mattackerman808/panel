<script lang="ts">
  import type { PowerwallInfo, SpanInfo } from '$lib/types';
  import { flowSources, splitRingArcs, type CircuitRow } from '$lib/derive';
  import { formatW, kwh, num } from '$lib/format';

  /** The Now page's power flow, carried through the SPAN panel to every
   *  circuit. Sources (solar, grid, Powerwall) on the left feed the panel
   *  hub; a wire runs from the hub to each circuit card on the right. A
   *  moving dash shows each live flow — its direction, and with its speed
   *  and weight, how much. Cards sit in breaker order so the layout holds
   *  still; idle circuits dim. Each card carries the circuit's live draw,
   *  today's energy, breaker size and a bar of draw against the breaker's
   *  capacity. The animation pauses while the page is hidden. */
  type Props = { pw: PowerwallInfo | null; span: SpanInfo; rows: CircuitRow[]; active?: boolean };
  let { pw, span, rows, active = true }: Props = $props();

  let cw = $state(0);
  let ch = $state(0);
  const VW = 1000;
  // Match the drawing's aspect to the panel so it fills rather than letterboxes.
  const VH = $derived(cw > 0 && ch > 0 ? Math.max(520, Math.min(900, (VW * ch) / cw)) : 620);

  const SRC_X = 92;
  const SRC_R = 50;
  const HUB = { x: 318, w: 116 };
  const CARD_X0 = 500;
  const CARD_X1 = 994;

  const sources = $derived(flowSources(pw, span));

  const total = $derived(rows.reduce((a, r) => a + r.watts, 0));

  const layout = $derived.by(() => {
    const hubH = Math.min(VH * 0.5, 260);
    const hubY = (VH - hubH) / 2;
    // Sources spread over the middle of the height.
    const srcTop = VH * 0.17;
    const srcSpan = VH * 0.66;
    const src = sources.map((s, i) => {
      const y = sources.length === 1 ? VH / 2 : srcTop + (srcSpan * i) / (sources.length - 1);
      // Enter the hub along its left edge, spread to match the order.
      const hy = hubY + (hubH * (i + 1)) / (sources.length + 1);
      return { ...s, y, hy };
    });
    const n = Math.max(1, rows.length);
    const pad = 10;
    const rowH = (VH - pad * 2) / n;
    const compact = rowH < 50;
    const cardH = Math.min(rowH - (compact ? 4 : 8), 70);
    const cards = rows.map((r, i) => {
      const cy = pad + rowH * (i + 0.5);
      const hy = hubY + (hubH * (i + 1)) / (n + 1);
      return { ...r, cy, hy, cardH };
    });
    return { hubH, hubY, src, cards, compact };
  });

  /** Dash weight and speed from power, calm at both ends. */
  const weight = (w: number) => 1.6 + Math.min(4.5, (Math.abs(w) / 1000) * 0.9);
  const dur = (w: number) => Math.max(0.45, Math.min(2.6, 1.8 / (0.3 + Math.abs(w) / 1000)));

  function curve(x1: number, y1: number, x2: number, y2: number): string {
    const xm = (x1 + x2) / 2;
    return `M${x1.toFixed(1)} ${y1.toFixed(1)}C${xm.toFixed(1)} ${y1.toFixed(1)} ${xm.toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  const f = (w: number) => formatW(w);
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
</script>

<div class="cflow" class:paused={!active} bind:clientWidth={cw} bind:clientHeight={ch}>
  <svg viewBox="0 0 {VW} {VH}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Power flow through the SPAN panel: {f(total).value} {f(total).unit} to {rows.filter((r) => r.active).length} active circuits">
    <!-- source → hub -->
    {#each layout.src as s (s.key)}
      {@const a = { x: SRC_X + SRC_R + 4, y: s.y }}
      {@const b = { x: HUB.x, y: s.hy }}
      <path class="track" d={curve(a.x, a.y, b.x, b.y)} />
      {#if !s.idle && !s.off}
        <!-- Positive = into the panel; negative (export, charging) runs back out. -->
        <path class="dash" d={s.watts >= 0 ? curve(a.x, a.y, b.x, b.y) : curve(b.x, b.y, a.x, a.y)} stroke={s.color} stroke-width={weight(s.watts)} style="animation-duration: {dur(s.watts)}s" />
      {/if}
    {/each}

    <!-- hub → circuits -->
    {#each layout.cards as c (c.key)}
      {@const a = { x: HUB.x + HUB.w, y: c.hy }}
      {@const b = { x: CARD_X0 - 6, y: c.cy }}
      <path class="track" d={curve(a.x, a.y, b.x, b.y)} />
      {#if c.active}
        <path class="dash" d={curve(a.x, a.y, b.x, b.y)} stroke={c.kind === 'unmetered' ? 'var(--ink-3)' : 'var(--home)'} stroke-width={weight(c.watts)} style="animation-duration: {dur(c.watts)}s" />
      {/if}
    {/each}

    <!-- sources -->
    {#each layout.src as s (s.key)}
      <g class="src" class:idle={s.idle} class:off={s.off}>
        <circle class="disc" cx={SRC_X} cy={s.y} r={SRC_R} />
        {#if s.key === 'battery' && pw?.chargePct != null}
          {@const r = SRC_R + 1}
          {@const c = 2 * Math.PI * r}
          <circle class="soc-track" cx={SRC_X} cy={s.y} r={r} />
          <circle class="soc" cx={SRC_X} cy={s.y} r={r} stroke-dasharray="{((c * pw.chargePct) / 100).toFixed(1)} {c.toFixed(1)}" transform="rotate(-90 {SRC_X} {s.y})" />
          <text class="v" x={SRC_X} y={s.y + 2}>{num(pw.chargePct)}<tspan class="u" dx="2">%</tspan></text>
          <text class="v2" x={SRC_X} y={s.y + 22}>{f(s.watts).value} {f(s.watts).unit}</text>
        {:else if s.split}
          <!-- Solar from two systems: Tesla arc, then the plug-in arc (lighter). -->
          {@const c = 2 * Math.PI * SRC_R}
          {@const arcs = splitRingArcs(s.split, c)}
          <circle class="ring split-track" cx={SRC_X} cy={s.y} r={SRC_R} stroke={s.color} />
          {#if arcs.roof}<circle class="ring arc" cx={SRC_X} cy={s.y} r={SRC_R} stroke={s.color} stroke-dasharray={arcs.roof.dash} stroke-dashoffset={arcs.roof.offset} transform="rotate(-90 {SRC_X} {s.y})" />{/if}
          {#if arcs.plugIn}<circle class="ring arc plug" cx={SRC_X} cy={s.y} r={SRC_R} stroke={s.color} stroke-dasharray={arcs.plugIn.dash} stroke-dashoffset={arcs.plugIn.offset} transform="rotate(-90 {SRC_X} {s.y})" />{/if}
          <text class="v" x={SRC_X} y={s.y + 8}>{f(s.watts).value}<tspan class="u" dx="3">{f(s.watts).unit}</tspan></text>
        {:else}
          <circle class="ring" cx={SRC_X} cy={s.y} r={SRC_R} stroke={s.color} />
          <text class="v" x={SRC_X} y={s.y + 8}>{f(s.watts).value}<tspan class="u" dx="3">{f(s.watts).unit}</tspan></text>
        {/if}
        <text class="name" x={SRC_X} y={s.y + SRC_R + 22}>{s.label}</text>
        {#if s.split}
          <text class="dir" x={SRC_X} y={s.y + SRC_R + 38}>Tesla {f(s.split.roofW).value} {f(s.split.roofW).unit}</text>
          <text class="dir" x={SRC_X} y={s.y + SRC_R + 54}>Plug-in {f(s.split.plugInW).value} {f(s.split.plugInW).unit}</text>
        {:else}
          <text class="dir" x={SRC_X} y={s.y + SRC_R + 38}>{s.dir}</text>
        {/if}
      </g>
    {/each}

    <!-- hub -->
    <rect class="hub" x={HUB.x} y={layout.hubY} width={HUB.w} height={layout.hubH} rx="14" />
    <text class="hub-name" x={HUB.x + HUB.w / 2} y={VH / 2 - 14}>SPAN panel</text>
    <text class="hub-v" x={HUB.x + HUB.w / 2} y={VH / 2 + 16}>{f(total).value}<tspan class="u" dx="3">{f(total).unit}</tspan></text>
    <text class="hub-sub" x={HUB.x + HUB.w / 2} y={VH / 2 + 36}>{rows.filter((r) => r.active && r.kind === 'circuit').length} circuits active</text>

    <!-- circuit cards -->
    {#each layout.cards as c (c.key)}
      {@const top = c.cy - c.cardH / 2}
      {@const fw = f(c.watts)}
      <g class="card" class:dim={!c.active} class:unmetered={c.kind === 'unmetered'}>
        <rect class="card-bg" x={CARD_X0} y={top} width={CARD_X1 - CARD_X0} height={c.cardH} rx="8" />
        <circle class="port" cx={CARD_X0} cy={c.cy} r="4" />
        {#if layout.compact}
          <!-- One line: name · (today, breaker | the known split) · value,
               with the breaker-load bar along the card's bottom edge. -->
          <text class="c-name" x={CARD_X0 + 16} y={c.cy + 4}>{clip(c.name, c.parts ? 18 : 26)}{c.off ? ' · off' : ''}</text>
          <text class="c-sub end" x={CARD_X1 - 112} y={c.cy + 4}>
            {#if c.parts}
              {c.parts.map((p) => `${p.label} ${f(p.watts).value} ${f(p.watts).unit}`).join(' · ')}
            {:else}
              {c.todayWh != null ? `${kwh(c.todayWh)} today` : c.kind === 'unmetered' ? 'home minus circuits' : ''}{c.ratingA ? ` · ${c.ratingA} A` : ''}
            {/if}
          </text>
          {#if c.capacityW}
            {@const frac = Math.min(1, c.watts / c.capacityW)}
            {@const bw = CARD_X1 - CARD_X0 - 32}
            {@const mw = Math.max(c.watts > 0 ? 2 : 0, bw * frac)}
            <rect class="meter-track" x={CARD_X0 + 16} y={c.cy + c.cardH / 2 - 6} width={bw} height="2.5" rx="1.25" />
            {#if c.parts && c.watts > 0}
              {@const m = (mw * c.parts[0]!.watts) / c.watts}
              <rect class="meter" x={CARD_X0 + 16} y={c.cy + c.cardH / 2 - 6} width={Math.max(0, m - 1)} height="2.5" rx="1.25" />
              <rect class="meter rest" x={CARD_X0 + 16 + m + 1} y={c.cy + c.cardH / 2 - 6} width={Math.max(0, mw - m - 1)} height="2.5" rx="1.25" />
            {:else}
              <rect class="meter" class:warn={frac >= 0.8} x={CARD_X0 + 16} y={c.cy + c.cardH / 2 - 6} width={mw} height="2.5" rx="1.25" />
            {/if}
          {/if}
        {:else}
          <text class="c-name" x={CARD_X0 + 16} y={c.cy - 5}>{clip(c.name, 36)}</text>
          <text class="c-sub" x={CARD_X0 + 16} y={c.cy + 14}>
            {#if c.parts}
              {c.parts.map((p) => `${p.label} ${f(p.watts).value} ${f(p.watts).unit}${p.measured ? '' : ' (est.)'}`).join(' · ')}
            {:else}
              {c.off ? 'switched off · ' : ''}{c.todayWh != null ? `${kwh(c.todayWh)} today` : c.kind === 'unmetered' ? 'home total minus circuits' : 'today —'}{c.ratingA ? ` · ${c.ratingA} A` : ''}
            {/if}
          </text>
          {#if c.capacityW}
            {@const frac = Math.min(1, c.watts / c.capacityW)}
            {@const mw = Math.max(c.watts > 0 ? 2 : 0, 140 * frac)}
            <rect class="meter-track" x={CARD_X1 - 160} y={c.cy + 9} width="140" height="4" rx="2" />
            {#if c.parts && c.watts > 0}
              <!-- Measured share solid, the remainder lighter, a 2px gap between. -->
              {@const m = (mw * c.parts[0]!.watts) / c.watts}
              <rect class="meter" x={CARD_X1 - 160} y={c.cy + 9} width={Math.max(0, m - 1)} height="4" rx="2" />
              <rect class="meter rest" x={CARD_X1 - 160 + m + 1} y={c.cy + 9} width={Math.max(0, mw - m - 1)} height="4" rx="2" />
            {:else}
              <rect class="meter" class:warn={frac >= 0.8} x={CARD_X1 - 160} y={c.cy + 9} width={mw} height="4" rx="2" />
            {/if}
          {/if}
        {/if}
        <text class="c-v" x={CARD_X1 - 18} y={layout.compact ? c.cy + 6 : c.cy + 1}>{fw.value}<tspan class="u" dx="3">{fw.unit}</tspan></text>
      </g>
    {/each}
  </svg>
</div>

<style>
  .cflow {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: grid;
  }
  svg {
    width: 100%;
    height: 100%;
  }
  .track {
    fill: none;
    stroke: var(--line-strong);
    stroke-width: 1.2;
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
  @keyframes flow {
    to {
      stroke-dashoffset: -14;
    }
  }
  text {
    font-family: var(--font-ui);
  }
  .disc {
    fill: var(--surface-2);
  }
  .ring {
    fill: none;
    stroke-width: 3;
  }
  .src.idle .ring {
    stroke: var(--line-strong);
  }
  /* Split solar ring: a faint full track, the Tesla arc, then the plug-in
     arc at reduced strength so the two read as parts of one source. */
  .ring.split-track {
    opacity: 0.18;
  }
  .ring.arc.plug {
    opacity: 0.5;
  }
  .src.idle .ring.arc {
    display: none;
  }
  .src.off .ring {
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
  .v2,
  .name,
  .dir,
  .hub-name,
  .hub-v,
  .hub-sub {
    text-anchor: middle;
  }
  .v,
  .hub-v,
  .c-v {
    font-family: var(--font-display);
    fill: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .v {
    font-size: 26px;
  }
  .hub-v {
    font-size: 28px;
  }
  .u {
    font-family: var(--font-ui);
    font-size: 12px;
    fill: var(--ink-3);
  }
  .v2 {
    font-size: 12px;
    fill: var(--ink-2);
  }
  .name,
  .hub-name {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    fill: var(--ink-2);
  }
  .dir,
  .hub-sub {
    font-size: 12px;
    fill: var(--ink-3);
  }
  .hub {
    fill: var(--surface-3);
    stroke: var(--line-strong);
  }
  .card-bg {
    fill: var(--surface-2);
    stroke: var(--line);
  }
  .port {
    fill: var(--home);
  }
  .card.dim .port {
    fill: var(--ink-3);
  }
  .card.dim .c-name,
  .card.dim .c-v {
    fill: var(--ink-3);
  }
  .card.unmetered .card-bg {
    stroke: var(--line-strong);
    stroke-dasharray: 4 4;
  }
  .card.unmetered .port {
    fill: var(--ink-3);
  }
  .c-name {
    font-size: 15px;
    font-weight: 500;
    fill: var(--ink);
  }
  .c-sub {
    font-size: 12px;
    fill: var(--ink-3);
  }
  .c-sub.end {
    text-anchor: end;
  }
  .c-v {
    font-size: 22px;
    text-anchor: end;
  }
  .meter-track {
    fill: var(--home-soft);
  }
  .meter {
    fill: var(--home);
  }
  .meter.warn {
    fill: var(--warn);
  }
  .meter.rest {
    opacity: 0.45;
  }
</style>
