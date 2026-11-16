<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import { connectWs, panel } from '$lib/store.svelte';
  import { theme } from '$lib/theme.svelte';
  import { startBurnInGuard } from '$lib/burnInGuard';
  import { deriveAlerts, deriveEnergyAlerts } from '$lib/derive';
  import TopBar from '$lib/components/TopBar.svelte';
  import EnergyTopBar from '$lib/components/EnergyTopBar.svelte';
  import AlertStrip from '$lib/components/AlertStrip.svelte';
  import PageBar from '$lib/components/PageBar.svelte';
  import OverviewPage from '$lib/pages/OverviewPage.svelte';
  import InternetPage from '$lib/pages/InternetPage.svelte';
  import WiredPage from '$lib/pages/WiredPage.svelte';
  import WirelessPage from '$lib/pages/WirelessPage.svelte';
  import ClientsPage from '$lib/pages/ClientsPage.svelte';
  import TopologyPage from '$lib/pages/TopologyPage.svelte';
  import PowerPage from '$lib/pages/PowerPage.svelte';
  import EnergyNowPage from '$lib/pages/EnergyNowPage.svelte';
  import EnergyTodayPage from '$lib/pages/EnergyTodayPage.svelte';
  import EnergyHistoryPage from '$lib/pages/EnergyHistoryPage.svelte';
  import '../app.css';

  /** The kiosk shell: a persistent status bar, an exceptions strip that only
   *  appears when something needs attention, one rotating page, and a
   *  labeled page bar. Rotation order and dwell come from the URL
   *  (`?pages=overview,wired&dwell=30`, `?page=wired` pins one page) or from
   *  the server's PANEL_UI_* settings. */
  type PageDef = { id: string; label: string; component: Component<{ active?: boolean }>; available?: () => boolean };
  const NETWORK_PAGES: PageDef[] = [
    { id: 'overview', label: 'Overview', component: OverviewPage },
    { id: 'internet', label: 'Internet', component: InternetPage },
    { id: 'wired', label: 'Wired', component: WiredPage },
    { id: 'wireless', label: 'Wireless', component: WirelessPage },
    { id: 'clients', label: 'Clients', component: ClientsPage },
    { id: 'topology', label: 'Topology', component: TopologyPage },
    { id: 'power', label: 'Power', component: PowerPage, available: () => panel.features.upsAvailable },
  ];
  /** The home-power kiosk: same server, same shell, its own pages. The rack
   *  UPS page is shared (id 'power', so UPS alerts point at it here too). */
  const ENERGY_PAGES: PageDef[] = [
    { id: 'energy', label: 'Now', component: EnergyNowPage },
    { id: 'today', label: 'Today', component: EnergyTodayPage },
    { id: 'history', label: 'History', component: EnergyHistoryPage },
    { id: 'power', label: 'UPS', component: PowerPage, available: () => panel.features.upsAvailable },
  ];

  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  /** energy.808.org (any energy.* host) shows the home-power kiosk; ?view=
   *  overrides either way, which is also how to reach it in dev. */
  const view = params.get('view');
  const energyMode =
    view === 'energy' || (view !== 'network' && typeof window !== 'undefined' && window.location.hostname.startsWith('energy.'));
  const ALL_PAGES = energyMode ? ENERGY_PAGES : NETWORK_PAGES;
  /** `?page=x` pins one page (no rotation); `?start=x` just begins the normal
   *  rotation on that page. */
  const pinned = params.get('page');
  const startAt = params.get('start');
  const urlPages = params.get('pages')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
  const urlDwell = Number(params.get('dwell'));

  const pages = $derived.by(() => {
    // PANEL_UI_PAGES configures the network kiosk; the energy kiosk only
    // takes its rotation from the URL.
    const wanted = pinned ? [pinned] : (urlPages ?? (energyMode ? null : panel.ui.pages) ?? ALL_PAGES.map((p) => p.id));
    const list = wanted
      .map((id) => ALL_PAGES.find((p) => p.id === id))
      .filter((p): p is PageDef => !!p && (p.available?.() ?? true));
    return list.length > 0 ? list : [ALL_PAGES[0]!];
  });
  const dwellMs = $derived(Number.isFinite(urlDwell) && urlDwell > 0 ? urlDwell * 1000 : panel.ui.dwellMs);

  let index = $state(Math.max(0, ALL_PAGES.findIndex((p) => p.id === startAt)));
  let paused = $state(!!pinned);
  let enteredAt = $state(Date.now());
  let now = $state(Date.now());

  const current = $derived(pages[Math.min(index, pages.length - 1)] ?? pages[0]!);
  const progress = $derived(paused || pages.length < 2 ? 0 : Math.min(1, (now - enteredAt) / dwellMs));
  const alerts = $derived(
    energyMode
      ? deriveEnergyAlerts({ powerwall: panel.powerwall, ups: panel.ups, features: panel.features, connection: panel.connection, now })
      : deriveAlerts({
      wans: panel.wans,
      devices: panel.devices,
      clients: panel.clients,
      ups: panel.ups,
      udm: panel.udm,
      features: panel.features,
      connection: panel.connection,
    }),
  );
  const docTitle = $derived(energyMode ? `${panel.ui.energySiteName ?? 'Home'} energy` : `${panel.ui.siteName} network`);

  function go(delta: 1 | -1): void {
    index = (Math.min(index, pages.length - 1) + delta + pages.length) % pages.length;
    enteredAt = Date.now();
  }
  function jump(i: number): void {
    if (i < 0 || i >= pages.length) return;
    index = i;
    enteredAt = Date.now();
  }

  onMount(() => {
    const dispose = theme.init();
    const stop = connectWs();
    const stopGuard = startBurnInGuard();
    const timer = window.setInterval(() => {
      now = Date.now();
      if (!paused && pages.length > 1 && now - enteredAt >= dwellMs) go(1);
    }, 250);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.matches?.('input, textarea, [contenteditable]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      } else if (e.key === ' ' || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        paused = !paused;
        enteredAt = Date.now();
      } else if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        jump(Number.parseInt(e.key, 10) - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      dispose();
      stop();
      stopGuard();
      window.clearInterval(timer);
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

<svelte:head><title>{docTitle}</title></svelte:head>

<div class="panel-root shell">
  {#if energyMode}
    <EnergyTopBar {alerts} />
  {:else}
    <TopBar {alerts} />
  {/if}
  {#if alerts.length > 0}
    <AlertStrip {alerts} />
  {/if}
  <main class="stage">
    {#each ALL_PAGES as p (p.id)}
      {#if pages.some((x) => x.id === p.id)}
        {@const Page = p.component}
        <section class="page" class:active={current.id === p.id} aria-hidden={current.id !== p.id}>
          <Page active={current.id === p.id} />
        </section>
      {/if}
    {/each}
  </main>
  <PageBar pages={pages.map((p) => ({ id: p.id, label: p.label }))} activeId={current.id} {progress} {paused} onselect={jump} />
</div>

<style>
  .shell {
    height: 100%;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    gap: 0.75rem;
    padding-top: 0.5rem;
  }
  .shell > :global(.topbar) {
    grid-row: 1;
  }
  .shell > :global(.strip) {
    grid-row: 2;
  }
  .shell > .stage {
    grid-row: 3;
  }
  .shell > :global(.pagebar) {
    grid-row: 4;
  }
</style>
