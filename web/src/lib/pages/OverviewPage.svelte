<script lang="ts">
  import { panel } from '$lib/store.svelte';
  import { fleetSummary } from '$lib/derive';
  import { formatBps, formatUptime, num } from '$lib/format';
  import type { RankedRow } from '$lib/ui';
  import Panel from '$lib/components/Panel.svelte';
  import ThroughputChart from '$lib/components/ThroughputChart.svelte';
  import Stat from '$lib/components/Stat.svelte';
  import Sparkline from '$lib/components/Sparkline.svelte';
  import Meter from '$lib/components/Meter.svelte';
  import WanCard from '$lib/components/WanCard.svelte';
  import EventList from '$lib/components/EventList.svelte';
  import RankedBars from '$lib/components/RankedBars.svelte';

  /** The page the kiosk rests on: is the internet healthy, what is flowing,
   *  is the fleet up, what changed recently. */
  let { active = true }: { active?: boolean } = $props();

  const fleet = $derived(fleetSummary(panel.devices, panel.clients));
  const gw = $derived(panel.udm);
  const gwHist = $derived(panel.gatewayHistory);
  const cpuHist = $derived(gwHist.map((s) => s.cpuPct));
  const memHist = $derived(gwHist.map((s) => s.memPct));
  const tempHist = $derived(gwHist.map((s) => s.tempC));
  const clientHist = $derived(gwHist.map((s) => s.clients));
  const talkers = $derived<RankedRow[]>(
    panel.clients
      .slice()
      .sort((a, b) => b.rxBps + b.txBps - (a.rxBps + a.txBps))
      .slice(0, 6)
      .map((c) => {
        const f = formatBps(c.rxBps + c.txBps);
        return { id: c.id, label: c.name, sub: c.device ?? c.vendor ?? undefined, value: c.rxBps, value2: c.txBps, text: f.value, unit: f.unit, marker: c.isWired ? 'wired' : 'wireless' };
      }),
  );
  const bottomCols = $derived(Math.max(1, panel.wans.length) + 2);

  function wanTone(status: string): 'ok' | 'warn' | 'crit' | 'off' {
    return status === 'ok' ? 'ok' : status === 'degraded' ? 'warn' : status === 'down' ? 'crit' : 'off';
  }
</script>

