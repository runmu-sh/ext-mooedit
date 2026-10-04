/**
 * The MOO editor (`mooedit`): μClient's code editor for MOO games.
 *
 *  - **MCP simpleedit**: the game's `@edit` (`dns-org-mud-moo-simpleedit-content`) opens the host's editor surface
 *    (`mu.editor.open`); Save sends `-set` with the text a line each, keyed so a save made on two devices reaches the
 *    game once.
 *  - **LambdaCore local edit** (`#$# edit name: … upload: …`), off by default per world (the setting below): with it
 *    on, the extension accepts it (`mu.mcp.acceptLocalEdit`), the editor shows the upload command Save runs (the host
 *    asks first for a verb outside the world's upload verbs), and Save sends the command, the dot-stuffed lines and
 *    `.`, raw (no separators or aliases on MOO code).
 *  - **The editor UI** (`mu.editor.provide`) for MOO code, text and Markdown, whoever opened the editor: CodeMirror
 *    with the MOO language and linter, prose and code modes and an ANSI preview; Program (Save) sends at once. It is
 *    the lazy module `dist/editor.js` (`mu.modules.load`), fetched the first time an editor opens. If it cannot load,
 *    the extension steps aside and the host's plain editor shows the text.
 */
import { defineExtension, type Dispose, type EditorSession, type Mu } from '@muclient/sdk';
import { hash, lines, localEditLanguage, one, simpleeditContent, simpleeditLanguage, uploadText } from './protocol';
import type { EditorModule, Mounted, Mode } from './editor';

const SIMPLEEDIT = 'dns-org-mud-moo-simpleedit';

export default defineExtension({
  activate({ mu }) {
    mu.settings.define({
      title: 'MOO editor',
      items: [
        {
          key: 'localEdit', label: 'Accept LambdaCore local editing (#$# edit)', kind: 'toggle', default: false, scope: 'world',
          hint: 'Opens #$# edit blocks in the editor; Save runs their upload command. Off: they show as text. Off by itself when the game speaks MCP 2.1.',
        },
        {
          key: 'window', label: 'Always open the editor in a new window', kind: 'toggle', default: false, scope: 'global', sync: 'device',
          hint: 'Pops the editor out into its own window instead of a dialog. If the browser blocks the pop-up, it opens as a dialog.',
        },
        { key: 'lint', label: 'Check MOO code as you type', kind: 'toggle', default: true },
        {
          key: 'mode', label: 'Text opens in', kind: 'select', default: 'auto',
          options: [{ value: 'auto', label: 'Code for MOO code, prose for text' }, { value: 'code', label: 'Code mode' }, { value: 'prose', label: 'Prose mode' }],
        },
      ],
    });

    // ─── MCP simpleedit ───────────────────────────────────────────────────────
    mu.mcp.on(`${SIMPLEEDIT}-content`, (a, meta) => {
      const reference = one(a.reference);
      if (!reference) return;
      const type = one(a.type) || 'string-list';
      mu.editor.open({
        sid: meta.sid, id: `simpleedit:${reference}`, title: one(a.name, ' ') || reference,
        text: lines(a.content).join('\n'), language: simpleeditLanguage(type),
        async save(text) {
          const r = await mu.mcp.send(`${SIMPLEEDIT}-set`, { reference, type, content: simpleeditContent(type, text) }, { sid: meta.sid, key: `simpleedit-set:${meta.id}:${hash(text)}` });
          if (r === 'not-negotiated') throw new Error('The game is not connected, or no longer speaks simpleedit.');
          if (r === 'refused') throw new Error('The game refused the save (too large, or too many sends).');
        },
      });
    });

    // ─── LambdaCore local edit ────────────────────────────────────────────────
    mu.mcp.acceptLocalEdit((sid) => mu.settings.get<boolean>('localEdit', { sid }) === true);
    mu.mcp.on('legacy-edit', (a, meta) => {
      const name = one(a.name, ' ') || 'text', upload = one(a.upload, ' ');
      if (!upload) return;
      mu.editor.open({
        sid: meta.sid, id: `local-edit:${upload}`, title: `Local edit: ${name}`, text: lines(a.content).join('\n'),
        language: localEditLanguage(name, upload), command: upload,
        async save(text) {
          const r = await mu.sessions.send(uploadText(upload, text), { sid: meta.sid, raw: true, echo: false, key: `local-edit:${meta.id}:${hash(text)}` });
          if (r === 'refused') throw new Error('Not sent: the session is closed.');
        },
      });
    });

    provide(mu);
  },
});

/** The editor UI. If the module fails to load, the provider goes away and the host's plain editor takes over. */
function provide(mu: Mu) {
  let mod: Promise<EditorModule> | null = null;
  const load = () => (mod ??= mu.modules.load<EditorModule>('dist/editor.js'));
  let failed = false;
  const off = mu.editor.provide({
    id: 'mooedit',
    languages: ['moo-code', 'text', 'markdown'],
    show(session) { return failed ? undefined : showIn(mu, session, load, () => { if (failed) return; failed = true; off(); }); },
  });
}

/** One editor, in its own window (the setting) or a host modal. Returns the cleanup the host calls when it closes or moves elsewhere. */
function showIn(mu: Mu, session: EditorSession, load: () => Promise<EditorModule>, giveUp: () => void): Dispose {
  if (mu.settings.get<boolean>('window') === true) {
    const w = showInWindow(mu, session, load, giveUp);
    if (w) return w;
    mu.ui.toast('MOO editor', 'The browser blocked the editor window. Allow pop-ups for μClient to open it in a window; showing it here for now.');
  }
  return showInModal(mu, session, load, giveUp);
}

