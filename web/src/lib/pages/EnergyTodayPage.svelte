<script lang="ts">
  import { panel } from '$lib/store.svelte';
  import { kwh, num, watts } from '$lib/format';
  import Panel from '$lib/components/Panel.svelte';
  import EnergyChart from '$lib/components/EnergyChart.svelte';

  /** The last 24 hours, faceted: home vs solar together (the one pair the
   *  energy palette validates side by side), then grid, Powerwall power and
   *  Powerwall charge each on their own chart with a shared time axis. */
  let { active = true }: { active?: boolean } = $props();

  const h = $derived(panel.powerwallHistory);
  const ts = $derived(h.map((s) => s.ts));
  const pw = $derived(panel.powerwall);
  const today = $derived(pw?.today ?? null);
  // Re-anchor the window each minute (a new sample) rather than every tick.
  const now = $derived(h.length ? Math.max(h[h.length - 1]!.ts + 60_000, Date.now()) : Date.now());
  const peak = (xs: number[]) => (xs.length ? Math.max(...xs) : 0);
  const solarPeak = $derived(peak(h.map((s) => s.solarW)));
  const homePeak = $derived(peak(h.map((s) => s.homeW)));
</script>

{#if !panel.features.powerwallAvailable}
  <div class="single" data-active={active}>
    <Panel title="Last 24 hours">
      <div class="empty"><strong>Powerwall monitoring is not configured</strong>Set POWERWALL_HOST and POWERWALL_PASSWORD in the panel environment</div>
    </Panel>
  </div>
{:else if h.length < 2}
  <div class="single" data-active={active}>
    <Panel title="Last 24 hours">
      <div class="empty"><strong>Collecting history</strong>One sample is recorded per minute</div>
    </Panel>
  </div>
{:else}
  <div class="today" data-active={active}>
    <Panel title="Home & solar">
      {#snippet meta()}
        <span class="key"><span class="swatch s-home"></span>Home · peak {watts(homePeak)}</span>
        <span class="key"><span class="swatch s-solar"></span>Solar · peak {watts(solarPeak)}</span>
      {/snippet}
      <EnergyChart
        {ts}
        {now}
        unit="W"
        series={[
          { key: 'solar', label: 'Solar', color: 'var(--solar)', values: h.map((s) => s.solarW) },
          { key: 'home', label: 'Home', color: 'var(--home)', values: h.map((s) => s.homeW), area: false },
        ]}
      />
    </Panel>

    <Panel title="Grid">
      {#snippet meta()}
        <span>{today ? `${kwh(today.gridImportWh)} in · ${kwh(today.gridExportWh)} out today` : 'last 24 h'}</span>
      {/snippet}
      <EnergyChart {ts} {now} unit="W" signed posLabel="importing" negLabel="exporting" series={[{ key: 'grid', label: 'Grid', color: 'var(--grid)', values: h.map((s) => s.gridW) }]} />
    </Panel>

    <Panel title="Powerwall power">
      {#snippet meta()}
        <span>{today ? `${kwh(today.batteryChargeWh)} charged · ${kwh(today.batteryDischargeWh)} discharged today` : 'last 24 h'}</span>
      {/snippet}
      <EnergyChart {ts} {now} unit="W" signed posLabel="discharging" negLabel="charging" series={[{ key: 'battery', label: 'Powerwall', color: 'var(--battery)', values: h.map((s) => s.batteryW) }]} />
    </Panel>

    <Panel title="Powerwall charge">
      {#snippet meta()}<span>{pw?.chargePct != null ? `${num(pw.chargePct)}% now` : 'last 24 h'}</span>{/snippet}
      <EnergyChart {ts} {now} unit="%" min={0} max={100} series={[{ key: 'soc', label: 'Charge', color: 'var(--battery)', values: h.map((s) => s.chargePct) }]} />
    </Panel>
  </div>
{/if}

<style>
  .single {
    height: 100%;
    display: grid;
  }
  .today {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
    gap: 1rem;
    height: 100%;
    min-height: 0;
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
</style>
