<script lang="ts">
  import { panel } from '$lib/store.svelte';
  import { backupEstimate, batteryDirection, gridLabel, selfPoweredPct, solarSystems, THRESHOLDS } from '$lib/derive';
  import { formatKWh, formatUptime, formatW, num, relativeTime } from '$lib/format';
  import Panel from '$lib/components/Panel.svelte';
  import Stat from '$lib/components/Stat.svelte';
  import Meter from '$lib/components/Meter.svelte';
  import PowerFlow from '$lib/components/PowerFlow.svelte';
  import Sparkline from '$lib/components/Sparkline.svelte';
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
  const energyEvents = $derived(panel.events.filter((e) => /^(grid|powerwall|ups|solar)\./.test(e.kind)));
  // Tesla (roof) vs plug-in microinverters, side by side. solarW and
  // today.solarWh are the two together; null when there's no plug-in.
  const plugIn = $derived(panel.features.microinvertersAvailable ? panel.microinverters : []);
  const plugInAwake = $derived(plugIn.some((m) => m.reachable));
  const cmp = $derived(solarSystems(pw, panel.powerwallHistory, today, plugIn));
  /** One short line under each system's name: where it's read from, and
   *  for the plug-in whether it's awake and how many panels are producing. */
  const plugInNote = $derived.by(() => {
    if (!plugInAwake) return 'asleep, no sun on the panel';
    const ch = plugIn.filter((m) => m.reachable).flatMap((m) => m.channels);
    const on = ch.filter((c) => c.powerW > 0).length;
    const model = plugIn.find((m) => m.reachable)?.model ?? 'EZ1';
    return `${model}, ${on} panel${on === 1 ? '' : 's'} producing`;
  });
  const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  // The plug-in makes well under a kWh a day: two decimals below 10 kWh.
  const kwhFine = (wh: number | null) => (wh == null ? '—' : (Math.max(0, wh) / 1000).toFixed(wh < 10_000 ? 2 : 1));

  const k = (wh: number | undefined) => formatKWh(wh);
  const backup = $derived(backupEstimate(panel.span, pw));
  const dur = (min: number | null | undefined) => (min == null ? '—' : formatUptime(min * 60));
  const backupSub = $derived.by(() => {
    if (!backup) return '';
    const parts: string[] = [];
    if (backup.forecastMin != null) parts.push(`SPAN forecast${backup.confidence ? ` (${backup.confidence.toLowerCase()} confidence)` : ''}`);
    if (backup.atCurrentMin != null) parts.push(`${dur(backup.atCurrentMin)} at current draw`);
    else if (pw && pw.solarW >= pw.homeW) parts.push('solar covering the load');
    if (backup.nextShedMin != null) parts.push(`first shed in ${dur(backup.nextShedMin)}`);
    return parts.join(' · ');
  });
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
      <PowerFlow {pw} {active} {plugInAwake} />
    </Panel>

    <Panel title="Powerwall">
      {#snippet meta()}<span>{batteryDirection(pw.batteryW)}{pw.batteryW !== 0 ? ` · ${batt.value} ${batt.unit}` : ''}</span>{/snippet}
      <div class="battery">
        <Stat label="Charge" value={num(pw.chargePct)} unit="%" size="xl" tone={chargeTone}>
          <Meter value={pw.chargePct} tone={chargeTone === 'none' ? 'ok' : chargeTone} height={8} />
        </Stat>
        {#if backup}
          <Stat label="Backup if the grid fails" value={dur(backup.forecastMin ?? backup.atCurrentMin)} size="lg" sub={backupSub} class="wrap-sub" />
        {/if}
        <Stat label="Charged today" value={k(today?.batteryChargeWh).value} unit="kWh" />
        <Stat label="Discharged today" value={k(today?.batteryDischargeWh).value} unit="kWh" />
      </div>
    </Panel>

    {#if cmp}
      <Panel title="Solar by system">
        {#snippet meta()}
          {#if cmp.plugInSharePct != null}<span>plug-in made {cmp.plugInSharePct < 1 ? cmp.plugInSharePct.toFixed(1) : num(cmp.plugInSharePct)}% of today's solar</span>{/if}
        {/snippet}
        <div class="cmp" role="table" aria-label="Solar output by system">
          <div class="cmp-row head" role="row">
            <span role="columnheader"><span class="sr">System</span></span>
            <span class="eyebrow num-h" role="columnheader">Now</span>
            <span class="eyebrow num-h" role="columnheader">Today</span>
            <span class="eyebrow num-h" role="columnheader">Peak</span>
            <span class="eyebrow axis" role="columnheader">
              <span>{cmp.fromTs ? clock(cmp.fromTs) : 'today'}</span><span>now</span>
            </span>
          </div>
          {#each cmp.systems as sys (sys.key)}
            {@const nowW = formatW(sys.watts)}
            {@const pk = formatW(sys.peakW ?? undefined)}
            <div class="cmp-row" class:quiet={sys.key === 'plugin' && !plugInAwake} role="row">
              <div class="who" role="rowheader">
                <span class="name"><span class="swatch s-solar" class:soft={sys.key === 'plugin'}></span>{sys.label}</span>
                <span class="note">{sys.key === 'roof' ? 'roof, via the Powerwall' : plugInNote}</span>
              </div>
              <span class="num" role="cell" data-label="Now"><span class="display">{nowW.value}</span><span class="unit">{nowW.unit}</span></span>
              <span class="num" role="cell" data-label="Today"><span class="display">{kwhFine(sys.todayWh)}</span><span class="unit">kWh</span></span>
              <span class="num" role="cell" data-label="Peak"><span class="display">{pk.value}</span><span class="unit">{pk.unit}</span></span>
              <span class="spark" role="cell"><Sparkline values={sys.series} color="var(--solar)" height={34} min={0} indexed /></span>
            </div>
          {/each}
        </div>
      </Panel>
    {/if}

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
    grid-template-rows: auto auto auto minmax(0, 1fr);
    gap: 1rem;
    height: 100%;
    min-height: 0;
  }
  .now > :global(.flow-panel) {
    grid-row: 1 / -1;
  }
  /* Solar by system: a two-row comparison table. Numbers right-aligned in
     tabular figures; the sparklines share one clock (first light → now),
     each on its own vertical scale. */
  .cmp {
    display: grid;
    grid-template-columns: minmax(8.5rem, 1.15fr) repeat(3, minmax(4.2rem, auto)) minmax(6rem, 1.6fr);
    column-gap: 1.3rem;
    row-gap: 0.7rem;
    align-items: center;
    padding: 0.1rem 0 0.3rem;
  }
  .cmp-row {
    display: contents;
  }
  .cmp-row.head > * {
    padding-bottom: 0.1rem;
  }
  .num-h {
    text-align: right;
  }
  .axis {
    display: flex;
    justify-content: space-between;
    letter-spacing: 0.04em;
    text-transform: none;
  }
  .who {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--ink);
    font-weight: 600;
    font-size: 1.05rem;
  }
  .swatch.soft {
    opacity: 0.55;
  }
  .note {
    color: var(--ink-3);
    font-size: 0.78rem;
    padding-left: 1.25rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .num {
    display: flex;
    justify-content: flex-end;
    align-items: baseline;
    gap: 0.22rem;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .num .display {
    font-size: 1.55rem;
    color: var(--ink);
  }
  .num .unit {
    font-size: 0.75rem;
    color: var(--ink-3);
  }
  .quiet .num .display,
  .quiet .name {
    color: var(--ink-2);
  }
  .spark {
    min-width: 0;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .battery {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.5fr) repeat(2, minmax(0, 0.9fr));
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

  /* Compact (COMPACT_QUERY): one column; the flow diagram sizes itself
     from its width. */
  @media (max-width: 900px), (max-height: 500px) {
    .now {
      display: flex;
      flex-direction: column;
      height: auto;
    }
    .battery {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    /* Each system becomes a block: name, then the three figures labelled
       in place, then its sparkline full width. */
    .cmp {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      row-gap: 0.45rem;
    }
    .cmp-row.head {
      display: none;
    }
    .who,
    .spark {
      grid-column: 1 / -1;
    }
    .who {
      margin-top: 0.5rem;
    }
    .num {
      justify-content: flex-start;
    }
    .num::before {
      content: attr(data-label);
      font-size: 0.7rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--ink-3);
      margin-right: 0.35rem;
    }
  }
</style>
