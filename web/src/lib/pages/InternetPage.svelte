<script lang="ts">
  import { panel } from '$lib/store.svelte';
  import { formatBytes, pct } from '$lib/format';
  import type { RankedRow } from '$lib/ui';
  import Panel from '$lib/components/Panel.svelte';
  import WanCard from '$lib/components/WanCard.svelte';
  import RankedBars from '$lib/components/RankedBars.svelte';

  /** Each uplink in depth (latency, probes, addresses, daily usage) and what
   *  the internet is being used for (DPI, trailing 24 h). */
  let { active = true }: { active?: boolean } = $props();

  const toRows = (list: { id: string; name: string; bytes: number; pct: number }[], n: number): RankedRow[] =>
    list.slice(0, n).map((a) => {
      const f = formatBytes(a.bytes);
      return { id: a.id, label: a.name, value: a.bytes, text: f.value, unit: f.unit, text2: pct(a.pct * 100, 1) };
    });
  const apps = $derived(toRows(panel.dpi, 7));
  const cats = $derived(toRows(panel.dpiCategories, 7));

  function wanTone(status: string): 'ok' | 'warn' | 'crit' | 'off' {
    return status === 'ok' ? 'ok' : status === 'degraded' ? 'warn' : status === 'down' ? 'crit' : 'off';
  }
</script>

<div class="internet" data-active={active}>
  <div class="wans" style="grid-template-columns: repeat({Math.max(1, panel.wans.length)}, minmax(0, 1fr))">
    {#each panel.wans as w (w.id)}
      <Panel title={w.label} tone={wanTone(w.status)}>
        {#snippet meta()}<span>{w.ifName}</span>{/snippet}
        <WanCard wan={w} detail />
      </Panel>
    {/each}
    {#if panel.wans.length === 0}
      <Panel title="Internet"><div class="empty"><strong>No WAN telemetry yet</strong>Waiting for SNMP counters from the gateway</div></Panel>
    {/if}
  </div>

  <div class="traffic">
    <Panel title="Top applications">
      {#snippet meta()}<span>Last 24 h · DPI</span>{/snippet}
      {#if !panel.features.dpiAvailable}
        <div class="empty"><strong>Traffic identification unavailable</strong>Local controller credentials unlock application data</div>
      {:else if apps.length === 0}
        <div class="empty"><strong>No DPI data yet</strong>Enable Traffic Identification on the gateway</div>
      {:else}
        <RankedBars rows={apps} dense />
      {/if}
    </Panel>
    <Panel title="Top categories">
      {#snippet meta()}<span>Last 24 h · DPI</span>{/snippet}
      {#if !panel.features.dpiAvailable || cats.length === 0}
        <div class="empty">No category data</div>
      {:else}
        <RankedBars rows={cats} dense />
      {/if}
    </Panel>
  </div>
</div>

<style>
  .internet {
    display: grid;
    grid-template-rows: minmax(0, 1.5fr) minmax(0, 1fr);
    gap: 1rem;
    height: 100%;
    min-height: 0;
  }
  .wans,
  .traffic {
    display: grid;
    gap: 1rem;
    min-height: 0;
  }
  .traffic {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
</style>
