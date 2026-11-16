<script lang="ts">
  import { untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import type { PowerwallInfo, SpanInfo } from '$lib/types';
  import { flowSources, stickyRank, type CircuitRow } from '$lib/derive';
  import { formatW, kwh, num } from '$lib/format';

  /** The circuit flow for a phone, drawn top-down: the sources (solar,
   *  grid, Powerwall) feed the SPAN panel, a trunk runs down the left, and
   *  a branch runs to each circuit card. As on the desktop diagram, moving
   *  dots show each live flow — direction, and with their size and speed,
   *  how much. Cards are ranked by live draw so the big consumer is on top;
   *  the ranking is damped (re-checked every few seconds, and a circuit
   *  must clearly out-draw the one above to pass it) so the list doesn't
   *  shuffle with every reading. */
  type Props = { pw: PowerwallInfo | null; span: SpanInfo; rows: CircuitRow[]; active?: boolean };
  let { pw, span, rows, active = true }: Props = $props();

  const RESORT_MS = 8_000;

  let order = $state<string[]>(untrack(() => stickyRank([], rows)));
  let sortedAt = Date.now();
  $effect(() => {
    const r = rows;
    untrack(() => {
      const known = new Set(order);
      const changed = r.length !== order.length || r.some((x) => !known.has(x.key));
      if (!changed && Date.now() - sortedAt < RESORT_MS) return;
      order = stickyRank(order, r);
      sortedAt = Date.now();
    });
  });
  const byKey = $derived(new Map(rows.map((r) => [r.key, r])));
  const ordered = $derived(order.map((k) => byKey.get(k)).filter((r): r is CircuitRow => !!r));

  const sources = $derived(flowSources(pw, span));
  const total = $derived(rows.reduce((a, r) => a + r.watts, 0));
  const activeCount = $derived(rows.filter((r) => r.active && r.kind === 'circuit').length);

  // The trunk ends level with the last card's branch.
  let list = $state<HTMLUListElement | null>(null);
  let tail = $state(0);
  $effect(() => {
    void ordered.length;
    const last = list?.lastElementChild as HTMLElement | null | undefined;
    tail = last ? last.offsetHeight / 2 : 0;
  });

  /** Dot size and speed from power, calm at both ends (as CircuitFlow). */
  const dot = (w: number) => 3 + Math.min(4, (Math.abs(w) / 1000) * 0.9);
  const dur = (w: number) => Math.max(0.45, Math.min(2.6, 1.8 / (0.3 + Math.abs(w) / 1000)));
  const wire = (w: number) => `--s: ${dot(w).toFixed(1)}px; --d: ${dur(w).toFixed(2)}s`;
  const f = (w: number) => formatW(w);
</script>

<div class="cl" class:paused={!active}>
  <div class="sources" style="grid-template-columns: repeat({sources.length}, minmax(0, 1fr))">
    {#each sources as s (s.key)}
      <div class="src" class:idle={s.idle} class:off={s.off} style="--c: {s.color}">
        <div class="src-card">
          <span class="src-name">{s.label}</span>
          {#if s.key === 'battery' && pw?.chargePct != null}
            <span class="src-v display">{num(pw.chargePct)}<span class="u">%</span></span>
            <span class="src-dir">{s.dir}{s.idle ? '' : ` · ${f(s.watts).value} ${f(s.watts).unit}`}</span>
          {:else}
            <span class="src-v display">{f(s.watts).value}<span class="u">{f(s.watts).unit}</span></span>
            <span class="src-dir">{s.dir}</span>
          {/if}
        </div>
        <!-- Positive = into the panel; export and charging run back up. -->
        <span class="lane v">
          {#if !s.idle && !s.off}<span class="wire v" class:rev={s.watts < 0} style={wire(s.watts)}></span>{/if}
        </span>
      </div>
    {/each}
  </div>

  <div class="hub">
    <span class="hub-name">SPAN panel</span>
    <span class="hub-v display">{f(total).value}<span class="u">{f(total).unit}</span></span>
    <span class="hub-sub">{activeCount} circuits active</span>
  </div>

  <div class="tree">
    <span class="lane v trunk" style="bottom: {tail}px">
      {#if total >= 15}<span class="wire v" style={wire(total)}></span>{/if}
    </span>
    <ul class="clist" bind:this={list}>
      {#each ordered as c (c.key)}
        {@const fw = f(c.watts)}
        {@const frac = c.capacityW ? Math.min(1, c.watts / c.capacityW) : null}
        <li class:dim={!c.active} class:unmetered={c.kind === 'unmetered'} animate:flip={{ duration: 450 }}>
          <span class="lane h">
            {#if c.active}<span class="wire h" style={wire(c.watts)}></span>{/if}
          </span>
          <div class="card">
            <div class="top">
              <span class="name truncate">{c.name}{c.off ? ' · off' : ''}</span>
              <span class="v display">{fw.value}<span class="u">{fw.unit}</span></span>
            </div>
            <div class="sub truncate">
              {#if c.parts}
                {c.parts.map((p) => `${p.label} ${f(p.watts).value} ${f(p.watts).unit}${p.measured ? '' : ' (est.)'}`).join(' · ')}
              {:else}
                {c.todayWh != null ? `${kwh(c.todayWh)} today` : c.kind === 'unmetered' ? 'home total minus circuits' : 'today —'}{c.ratingA ? ` · ${c.ratingA} A` : ''}
              {/if}
            </div>
            {#if frac != null}
              {@const pct = Math.max(c.watts > 0 ? 0.6 : 0, frac * 100)}
              <div class="track" aria-hidden="true">
                {#if c.parts && c.watts > 0}
                  {@const m = (pct * c.parts[0]!.watts) / c.watts}
                  <span class="fill" style="width: {m}%"></span>
                  <span class="fill rest" style="width: {Math.max(0, pct - m)}%"></span>
                {:else}
                  <span class="fill" class:warn={frac >= 0.8} style="width: {pct}%"></span>
                {/if}
              </div>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .cl {
    --trunk-x: 0.75rem;
    --dot-gap: 14px;
    display: flex;
    flex-direction: column;
  }

  /* ---- wires: a faint 1px track with dots moving along it ---- */
  .lane {
    position: relative;
    display: block;
  }
  .lane::before {
    content: '';
    position: absolute;
    background: var(--line-strong);
  }
  .lane.v::before {
    top: 0;
    bottom: 0;
    left: 50%;
    width: 1px;
  }
  .lane.h::before {
    left: 0;
    right: 0;
    top: 50%;
    height: 1px;
  }
  .wire {
    position: absolute;
    background-image: radial-gradient(circle closest-side, var(--c, var(--home)) 85%, transparent 100%);
    animation: var(--d, 1.5s) linear infinite;
  }
  .wire.v {
    top: 0;
    bottom: 0;
    left: calc(50% - var(--s) / 2 + 0.5px);
    width: var(--s);
    background-size: var(--s) var(--dot-gap);
    background-repeat: repeat-y;
    animation-name: flow-down;
  }
  .wire.h {
    left: 0;
    right: 0;
    top: calc(50% - var(--s) / 2 + 0.5px);
    height: var(--s);
    background-size: var(--dot-gap) var(--s);
    background-repeat: repeat-x;
    animation-name: flow-right;
  }
  .wire.rev {
    animation-direction: reverse;
  }
  .paused .wire {
    animation-play-state: paused;
  }
  @keyframes flow-down {
    from {
      background-position: 0 0;
    }
    to {
      background-position: 0 var(--dot-gap);
    }
  }
  @keyframes flow-right {
    from {
      background-position: 0 0;
    }
    to {
      background-position: var(--dot-gap) 0;
    }
  }

  /* ---- sources → hub ---- */
  .sources {
    display: grid;
    gap: 0.5rem;
  }
  .src {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .src-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    padding: 0.5rem 0.4rem;
    border: 2px solid var(--c);
    border-radius: var(--r-card);
    background: var(--surface-2);
    min-width: 0;
    text-align: center;
  }
  .src.idle .src-card {
    border-color: var(--line-strong);
  }
  .src.off .src-card {
    border-color: var(--crit);
    border-style: dashed;
  }
  .src-name {
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  .src-v {
    font-size: 1.3rem;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .src-dir {
    font-size: 0.7rem;
    color: var(--ink-3);
    white-space: nowrap;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .src .lane.v {
    height: 2rem;
  }
  .hub {
    display: flex;
    align-items: baseline;
    justify-content: center;
    flex-wrap: wrap;
    gap: 0.2rem 0.7rem;
    padding: 0.55rem 0.8rem;
    border: 1px solid var(--line-strong);
    border-radius: 12px;
    background: var(--surface-3);
  }
  .hub-name {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  .hub-v {
    font-size: 1.4rem;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .hub-sub {
    font-size: 0.74rem;
    color: var(--ink-3);
  }

  /* ---- hub → trunk → circuits ---- */
  .tree {
    position: relative;
    padding-top: 0.8rem;
  }
  .trunk {
    position: absolute;
    top: 0;
    left: calc(var(--trunk-x) - 0.5rem);
    width: 1rem;
  }
  .clist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  li {
    display: grid;
    grid-template-columns: 3.4rem minmax(0, 1fr);
    align-items: stretch;
    min-width: 0;
  }
  li .lane.h {
    margin-left: var(--trunk-x);
  }
  .unmetered .wire {
    --c: var(--ink-3);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.55rem 0.75rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: var(--r-card);
    background: var(--surface-2);
    min-width: 0;
  }
  .unmetered .card {
    border-style: dashed;
    border-color: var(--line-strong);
  }
  .top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.8rem;
    min-width: 0;
  }
  .name {
    font-weight: 500;
    color: var(--ink);
    min-width: 0;
  }
  .dim .name,
  .dim .v {
    color: var(--ink-3);
  }
  .v {
    font-size: 1.25rem;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .u {
    margin-left: 0.2rem;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    font-weight: 500;
    color: var(--ink-3);
  }
  .sub {
    font-size: 0.76rem;
    color: var(--ink-3);
  }
  .track {
    display: flex;
    gap: 2px;
    height: 3px;
    margin-top: 0.2rem;
    border-radius: 2px;
    background: var(--home-soft);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--home);
  }
  .fill.warn {
    background: var(--warn);
  }
  .fill.rest {
    opacity: 0.45;
  }
  @media (prefers-reduced-motion: reduce) {
    .wire {
      animation: none;
    }
  }
</style>
