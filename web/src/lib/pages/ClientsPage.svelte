<script lang="ts">
  import { panel } from '$lib/store.svelte';
  import { deviceNameByMac, fleetSummary } from '$lib/derive';
  import { ageFromUnix, formatBps, formatBytes, shortName } from '$lib/format';
  import type { ClientStat } from '$lib/types';
  import type { RankedRow } from '$lib/ui';
  import Panel from '$lib/components/Panel.svelte';
  import RankedBars from '$lib/components/RankedBars.svelte';
  import Stat from '$lib/components/Stat.svelte';

  /** Who is on the network: the busiest right now, the heaviest over their
   *  session, how the population breaks down, and who arrived recently. */
  let { active = true }: { active?: boolean } = $props();

  const names = $derived(deviceNameByMac(panel.devices));
  const fleet = $derived(fleetSummary(panel.devices, panel.clients));

  const subtitle = (c: ClientStat): string => [c.device ?? c.vendor, c.ip].filter(Boolean).join(' · ');

  const byRate = $derived<RankedRow[]>(
    panel.clients
      .slice()
      .sort((a, b) => b.rxBps + b.txBps - (a.rxBps + a.txBps))
      .slice(0, 10)
      .map((c) => {
        const f = formatBps(c.rxBps + c.txBps);
        return { id: c.id, label: c.name, sub: subtitle(c), value: c.rxBps, value2: c.txBps, text: f.value, unit: f.unit, marker: c.isWired ? 'wired' : 'wireless' };
      }),
  );
  const byVolume = $derived<RankedRow[]>(
    panel.clients
      .slice()
      .sort((a, b) => b.rxBytes + b.txBytes - (a.rxBytes + a.txBytes))
      .slice(0, 10)
      .map((c) => {
        const f = formatBytes(c.rxBytes + c.txBytes);
        return { id: c.id, label: c.name, sub: subtitle(c), value: c.rxBytes, value2: c.txBytes, text: f.value, unit: f.unit, marker: c.isWired ? 'wired' : 'wireless' };
      }),
  );
  const networks = $derived<RankedRow[]>(
    [...panel.clients.reduce((m, c) => m.set(c.network ?? 'Unlabeled', (m.get(c.network ?? 'Unlabeled') ?? 0) + 1), new Map<string, number>())]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({ id: name, label: name, value: count, text: String(count) })),
  );
  const dayAgo = $derived(Date.now() / 1000 - 86400);
  const newToday = $derived(panel.clients.filter((c) => (c.firstSeen ?? 0) >= dayAgo).length);
  const newest = $derived(
    panel.clients
      .filter((c) => c.firstSeen)
      .sort((a, b) => (b.firstSeen ?? 0) - (a.firstSeen ?? 0))
      .slice(0, 8),
  );
</script>

<div class="clients" data-active={active}>
  <Panel title="Top talkers">
    {#snippet meta()}
      <span><span class="swatch rx"></span> Down</span><span><span class="swatch tx"></span> Up</span><span>Now</span>
    {/snippet}
    {#if byRate.length === 0}
      <div class="empty">Waiting for client data</div>
    {:else}
      <RankedBars rows={byRate} />
    {/if}
  </Panel>

  <Panel title="Heaviest sessions">
    {#snippet meta()}<span>Bytes since connecting</span>{/snippet}
    {#if byVolume.length === 0}
      <div class="empty">Waiting for client data</div>
    {:else}
      <RankedBars rows={byVolume} />
    {/if}
  </Panel>

  <Panel title="Population">
    <div class="pop">
      <div class="pop-stats">
        <Stat label="Clients" value={String(fleet.clients.total)} size="lg" />
        <Stat label="Wired" value={String(fleet.clients.wired)} />
        <Stat label="Wireless" value={String(fleet.clients.wireless)} />
        <Stat label="Guest" value={String(fleet.clients.guest)} />
        <Stat label="New · 24 h" value={String(newToday)} />
      </div>
      <div class="pop-nets">
        <div class="eyebrow">By network</div>
        <RankedBars rows={networks} showRank={false} dense />
      </div>
    </div>
  </Panel>

  <Panel title="Recently joined">
    {#snippet meta()}<span>First seen</span>{/snippet}
    {#if newest.length === 0}
      <div class="empty">No client history</div>
    {:else}
      <div class="rows recent">
        {#each newest as c (c.id)}
          <div class="row">
            <span class="marker {c.isWired ? 'wired' : 'wireless'}"></span>
            <div class="min-w-0">
              <div class="cell-name truncate">{c.name}</div>
              <div class="cell-sub truncate">{subtitle(c)}</div>
            </div>
            <div class="cell-sub truncate">{c.uplinkMac ? (names.get(c.uplinkMac) ?? '') : ''}{c.swPort ? ` · port ${c.swPort}` : ''}{c.essid ? ` · ${c.essid}` : ''}</div>
            <div class="num dim">{ageFromUnix(c.firstSeen)}</div>
          </div>
        {/each}
      </div>
    {/if}
  </Panel>
</div>

<style>
  .clients {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: 1rem;
    height: 100%;
    min-height: 0;
  }
  .pop {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
    gap: 1.5rem;
    height: 100%;
    min-height: 0;
  }
  .pop-stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.8rem 1rem;
    align-content: start;
  }
  .pop-stats > :global(.stat:first-child) {
    grid-column: 1 / -1;
  }
  .pop-nets {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }
  .recent > .row {
    grid-template-columns: 0.6rem minmax(9rem, 1.2fr) minmax(0, 1fr) 5rem;
    padding-top: 0.38rem;
    padding-bottom: 0.38rem;
  }
  .recent > .row:first-child {
    border-top: none;
  }
  .marker {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 1px;
    background: var(--ink-3);
  }
  .marker.wireless {
    border-radius: 50%;
  }
  .min-w-0 {
    min-width: 0;
  }
</style>