const editorOpts = (mu: Mu, sid: string) => ({
  lint: mu.settings.get<boolean>('lint', { sid }) !== false,
  mode: String(mu.settings.get('mode', { sid }) ?? 'auto') as Mode | 'auto',
});

/**
 * Copy this page's theme (the root's data-* attributes and style, which carry the tokens) and stylesheets into a
 * pop-out, and keep them in step until it closes: the host's classes (`mu.ui.css`) and this extension's CSS reach it.
 */
function mirrorStyles(w: Window): () => void {
  const copies = new Map<Element, Element>();
  const sync = () => {
    if (w.closed) return;
    const src = document.documentElement, dst = w.document.documentElement;
    for (const a of [...src.attributes]) if ((a.name.startsWith('data-') || a.name === 'style' || a.name === 'class') && dst.getAttribute(a.name) !== a.value) dst.setAttribute(a.name, a.value);
    const now = new Set(document.head.querySelectorAll('style, link[rel="stylesheet"]'));
    for (const [s, c] of [...copies]) if (!now.has(s)) { c.remove(); copies.delete(s); }
    for (const s of now) {
      let c = copies.get(s);
      if (!c) { c = w.document.importNode(s, true); w.document.head.appendChild(c); copies.set(s, c); }
      else if (s.tagName === 'STYLE' && c.textContent !== s.textContent) c.textContent = s.textContent;
    }
  };
  const mo = new MutationObserver(sync);
  mo.observe(document.head, { childList: true, subtree: true, characterData: true });
  mo.observe(document.documentElement, { attributes: true });
  sync();
  return () => mo.disconnect();
}

let windows = 0;

/** One editor in its own browser window, or null when the pop-up was blocked. */
function showInWindow(mu: Mu, session: EditorSession, load: () => Promise<EditorModule>, giveUp: () => void): Dispose | null {
  const w = window.open('', `mooedit-${++windows}`, 'popup,width=960,height=680');
  if (!w) return null;
  let hostClosed = false, gone = false;
  let ed: Mounted | null = null;
  const d = w.document;
  d.open(); d.write('<!doctype html><html lang="en"><head><meta charset="UTF-8"></head><body></body></html>'); d.close();
  d.title = session.title;
  d.body.style.margin = '0';
  d.body.style.background = 'var(--bg)';
  const stopStyles = mirrorStyles(w);
  const el = d.createElement('div');
  el.className = 'mooed-win';
  el.textContent = 'Loading the editor…';
  d.body.append(el);

  const teardown = () => {
    if (gone) return;
    gone = true;
    window.removeEventListener('pagehide', closeWin);
    stopStyles();
    ed?.dispose(); ed = null;
    if (!w.closed) w.close();
  };
  const closeWin = () => { hostClosed = true; teardown(); };
  // The client page goes away: the editor window goes with it (the draft is kept by the host).
  window.addEventListener('pagehide', closeWin);
  // Closing the window is Cancel; unsaved edits get the browser's own "leave?" prompt first.
  w.addEventListener('beforeunload', (e) => { if (!hostClosed && ed && !ed.requestClose()) { e.preventDefault(); e.returnValue = ''; } });
  w.addEventListener('pagehide', () => { const cancel = !hostClosed; teardown(); if (cancel) session.cancel(); });
  w.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (!ed || ed.requestClose()) { teardown(); session.cancel(); }
  });

  load().then((m) => {
    if (gone) return;
    el.textContent = '';
    ed = m.mountEditor(el, session, mu, editorOpts(mu, session.sid));
    w.focus();
  }, (e) => {
    mu.log.error('the editor module did not load:', e);
    mu.ui.toast('MOO editor', `The code editor could not load (${(e as Error)?.message ?? e}). Showing the plain editor.`, { kind: 'error' });
    hostClosed = true;
    teardown();
    giveUp();
  });
  return closeWin;
}

/** One editor in a host modal. */
function showInModal(mu: Mu, session: EditorSession, load: () => Promise<EditorModule>, giveUp: () => void): Dispose {
  let hostClosed = false;
  let ed: Mounted | null = null;
  const modal = mu.ui.modal({
    title: session.title, width: 'lg', everywhere: true,
    mount(el) {
      let gone = false;
      el.textContent = 'Loading the editor…';
      load().then((m) => {
        if (gone) return;
        el.textContent = '';
        ed = m.mountEditor(el, session, mu, editorOpts(mu, session.sid));
      }, (e) => {
        mu.log.error('the editor module did not load:', e);
        mu.ui.toast('MOO editor', `The code editor could not load (${(e as Error)?.message ?? e}). Showing the plain editor.`, { kind: 'error' });
        // Hand this editor (and the next ones) to the host's plain editor: closing here is not cancelling.
        hostClosed = true;
        modal.close();
        giveUp();
      });
      return () => { gone = true; ed?.dispose(); ed = null; };
    },
    // Esc, the scrim or ×: unsaved edits ask first, inside the editor (a host dialog would queue behind this modal).
    beforeClose: () => (ed ? ed.requestClose() : true),
  });
  // The player closed it: that is Cancel, everywhere. The host closing it (saved, cancelled, moved) is not.
  void modal.closed.then(() => { if (!hostClosed) session.cancel(); });
  return () => { hostClosed = true; modal.close(); };
}
