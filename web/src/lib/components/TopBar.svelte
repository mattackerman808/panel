<script lang="ts">
  import { onMount } from 'svelte';
  import { panel } from '$lib/store.svelte';
  import { fleetSummary, type Alert } from '$lib/derive';
  import { formatBps, formatClock, formatDate, formatUptime } from '$lib/format';

  /** Always-visible summary: site, feed state, live WAN rates, fleet counts,
   *  power, alert count, clock. Everything a glance from across the room
   *  should answer, regardless of which page is showing. */
  type Props = { alerts: Alert[] };
  let { alerts }: Props = $props();

  let now = $state(new Date());
  onMount(() => {
    const id = setInterval(() => (now = new Date()), 1000);
    return () => clearInterval(id);
  });

  const fleet = $derived(fleetSummary(panel.devices, panel.clients));
  const devicesOnline = $derived(fleet.switches.online + fleet.aps.online + (fleet.gatewayOnline ? 1 : 0));
  const devicesTotal = $derived(fleet.switches.total + fleet.aps.total + (panel.devices.some((d) => d.type === 'udm') ? 1 : 0));
  const feed = $derived.by(() => {
    if (panel.connection !== 'open') return { label: panel.connection === 'connecting' ? 'Connecting' : 'Disconnected', tone: 'crit' as const };
    if (panel.source === 'mock') return { label: 'Mock data', tone: 'accent' as const };
    return { label: 'Live', tone: 'ok' as const };
  });
  const worst = $derived(alerts.some((a) => a.severity === 'crit') ? 'crit' : alerts.some((a) => a.severity === 'warn') ? 'warn' : 'ok');
  const ups = $derived(panel.ups);
  const upsTone = $derived(!ups || !ups.reachable ? 'warn' : ups.onBattery ? 'crit' : 'ok');
  const upsLabel = $derived(!ups || !ups.reachable ? 'No UPS data' : ups.onBattery ? 'On battery' : 'On mains');

  function wanTone(status: string): 'ok' | 'warn' | 'crit' | 'off' {
    return status === 'ok' ? 'ok' : status === 'degraded' ? 'warn' : status === 'down' ? 'crit' : 'off';
  }
</script>

<header class="topbar">
  <div class="brand">
    <span class="mark" aria-hidden="true"></span>
    <div class="brand-text">
      <span class="site display">{panel.ui.siteName}</span>
      <span class="pill {feed.tone}"><span class="dot {feed.tone === 'accent' ? 'off' : feed.tone} pulse"></span>{feed.label}</span>
    </div>
  </div>

  {#each panel.wans as w (w.id)}
    {@const rx = formatBps(w.rxBps)}
    {@const tx = formatBps(w.txBps)}
    <div class="sep"></div>
    <div class="wan">
      <div class="wan-head">
        <span class="dot {wanTone(w.status)}"></span>
        <span class="wan-label">{w.label}</span>
        {#if w.latencyMs != null}<span class="wan-lat mono">{w.latencyMs} ms</span>{/if}
      </div>
      <div class="wan-rates">
        <span class="rate"><span class="glyph rx">▼</span><span class="display">{rx.value}</span><span class="unit">{rx.unit}</span></span>
        <span class="rate"><span class="glyph tx">▲</span><span class="display">{tx.value}</span><span class="unit">{tx.unit}</span></span>
      </div>
    </div>
  {/each}

  <div class="sep"></div>
  <div class="kpi">
    <span class="eyebrow">Clients</span>
    <span class="display big">{fleet.clients.total}</span>
    <span class="sub">{fleet.clients.wired} wired · {fleet.clients.wireless} wifi</span>
  </div>
  <div class="kpi">
    <span class="eyebrow">Devices</span>
    <span class="display big" class:tone-warn={devicesOnline < devicesTotal}>{devicesOnline}<span class="of">/{devicesTotal}</span></span>
    <span class="sub">{fleet.switches.total} switches · {fleet.aps.total} APs</span>
  </div>
  {#if fleet.poeBudgetW > 0}
    <div class="kpi">
      <span class="eyebrow">PoE</span>
      <span class="display big">{fleet.poeDrawW.toFixed(0)}<span class="of"> W</span></span>
      <span class="sub">of {fleet.poeBudgetW.toFixed(0)} W budget</span>
    </div>
  {/if}
  {#if panel.features.upsAvailable}
    <div class="kpi">
      <span class="eyebrow">Power</span>
      <span class="display big tone-{upsTone === 'ok' ? 'none' : upsTone}">{upsLabel}</span>
      <span class="sub">
        {#if ups?.reachable}
          load {ups.loadPct ?? '—'}% · {ups.minutesRemaining != null ? formatUptime(ups.minutesRemaining * 60) : '—'} runtime
        {:else}
          check SNMP
        {/if}
      </span>
    </div>
  {/if}

  <div class="spacer"></div>

  <div class="status">
    {#if alerts.length === 0}
      <span class="pill ok"><span class="dot ok"></span>All clear</span>
    {:else}
      <span class="pill {worst}"><span class="dot {worst}"></span>{alerts.length} {alerts.length === 1 ? 'alert' : 'alerts'}</span>
    {/if}
    {#if panel.udm}
      <span class="gw dim">{panel.udm.modelName} · {panel.udm.firmware} · up {formatUptime(panel.udm.uptimeSec)}</span>
    {/if}
  </div>

  <div class="clock">
    <span class="time display">{formatClock(now)}</span>
    <span class="date">{formatDate(now)}</span>
  </div>
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    padding: 0 1.25rem;
    min-height: 3.6rem;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }
  .mark {
    width: 0.9rem;
    height: 0.9rem;
    border-radius: 3px;
    background: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-soft);
  }
  .brand-text {
    display: flex;
    align-items: center;
    gap: 0.7rem;
  }
  .site {
    font-size: 1.25rem;
    color: var(--ink);
  }
  .sep {
    width: 1px;
    align-self: stretch;
    background: var(--line-strong);
    margin: 0.3rem 0;
  }
  .wan {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  .wan-head {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  .wan-lat {
    color: var(--ink-3);
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
  }
  .wan-rates {
    display: flex;
    gap: 1rem;
  }
  .rate {
    display: inline-flex;
    align-items: baseline;
    gap: 0.2rem;
    white-space: nowrap;
  }
  .rate .display {
    font-size: 1.45rem;
    color: var(--ink);
    min-width: 2.6ch;
  }
  .unit,
  .of {
    font-size: 0.72rem;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--ink-3);
  }
  .of {
    font-size: 0.85rem;
    font-family: var(--font-display);
  }
  .kpi {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .big {
    font-size: 1.45rem;
    color: var(--ink);
    white-space: nowrap;
  }
  .sub {
    font-size: 0.72rem;
    color: var(--ink-3);
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }
  .status {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.35rem;
  }
  .gw {
    font-size: 0.72rem;
    white-space: nowrap;
  }
  .clock {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    line-height: 1;
    gap: 0.3rem;
  }
  .time {
    font-size: 2rem;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
  }
  .date {
    font-size: 0.74rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
</style>
