<script lang="ts">
  import { panel } from '$lib/store.svelte';
  import { THRESHOLDS, deriveLinks, deviceNameByMac, poeDraw } from '$lib/derive';
  import { bps, compact, formatUptime, num, pct, shortName, speedLabel } from '$lib/format';
  import type { NetworkDevice } from '$lib/types';
  import Panel from '$lib/components/Panel.svelte';
  import PortStrip from '$lib/components/PortStrip.svelte';
  import Meter from '$lib/components/Meter.svelte';

  /** The switching fabric as one scannable table: every switch is a row,
   *  every port is a cell. Below it, the links that carry the most traffic
   *  and how much PoE headroom is left. */
  let { active = true }: { active?: boolean } = $props();

  const names = $derived(deviceNameByMac(panel.devices));
  const switches = $derived(
    panel.devices
      .filter((d) => d.type === 'usw')
      .slice()
      // Offline first so it's at the top; then by size (core first).
      .sort((a, b) => (a.state === 1 ? 1 : 0) - (b.state === 1 ? 1 : 0) || b.ports.length - a.ports.length || a.name.localeCompare(b.name)),
  );
  const links = $derived(deriveLinks(panel.devices, panel.wans).slice(0, 8));
  const poeSwitches = $derived(switches.filter((s) => s.poeBudgetW).sort((a, b) => poeDraw(b) / (b.poeBudgetW ?? 1) - poeDraw(a) / (a.poeBudgetW ?? 1)));

  type UplinkInfo = { name: string | null; speedMbps: number | null; util: number | null; rate: number };
  function uplinkOf(sw: NetworkDevice): UplinkInfo {
    const p = sw.ports.find((x) => x.isUplink) ?? null;
    const name = p?.neighbor?.systemName ?? (sw.uplink ? (names.get(sw.uplink.chassisId) ?? sw.uplink.systemName) : null);
    const speedMbps = p?.speedMbps || sw.uplinkSpeedMbps || null;
    const rate = p ? p.rxBps + p.txBps : 0;
    const util = speedMbps && rate > 0 ? Math.min(1, (rate * 8) / (speedMbps * 1e6)) : null;
    return { name: name ? shortName(name) : null, speedMbps, util, rate };
  }
</script>

