<script lang="ts">
  import { panel } from '$lib/store.svelte';
  import { THRESHOLDS, bandLabel, bandShort, deviceNameByMac, retryPct, signalBars, signalTone } from '$lib/derive';
  import { bps, formatUptime, pct, shortName, speedLabel } from '$lib/format';
  import type { Band, NetworkDevice, NetworkRadio } from '$lib/types';
  import Panel from '$lib/components/Panel.svelte';
  import Meter from '$lib/components/Meter.svelte';

  /** Access points as rows, one column per band showing channel and airtime;
   *  below, the busiest wireless clients with their signal and the channel
   *  plan per band. */
  let { active = true }: { active?: boolean } = $props();

  const BANDS: Band[] = ['2g', '5g', '6g'];
  const names = $derived(deviceNameByMac(panel.devices));
  const aps = $derived(
    panel.devices
      .filter((d) => d.type === 'uap')
      .slice()
      .sort((a, b) => (a.state === 1 ? 1 : 0) - (b.state === 1 ? 1 : 0) || b.numClients - a.numClients),
  );
  const wifiClients = $derived(
    panel.clients
      .filter((c) => !c.isWired)
      .sort((a, b) => b.rxBps + b.txBps - (a.rxBps + a.txBps))
      .slice(0, 9),
  );
  const bandSummary = $derived(
    BANDS.map((band) => {
      const radios = aps.flatMap((ap) => ap.radios.filter((r) => r.band === band).map((r) => ({ ap, r })));
      const util = radios.length ? radios.reduce((s, x) => s + x.r.utilizationPct, 0) / radios.length : null;
      const clients = radios.reduce((s, x) => s + x.r.numClients, 0);
      return { band, radios: radios.sort((a, b) => b.r.utilizationPct - a.r.utilizationPct), util, clients };
    }).filter((b) => b.radios.length > 0),
  );

  function radioOf(ap: NetworkDevice, band: Band): NetworkRadio | null {
    return ap.radios.find((r) => r.band === band) ?? null;
  }
  function worstRetry(ap: NetworkDevice): number {
    return Math.max(0, ...ap.radios.map((r) => retryPct(r.txRetries, r.txPackets)));
  }
  function apClientCount(ap: NetworkDevice): number {
    const radios = ap.radios.reduce((s, r) => s + r.numClients, 0);
    return ap.numClients || radios;
  }
  function uplinkName(ap: NetworkDevice): string {
    if (!ap.uplink) return '—';
    return shortName(names.get(ap.uplink.chassisId) ?? ap.uplink.systemName ?? '—');
  }
</script>

