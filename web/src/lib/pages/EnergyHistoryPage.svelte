<script lang="ts">
  import { panel } from '$lib/store.svelte';
  import { selfPoweredPct } from '$lib/derive';
  import { formatKWh, num } from '$lib/format';
  import type { EnergyDay } from '$lib/types';
  import Panel from '$lib/components/Panel.svelte';
  import Stat from '$lib/components/Stat.svelte';
  import EnergyDayBars from '$lib/components/EnergyDayBars.svelte';

  /** Two weeks of daily energy: production against consumption, the grid
   *  balance, and the period's totals. */
  let { active = true }: { active?: boolean } = $props();

  const DAYS = 14;
  // Today's bar tracks the live reading rather than waiting for the minute.
  const days = $derived.by(() => {
    const list = panel.energyDaily.slice(-DAYS);
    const t = panel.powerwall?.today;
    if (t && list.length && list[list.length - 1]!.date === t.date) list[list.length - 1] = t;
    else if (t && !list.some((d) => d.date === t.date)) list.push(t);
    return list.slice(-DAYS);
  });
  const sum = (key: keyof Omit<EnergyDay, 'date' | 'plugInSolarWh'>) => days.reduce((a, d) => a + d[key], 0);
  const total = $derived<EnergyDay>({
    date: '',
    solarWh: sum('solarWh'),
    homeWh: sum('homeWh'),
    gridImportWh: sum('gridImportWh'),
    gridExportWh: sum('gridExportWh'),
    batteryChargeWh: sum('batteryChargeWh'),
    batteryDischargeWh: sum('batteryDischargeWh'),
  });
  const selfPct = $derived(selfPoweredPct(total));
  const net = $derived(total.gridImportWh - total.gridExportWh);
  const k = (wh: number) => formatKWh(wh);
</script>

{#if !panel.features.powerwallAvailable}
  <div class="single" data-active={active}>
    <Panel title="History">
      <div class="empty"><strong>Powerwall monitoring is not configured</strong>Set POWERWALL_HOST and POWERWALL_PASSWORD in the panel environment</div>
    </Panel>
  </div>
{:else if days.length === 0}
  <div class="single" data-active={active}>
    <Panel title="History">
      <div class="empty"><strong>No daily totals yet</strong>The first day fills in from the gateway's meters</div>
    </Panel>
  </div>
{:else}
  <div class="history" data-active={active}>
    <Panel title="Solar vs home">
      {#snippet meta()}
        <span class="key"><span class="swatch s-home"></span>Home used</span>
        <span class="key"><span class="swatch s-solar"></span>Solar produced</span>
        <span>kWh per day</span>
      {/snippet}
      <EnergyDayBars
        {days}
        bars={[
          { key: 'home', label: 'Home', color: 'var(--home)', value: (d) => d.homeWh },
          { key: 'solar', label: 'Solar', color: 'var(--solar)', value: (d) => d.solarWh },
        ]}
      />
    </Panel>

    <Panel title="Grid">
      {#snippet meta()}<span>kWh per day</span>{/snippet}
      <EnergyDayBars
        {days}
        posLabel="imported"
        negLabel="exported"
        bars={[
          { key: 'in', label: 'Imported', color: 'var(--grid)', value: (d) => d.gridImportWh },
          { key: 'out', label: 'Exported', color: 'var(--grid)', value: (d) => d.gridExportWh, sign: -1 },
        ]}
      />
    </Panel>

    <Panel title="Last {days.length} days" class="sum-panel">
      <div class="sums">
        <div class="t"><span class="swatch s-solar"></span><Stat label="Solar produced" value={k(total.solarWh).value} unit="kWh" size="lg" /></div>
        <div class="t"><span class="swatch s-home"></span><Stat label="Home used" value={k(total.homeWh).value} unit="kWh" size="lg" /></div>
        <div class="t"><span class="swatch s-grid"></span><Stat label="From grid" value={k(total.gridImportWh).value} unit="kWh" /></div>
        <div class="t"><span class="swatch s-grid"></span><Stat label="To grid" value={k(total.gridExportWh).value} unit="kWh" /></div>
        <div class="t"><span class="swatch s-battery"></span><Stat label="Powerwall charged" value={k(total.batteryChargeWh).value} unit="kWh" /></div>
        <div class="t"><span class="swatch s-battery"></span><Stat label="Powerwall discharged" value={k(total.batteryDischargeWh).value} unit="kWh" /></div>
        <div class="t wide"><Stat label="Self-powered" value={selfPct == null ? '—' : num(selfPct)} unit="%" size="lg" sub="share of home energy not drawn from the grid" /></div>
        <div class="t wide">
          <Stat label={net >= 0 ? 'Net from grid' : 'Net to grid'} value={k(Math.abs(net)).value} unit="kWh" sub="imported minus exported" />
        </div>
      </div>
    </Panel>
  </div>
{/if}

<style>
  .single {
    height: 100%;
    display: grid;
  }
  .history {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    grid-template-rows: repeat(2, minmax(0, 1fr));
    gap: 1rem;
    height: 100%;
    min-height: 0;
  }
  .history > :global(.sum-panel) {
    grid-column: 2;
    grid-row: 1 / 3;
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .sums {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.1rem 1.2rem;
    align-content: start;
    padding-top: 0.3rem;
  }
  .t {
    display: flex;
    gap: 0.55rem;
    align-items: flex-start;
    min-width: 0;
  }
  .t .swatch {
    margin-top: 0.2rem;
  }
  .t.wide {
    grid-column: 1 / -1;
    padding-left: 1.25rem;
  }

  /* Compact (COMPACT_QUERY): totals first, then the two charts. */
  @media (max-width: 900px), (max-height: 500px) {
    .history {
      display: flex;
      flex-direction: column;
      height: auto;
    }
    .history > :global(.sum-panel) {
      order: -1;
    }
    .history > :global(.panel:not(.sum-panel)) {
      height: 16rem;
    }
  }
</style>
