<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import { connectWs, panel } from '$lib/store.svelte';
  import { theme } from '$lib/theme.svelte';
  import { startBurnInGuard } from '$lib/burnInGuard';
  import { deriveAlerts } from '$lib/derive';
  import TopBar from '$lib/components/TopBar.svelte';
  import AlertStrip from '$lib/components/AlertStrip.svelte';
  import PageBar from '$lib/components/PageBar.svelte';
  import OverviewPage from '$lib/pages/OverviewPage.svelte';
  import InternetPage from '$lib/pages/InternetPage.svelte';
  import WiredPage from '$lib/pages/WiredPage.svelte';
  import WirelessPage from '$lib/pages/WirelessPage.svelte';
  import ClientsPage from '$lib/pages/ClientsPage.svelte';
  import TopologyPage from '$lib/pages/TopologyPage.svelte';
  import PowerPage from '$lib/pages/PowerPage.svelte';
  import '../app.css';

  /** The kiosk shell: a persistent status bar, an exceptions strip that only
   *  appears when something needs attention, one rotating page, and a
   *  labeled page bar. Rotation order and dwell come from the URL
   *  (`?pages=overview,wired&dwell=30`, `?page=wired` pins one page) or from
   *  the server's PANEL_UI_* settings. */
  type PageDef = { id: string; label: string; component: Component<{ active?: boolean }>; available?: () => boolean };
  const ALL_PAGES: PageDef[] = [
    { id: 'overview', label: 'Overview', component: OverviewPage },
    { id: 'internet', label: 'Internet', component: InternetPage },
    { id: 'wired', label: 'Wired', component: WiredPage },
    { id: 'wireless', label: 'Wireless', component: WirelessPage },
    { id: 'clients', label: 'Clients', component: ClientsPage },
    { id: 'topology', label: 'Topology', component: TopologyPage },
    { id: 'power', label: 'Power', component: PowerPage, available: () => panel.features.upsAvailable },
  ];

  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const pinned = params.get('page');
  const urlPages = params.get('pages')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
  const urlDwell = Number(params.get('dwell'));

  const pages = $derived.by(() => {
    const wanted = pinned ? [pinned] : (urlPages ?? panel.ui.pages ?? ALL_PAGES.map((p) => p.id));
    const list = wanted
      .map((id) => ALL_PAGES.find((p) => p.id === id))
      .filter((p): p is PageDef => !!p && (p.available?.() ?? true));
    return list.length > 0 ? list : [ALL_PAGES[0]!];
  });
  const dwellMs = $derived(Number.isFinite(urlDwell) && urlDwell > 0 ? urlDwell * 1000 : panel.ui.dwellMs);

  let index = $state(0);
  let paused = $state(!!pinned);
  let enteredAt = $state(Date.now());
  let now = $state(Date.now());

  const current = $derived(pages[Math.min(index, pages.length - 1)] ?? pages[0]!);
  const progress = $derived(paused || pages.length < 2 ? 0 : Math.min(1, (now - enteredAt) / dwellMs));
  const alerts = $derived(
    deriveAlerts({
      wans: panel.wans,
      devices: panel.devices,
      clients: panel.clients,
      ups: panel.ups,
      udm: panel.udm,
      features: panel.features,
      connection: panel.connection,
    }),
  );

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

<div class="panel-root shell">
  <TopBar {alerts} />
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
