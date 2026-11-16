<script lang="ts">
  import { onMount } from 'svelte';
  import { panel } from '$lib/store.svelte';
  import { backupEstimate, batteryDirection, gridDirection, gridLabel, type Alert } from '$lib/derive';
  import { formatClock, formatDate, formatUptime, formatW, num } from '$lib/format';

  /** The energy kiosk's status bar: where the home's power is coming from
   *  right now, the grid state, the battery, the rack UPS, alerts, clock.
   *  Each figure sits beside a series swatch; the text stays in ink. */
  type Props = { alerts: Alert[] };
  let { alerts }: Props = $props();

  let now = $state(new Date());
  onMount(() => {
    const id = setInterval(() => (now = new Date()), 1000);
    return () => clearInterval(id);
  });

  const pw = $derived(panel.powerwall);
  const live = $derived(!!pw && pw.reachable);
  const feed = $derived.by(() => {
    if (panel.connection !== 'open') return { label: panel.connection === 'connecting' ? 'Connecting' : 'Disconnected', tone: 'crit' as const };
    if (panel.source === 'mock') return { label: 'Mock data', tone: 'accent' as const };
    return { label: 'Live', tone: 'ok' as const };
  });
  const gridTone = $derived(!live ? 'off' : pw!.grid === 'connected' ? 'ok' : pw!.grid === 'islanded' ? 'crit' : 'warn');
  const worst = $derived(alerts.some((a) => a.severity === 'crit') ? 'crit' : alerts.some((a) => a.severity === 'warn') ? 'warn' : 'ok');

  const solar = $derived(formatW(pw?.solarW));
  const home = $derived(formatW(pw?.homeW));
  const grid = $derived(formatW(pw?.gridW));
  const battery = $derived(formatW(pw?.batteryW));

  const backup = $derived(backupEstimate(panel.span, pw));
  const backupLeft = $derived(backup?.forecastMin ?? backup?.atCurrentMin ?? null);
  const ups = $derived(panel.ups);
  const upsTone = $derived(!ups || !ups.reachable ? 'warn' : ups.onBattery ? 'crit' : 'ok');
  const upsLabel = $derived(!ups || !ups.reachable ? 'No UPS data' : ups.onBattery ? 'On battery' : 'On mains');
</script>

<header class="topbar">
  <div class="brand">
    <span class="mark" aria-hidden="true"></span>
    <div class="brand-text">
      <span class="site display">{panel.ui.energySiteName ?? panel.ui.siteName}</span>
      <span class="pill {feed.tone}"><span class="dot {feed.tone === 'accent' ? 'off' : feed.tone} pulse"></span>{feed.label}</span>
    </div>
  </div>

  <div class="sep"></div>
  <div class="kpi">
    <span class="eyebrow">Grid</span>
    <span class="display big"><span class="dot {gridTone}"></span> {live ? gridLabel(pw!.grid) : 'No data'}</span>
    <span class="sub">
      {#if live && pw!.grid === 'islanded' && backupLeft != null}backup ~{formatUptime(backupLeft * 60)} left{:else if live && pw!.voltageV != null}{num(pw!.voltageV)} V · {num(pw!.frequencyHz, 2)} Hz{:else}Powerwall gateway{/if}
    </span>
  </div>

  <div class="sep"></div>
  <div class="flow">
    <span class="eyebrow"><span class="swatch s-solar"></span>Solar</span>
    <span class="value"><span class="display">{solar.value}</span><span class="unit">{solar.unit}</span></span>
  </div>
  <div class="flow">
    <span class="eyebrow"><span class="swatch s-home"></span>Home</span>
    <span class="value"><span class="display">{home.value}</span><span class="unit">{home.unit}</span></span>
  </div>
  <div class="flow">
    <span class="eyebrow"><span class="swatch s-grid"></span>Grid · {live ? gridDirection(pw!.gridW) : '—'}</span>
    <span class="value"><span class="display">{grid.value}</span><span class="unit">{grid.unit}</span></span>
  </div>
  <div class="flow">
    <span class="eyebrow"><span class="swatch s-battery"></span>Powerwall · {live ? batteryDirection(pw!.batteryW) : '—'}</span>
    <span class="value">
      <span class="display">{live && pw!.chargePct != null ? num(pw!.chargePct) : '—'}</span><span class="unit">%</span>
      <span class="aside">{battery.value} {battery.unit}</span>
    </span>
  </div>

  {#if panel.features.upsAvailable}
    <div class="sep"></div>
    <div class="kpi">
      <span class="eyebrow">Rack UPS</span>
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
  .kpi,
  .flow {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .flow .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    white-space: nowrap;
  }
  .value {
    display: inline-flex;
    align-items: baseline;
    gap: 0.2rem;
    white-space: nowrap;
  }
  .value .display {
    font-size: 1.45rem;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .unit {
    font-size: 0.72rem;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--ink-3);
  }
  .aside {
    margin-left: 0.5rem;
    font-size: 0.8rem;
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  .big {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
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
