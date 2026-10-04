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

/** One editor in a host modal. Returns the cleanup the host calls when it closes or moves elsewhere. */
function showIn(mu: Mu, session: EditorSession, load: () => Promise<EditorModule>, giveUp: () => void): Dispose {
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
        ed = m.mountEditor(el, session, mu, {
          lint: mu.settings.get<boolean>('lint', { sid: session.sid }) !== false,
          mode: String(mu.settings.get('mode', { sid: session.sid }) ?? 'auto') as Mode | 'auto',
        });
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