<div class="wired" data-active={active}>
  <Panel title="Switches" flush>
    {#snippet meta()}
      <span class="legend">
        <span class="key t4"></span>10G
        <span class="key t3"></span>2.5G
        <span class="key t2"></span>1G
        <span class="key t1"></span>100M
        <span class="key down"></span>down
      </span>
      <span class="legend"><span class="key ring"></span>uplink <span class="key poe"></span>PoE <span class="key err"></span>errors</span>
    {/snippet}
    {#if switches.length === 0}
      <div class="empty"><strong>No switches reported</strong>Waiting for the controller</div>
    {:else}
      <div class="rows table">
        <div class="row head">
          <span>Switch</span>
          <span>Ports</span>
          <span>Uplink</span>
          <span class="right">Throughput</span>
          <span>PoE</span>
          <span class="right">Clients</span>
          <span class="right">CPU</span>
          <span class="right">Temp</span>
          <span class="right">Uptime</span>
        </div>
        {#each switches as sw (sw.id)}
          {@const up = sw.ports.filter((p) => p.up).length}
          {@const ul = uplinkOf(sw)}
          {@const draw = poeDraw(sw)}
          {@const errors = sw.ports.reduce((s, p) => s + p.rxErrors + p.txErrors, 0)}
          <div class="row" class:dimmed={sw.state !== 1}>
            <div class="ident">
              <span class="dot {sw.state === 1 ? 'ok' : 'crit'}"></span>
              <div class="min-w-0">
                <div class="cell-name truncate">{shortName(sw.name)}</div>
                <div class="cell-sub truncate">{sw.modelName}{#if sw.state !== 1} · offline{:else if sw.upgradable} · update available{/if}{#if errors > 0} · {compact(errors)} port errors{/if}</div>
              </div>
            </div>
            <div class="ports">
              <PortStrip ports={sw.ports} size="sm" />
              <span class="cell-sub mono">{up}/{sw.ports.length}</span>
            </div>
            <div class="uplink">
              <div class="truncate">{ul.name ?? '—'}</div>
              <div class="uplink-sub">
                <span class="cell-sub mono">{speedLabel(ul.speedMbps)}</span>
                <Meter value={ul.util == null ? null : ul.util * 100} warn={80} crit={95} height={4} />
                <span class="cell-sub mono">{ul.util == null ? '' : pct(ul.util * 100)}</span>
              </div>
            </div>
            <div class="num">{bps(sw.bytesRate)}</div>
            <div class="poe">
              {#if sw.poeBudgetW}
                <Meter value={(draw / sw.poeBudgetW) * 100} warn={80} crit={90} height={5} />
                <span class="cell-sub mono">{draw.toFixed(0)} / {sw.poeBudgetW} W</span>
              {:else}
                <span class="dim">—</span>
              {/if}
            </div>
            <div class="num">{sw.numClients}</div>
            <div class="num" class:tone-warn={(sw.cpuPct ?? 0) >= THRESHOLDS.deviceCpuWarnPct}>{pct(sw.cpuPct)}</div>
            <div class="num" class:tone-warn={(sw.tempC ?? 0) >= THRESHOLDS.deviceTempWarnC}>{sw.tempC == null ? '—' : `${num(sw.tempC)}°`}</div>
            <div class="num">{formatUptime(sw.uptimeSec)}</div>
          </div>
        {/each}
      </div>
    {/if}
  </Panel>

  <Panel title="Busiest links">
    {#snippet meta()}<span>Utilization of negotiated speed</span>{/snippet}
    {#if links.length === 0}
      <div class="empty">No LLDP links discovered</div>
    {:else}
      <div class="links">
        {#each links as l (l.id)}
          <div class="link">
            <span class="link-name truncate"><strong>{l.targetName}</strong><span class="dim"> → {l.sourceName}</span></span>
            <Meter value={l.capacityBps > 0 ? l.utilization * 100 : null} warn={80} crit={95} height={5} />
            <span class="num">{bps(l.rateBps / 8)}</span>
            <span class="cell-sub mono right">{l.capacityBps > 0 ? `${pct(l.utilization * 100)} of ${speedLabel(l.capacityBps / 1e6)}` : 'speed unknown'}</span>
          </div>
        {/each}
      </div>
    {/if}
  </Panel>

  <Panel title="PoE budget">
    {#snippet meta()}
      <span><strong>{poeSwitches.reduce((s, d) => s + poeDraw(d), 0).toFixed(0)} W</strong> of {poeSwitches.reduce((s, d) => s + (d.poeBudgetW ?? 0), 0)} W</span>
    {/snippet}
    {#if poeSwitches.length === 0}
      <div class="empty">No PoE switches</div>
    {:else}
      <div class="links">
        {#each poeSwitches as sw (sw.id)}
          {@const draw = poeDraw(sw)}
          {@const powered = sw.ports.filter((p) => p.poeWatts > 0).length}
          <div class="link">
            <span class="link-name truncate"><strong>{shortName(sw.name)}</strong><span class="dim"> · {powered} powered {powered === 1 ? 'port' : 'ports'}</span></span>
            <Meter value={(draw / (sw.poeBudgetW ?? 1)) * 100} warn={80} crit={90} height={5} />
            <span class="num">{draw.toFixed(0)}<span class="unit">W</span></span>
            <span class="cell-sub mono right">of {sw.poeBudgetW} W</span>
          </div>
        {/each}
      </div>
    {/if}
  </Panel>
</div>

<style>
  .wired {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
    grid-template-rows: minmax(0, 2fr) minmax(0, 1fr);
    gap: 1rem;
    height: 100%;
    min-height: 0;
  }
  .wired > :global(.panel:first-child) {
    grid-column: 1 / -1;
  }
  .table {
    padding: 0 1.1rem 0.6rem;
    overflow: hidden;
  }
  .table > .row {
    grid-template-columns: minmax(11rem, 1.1fr) minmax(14rem, 2.4fr) minmax(9rem, 1.1fr) 7rem minmax(7.5rem, 0.9fr) 4.5rem 4rem 4rem 5rem;
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
  .ports {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-width: 0;
  }
  .uplink {
    min-width: 0;
    font-size: 0.86rem;
    color: var(--ink-2);
  }
  .uplink-sub {
    display: grid;
    grid-template-columns: 2.6rem minmax(0, 1fr) 2.6rem;
    align-items: center;
    gap: 0.4rem;
  }
  .poe {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  .legend {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .legend .key {
    display: inline-block;
    width: 0.55rem;
    height: 0.75rem;
    border-radius: 2px;
    margin-left: 0.5rem;
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }
  .legend .key:first-child {
    margin-left: 0;
  }
  .key.t4 {
    background: var(--rx);
    box-shadow: none;
  }
  .key.t3 {
    background: color-mix(in oklab, var(--rx) 78%, var(--surface));
    box-shadow: none;
  }
  .key.t2 {
    background: color-mix(in oklab, var(--rx) 55%, var(--surface));
    box-shadow: none;
  }
  .key.t1 {
    background: color-mix(in oklab, var(--rx) 32%, var(--surface));
    box-shadow: none;
  }
  .key.ring {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .key.poe {
    background: var(--tx);
    border-radius: 50%;
    width: 0.4rem;
    height: 0.4rem;
    box-shadow: none;
  }
  .key.err {
    background: var(--warn);
    border-radius: 50%;
    width: 0.4rem;
    height: 0.4rem;
    box-shadow: none;
  }
  .links {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .link {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) 6.5rem 8rem;
    align-items: center;
    gap: 0.8rem;
    font-size: 0.88rem;
  }
  .link-name strong {
    color: var(--ink);
    font-weight: 600;
  }
</style>
