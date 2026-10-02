/**
 * The CodeMirror theme generated from the tokens (style bible §7 "Code editor theme").
 * One table maps editor roles to tokens; `tokenTheme()` turns it into an EditorView theme plus a
 * HighlightStyle. Every value is a `var(--token)` reference resolved by the browser at paint time,
 * so switching `data-theme` (or custom swatches) recolours open editors with no rebuild.
 */
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

const v = (tok: string) => `var(--${tok})`;
const tint = (tok: string, pct: number) => `color-mix(in srgb, var(--${tok}) ${pct}%, transparent)`;

/** Editor role → token, straight from the style bible. */
export const EDITOR_TOKENS = {
  background: 'bg', gutter: 'bg-elev', gutterEdge: 'border', lineNumber: 'fg-faint', text: 'fg',
  cursor: 'accent-bright', keyword: 'accent-bright', string: 'gold', number: 'ok', comment: 'fg-faint',
  function: 'fg', operator: 'fg-dim', error: 'alert',
} as const;

export function tokenTheme(): Extension {
  const T = EDITOR_TOKENS;
  const view = EditorView.theme({
    '&': { backgroundColor: v(T.background), color: v(T.text), height: '100%', fontSize: '.82rem' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.5' },
    '.cm-content': { caretColor: v(T.cursor), padding: '4px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: v(T.cursor), borderLeftWidth: '2px' },
    '.cm-gutters': { backgroundColor: v(T.gutter), color: v(T.lineNumber), borderRight: `1px solid ${v(T.gutterEdge)}` },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 10px', minWidth: '2.6em' },
    '.cm-activeLine': { backgroundColor: tint('accent', 9) },
    '.cm-activeLineGutter': { backgroundColor: tint('accent', 9), color: v('fg-dim') },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: `${tint('accent', 30)} !important` },
    '.cm-selectionMatch': { backgroundColor: tint('accent', 14) },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: tint('accent', 20), outline: `1px solid ${v('accent')}` },
    '.cm-searchMatch': { backgroundColor: tint('accent', 14) },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: tint('accent', 30), outline: `1px solid ${v('accent')}` },
    // lint: errors with a wavy --alert underline, warnings with --gold
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: `underline wavy ${v(T.error)}`, textUnderlineOffset: '3px' },
    '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: `underline wavy ${v('gold')}`, textUnderlineOffset: '3px' },
    '.cm-lint-marker-error': { content: 'none' },
    '.cm-diagnostic': { padding: '4px 8px', fontSize: '.74rem', color: v('fg') },
    '.cm-diagnostic-error': { borderLeft: `2px solid ${v(T.error)}` },
    '.cm-diagnostic-warning': { borderLeft: `2px solid ${v('gold')}` },
    '.cm-tooltip': { backgroundColor: v('bg-elev'), border: `1px solid ${v('accent')}`, color: v('fg'), borderRadius: '0' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: tint('accent', 22), color: v('accent-bright') },
    '.cm-panels': { backgroundColor: v('bg-deep'), color: v('fg'), borderColor: v('accent') },
    '.cm-panels input, .cm-panels button': { borderRadius: '0' },
    '.cm-foldPlaceholder': { backgroundColor: v('bg-elev'), border: `1px solid ${v('border-bright')}`, color: v('fg-dim') },
  }, { dark: true });

  const hl = HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword], color: v(T.keyword) },
    { tag: [t.string, t.special(t.string), t.regexp], color: v(T.string) },
    { tag: [t.number, t.bool, t.null, t.atom], color: v(T.number) },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta], color: v(T.comment), fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.standard(t.variableName)], color: v(T.function) },
    { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: v(T.operator) },
    { tag: [t.special(t.variableName), t.typeName], color: v('gold') },
    { tag: [t.variableName, t.propertyName, t.name], color: v(T.text) },
    { tag: t.invalid, color: v(T.error) },
  ]);
  return [view, syntaxHighlighting(hl)];
}
