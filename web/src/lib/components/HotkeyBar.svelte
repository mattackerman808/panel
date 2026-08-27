<script lang="ts">
  // Slim always-visible legend of the interactive controls, shown directly
  // under the header. All handled in +page.svelte and theme.svelte.ts.
  let { paused = false }: { paused?: boolean } = $props();
</script>

<div class="hotkey-bar" class:paused>
  <span class="hk"><kbd>←</kbd><span class="lbl">BACK</span></span>
  <span class="hk"><kbd class:live={!paused}>SPACE</kbd><span class="lbl">{paused ? 'RESUME' : 'PAUSE'}</span></span>
  <span class="hk"><span class="lbl">FWD</span><kbd>→</kbd></span>
  <span class="sep">·</span>
  <span class="hk"><kbd>T</kbd><span class="lbl">THEME</span></span>

  {#if paused}
    <span class="status">❚❚ PAUSED</span>
  {/if}
</div>

<style>
  .hotkey-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 3px 12px;
    border-bottom: 1px solid var(--c-line);
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--c-text-dim);
  }
  .hk {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .lbl {
    color: var(--c-text-dim);
  }
  kbd {
    font-family: var(--font-mono);
    font-size: 9px;
    line-height: 1;
    padding: 2px 5px;
    border: 1px solid var(--c-line-bright);
    border-radius: 3px;
    color: var(--c-text);
    background: color-mix(in oklab, var(--c-bg-panel) 70%, transparent);
  }
  kbd.live {
    color: var(--c-primary);
    border-color: color-mix(in oklab, var(--c-primary) 55%, var(--c-line-bright));
  }
  .sep {
    color: var(--c-line-bright);
  }
  .status {
    color: var(--c-warn);
    letter-spacing: 0.2em;
    text-shadow: 0 0 calc(6px * var(--glow-mult)) color-mix(in oklab, var(--c-warn) 40%, transparent);
  }
</style>