<div class="wireless" data-active={active}>
  <Panel title="Access points" flush>
    {#snippet meta()}
      <span>{aps.filter((a) => a.state === 1).length} of {aps.length} online</span>
      <span>Airtime = channel utilization</span>
    {/snippet}
    {#if aps.length === 0}
      <div class="empty"><strong>No access points reported</strong>Waiting for the controller</div>
    {:else}
      <div class="rows table">
        <div class="row head">
          <span>Access point</span>
          <span class="right">Clients</span>
          <span>2.4 GHz</span>
          <span>5 GHz</span>
          <span>6 GHz</span>
          <span class="right">Retries</span>
          <span class="right">Experience</span>
          <span>Uplink</span>
          <span class="right">Uptime</span>
        </div>
        {#each aps as ap (ap.id)}
          {@const retry = worstRetry(ap)}
          <div class="row" class:dimmed={ap.state !== 1}>
            <div class="ident">
              <span class="dot {ap.state === 1 ? 'ok' : 'warn'}"></span>
              <div class="min-w-0">
                <div class="cell-name truncate">{shortName(ap.name)}</div>
                <div class="cell-sub truncate">{ap.modelName}{#if ap.state !== 1} · offline{:else if ap.upgradable} · update available{/if}</div>
              </div>
            </div>
            <div class="clients">
              <span class="display big">{apClientCount(ap)}</span>
              <span class="cell-sub">{ap.radios.map((r) => `${bandShort(r.band)}:${r.numClients}`).join(' · ')}</span>
            </div>
            {#each BANDS as band (band)}
              {@const r = radioOf(ap, band)}
              <div class="band">
                {#if r}
                  <div class="band-top">
                    <span class="mono">ch {r.channel}</span>
                    <span class="cell-sub">{r.bwMhz ? `${r.bwMhz} MHz` : ''}</span>
                    <span class="num" class:tone-warn={r.utilizationPct >= THRESHOLDS.radioUtilWarnPct} class:tone-crit={r.utilizationPct >= THRESHOLDS.radioUtilCritPct}>{pct(r.utilizationPct)}</span>
                  </div>
                  <Meter value={r.utilizationPct} warn={THRESHOLDS.radioUtilWarnPct} crit={THRESHOLDS.radioUtilCritPct} height={5} />
                {:else}
                  <span class="dim">—</span>
                {/if}
              </div>
            {/each}
            <div class="num" class:tone-warn={retry >= THRESHOLDS.radioRetryWarnPct}>{pct(retry, 1)}</div>
            <div class="num" class:tone-warn={ap.satisfaction > 0 && ap.satisfaction < THRESHOLDS.satisfactionWarn}>{ap.satisfaction > 0 ? ap.satisfaction : '—'}</div>
            <div class="uplink truncate">{uplinkName(ap)}{#if ap.uplinkSpeedMbps}<span class="cell-sub"> · {speedLabel(ap.uplinkSpeedMbps)}</span>{/if}</div>
            <div class="num">{formatUptime(ap.uptimeSec)}</div>
          </div>
        {/each}
      </div>
    {/if}
  </Panel>

  <Panel title="Wireless clients" flush>
    {#snippet meta()}<span>Busiest now</span>{/snippet}
    {#if wifiClients.length === 0}
      <div class="empty">No wireless clients</div>
    {:else}
      <div class="rows table clients-table">
        {#each wifiClients as c (c.id)}
          {@const bars = signalBars(c.signal)}
          <div class="row">
            <div class="signal" title={c.signal == null ? '' : `${c.signal} dBm`}>
              {#each [1, 2, 3, 4] as i (i)}
                <span class="bar {signalTone(c.signal)}" class:on={i <= bars} style="height: {30 + i * 17}%"></span>
              {/each}
            </div>
            <div class="min-w-0">
              <div class="cell-name truncate">{c.name}</div>
              <div class="cell-sub truncate">{c.device ?? c.vendor ?? c.ip ?? ''}</div>
            </div>
            <div class="cell-sub truncate">
              {c.uplinkMac ? (names.get(c.uplinkMac) ?? '—') : '—'}
              {#if c.band} · {bandLabel(c.band)}{/if}{#if c.channel} ch {c.channel}{/if}
            </div>
            <div class="num"><span class="dim">{c.signal == null ? '—' : `${c.signal} dBm`}</span></div>
            <div class="num">{c.rxRateMbps ? speedLabel(c.rxRateMbps) : '—'}</div>
            <div class="num">{bps(c.rxBps + c.txBps)}</div>
          </div>
        {/each}
      </div>
    {/if}
  </Panel>

  <Panel title="Channel plan">
    {#snippet meta()}<span>Per band · airtime</span>{/snippet}
    <div class="bands">
      {#each bandSummary as b (b.band)}
        <div class="band-col">
          <div class="band-head">
            <span class="band-name">{bandLabel(b.band)}</span>
            <span class="cell-sub">{b.clients} clients · avg {pct(b.util)}</span>
          </div>
          {#each b.radios as x (x.ap.id)}
            <div class="chan">
              <span class="truncate">{shortName(x.ap.name)}</span>
              <span class="mono cell-sub">ch {x.r.channel}</span>
              <Meter value={x.r.utilizationPct} warn={THRESHOLDS.radioUtilWarnPct} crit={THRESHOLDS.radioUtilCritPct} height={4} />
            </div>
          {/each}
        </div>
      {/each}
      {#if bandSummary.length === 0}
        <div class="empty">No radio data</div>
      {/if}
    </div>
  </Panel>
</div>

<style>
  .wireless {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
    grid-template-rows: minmax(0, 1.35fr) minmax(0, 1fr);
    gap: 1rem;
    height: 100%;
    min-height: 0;
  }
  .wireless > :global(.panel:first-child) {
    grid-column: 1 / -1;
  }
  .table {
    padding: 0 1.1rem 0.6rem;
    overflow: hidden;
  }
  .table > .row {
    grid-template-columns: minmax(10rem, 1.2fr) 6rem minmax(8rem, 1fr) minmax(8rem, 1fr) minmax(8rem, 1fr) 4.5rem 5.5rem minmax(7rem, 0.9fr) 5rem;
  }
  .clients-table > .row {
    grid-template-columns: 1.4rem minmax(9rem, 1.3fr) minmax(8rem, 1fr) 5rem 4rem 6rem;
    padding-top: 0.4rem;
    padding-bottom: 0.4rem;
  }
  .ident {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
  }
  .min-w-0 {
    min-width: 0;
  }
  .clients {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.1rem;
  }
  .big {
    font-size: 1.4rem;
    color: var(--ink);
  }
  .band {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
    font-size: 0.84rem;
    color: var(--ink-2);
  }
  .band-top {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 0.5rem;
    align-items: baseline;
  }
  .uplink {
    font-size: 0.86rem;
    color: var(--ink-2);
  }
  .signal {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 1rem;
  }
  .signal .bar {
    width: 3px;
    border-radius: 1px;
    background: var(--line-strong);
  }
  .signal .bar.on.ok {
    background: var(--ok);
  }
  .signal .bar.on.warn {
    background: var(--warn);
  }
  .signal .bar.on.crit {
    background: var(--crit);
  }
  .signal .bar.on.none {
    background: var(--ink-2);
  }
  .bands {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
    gap: 1.2rem;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .band-col {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    min-width: 0;
  }
  .band-head {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding-bottom: 0.3rem;
    border-bottom: 1px solid var(--line);
  }
  .band-name {
    font-weight: 600;
    color: var(--ink);
  }
  .chan {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 3rem minmax(0, 3.5rem);
    align-items: center;
    gap: 0.5rem;
    font-size: 0.82rem;
    color: var(--ink-2);
  }
</style>
