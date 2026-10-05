<script lang="ts">
  import type { RankedRow } from '$lib/ui';

  /** A ranked list with a thin bar per row. One hue for the whole list (the
   *  ranking is one series); an optional second value splits the bar into
   *  download/upload. Rank numbers are shown because the order *is* the
   *  information. */
  type Props = {
    rows: RankedRow[];
    /** Reference for 100% bar width; defaults to the largest row. */
    max?: number | null;
    showRank?: boolean;
    dense?: boolean;
  };
  let { rows, max = null, showRank = true, dense = false }: Props = $props();

  const scale = $derived(Math.max(1e-9, max ?? Math.max(0, ...rows.map((r) => r.value + (r.value2 ?? 0)))));
</script>

<ol class="ranked" class:dense>
  {#each rows as r, i (r.id)}
    {@const w1 = (r.value / scale) * 100}
    {@const w2 = ((r.value2 ?? 0) / scale) * 100}
    <li>
      {#if showRank}<span class="rank mono">{i + 1}</span>{/if}
      <div class="text">
        <div class="label-row">
          {#if r.marker}
            <span class="marker {r.marker}" title={r.marker}></span>
          {/if}
          <span class="label truncate">{r.label}</span>
          {#if r.sub}<span class="sub truncate">{r.sub}</span>{/if}
        </div>
        <div class="track">
          <span class="fill rx" style="width: {w1}%"></span>
          {#if w2 > 0}<span class="fill tx" style="width: {w2}%"></span>{/if}
        </div>
      </div>
      <div class="figure">
        <span class="num">{r.text}{#if r.unit}<span class="unit">{r.unit}</span>{/if}</span>
        {#if r.text2}<span class="num small">{r.text2}</span>{/if}
      </div>
    </li>
  {/each}
</ol>

<style>
  .ranked {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    min-width: 0;
  }
  .ranked.dense {
    gap: 0.35rem;
  }
  li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0 0.8rem;
    min-width: 0;
  }
  .rank {
    width: 1.4rem;
    font-size: 0.72rem;
    color: var(--ink-3);
    text-align: right;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
  }
  .label-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    min-width: 0;
    font-size: 0.9rem;
  }
  .dense .label-row {
    font-size: 0.84rem;
  }
  .label {
    font-weight: 600;
    color: var(--ink);
    flex: 0 1 auto;
    min-width: 0;
  }
  .sub {
    font-size: 0.72rem;
    color: var(--ink-3);
    flex: 1 1 0;
    min-width: 0;
  }
  .marker {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 1px;
    flex: none;
    align-self: center;
    background: var(--ink-3);
  }
  .marker.wireless {
    border-radius: 50%;
  }
  .track {
    display: flex;
    gap: 2px;
    height: 5px;
    min-width: 0;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: 0 3px 3px 0;
    transition: width 600ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .fill.rx {
    background: var(--rx);
  }
  .fill.tx {
    background: var(--tx);
  }
  .figure {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.1rem;
    min-width: 5.5rem;
  }
  .num {
    font-size: 0.95rem;
    color: var(--ink);
  }
  .num.small {
    font-size: 0.72rem;
    color: var(--ink-3);
  }
  @media (prefers-reduced-motion: reduce) {
    .fill {
      transition: none;
    }
  }
</style>
