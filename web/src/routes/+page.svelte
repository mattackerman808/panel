<script lang="ts">
  import { onMount } from 'svelte';
  import { connectWs, panel } from '$lib/store.svelte';
  import { theme } from '$lib/theme.svelte';
  import { startBurnInGuard } from '$lib/burnInGuard';
  import HudHeader from '$lib/components/HudHeader.svelte';
  import HotkeyBar from '$lib/components/HotkeyBar.svelte';
  import HudFrame from '$lib/components/HudFrame.svelte';
  import BandwidthChart from '$lib/components/BandwidthChart.svelte';
  import ClientsPanel from '$lib/components/ClientsPanel.svelte';
  import DpiPanel from '$lib/components/DpiPanel.svelte';
  import UdmStats from '$lib/components/UdmStats.svelte';
  import ThemeIndicator from '$lib/components/ThemeIndicator.svelte';
  import AccessPointsPanel from '$lib/components/AccessPointsPanel.svelte';
  import SwitchesPanel from '$lib/components/SwitchesPanel.svelte';
  import RadiosPanel from '$lib/components/RadiosPanel.svelte';
  import TopologyPanel from '$lib/components/TopologyPanel.svelte';
  import TopTalkersTotalPanel from '$lib/components/TopTalkersTotalPanel.svelte';
  import SwitchDetailPanel from '$lib/components/SwitchDetailPanel.svelte';
  import WanStatusCard from '$lib/components/WanStatusCard.svelte';
  import UpsPanel from '$lib/components/UpsPanel.svelte';
  import '../app.css';

  const PAGE_COUNT = 6;
  const AUTO_CYCLE_MS = 30_000;
  let currentPage = $state(0);
  let paused = $state(false);

  function go(delta: 1 | -1): void {
    currentPage = (currentPage + delta + PAGE_COUNT) % PAGE_COUNT;
  }

  onMount(() => {
    const dispose = theme.init();
    const stop = connectWs();
    const stopGuard = startBurnInGuard();
    const cycleTimer = window.setInterval(() => {
      if (!paused) go(1);
    }, AUTO_CYCLE_MS);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.matches?.('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      } else if (e.key === ' ' || e.key === 'p' || e.key === 'P') {
        // Space (or P) toggles the auto-cycle. Manual ←/→ still work while paused.
        e.preventDefault();
        paused = !paused;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      dispose();
      stop();
      stopGuard();
      window.clearInterval(cycleTimer);
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="panel-root relative flex h-screen w-screen flex-col">
  <HudHeader />
  <HotkeyBar {paused} />

  <div class="page-viewport min-h-0 flex-1 overflow-hidden">
    <div class="page-stage">
      <!-- ============= PAGE 1: Network (WAN traffic + per-WAN status) ============= -->
      <section class="page" class:active={currentPage === 0}>
        <main class="grid h-full min-h-0 gap-4 p-4" style="grid-template-columns: 2fr 1fr 1fr; grid-template-rows: 1.1fr 1fr;">
          <div style="grid-column: 1 / 3" class="min-h-0 min-w-0">
            <HudFrame label="WAN THROUGHPUT" accent="primary">
              {#snippet actions()}
                <span>WINDOW · 90s</span>
              {/snippet}
              {#snippet children()}
                <div class="flex h-full flex-col gap-3">
                  {#each panel.wans as wan (wan.id)}
                    <div class="min-h-0 flex-1">
                      <BandwidthChart wanId={wan.id} />
                    </div>
                    {#if wan.id !== panel.wans[panel.wans.length - 1]?.id}
                      <div class="border-t border-[var(--c-line)]"></div>
                    {/if}
                  {/each}
                  {#if panel.wans.length === 0}
                    <div class="grid h-full place-items-center text-[11px] uppercase tracking-widest text-[var(--c-text-dim)]">
                      Awaiting WAN data…
                    </div>
                  {/if}
                </div>
              {/snippet}
            </HudFrame>
          </div>

          <HudFrame label="GATEWAY · UDM PRO MAX" accent="secondary">
            {#snippet children()}
              <UdmStats />
            {/snippet}
          </HudFrame>

          <!-- Bottom row spans the full width and lays out one card per WAN. -->
          <div class="min-h-0 min-w-0 grid gap-4" style="grid-column: 1 / 4; grid-template-columns: repeat({Math.max(1, panel.wans.length)}, 1fr);">
            {#each panel.wans as wan (wan.id)}
              <HudFrame label={wan.label.toUpperCase()} accent="primary">
                {#snippet actions()}
                  {@const h = panel.health.find((x) => x.name === wan.id) ?? panel.health.find((x) => x.name === 'wan') ?? null}
                  <span>
                    {(h?.status ?? wan.status).toUpperCase()}
                    {#if h?.latencyMs != null} · {h.latencyMs}ms{/if}
                  </span>
                {/snippet}
                {#snippet children()}
                  <WanStatusCard wanId={wan.id} />
                {/snippet}
              </HudFrame>
            {/each}
          </div>
        </main>
      </section>

      <!-- ============= PAGE 2: Clients ============= -->
      <section class="page" class:active={currentPage === 1}>
        <main class="grid h-full min-h-0 gap-4 p-4" style="grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;">
          <HudFrame label="TOP CONSUMERS" accent="primary">
            {#snippet actions()}
              <span>BY THROUGHPUT</span>
            {/snippet}
            {#snippet children()}
              <ClientsPanel />
            {/snippet}
          </HudFrame>

          <HudFrame label="TOP TALKERS · SESSION" accent="primary">
            {#snippet actions()}
              <span>{panel.clients.length} CLIENTS</span>
            {/snippet}
            {#snippet children()}
              <TopTalkersTotalPanel />
            {/snippet}
          </HudFrame>

          <HudFrame label="TOP APPLICATIONS" accent="primary">
            {#snippet children()}
              <DpiPanel source="apps" />
            {/snippet}
          </HudFrame>

          <HudFrame label="TOP CATEGORIES" accent="primary">
            {#snippet children()}
              <DpiPanel source="categories" />
            {/snippet}
          </HudFrame>
        </main>
      </section>

      <!-- ============= PAGE 3: Layer 2 ============= -->
      <section class="page" class:active={currentPage === 2}>
        <main class="grid h-full min-h-0 gap-4 p-4" style="grid-template-columns: 1fr 1fr; grid-template-rows: 1.2fr 1fr;">
          <HudFrame label="ACCESS POINTS" accent="primary">
            {#snippet actions()}
              <span>{panel.devices.filter((d) => d.type === 'uap').length} APs</span>
            {/snippet}
            {#snippet children()}
              <AccessPointsPanel />
            {/snippet}
          </HudFrame>

          <HudFrame label="SWITCHES" accent="primary">
            {#snippet actions()}
              <span>{panel.devices.filter((d) => d.type === 'usw').length} switches</span>
            {/snippet}
            {#snippet children()}
              <SwitchesPanel />
            {/snippet}
          </HudFrame>

          <div style="grid-column: 1 / 3" class="min-h-0 min-w-0">
            <HudFrame label="WIFI RADIOS" accent="primary">
              {#snippet actions()}
                <span>UTILIZATION · RETRY</span>
              {/snippet}
              {#snippet children()}
                <RadiosPanel />
              {/snippet}
            </HudFrame>
          </div>
        </main>
      </section>

      <!-- ============= PAGE 4: Switch Detail (carousel) ============= -->
      <section class="page" class:active={currentPage === 3}>
        <main class="grid h-full min-h-0 gap-4 p-4" style="grid-template-columns: 1fr; grid-template-rows: 1fr;">
          <HudFrame label="SWITCH DETAIL" accent="primary">
            {#snippet actions()}
              {@const sws = panel.devices.filter((d) => d.type === 'usw').length}
              {@const groups = Math.max(1, Math.ceil(sws / 8))}
              <span>{sws} SWITCHES · {groups > 1 ? `${groups} GROUPS · 12s` : 'SINGLE PAGE'}</span>
            {/snippet}
            {#snippet children()}
              <SwitchDetailPanel />
            {/snippet}
          </HudFrame>
        </main>
      </section>

      <!-- ============= PAGE 5: Topology ============= -->
      <section class="page" class:active={currentPage === 4}>
        <main class="grid h-full min-h-0 gap-4 p-4" style="grid-template-columns: 1fr; grid-template-rows: 1fr;">
          <HudFrame label="TOPOLOGY · LLDP" accent="primary">
            {#snippet actions()}
              {@const linked = panel.devices.filter((d) => d.uplink || d.ports.some((p) => p.neighbor)).length}
              <span>{linked}/{panel.devices.length} LINKED</span>
            {/snippet}
            {#snippet children()}
              <TopologyPanel />
            {/snippet}
          </HudFrame>
        </main>
      </section>

      <!-- ============= PAGE 6: Power (UPS) ============= -->
      <section class="page" class:active={currentPage === 5}>
        <main class="grid h-full min-h-0 gap-4 p-4" style="grid-template-columns: 1fr; grid-template-rows: 1fr;">
          <HudFrame label="POWER · UPS" accent="secondary">
            {#snippet actions()}
              {@const u = panel.ups}
              <span>
                {#if !panel.features.upsAvailable}NOT CONFIGURED
                {:else if u?.reachable}{u.onBattery ? 'ON BATTERY' : 'ON MAINS'}{#if u.loadPct != null} · {u.loadPct.toFixed(0)}% LOAD{/if}
                {:else}UNREACHABLE{/if}
              </span>
            {/snippet}
            {#snippet children()}
              <UpsPanel />
            {/snippet}
          </HudFrame>
        </main>
      </section>
    </div>
  </div>

  <div class="page-dots">
    {#each Array(PAGE_COUNT) as _, i}
      <span class="dot" class:active={currentPage === i}></span>
    {/each}
  </div>
</div>

<div class="hud-scanlines"></div>
<div class="hud-noise"></div>

<ThemeIndicator />

<style>
  .page-viewport {
    position: relative;
  }
  .page-stage {
    position: relative;
    height: 100%;
    width: 100%;
  }
  .page {
    position: absolute;
    inset: 0;
    opacity: 0;
    pointer-events: none;
    transition: opacity 600ms ease;
    will-change: opacity;
  }
  .page.active {
    opacity: 1;
    pointer-events: auto;
  }
  .page-dots {
    display: flex;
    justify-content: center;
    gap: 8px;
    padding: 6px 0 8px;
  }
  .dot {
    width: 6px;
    height: 6px;
    background: var(--c-line-bright);
    border-radius: 1px;
    transition: background 0.4s, box-shadow 0.4s, width 0.4s;
  }
  .dot.active {
    width: 22px;
    background: var(--c-primary);
    box-shadow: 0 0 calc(6px * var(--glow-mult)) var(--c-primary);
  }
</style>
