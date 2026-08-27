<script lang="ts">
  import { panel } from '$lib/store.svelte';
  import { formatUptime } from '$lib/format';
  import StatTile from './StatTile.svelte';

  const ups = $derived(panel.ups);
  const configured = $derived(panel.features.upsAvailable);
  const live = $derived(!!ups && ups.reachable);

  type Accent = 'primary' | 'secondary' | 'ok' | 'warn' | 'err';

  // On battery is the headline alarm state; a degraded battery matters even
  // on mains. Everything else is nominal.
  const onBattery = $derived(!!ups?.onBattery);
  const batteryDegraded = $derived(ups?.batteryStatus === 'low' || ups?.batteryStatus === 'depleted');

  const sourceLabel = $derived.by(() => {
    if (!ups) return '—';
    if (onBattery) return 'ON BATTERY';
    switch (ups.outputSource) {
      case 'normal':
        return 'ON MAINS';
      case 'bypass':
        return 'BYPASS';
      case 'booster':
        return 'BOOST';
      case 'reducer':
        return 'TRIM';
      case 'none':
        return 'OUTPUT OFF';
      default:
        return ups.outputSource.toUpperCase();
    }
  });
  const sourceAccent: Accent = $derived(onBattery ? 'warn' : batteryDegraded ? 'warn' : 'ok');

  const chargeAccent: Accent = $derived(
    (ups?.chargePct ?? 100) < 20 ? 'err' : (ups?.chargePct ?? 100) < 50 ? 'warn' : 'ok',
  );
  const loadAccent: Accent = $derived(
    (ups?.loadPct ?? 0) > 90 ? 'err' : (ups?.loadPct ?? 0) > 75 ? 'warn' : 'primary',
  );

  function n(v: number | null | undefined, digits = 0): string {
    return v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits);
  }
  const runtime = $derived(
    ups?.minutesRemaining != null ? formatUptime(ups.minutesRemaining * 60) : '—',
  );
  const identity = $derived(
    [ups?.manufacturer, ups?.model].filter(Boolean).join(' · ') || 'UNIDENTIFIED UPS',
  );
</script>

{#if !configured}
  <div class="grid h-full place-items-center text-[11px] uppercase tracking-widest text-[var(--c-text-dim)]">
    UPS monitoring not configured
  </div>
{:else if !live}
  <div class="grid h-full place-items-center text-center text-[11px] uppercase tracking-widest text-[var(--c-warn)]">
    UPS unreachable — check SNMP host / community
  </div>
{:else if ups}
  <div class="flex h-full flex-col gap-3">
    <!-- Headline: power source + identity -->
    <div
      class="ups-banner flex items-center justify-between gap-3 px-4 py-3"
      style="border-color: var(--c-{sourceAccent});"
    >
      <div class="flex items-baseline gap-3">
        <span
          class="font-display text-[26px] font-semibold leading-none"
          style="color: var(--c-{sourceAccent}); text-shadow: 0 0 calc(14px * var(--glow-mult)) color-mix(in oklab, var(--c-{sourceAccent}) 60%, transparent);"
        >
          {sourceLabel}
        </span>
        <span class="text-[10px] uppercase tracking-[0.3em] text-[var(--c-text-dim)]">{identity}</span>
      </div>
      <div class="text-right text-[10px] uppercase tracking-widest text-[var(--c-text-dim)]">
        BATTERY · {ups.batteryStatus.toUpperCase()}
        {#if onBattery && ups.secondsOnBattery != null}
          <div class="text-[var(--c-warn)]">{formatUptime(ups.secondsOnBattery)} ELAPSED</div>
        {/if}
      </div>
    </div>

    <!-- Measurement grid -->
    <div class="grid min-h-0 flex-1 grid-cols-4 gap-3">
      <StatTile label="LOAD" value={n(ups.loadPct)} unit="%" accent={loadAccent} progress={ups.loadPct} />
      <StatTile label="OUTPUT POWER" value={n(ups.outputPowerW)} unit="W" accent="secondary" />
      <StatTile label="BATTERY" value={n(ups.chargePct)} unit="%" accent={chargeAccent} progress={ups.chargePct} />
      <StatTile label="RUNTIME" value={runtime} accent={chargeAccent} />

      <StatTile label="INPUT" value={n(ups.inputVoltage)} unit="V" accent="primary" sub="{n(ups.inputFrequencyHz, 1)} Hz" />
      <StatTile label="OUTPUT" value={n(ups.outputVoltage)} unit="V" accent="primary" sub="{n(ups.outputFrequencyHz, 1)} Hz" />
      <StatTile label="OUTPUT CURRENT" value={n(ups.outputCurrentA, 1)} unit="A" accent="primary" />
      <StatTile
        label="BATTERY"
        value={n(ups.batteryVoltage, 1)}
        unit="V"
        accent="primary"
        sub={ups.batteryTempC != null ? `${n(ups.batteryTempC)}°C` : ''}
      />
    </div>
  </div>
{/if}

<style>
  .ups-banner {
    border: 1px solid;
    background: linear-gradient(180deg, rgba(13, 22, 34, 0.6), rgba(10, 16, 24, 0.6));
    clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%);
  }
  :global([data-theme='mission-control']) .ups-banner,
  :global([data-theme='matrix']) .ups-banner {
    clip-path: none;
  }
</style>
