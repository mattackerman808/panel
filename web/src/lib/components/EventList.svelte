<script lang="ts">
  import { formatClock } from '$lib/format';
  import type { PanelEvent } from '$lib/types';

  /** Recent state changes, newest first. Time is shown as a clock for today
   *  and as weekday + clock for older entries. */
  type Props = { events: PanelEvent[]; limit?: number; now?: number };
  let { events, limit = 8, now = Date.now() }: Props = $props();

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function when(ts: number): string {
    const d = new Date(ts);
    const today = new Date(now);
    const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
    return sameDay ? formatClock(d, false) : `${DAYS[d.getDay()]} ${formatClock(d, false)}`;
  }
</script>

{#if events.length === 0}
  <div class="empty">No events yet</div>
{:else}
  <ul class="events">
    {#each events.slice(0, limit) as e (e.id)}
      <li>
        <span class="dot {e.severity === 'info' ? 'off' : e.severity}"></span>
        <span class="when mono">{when(e.ts)}</span>
        <span class="msg truncate"><strong>{e.subject}</strong> {e.message.startsWith(e.subject) ? e.message.slice(e.subject.length).trim() : e.message}</span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .events {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  li {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    align-items: center;
    gap: 0 0.7rem;
    padding: 0.45rem 0;
    border-top: 1px solid var(--line);
    font-size: 0.86rem;
    min-width: 0;
  }
  li:first-child {
    border-top: none;
  }
  .when {
    font-size: 0.74rem;
    color: var(--ink-3);
  }
  .msg {
    color: var(--ink-2);
    min-width: 0;
  }
  .msg strong {
    color: var(--ink);
    font-weight: 600;
  }
</style>
