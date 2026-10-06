import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { EventSeverity, PanelEvent } from './types.js';

const EVENTS_PATH = join(process.cwd(), 'data', 'events.json');
const MAX_EVENTS = 200;
const WRITE_DEBOUNCE_MS = 5_000;

/** Append-only log of noteworthy state changes, persisted to `data/` so a
 *  server restart doesn't blank the kiosk's "recent events" list. Writes are
 *  debounced; the log is small enough to rewrite whole. */
export class EventLog {
  private items: PanelEvent[] = [];
  private seq = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private path = EVENTS_PATH) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      if (Array.isArray(parsed)) {
        this.items = parsed.filter(isEvent).slice(-MAX_EVENTS);
      }
    } catch {
      // first run or unreadable file: start empty
    }
  }

  /** Newest first. */
  recent(limit = 50): PanelEvent[] {
    return this.items.slice(-limit).reverse();
  }

  push(input: { severity: EventSeverity; kind: string; subject: string; message: string; ts?: number }): PanelEvent {
    const ts = input.ts ?? Date.now();
    const ev: PanelEvent = {
      id: `${ts.toString(36)}-${(this.seq++).toString(36)}`,
      ts,
      severity: input.severity,
      kind: input.kind,
      subject: input.subject,
      message: input.message,
    };
    this.items.push(ev);
    this.items.sort((a, b) => a.ts - b.ts);
    if (this.items.length > MAX_EVENTS) this.items.splice(0, this.items.length - MAX_EVENTS);
    this.scheduleSave();
    return ev;
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, JSON.stringify(this.items));
      } catch (err) {
        console.error('[events] failed to persist event log:', err);
      }
    }, WRITE_DEBOUNCE_MS);
    // Don't keep the process alive just for a pending save.
    this.saveTimer.unref?.();
  }
}

function isEvent(v: unknown): v is PanelEvent {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.ts === 'number' &&
    typeof e.kind === 'string' &&
    typeof e.subject === 'string' &&
    typeof e.message === 'string' &&
    (e.severity === 'info' || e.severity === 'warn' || e.severity === 'crit')
  );
}
