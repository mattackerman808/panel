<script lang="ts">
  import { theme, THEME_LABELS } from '$lib/theme.svelte';

  /** Labeled page tabs with a dwell progress line under the active one, plus
   *  the keyboard legend. Replaces anonymous dots: the viewer always knows
   *  what they are looking at and what comes next. */
  type PageTab = { id: string; label: string };
  type Props = { pages: PageTab[]; activeId: string; progress: number; paused: boolean; onselect: (index: number) => void };
  let { pages, activeId, progress, paused, onselect }: Props = $props();
</script>

<nav class="pagebar" aria-label="Pages">
  <ol class="tabs">
    {#each pages as p, i (p.id)}
      <li>
        <button type="button" class="tab" class:active={p.id === activeId} onclick={() => onselect(i)}>
          <span class="n mono">{i + 1}</span>
          <span class="label">{p.label}</span>
          <span class="track"><span class="fill" style="width: {p.id === activeId ? progress * 100 : 0}%"></span></span>
        </button>
      </li>
    {/each}
  </ol>
  <div class="legend">
    {#if paused}<span class="pill warn">Paused</span>{/if}
    <span><kbd>←</kbd><kbd>→</kbd> page</span>
    <span><kbd>space</kbd> {paused ? 'resume' : 'pause'}</span>
    <span><kbd>1</kbd>–<kbd>{pages.length}</kbd> jump</span>
    <span><kbd>t</kbd> theme · {THEME_LABELS[theme.current]}</span>
  </div>
</nav>

<style>
  .pagebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0 1.25rem 0.75rem;
  }
  .tabs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: 0.4rem;
  }
  .tab {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.35rem;
    padding: 0.35rem 0.8rem 0.3rem;
    border-radius: 6px;
    cursor: pointer;
    min-width: 6.5rem;
  }
  .tab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .tab .label {
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .tab .n {
    font-size: 0.66rem;
    color: var(--ink-3);
  }
  .tab.active {
    color: var(--ink);
    background: var(--surface);
  }
  .tab.active .n {
    color: var(--accent);
  }
  .track {
    display: block;
    width: 100%;
    height: 2px;
    border-radius: 2px;
    background: var(--line-strong);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 250ms linear;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 1.1rem;
    font-size: 0.72rem;
    color: var(--ink-3);
    white-space: nowrap;
  }
  kbd {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: 0.66rem;
    line-height: 1;
    padding: 0.18rem 0.35rem;
    margin-right: 0.25rem;
    border: 1px solid var(--line-strong);
    border-radius: 3px;
    color: var(--ink-2);
    background: var(--surface);
  }
  @media (prefers-reduced-motion: reduce) {
    .fill {
      transition: none;
    }
  }
</style>
