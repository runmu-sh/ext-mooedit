# Changelog

## 1.0.1

- Narrow screens: the command Save runs gets its own line, so Cancel and Save stay together. The toolbar is
  tighter.

## 1.0.0

- The MOO editor, moved out of μClient (SDK 1.13). It has code and prose modes, MOO highlighting and a linter,
  snippets, an ANSI preview, a diff before Save, and asks before discarding unsaved edits.
- MCP simpleedit: `@edit` opens the editor, and Save sends `-set` once.
- LambdaCore local edit, off by default per world. It shows the upload command, and the host asks before an
  unusual verb.
- The editor is a lazy module (`dist/editor.js`, `mu.modules.load`), so CodeMirror loads only when an editor opens.
