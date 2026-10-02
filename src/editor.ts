/**
 * The MOO editor's UI, the lazy module `dist/editor.js` (`muclient.modules`, loaded with `mu.modules.load` the first
 * time an editor opens, so CodeMirror stays out of the entry). Plain DOM inside the host modal (`mu.ui.modal`):
 *
 *   toolbar   session · [ PROSE | CODE ] · [ EDIT | PREVIEW | DIFF ] · snippets
 *   pane      CodeMirror (MOO language + linter in code mode; wrapping prose mode), the ANSI preview, or the diff
 *   footer    "Saving runs: <command>" (local edit) · error · diff stats · CANCEL · REVIEW → SAVE TO GAME
 *
 * The host owns the editor's state (`EditorSession`): the draft goes to `setDraft` (it follows the player to their
 * other devices), new server text shows as "The game sent new text" with Take it, and Save is `session.save`, which
 * resolves `'ask'` when the upload command needs the player's yes (asked here, then `save(text, { run: true })`).
 * Colours are theme tokens only (./theme.ts, the stylesheet below).
 */
import { h, type EditorSession, type Mu } from '@muclient/sdk';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { moocode } from './moocode';
import { tokenTheme } from './theme';
import { ansiRuns, diffStats, lineDiff, SNIPPETS } from './protocol';

export type Mode = 'code' | 'prose';
type View = 'edit' | 'preview' | 'diff';
export interface EditorOpts { lint: boolean; mode: Mode | 'auto' }
export interface Mounted {
  dispose(): void;
  /** The player is closing the modal: true to let it close; false while there are unsaved edits (asks inline). */
  requestClose(): boolean;
  /** The CodeMirror view (tests). */
  readonly view: EditorView;
}
export interface EditorModule { mountEditor(el: HTMLElement, s: EditorSession, mu: Mu, opts: EditorOpts): Mounted }

const CSS = `
.mooed:focus { outline: none; }
.mooed { display: flex; flex-direction: column; height: min(62vh, 36rem); margin: -.4rem -1rem -.8rem; background: var(--bg); }
.mooed .bar { display: flex; align-items: center; gap: .8ch; flex-wrap: wrap; padding: 4px .85rem; background: var(--bg-elev); border-bottom: 1px solid var(--border); }
.mooed .sess { font-size: .66rem; letter-spacing: .16em; text-transform: uppercase; color: var(--gold); margin-right: .6ch; }
.mooed .lbl { font-size: .66rem; letter-spacing: .16em; text-transform: uppercase; color: var(--fg-faint); }
.mooed .seg { display: inline-flex; gap: 2px; }
.mooed .sp { flex: 1; }
.mooed .pane { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.mooed .cm { flex: 1; min-height: 0; overflow: hidden; }
.mooed .cm .cm-editor { height: 100%; }
.mooed .preview, .mooed .diff { flex: 1; overflow: auto; padding: .6rem .85rem; font-family: var(--font-mono); font-size: .82rem; white-space: pre-wrap; }
.mooed .pl { min-height: 1.5em; }
.mooed .diff { padding: 4px 0; white-space: pre; font-size: .78rem; }
.mooed .dl { display: flex; line-height: 1.5; }
.mooed .dl .g { width: 3em; flex: none; text-align: right; padding-right: 6px; color: var(--fg-faint); background: var(--bg-elev); border-right: 1px solid var(--border); }
.mooed .dl .op { width: 1.6em; flex: none; text-align: center; color: var(--fg-faint); }
.mooed .dl.add { background: color-mix(in srgb, var(--ok) 14%, transparent); }
.mooed .dl.add .op, .mooed .dl.add .t { color: var(--ok); }
.mooed .dl.del { background: color-mix(in srgb, var(--alert) 14%, transparent); }
.mooed .dl.del .op, .mooed .dl.del .t { color: var(--alert); }
.mooed .empty { margin: 0; color: var(--fg-faint); font-size: .76rem; padding: .3rem .85rem; }
.mooed .note { margin: 0; padding: 4px .85rem; font-size: .72rem; color: var(--gold); background: var(--bg-elev); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 1ch; flex-wrap: wrap; }
.mooed .note.warn { color: var(--alert); border-color: var(--alert); }
.mooed .note code { font-family: var(--font-mono); color: var(--gold); word-break: break-all; white-space: pre-wrap; }
.mooed .foot { display: flex; align-items: center; gap: 8px; padding: 8px .85rem; border-top: 1px solid var(--border); background: var(--bg-elev); flex-wrap: wrap; }
.mooed .runs { display: inline-flex; align-items: baseline; gap: .8ch; min-width: 0; }
.mooed .runs code { font-family: var(--font-mono); font-size: .72rem; color: var(--gold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mooed .stat { font-size: .72rem; color: var(--fg-dim); }
.mooed .err { font-size: .72rem; color: var(--alert); min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 520px) { .mooed { height: min(70vh, 36rem); } .mooed .sess { flex-basis: 100%; } .mooed .runs, .mooed .err { flex-basis: 100%; } }
`;

let styled = 0;
let unstyle: (() => void) | null = null;

