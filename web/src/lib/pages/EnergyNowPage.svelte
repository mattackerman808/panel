<script lang="ts">
  import { panel } from '$lib/store.svelte';
  import { batteryDirection, gridLabel, selfPoweredPct, THRESHOLDS } from '$lib/derive';
  import { formatKWh, formatW, num, relativeTime } from '$lib/format';
  import Panel from '$lib/components/Panel.svelte';
  import Stat from '$lib/components/Stat.svelte';
  import Meter from '$lib/components/Meter.svelte';
  import PowerFlow from '$lib/components/PowerFlow.svelte';
  import EventList from '$lib/components/EventList.svelte';

  /** The energy kiosk's home page: the live power flow, the Powerwall, the
   *  day's totals, and the power-related event log. */
  let { active = true }: { active?: boolean } = $props();

  const pw = $derived(panel.powerwall);
  const configured = $derived(panel.features.powerwallAvailable);
  const live = $derived(!!pw && pw.reachable);
  const today = $derived(pw?.today ?? panel.energyDaily.at(-1) ?? null);
  const selfPct = $derived(selfPoweredPct(today));
  const chargeTone = $derived(
    pw?.chargePct == null ? 'none' : pw.chargePct < THRESHOLDS.powerwallChargeCritPct ? 'crit' : pw.chargePct < THRESHOLDS.powerwallChargeWarnPct ? 'warn' : 'none',
  );
  const gridTone = $derived(!live ? 'warn' : pw!.grid === 'connected' ? 'ok' : pw!.grid === 'islanded' ? 'crit' : 'warn');
  const energyEvents = $derived(panel.events.filter((e) => /^(grid|powerwall|ups)\./.test(e.kind)));

  const k = (wh: number | undefined) => formatKWh(wh);
  const batt = $derived(formatW(pw?.batteryW));
</script>

{#if !configured}
  <div class="single" data-active={active}>
    <Panel title="Energy">
      <div class="empty"><strong>Powerwall monitoring is not configured</strong>Set POWERWALL_HOST and POWERWALL_PASSWORD in the panel environment</div>
    </Panel>
  </div>
{:else if !pw}
  <div class="single" data-active={active}>
    <Panel title="Energy" tone="warn">
      <div class="empty"><strong>Waiting for the Powerwall</strong>No reading from the gateway yet</div>
    </Panel>
  </div>
{:else}
  <div class="now" data-active={active}>
    <Panel title="Power flow" tone={gridTone} class="flow-panel">
      {#snippet meta()}
        <span>{gridLabel(pw.grid)}</span>
        <span>{live ? `updated ${relativeTime(pw.updatedAt)}` : 'gateway not answering'}</span>
      {/snippet}
      <PowerFlow {pw} {active} />
    </Panel>

    <Panel title="Powerwall">
      {#snippet meta()}<span>{batteryDirection(pw.batteryW)}{pw.batteryW !== 0 ? ` · ${batt.value} ${batt.unit}` : ''}</span>{/snippet}
      <div class="battery">
        <Stat label="Charge" value={num(pw.chargePct)} unit="%" size="xl" tone={chargeTone}>
          <Meter value={pw.chargePct} tone={chargeTone === 'none' ? 'ok' : chargeTone} height={8} />
        </Stat>
        <Stat label="Charged today" value={k(today?.batteryChargeWh).value} unit="kWh" />
        <Stat label="Discharged today" value={k(today?.batteryDischargeWh).value} unit="kWh" />
      </div>
    </Panel>

    <Panel title="Today">
      {#snippet meta()}<span>since midnight</span>{/snippet}
      {#if today}
        <div class="totals">
          <div class="t"><span class="swatch s-solar"></span><Stat label="Solar produced" value={k(today.solarWh).value} unit="kWh" size="lg" /></div>
          <div class="t"><span class="swatch s-home"></span><Stat label="Home used" value={k(today.homeWh).value} unit="kWh" size="lg" /></div>
          <div class="t"><span class="swatch s-grid"></span><Stat label="From grid" value={k(today.gridImportWh).value} unit="kWh" /></div>
          <div class="t"><span class="swatch s-grid"></span><Stat label="To grid" value={k(today.gridExportWh).value} unit="kWh" /></div>
          <div class="t wide"><Stat label="Self-powered" value={selfPct == null ? '—' : num(selfPct)} unit="%" sub="share of home energy not drawn from the grid" /></div>
        </div>
      {:else}
        <div class="empty">Totals start after the first full reading</div>
      {/if}
    </Panel>

    <Panel title="Power events">
      {#if energyEvents.length === 0}
        <div class="empty">No grid, Powerwall or UPS events yet</div>
      {:else}
        <EventList events={energyEvents} limit={6} />
      {/if}
    </Panel>
  </div>
{/if}

<style>
  .single {
    height: 100%;
    display: grid;
  }
  .now {
    display: grid;
    grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: 1rem;
    height: 100%;
    min-height: 0;
  }
  .now > :global(.flow-panel) {
    grid-row: 1 / 4;
  }
  .battery {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) repeat(2, minmax(0, 1fr));
    gap: 1.2rem;
    align-items: start;
    padding: 0.2rem 0 0.4rem;
  }
  .totals {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.9rem 1.2rem;
    padding: 0.2rem 0 0.4rem;
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
</style>
