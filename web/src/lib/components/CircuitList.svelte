<script lang="ts">
  import type { CircuitRow } from '$lib/derive';
  import { formatW, kwh } from '$lib/format';

  /** The circuit flow's cards as a plain list, for screens too narrow for
   *  the diagram (its 1000-unit drawing would shrink the text to a few
   *  pixels on a phone). Same rows in the same breaker order, same figures
   *  — live draw, today's energy, breaker size, draw against the breaker
   *  — and the same known split (UPS vs the rest of the subpanel). */
  type Props = { rows: CircuitRow[] };
  let { rows }: Props = $props();

  const f = (w: number) => formatW(w);
</script>

<ul class="clist">
  {#each rows as c (c.key)}
    {@const fw = f(c.watts)}
    {@const frac = c.capacityW ? Math.min(1, c.watts / c.capacityW) : null}
    <li class:dim={!c.active} class:unmetered={c.kind === 'unmetered'}>
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
    </li>
  {/each}
</ul>

<style>
  .clist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  li {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.55rem 0.75rem 0.6rem;
    border: 1px solid var(--line);
    border-left: 3px solid var(--home);
    border-radius: var(--r-card);
    background: var(--surface-2);
    min-width: 0;
  }
  li.dim {
    border-left-color: var(--line-strong);
  }
  li.unmetered {
    border-style: dashed;
    border-left-style: solid;
    border-left-color: var(--ink-3);
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
</style>
