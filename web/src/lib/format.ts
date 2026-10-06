/** Formatting helpers. Rates arrive from the server in BYTES per second and
 *  are shown in bits per second, which is what network people expect. */

export type Formatted = { value: string; unit: string };

export function formatBps(bytesPerSec: number): Formatted {
  const bits = Math.max(0, bytesPerSec) * 8;
  if (bits >= 1e9) return { value: (bits / 1e9).toFixed(bits >= 10e9 ? 1 : 2), unit: 'Gbps' };
  if (bits >= 1e6) return { value: (bits / 1e6).toFixed(bits >= 100e6 ? 0 : 1), unit: 'Mbps' };
  if (bits >= 1e3) return { value: (bits / 1e3).toFixed(0), unit: 'Kbps' };
  return { value: bits.toFixed(0), unit: 'bps' };
}

/** Compact rate string, e.g. "1.2 Gbps". */
export function bps(bytesPerSec: number): string {
  const f = formatBps(bytesPerSec);
  return `${f.value} ${f.unit}`;
}

export function formatBytes(bytes: number): Formatted {
  const b = Math.max(0, bytes);
  if (b >= 1e12) return { value: (b / 1e12).toFixed(2), unit: 'TB' };
  if (b >= 1e9) return { value: (b / 1e9).toFixed(b >= 100e9 ? 0 : 1), unit: 'GB' };
  if (b >= 1e6) return { value: (b / 1e6).toFixed(b >= 100e6 ? 0 : 1), unit: 'MB' };
  if (b >= 1e3) return { value: (b / 1e3).toFixed(0), unit: 'KB' };
  return { value: b.toFixed(0), unit: 'B' };
}

export function bytes(n: number): string {
  const f = formatBytes(n);
  return `${f.value} ${f.unit}`;
}

/** Link speed in Mbps → "1G", "2.5G", "10G", "100M". */
export function speedLabel(mbps: number | null | undefined): string {
  if (!mbps || mbps <= 0) return '—';
  if (mbps >= 1000) return `${Number.isInteger(mbps / 1000) ? mbps / 1000 : (mbps / 1000).toFixed(1)}G`;
  return `${mbps}M`;
}

export function formatUptime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export function formatClock(d: Date, seconds = true): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}${seconds ? `:${pad2(d.getSeconds())}` : ''}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatDate(d: Date): string {
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "2026-10" → "October 2026". */
export function monthName(label: string): string {
  const [y, m] = label.split('-');
  const idx = Number.parseInt(m ?? '0', 10) - 1;
  const full = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return idx >= 0 && idx < 12 ? `${full[idx]} ${y}` : label;
}

/** Relative age for event lists: "just now", "4m ago", "3h ago", "2d ago". */
export function relativeTime(tsMs: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - tsMs) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Age from a unix-seconds timestamp ("6h ago", "never"). */
export function ageFromUnix(ts: number | null | undefined): string {
  if (!ts) return 'never';
  return relativeTime(ts * 1000);
}

/** Compact count: 1284 → "1.3k", 190990 → "191k", 2.4e6 → "2.4M". */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 10e6 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 10e3 ? 0 : 1)}k`;
  return String(Math.round(n));
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}%`;
}

export function num(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

/** Strip the site domain from a hostname for compact labels. */
export function shortName(name: string): string {
  return name.replace(/\.[a-z0-9-]+\.[a-z]{2,}$/i, '');
}