<div class="ov">
  <Panel title="WAN throughput">
    {#snippet meta()}
      <span><span class="swatch rx"></span> Download</span>
      <span><span class="swatch tx"></span> Upload</span>
      <span>Last 15 min</span>
    {/snippet}
    <div class="charts">
      {#each panel.wans as w (w.id)}
        {@const rx = formatBps(w.rxBps)}
        {@const tx = formatBps(w.txBps)}
        <div class="chart-block">
          <div class="chart-head">
            <span class="chart-title"><span class="dot {wanTone(w.status)}"></span>{w.label}<span class="dim"> · {w.ispName ?? w.ifName}</span></span>
            <span class="chart-rates">
              <span class="rate"><span class="glyph rx">▼</span><span class="display">{rx.value}</span><span class="unit">{rx.unit}</span></span>
              <span class="rate"><span class="glyph tx">▲</span><span class="display">{tx.value}</span><span class="unit">{tx.unit}</span></span>
            </span>
          </div>
          <div class="chart-area"><ThroughputChart wanId={w.id} {active} /></div>
        </div>
      {/each}
      {#if panel.wans.length === 0}
        <div class="empty"><strong>No WAN telemetry yet</strong>Waiting for SNMP counters from the gateway</div>
      {/if}
    </div>
  </Panel>

  <div class="side">
    <Panel title="Gateway" tone={gw ? 'ok' : 'off'}>
      {#snippet meta()}
        {#if gw}<span>{gw.modelName}</span><span>{gw.firmware}</span>{/if}
      {/snippet}
      {#if gw}
        <div class="gw-grid">
          <Stat label="CPU" value={num(gw.cpuPct)} unit="%" tone={gw.cpuPct >= 85 ? 'warn' : 'none'}>
            <Sparkline values={cpuHist} min={0} max={100} height={26} color="var(--accent)" />
          </Stat>
          <Stat label="Memory" value={num(gw.memPct)} unit="%" tone={gw.memPct >= 90 ? 'warn' : 'none'}>
            <Sparkline values={memHist} min={0} max={100} height={26} color="var(--accent)" />
          </Stat>
          <Stat label="Temperature" value={gw.tempC == null ? '—' : num(gw.tempC)} unit="°C" tone={gw.tempC != null && gw.tempC >= 80 ? 'warn' : 'none'}>
            <Sparkline values={tempHist} height={26} color="var(--accent)" />
          </Stat>
          <Stat label="Uptime" value={formatUptime(gw.uptimeSec)} sub={gw.name} />
        </div>
      {:else}
        <div class="empty">Waiting for controller data</div>
      {/if}
    </Panel>

    <Panel title="Fleet">
      <div class="fleet">
        <div class="fleet-row">
          <span class="k eyebrow">Switches</span>
          <span class="v display" class:tone-crit={fleet.switches.online < fleet.switches.total}>{fleet.switches.online}<span class="of">/{fleet.switches.total}</span></span>
          <span class="s dim">{fleet.portsUp} of {fleet.portsTotal} ports up</span>
        </div>
        <div class="fleet-row">
          <span class="k eyebrow">Access points</span>
          <span class="v display" class:tone-warn={fleet.aps.online < fleet.aps.total}>{fleet.aps.online}<span class="of">/{fleet.aps.total}</span></span>
          <span class="s dim">2.4 GHz {fleet.wirelessByBand['2g']} · 5 GHz {fleet.wirelessByBand['5g']} · 6 GHz {fleet.wirelessByBand['6g']}</span>
        </div>
        <div class="fleet-row">
          <span class="k eyebrow">Clients</span>
          <span class="v display">{fleet.clients.total}</span>
          <span class="s"><Sparkline values={clientHist} height={22} fill={false} color="var(--accent)" /></span>
        </div>
        {#if fleet.poeBudgetW > 0}
          <div class="fleet-row">
            <span class="k eyebrow">PoE draw</span>
            <span class="v display">{fleet.poeDrawW.toFixed(0)}<span class="of"> W</span></span>
            <span class="s"><Meter value={(fleet.poeDrawW / fleet.poeBudgetW) * 100} height={5} /><span class="dim small">of {fleet.poeBudgetW.toFixed(0)} W</span></span>
          </div>
        {/if}
      </div>
    </Panel>
  </div>

  <div class="bottom" style="grid-template-columns: repeat({bottomCols}, minmax(0, 1fr))">
    {#each panel.wans as w (w.id)}
      <Panel title={w.label} tone={wanTone(w.status)}>
        <WanCard wan={w} />
      </Panel>
    {/each}
    <Panel title="Top talkers">
      {#snippet meta()}<span>Now</span>{/snippet}
      {#if talkers.length}
        <RankedBars rows={talkers} dense />
      {:else}
        <div class="empty">Waiting for client data</div>
      {/if}
    </Panel>
    <Panel title="Recent events">
      <EventList events={panel.events} limit={7} />
    </Panel>
  </div>
</div>

<style>
  .ov {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: 1rem;
    height: 100%;
    min-height: 0;
  }
  .side {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 1rem;
    min-height: 0;
  }
  .bottom {
    grid-column: 1 / -1;
    display: grid;
    gap: 1rem;
    min-height: 0;
  }
  .charts {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    height: 100%;
    min-height: 0;
  }
  .chart-block {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .chart-block + .chart-block {
    border-top: 1px solid var(--line);
    padding-top: 0.6rem;
  }
  .chart-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
  }
  .chart-title {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--ink);
  }
  .chart-rates {
    display: flex;
    gap: 1.2rem;
  }
  .rate {
    display: inline-flex;
    align-items: baseline;
    gap: 0.2rem;
  }
  .rate .display {
    font-size: 1.35rem;
    color: var(--ink);
  }
  .unit {
    font-size: 0.72rem;
    color: var(--ink-3);
    letter-spacing: 0.04em;
  }
  .chart-area {
    flex: 1;
    min-height: 0;
  }
  .gw-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.9rem 1.2rem;
  }
  .fleet {
    display: flex;
    flex-direction: column;
    height: 100%;
    justify-content: space-around;
    gap: 0.4rem;
  }
  .fleet-row {
    display: grid;
    grid-template-columns: 6.5rem 4.2rem minmax(0, 1fr);
    align-items: center;
    gap: 0.8rem;
    min-width: 0;
  }
  .fleet-row .v {
    font-size: 1.5rem;
    color: var(--ink);
    white-space: nowrap;
  }
  .of {
    font-size: 0.85rem;
    color: var(--ink-3);
  }
  .fleet-row .s {
    font-size: 0.78rem;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .small {
    font-size: 0.7rem;
  }
</style>