export function mountEditor(el: HTMLElement, s: EditorSession, mu: Mu, opts: EditorOpts): Mounted {
  const c = mu.ui.css;
  if (styled++ === 0) unstyle = mu.ui.style(CSS);

  let mode: Mode = opts.mode !== 'auto' ? opts.mode : s.language === 'moo-code' ? 'code' : 'prose';
  let view: View = 'edit';
  let saving = false;
  let asking = false;
  let discarding = false;
  let err: string | null = null;
  /** The last text this editor reported as the draft: a draft change that is not it came from another device. */
  let mine = s.draft;

  const sess = mu.sessions.list().find((x) => x.id === s.sid);
  const sessName = sess ? [sess.worldName, sess.character].filter(Boolean).join(' · ') || s.sid : s.sid;

  // ─── CodeMirror ───────────────────────────────────────────────────────────
  const langC = new Compartment();
  const langExt = (): Extension => {
    if (mode === 'prose') return [EditorView.lineWrapping];
    return [s.language === 'moo-code' ? moocode({ linting: opts.lint }) : [], lineNumbers(), highlightActiveLineGutter()];
  };
  const cmHost = h('div', { class: 'cm' });
  const ed = new EditorView({
    parent: cmHost,
    state: EditorState.create({
      doc: s.draft,
      extensions: [
        langC.of(langExt()), EditorState.readOnly.of(s.readOnly), EditorView.editable.of(!s.readOnly),
        history(), drawSelection(), dropCursor(), indentOnInput(), bracketMatching(), closeBrackets(), highlightActiveLine(), highlightSelectionMatches(),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
        EditorView.contentAttributes.of({ 'aria-label': s.title }),
        tokenTheme(),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          mine = u.state.doc.toString();
          s.setDraft(mine);
          if (discarding || err) { discarding = false; err = null; }
          render();
        }),
      ],
    }),
  });
  const text = () => ed.state.doc.toString();
  const setDoc = (t: string) => { if (t !== text()) ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: t } }); };
  const insert = (t: string) => {
    const r = ed.state.selection.main;
    ed.dispatch({ changes: { from: r.from, to: r.to, insert: t }, selection: { anchor: r.from + t.length } });
    ed.focus();
  };
  const changed = () => text() !== s.text;

  // ─── the frame ────────────────────────────────────────────────────────────
  const btn = (label: string, on: boolean, click: () => void, testid?: string) =>
    h('button', { type: 'button', class: `${c.tool}${on ? ` ${c.on}` : ''}`, 'aria-pressed': on ? 'true' : 'false', 'data-testid': testid, onclick: click }, label);
  const bar = h('div', { class: 'bar' });
  const notes = h('div');
  const preview = h('div', { class: 'preview mu-ansi', 'data-testid': 'mcp-preview-body', hidden: true });
  const diff = h('div', { class: 'diff', 'data-testid': 'mcp-diff-body', hidden: true });
  const pane = h('div', { class: 'pane' }, notes, cmHost, preview, diff);
  const foot = h('div', { class: 'foot' });
  const root = h('div', { class: 'mooed', tabindex: '-1', 'data-testid': 'mcp-editor', 'data-language': s.language }, bar, pane, foot);
  el.append(root);

  function setMode(m: Mode) { mode = m; ed.dispatch({ effects: langC.reconfigure(langExt()) }); render(); }
  function setView(v: View) { view = v; render(); if (v === 'edit') ed.focus(); }

  function renderBar() {
    bar.replaceChildren(h('span', { class: 'sess' }, sessName),
      h('span', { class: 'seg', role: 'group', 'aria-label': 'mode' }, btn('Prose', mode === 'prose', () => setMode('prose'), 'mcp-mode-prose'), btn('Code', mode === 'code', () => setMode('code'), 'mcp-mode-code')),
      h('span', { class: 'seg', role: 'group', 'aria-label': 'view' }, btn('Edit', view === 'edit', () => setView('edit'), 'mcp-edit'), btn('Preview', view === 'preview', () => setView('preview'), 'mcp-preview'), btn('Diff', view === 'diff', () => setView('diff'), 'mcp-diff')),
      h('span', { class: 'sp' }),
      ...(view === 'edit' && !s.readOnly ? [h('span', { class: 'lbl' }, 'Snippets'), ...SNIPPETS[mode].map((x) => h('button', { type: 'button', class: c.tool, 'data-testid': 'mcp-snippet', onclick: () => insert(x.text) }, x.label))] : []),
    );
  }

  function renderNotes() {
    const out: HTMLElement[] = [];
    if (s.incoming !== null) {
      out.push(h('p', { class: 'note', 'data-testid': 'editor-incoming' }, 'The game sent new text for this while you were editing.',
        h('button', { type: 'button', class: c.cmd, 'data-testid': 'editor-take', onclick: () => { s.takeIncoming(); } }, 'Take it')));
    }
    if (asking) {
      out.push(h('p', { class: 'note warn', 'data-testid': 'mcp-ask' },
        `Saving runs a command that does not start with one of this world's upload verbs (${s.askVerb ?? ''}):`,
        h('code', { 'data-testid': 'mcp-ask-cmd' }, s.command ?? ''),
        h('span', { class: 'sp' }),
        h('button', { type: 'button', class: c.cmd, 'data-testid': 'mcp-ask-cancel', onclick: () => { asking = false; render(); } }, 'Cancel'),
        h('button', { type: 'button', class: `${c.cmd} ${c.hot}`, 'data-testid': 'mcp-ask-run', onclick: () => void save(true) }, 'Run it, and allow it here')));
    }
    if (discarding) {
      out.push(h('p', { class: 'note warn', 'data-testid': 'mcp-discard' }, 'Close without saving? Your edits are lost.',
        h('span', { class: 'sp' }),
        h('button', { type: 'button', class: c.cmd, 'data-testid': 'mcp-keep', onclick: () => { discarding = false; render(); ed.focus(); } }, 'Keep editing'),
        h('button', { type: 'button', class: `${c.cmd} ${c.warn}`, 'data-testid': 'mcp-discard-yes', onclick: () => s.cancel() }, 'Discard')));
    }
    notes.replaceChildren(...out);
  }

  function renderPane() {
    cmHost.hidden = view !== 'edit';
    preview.hidden = view !== 'preview';
    diff.hidden = view !== 'diff';
    if (view === 'preview') {
      const t = text();
      preview.replaceChildren(...(t ? t.split('\n').map((l) => h('div', { class: 'pl' }, ...ansiRuns(l).map((r) => h('span', { class: r.cls || null }, r.text)), '\u200b')) : [h('p', { class: 'empty' }, 'Nothing to preview.')]));
    }
    if (view === 'diff') {
      diff.replaceChildren(...(!changed() ? [h('p', { class: 'empty' }, 'No changes.')] : lineDiff(s.text, text()).map((l) =>
        h('div', { class: `dl${l.op === '+' ? ' add' : l.op === '-' ? ' del' : ''}`, 'data-op': l.op }, h('span', { class: 'g' }, String(l.a ?? '')), h('span', { class: 'g' }, String(l.b ?? '')), h('span', { class: 'op' }, l.op), h('span', { class: 't' }, l.text)))));
    }
  }

  function renderFoot() {
    const st = view === 'diff' && changed() ? diffStats(lineDiff(s.text, text())) : null;
    foot.replaceChildren(...([
      s.command !== null ? h('span', { class: 'runs', 'data-testid': 'mcp-upload' }, h('span', { class: c.label }, 'Saving runs:'), h('code', null, s.command || '(no command)')) : null,
      err ? h('span', { class: 'err', role: 'alert', 'data-testid': 'editor-error' }, err) : null,
      st ? h('span', { class: 'stat', 'data-testid': 'mcp-stat' }, `+${st.added} −${st.removed}`) : null,
      h('span', { class: 'sp' }),
      h('button', { type: 'button', class: c.btn, 'data-testid': 'mcp-cancel', onclick: () => { if (!requestClose()) return; s.cancel(); } }, 'Cancel'),
      s.readOnly ? null : view !== 'diff'
        ? h('button', { type: 'button', class: c.primary, 'data-testid': 'mcp-review', onclick: () => setView('diff') }, 'Review')
        : h('button', { type: 'button', class: c.primary, 'data-testid': 'mcp-save', disabled: saving || asking, onclick: () => void save() }, saving ? 'Saving…' : 'Save to game'),
    ].filter((x): x is HTMLElement => !!x)));
  }

  function render() {
    root.dataset.mode = mode;
    root.dataset.view = view;
    // Re-rendering replaces the buttons: keep focus inside the editor (Esc, Ctrl+S and Tab still work).
    const lost = root.contains(document.activeElement) && !cmHost.contains(document.activeElement);
    renderBar(); renderNotes(); renderPane(); renderFoot();
    if (lost && !root.contains(document.activeElement)) { if (view === 'edit') ed.focus(); else root.focus({ preventScroll: true }); }
  }

  async function save(run = false) {
    if (saving || s.readOnly) return;
    saving = true; err = null; asking = false; render();
    try {
      const r = await s.save(text(), run ? { run: true } : undefined);
      saving = false;
      if (r === 'ask') { asking = true; render(); return; }
      mu.ui.toast('Saved', s.title);
      // The host closes the editor (and this modal) everywhere.
    } catch (e) {
      saving = false;
      err = (e as Error)?.message ?? String(e);
      render();
    }
  }

  function requestClose(): boolean {
    if (!changed() || s.readOnly) return true;
    discarding = true;
    render();
    return false;
  }

  root.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault(); e.stopPropagation();
      if (view === 'diff') void save(); else setView('diff');
    }
  }, true);

  // The host's state changed: a draft from another device, new server text, or the text taken.
  const off = s.onChange(() => {
    if (s.draft !== mine) { mine = s.draft; setDoc(s.draft); }
    render();
  });

  render();
  requestAnimationFrame(() => ed.focus());

  return {
    view: ed,
    requestClose,
    dispose() {
      off();
      ed.destroy();
      root.remove();
      if (--styled === 0) { unstyle?.(); unstyle = null; }
    },
  };
}
