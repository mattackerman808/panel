<script lang="ts">
  import { panel } from '$lib/store.svelte';
  import { bytes, formatUptime, pct, speedLabel } from '$lib/format';
  import Sparkline from './Sparkline.svelte';
  import Stat from './Stat.svelte';
  import Meter from './Meter.svelte';
  import UsageBars from './UsageBars.svelte';
  import type { Wan } from '$lib/types';

  /** One WAN's status card. `detail` adds the probe grid, the speedtest line
   *  and the 31-day usage chart (the Internet page); the compact form fits
   *  the overview's bottom row. */
  type Props = { wan: Wan; detail?: boolean };
  let { wan, detail = false }: Props = $props();

  const latencyHistory = $derived((panel.histories[wan.id] ?? []).map((s) => s.latencyMs));
  const www = $derived(panel.health.find((h) => h.name === 'www') ?? null);
  const isPrimary = $derived(panel.wans[0]?.id === wan.id);
  const days = $derived(panel.usageDaily[wan.id] ?? []);
  const statusTone = $derived(wan.status === 'ok' ? 'ok' : wan.status === 'degraded' ? 'warn' : wan.status === 'down' ? 'crit' : 'none');
  const statusLabel = $derived(wan.status === 'ok' ? 'Up' : wan.status === 'degraded' ? 'Degraded' : wan.status === 'down' ? 'Down' : 'Unknown');
  const latTone = $derived(wan.latencyMs == null ? 'none' : wan.latencyMs >= 200 ? 'crit' : wan.latencyMs >= 80 ? 'warn' : 'none');
  const probes = $derived(
    wan.monitors
      .filter((m) => m.latencyMs != null)
      .map((m) => ({ ...m, label: m.target.replace(/^www\./, ''), kind: m.type.toUpperCase() })),
  );

  function fmtMbps(mbps: number | null): string {
    if (mbps == null) return '—';
    return mbps >= 1000 ? `${(mbps / 1000).toFixed(2)} Gbps` : `${Math.round(mbps)} Mbps`;
  }
  function ago(ts: number | null): string {
    if (!ts) return 'never';
    const h = Math.max(0, Date.now() / 1000 - ts) / 3600;
    return h < 1 ? `${Math.floor(h * 60)}m ago` : h < 48 ? `${Math.floor(h)}h ago` : `${Math.floor(h / 24)}d ago`;
  }
</script>

<div class="wancard" class:detail>
  <div class="top">
    <div class="ident">
      <div class="isp truncate">{wan.ispName ?? wan.label}</div>
      <div class="meta mono truncate">
        {#if wan.asn != null}AS{wan.asn} · {/if}{wan.ifName}{#if wan.speedBitsPerSec > 0} · {speedLabel(wan.speedBitsPerSec / 1e6)}{/if}
      </div>
    </div>
    <span class="pill {statusTone === 'none' ? '' : statusTone}">{statusLabel}</span>
  </div>

  <div class="lat">
    <Stat label="Latency" value={wan.latencyMs == null ? '—' : String(wan.latencyMs)} unit="ms" size={detail ? 'xl' : 'lg'} tone={latTone} />
    <div class="lat-spark">
      <Sparkline values={latencyHistory} color="var(--accent)" height={detail ? 44 : 32} min={0} />
      <span class="spark-label">15 min</span>
    </div>
    <Stat label="Availability" value={wan.availabilityPct == null ? '—' : wan.availabilityPct.toFixed(wan.availabilityPct >= 99.95 ? 0 : 2)} unit="%" size={detail ? 'lg' : 'md'} align="end" tone={wan.availabilityPct != null && wan.availabilityPct < 99 ? 'warn' : 'none'} />
  </div>

  <dl class="facts">
    <dt>IPv4</dt>
    <dd class="mono">{wan.wanIp ?? '—'}</dd>
    <dt>IPv6</dt>
    <dd class="mono truncate" title={wan.wanIpv6 ?? ''}>{wan.wanIpv6 ?? '—'}</dd>
    {#if detail}
      <dt>Uptime</dt>
      <dd>{formatUptime(wan.uptimeSec)}</dd>
      <dt>Drops</dt>
      <dd>{wan.drops ?? '—'}</dd>
    {/if}
  </dl>

  <div class="usage">
    <div class="usage-row">
      <span class="eyebrow">Today</span>
      <span class="num"><span class="glyph rx">▼</span>{bytes(wan.dayRxBytes)}</span>
      <span class="num"><span class="glyph tx">▲</span>{bytes(wan.dayTxBytes)}</span>
    </div>
    <div class="usage-row">
      <span class="eyebrow">Month</span>
      <span class="num"><span class="glyph rx">▼</span>{bytes(wan.monthRxBytes)}</span>
      <span class="num"><span class="glyph tx">▲</span>{bytes(wan.monthTxBytes)}</span>
    </div>
  </div>

  {#if detail}
    {#if probes.length > 0}
      <div class="probes">
        {#each probes as p (p.type + p.target)}
          <div class="probe">
            <span class="probe-name truncate">{p.label}</span>
            <span class="probe-kind">{p.kind}</span>
            <Meter value={Math.min(100, (p.latencyMs ?? 0))} warn={60} crit={150} height={4} />
            <span class="num">{p.latencyMs}<span class="unit">ms</span></span>
          </div>
        {/each}
      </div>
    {/if}
    <div class="daily">
      <div class="daily-head">
        <span class="eyebrow">Daily usage · 31 days</span>
        {#if isPrimary && www && (www.xputDownMbps != null || www.xputUpMbps != null)}
          <span class="speedtest dim">
            Speedtest <span class="glyph rx">▼</span>{fmtMbps(www.xputDownMbps)} <span class="glyph tx">▲</span>{fmtMbps(www.xputUpMbps)} · {ago(www.speedtestLastRunTs)}
          </span>
        {/if}
      </div>
      <UsageBars {days} height={88} />
    </div>
  {/if}
</div>

<style>
  .wancard {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    height: 100%;
    min-height: 0;
  }
  .top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.8rem;
  }
  .ident {
    min-width: 0;
  }
  .isp {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--ink);
  }
  .meta {
    font-size: 0.74rem;
    color: var(--ink-3);
  }
  .lat {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: end;
    gap: 1rem;
  }
  .lat-spark {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  .spark-label {
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-3);
    text-align: right;
  }
  .facts {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.25rem 1rem;
    margin: 0;
    font-size: 0.84rem;
  }
  .detail .facts {
    grid-template-columns: auto minmax(0, 1fr) auto minmax(0, 1fr);
  }
  .facts dt {
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-3);
    align-self: baseline;
  }
  .facts dd {
    margin: 0;
    color: var(--ink-2);
    min-width: 0;
  }
  .usage {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--line);
    margin-top: auto;
  }
  .usage-row {
    display: grid;
    grid-template-columns: 3.4rem 1fr 1fr;
    gap: 0.6rem;
    align-items: baseline;
    font-size: 0.9rem;
  }
  .usage-row .num {
    text-align: left;
    color: var(--ink);
  }
  .probes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.35rem 1.4rem;
  }
  .probe {
    display: grid;
    grid-template-columns: minmax(0, 7.5rem) 2.6rem minmax(0, 1fr) 4rem;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
  }
  .probe-name {
    color: var(--ink-2);
  }
  .probe-kind {
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    color: var(--ink-3);
  }
  .daily {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .daily-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
  }
  .speedtest {
    font-size: 0.76rem;
    white-space: nowrap;
  }
</style>
