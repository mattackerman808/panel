<script lang="ts">
  import type { Snippet } from 'svelte';

  /** Label + figure. The figure is set in the condensed display face with
   *  proportional figures; only status tones color it. */
  type Props = {
    label: string;
    value: string;
    unit?: string;
    sub?: string;
    tone?: 'none' | 'ok' | 'warn' | 'crit';
    size?: 'sm' | 'md' | 'lg' | 'xl';
    align?: 'start' | 'end';
    children?: Snippet;
    class?: string;
  };
  let { label, value, unit = '', sub = '', tone = 'none', size = 'md', align = 'start', children, class: cls = '' }: Props = $props();
</script>

<div class="stat {size} {cls}" class:end={align === 'end'}>
  <div class="eyebrow">{label}</div>
  <div class="value-row">
    <span class="value display tone-{tone}">{value}</span>
    {#if unit}<span class="unit">{unit}</span>{/if}
  </div>
  {#if sub}<div class="sub">{sub}</div>{/if}
  {#if children}
    <div class="extra">{@render children()}</div>
  {/if}
</div>

<style>
  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
  }
  .stat.end {
    align-items: flex-end;
    text-align: right;
  }
  .value-row {
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
    min-width: 0;
  }
  .value {
    color: var(--ink);
    white-space: nowrap;
  }
  .sm .value {
    font-size: 1.15rem;
  }
  .md .value {
    font-size: 1.6rem;
  }
  .lg .value {
    font-size: 2.2rem;
  }
  .xl .value {
    font-size: 3.4rem;
    letter-spacing: -0.02em;
  }
  .unit {
    font-size: 0.74rem;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--ink-3);
  }
  .lg .unit,
  .xl .unit {
    font-size: 0.85rem;
  }
  .sub {
    font-size: 0.76rem;
    color: var(--ink-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .extra {
    margin-top: 0.15rem;
    min-width: 0;
  }
</style>
