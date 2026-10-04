# Changelog

## 1.2.0

- New setting **Always open the editor in a new window** (Settings → Extensions → MOO editor; off by default, kept
  on this device). The editor pops out into its own browser window with your theme. Program saves and closes it;
  closing the window or Esc cancels (unsaved edits ask first). If the browser blocks the pop-up, the editor opens
  as a dialog and a toast says why.

## 1.1.1

- Ships the release build of `dist/`: 1.1.0 carried a dev build whose editor module did not match its pin.

## 1.1.0

- **Program** sends straight away: the Review step, the Diff view and its confirm are gone. The button reads
  Program for MOO code and Save for text; Ctrl+S does the same.
- The snippet buttons (`if`, `for`, `while`, …) are gone from the toolbar.

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
