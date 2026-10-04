/**
 * The protocol halves of the MOO editor, kept free of the UI so they can be tested on their own:
 *
 *  - MCP simpleedit (`dns-org-mud-moo-simpleedit` 1.0): the game sends `-content { reference, name, type, content }`;
 *    Save answers `-set { reference, type, content }`, the content a line each (`string` is one line).
 *  - LambdaCore local edit (`#$# edit name: … upload: …`, the backend's `legacy-edit { name, upload, content }`):
 *    Save sends the upload command, the text dot-stuffed, then `.`.
 */
import type { McpArgs } from '@muclient/sdk';

export type EditLanguage = 'moo-code' | 'text';

/** An MCP argument as one string (a multiline value is joined with `sep`). */
export const one = (v: McpArgs[string] | undefined, sep = '\n'): string => (Array.isArray(v) ? v.join(sep) : v ?? '');
/** An MCP argument as lines. */
export const lines = (v: McpArgs[string] | undefined): string[] => (Array.isArray(v) ? [...v] : one(v).split('\n'));

/** FNV-1a, base 36: a short stable hash for the idempotency keys (the same save on two devices sends once). */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const normal = (text: string) => text.replace(/\r\n?/g, '\n');

/** simpleedit `type` → the editor's language. */
export const simpleeditLanguage = (type: string): EditLanguage => (type === 'moo-code' ? 'moo-code' : 'text');

/** The `content` of a simpleedit `-set`: `string` is one line, `string-list` and `moo-code` a line each. */
export function simpleeditContent(type: string, text: string): string[] {
  return type === 'string' ? [normal(text).replace(/\n/g, ' ')] : normal(text).split('\n');
}

/** A local edit's language: a verb (`#4:look`, `@program …`) is MOO code, anything else text. */
export const localEditLanguage = (name: string, upload: string): EditLanguage => (/:/.test(name) || /^@program\b/i.test(upload) ? 'moo-code' : 'text');

/**
 * What a local-edit Save sends: the upload command, the lines, then `.` alone. `.` alone would end the upload and
 * LambdaCore's read_lines strips one leading `.`, so every line starting with `.` gets another.
 */
export function uploadText(upload: string, text: string): string {
  return [upload, ...normal(text).split('\n').map((l) => (l.startsWith('.') ? `.${l}` : l)), '.'].join('\n');
}

// ─── the editor's helpers ─────────────────────────────────────────────────────

/** One run of a previewed line: its text and the terminal's palette classes (`c-001`, `bg-004`, `b`, `i`, `u`). */
export interface Run { text: string; cls: string }

const pad = (n: number) => String(n).padStart(3, '0');
/**
 * ANSI SGR → runs, for the preview of a description with colour codes. Covers what MOO text uses: reset, bold, dim,
 * italic, underline, inverse, the 16 colours, 256-colour (`38;5;n` / `48;5;n`); anything else is dropped. The
 * classes are the host terminal's (`.mu-ansi` palette), so the preview follows the player's theme.
 */
export function ansiRuns(line: string): Run[] {
  const out: Run[] = [];
  let fg: number | null = null, bg: number | null = null, b = false, dim = false, it = false, u = false, inv = false;
  const cls = () => {
    let f = fg, k = bg;
    if (inv) [f, k] = [k ?? 7, f ?? 0];
    const c: string[] = [];
    if (f !== null) c.push(`c-${pad(b && f < 8 ? f + 8 : f)}`);
    if (k !== null) c.push(`bg-${pad(k)}`);
    if (b) c.push('b'); if (dim) c.push('dim'); if (it) c.push('i'); if (u) c.push('u');
    return c.join(' ');
  };
  const re = /\x1b\[([0-9;]*)m/g;
  let at = 0, m: RegExpExecArray | null;
  const push = (text: string) => { if (!text) return; const c = cls(); const last = out[out.length - 1]; if (last && last.cls === c) last.text += text; else out.push({ text, cls: c }); };
  while ((m = re.exec(line))) {
    push(line.slice(at, m.index).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''));
    at = re.lastIndex;
    const ps = m[1] === '' ? [0] : m[1].split(';').map((x) => Number(x) || 0);
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p === 0) { fg = bg = null; b = dim = it = u = inv = false; }
      else if (p === 1) b = true; else if (p === 2) dim = true; else if (p === 3) it = true; else if (p === 4) u = true; else if (p === 7) inv = true;
      else if (p === 22) b = dim = false; else if (p === 23) it = false; else if (p === 24) u = false; else if (p === 27) inv = false;
      else if (p >= 30 && p <= 37) fg = p - 30; else if (p === 39) fg = null;
      else if (p >= 40 && p <= 47) bg = p - 40; else if (p === 49) bg = null;
      else if (p >= 90 && p <= 97) fg = p - 90 + 8; else if (p >= 100 && p <= 107) bg = p - 100 + 8;
      else if ((p === 38 || p === 48) && ps[i + 1] === 5 && ps[i + 2] !== undefined) { const n = Math.max(0, Math.min(255, ps[i + 2])); if (p === 38) fg = n; else bg = n; i += 2; }
    }
  }
  push(line.slice(at).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''));
  return out;
}
