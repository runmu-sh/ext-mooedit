/**
 * `npm test`: the MOO editor in a headless μClient host (@runmu.sh/dev/test), plus its protocol helpers.
 * The host records `mu.editor.open` / `mu.editor.provide` / `mu.mcp.acceptLocalEdit` in `host.calls`; the tests call
 * the opened editor's `save` the way μClient does after the player presses Save, and assert on what reached the game.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function find() {
  if (process.env.MUCLIENT_DEV_TEST) return process.env.MUCLIENT_DEV_TEST;
  return createRequire(join(ROOT, 'package.json')).resolve('@runmu.sh/dev/test');
}
const { createHost } = await import(pathToFileURL(find()).href);

/** src/protocol.ts as a module (no SDK runtime needed). */
const P = await (async () => {
  const r = await build({ entryPoints: [join(ROOT, 'src/protocol.ts')], bundle: true, format: 'esm', write: false, external: ['@muclient/sdk'] });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].contents).toString('base64')}`);
})();

const opened = (host) => host.calls.filter((c) => c.path === 'editor.open').map((c) => c.args[0]);

test('registers the editor UI, local edit (gated by the world setting) and its settings', async () => {
  const host = createHost({ root: ROOT });
  await host.load('src/index.ts');
  const prov = host.calls.find((c) => c.path === 'editor.provide');
  assert.ok(prov, 'mu.editor.provide');
  assert.deepEqual(prov.args[0].languages, ['moo-code', 'text', 'markdown']);
  const le = host.calls.find((c) => c.path === 'mcp.acceptLocalEdit');
  assert.ok(le, 'mu.mcp.acceptLocalEdit');
  assert.equal(le.args[0]('s1'), false, 'local edit is off by default');
  host.mu.settings.set('localEdit', true);
  assert.equal(le.args[0]('s1'), true);
  assert.deepEqual(host.settingsSchema.items.map((i) => i.key), ['localEdit', 'lint', 'mode']);
  assert.equal(host.errors.length, 0);
  await host.unload();
  assert.deepEqual(host.live(), []);
});

test('simpleedit: -content opens the editor; Save sends one keyed -set with the lines', async () => {
  const host = createHost({ root: ROOT });
  await host.load('src/index.ts');
  host.mcp('dns-org-mud-moo-simpleedit-content', { reference: '#95.description', name: 'me.description', type: 'string-list', content: ['A tall figure.', 'Grey eyes.'] });
  const [ed] = opened(host);
  assert.equal(ed.id, 'simpleedit:#95.description');
  assert.equal(ed.title, 'me.description');
  assert.equal(ed.text, 'A tall figure.\nGrey eyes.');
  assert.equal(ed.language, 'text');
  assert.equal(ed.command, undefined, 'simpleedit runs no command');
  await ed.save('A tall figure.\r\nGrey eyes.\nA second line.');
  const sent = host.sends('mcp');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message, 'dns-org-mud-moo-simpleedit-set');
  assert.deepEqual(sent[0].args, { reference: '#95.description', type: 'string-list', content: ['A tall figure.', 'Grey eyes.', 'A second line.'] });
  // moo-code opens as MOO code; a `string` is sent as one line
  host.mcp('dns-org-mud-moo-simpleedit-content', { reference: '#4:look_self', name: '#4:look_self', type: 'moo-code', content: ['player:tell("hi");'] });
  assert.equal(opened(host)[1].language, 'moo-code');
  host.mcp('dns-org-mud-moo-simpleedit-content', { reference: '#9.name', name: 'name', type: 'string', content: 'Quill' });
  await opened(host)[2].save('Quill\nthe Grey');
  assert.deepEqual(host.sends('mcp').at(-1).args.content, ['Quill the Grey']);
  // no reference: ignored
  host.mcp('dns-org-mud-moo-simpleedit-content', { name: 'x', content: [] });
  assert.equal(opened(host).length, 3);
  assert.equal(host.errors.length, 0);
  await host.unload();
});

test('simpleedit: a save the game cannot take rejects with a reason (the editor stays open)', async () => {
  const host = createHost({ root: ROOT });
  await host.load('src/index.ts');
  host.mu.mcp.send = async () => 'not-negotiated';
  host.mcp('dns-org-mud-moo-simpleedit-content', { reference: '#1.d', name: 'd', type: 'string-list', content: ['x'] });
  await assert.rejects(opened(host)[0].save('y'), /no longer speaks simpleedit/);
  await host.unload();
});

test('local edit: legacy-edit opens the editor with the upload command; Save sends it raw and dot-stuffed', async () => {
  const host = createHost({ root: ROOT });
  await host.load('src/index.ts');
  host.mcp('legacy-edit', { name: 'Note', upload: '@set-note-text #77', content: ['one', '.dot', ''] });
  const [ed] = opened(host);
  assert.equal(ed.command, '@set-note-text #77');
  assert.equal(ed.title, 'Local edit: Note');
  assert.equal(ed.language, 'text');
  await ed.save('one\n.dot');
  const [cmd] = host.sends('command');
  assert.equal(cmd.text, '@set-note-text #77\none\n..dot\n.');
  assert.match(cmd.key, /^local-edit:/);
  host.mcp('legacy-edit', { name: '#4:look', upload: '@program #4:look', content: ['x;'] });
  assert.equal(opened(host)[1].language, 'moo-code');
  host.mcp('legacy-edit', { name: 'x', content: ['no upload'] });
  assert.equal(opened(host).length, 2, 'no upload command: ignored');
  await host.unload();
});

test('protocol helpers', () => {
  assert.equal(P.uploadText('@program #1:x', '.\n..a\nb'), '@program #1:x\n..\n...a\nb\n.');
  assert.deepEqual(P.simpleeditContent('moo-code', 'a\r\nb'), ['a', 'b']);
  assert.equal(P.hash('abc'), P.hash('abc'));
  assert.notEqual(P.hash('abc'), P.hash('abd'));
  assert.deepEqual(P.ansiRuns('\x1b[1;31mred\x1b[0m plain \x1b[38;5;208mo'), [{ text: 'red', cls: 'c-009 b' }, { text: ' plain ', cls: '' }, { text: 'o', cls: 'c-208' }]);
});

test('the lazy editor module is listed, built and pinned', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const pin = pkg.muclient.modules['dist/editor.js'];
  assert.ok(existsSync(join(ROOT, 'dist/editor.js')), 'npm run build first');
  assert.equal(createHash('sha256').update(readFileSync(join(ROOT, 'dist/editor.js'))).digest('hex'), pin, 'the pin matches the built bytes');
  const entry = readFileSync(join(ROOT, 'dist/index.js'), 'utf8');
  assert.ok(!/@codemirror|EditorView/.test(entry), 'CodeMirror is not in the entry');
  assert.ok(entry.length < 20000);
});
