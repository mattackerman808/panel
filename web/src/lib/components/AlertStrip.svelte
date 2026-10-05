<script lang="ts">
  import type { Alert } from '$lib/derive';

  /** Exceptions, surfaced above the page so they are seen regardless of which
   *  page is rotating. Only rendered when there is something to show. */
  type Props = { alerts: Alert[]; max?: number };
  let { alerts, max = 6 }: Props = $props();
  const shown = $derived(alerts.slice(0, max));
  const rest = $derived(alerts.length - shown.length);
</script>

<div class="strip" role="status">
  <span class="eyebrow heading">Attention</span>
  {#each shown as a (a.id)}
    <span class="chip {a.severity}">
      <span class="dot {a.severity}"></span>
      <strong>{a.subject}</strong>
      <span class="detail">{a.detail}</span>
    </span>
  {/each}
  {#if rest > 0}
    <span class="chip more">+{rest} more</span>
  {/if}
</div>

<style>
  .strip {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0 1.25rem;
    padding: 0.45rem 0.8rem;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-card);
    background: var(--surface);
    overflow: hidden;
  }
  .heading {
    color: var(--ink-2);
    margin-right: 0.3rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.7rem;
    border-radius: 999px;
    font-size: 0.82rem;
    white-space: nowrap;
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--ink-2);
  }
  .chip strong {
    color: var(--ink);
    font-weight: 600;
  }
  .chip.crit {
    background: var(--crit-soft);
    border-color: color-mix(in oklab, var(--crit) 40%, transparent);
  }
  .chip.warn {
    background: var(--warn-soft);
    border-color: color-mix(in oklab, var(--warn) 40%, transparent);
  }
  .chip.more {
    color: var(--ink-3);
  }
</style>
