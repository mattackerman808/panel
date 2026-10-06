<script lang="ts">
  import { bps, speedLabel } from '$lib/format';
  import type { NetworkPort } from '$lib/types';

  /** One cell per switch port. Fill brightness encodes negotiated speed
   *  (an ordinal ramp of the download hue), an accent ring marks the uplink,
   *  a small amber dot marks a port delivering PoE, a red tick marks errors. */
  type Props = { ports: NetworkPort[]; size?: 'sm' | 'md' };
  let { ports, size = 'md' }: Props = $props();

  function tier(p: NetworkPort): string {
    if (!p.up) return 'down';
    if (p.speedMbps >= 10000) return 't4';
    if (p.speedMbps >= 2500) return 't3';
    if (p.speedMbps >= 1000) return 't2';
    return 't1';
  }

  function title(p: NetworkPort): string {
    if (!p.up) return `${p.name}: down`;
    const parts = [`${p.name}: ${speedLabel(p.speedMbps)}`, bps(p.rxBps + p.txBps)];
    if (p.neighbor) parts.push(`→ ${p.neighbor.systemName ?? p.neighbor.chassisId}`);
    if (p.poeWatts > 0) parts.push(`PoE ${p.poeWatts.toFixed(1)} W`);
    if (p.rxErrors + p.txErrors > 0) parts.push(`${p.rxErrors + p.txErrors} errors`);
    return parts.join(' · ');
  }
</script>

<div class="strip {size}" role="img" aria-label="{ports.filter((p) => p.up).length} of {ports.length} ports up">
  {#each ports as p (p.idx)}
    <span
      class="port {tier(p)}"
      class:uplink={p.isUplink}
      class:poe={p.poeWatts > 0}
      class:err={p.rxErrors + p.txErrors > 0}
      title={title(p)}
    ></span>
  {/each}
</div>

<style>
  .strip {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    min-width: 0;
  }
  .port {
    position: relative;
    width: 0.78rem;
    height: 1.05rem;
    border-radius: 2px;
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--line-strong);
    flex: none;
  }
  .sm .port {
    width: 0.56rem;
    height: 0.8rem;
  }
  .port.t1 {
    background: color-mix(in oklab, var(--rx) 32%, var(--surface));
    box-shadow: none;
  }
  .port.t2 {
    background: color-mix(in oklab, var(--rx) 55%, var(--surface));
    box-shadow: none;
  }
  .port.t3 {
    background: color-mix(in oklab, var(--rx) 78%, var(--surface));
    box-shadow: none;
  }
  .port.t4 {
    background: var(--rx);
    box-shadow: none;
  }
  .port.uplink {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .port.poe::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 2px;
    width: 3px;
    height: 3px;
    margin-left: -1.5px;
    border-radius: 50%;
    background: var(--tx);
    box-shadow: 0 0 0 1px var(--surface);
  }
  /* Lifetime error counters are informational (they never reset until the
     switch reboots), so the tick is amber, not red. */
  .port.err::before {
    content: '';
    position: absolute;
    top: -2px;
    right: -2px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--warn);
    box-shadow: 0 0 0 1px var(--surface);
  }
</style>
