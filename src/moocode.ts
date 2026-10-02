/**
 * MOOcode for CodeMirror 6: a StreamLanguage (highlighting through the token theme in ./theme.ts, no colours of its
 * own) and a linter (unbalanced blocks, undefined variables). Ported from the ACE editor's mode-moo.js; it was
 * μClient's src/extensions/moocode-lang.ts until the MOO editor became this extension.
 */
import { StreamLanguage, type StringStream } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';

// ============================================================================
// Token Classification Patterns
// ============================================================================

/**
 * MOOcode keywords - control flow and block structure
 */
const keywords = new Set([
  'if', 'else', 'elseif', 'endif',
  'for', 'endfor',
  'while', 'endwhile',
  'try', 'catch', 'except', 'endtry', 'finally',
  'fork', 'endfork',
  'return', 'raise', 'break', 'continue', 'in',
  'case', 'do', 'instanceof', 'throw', 'typeof', 'yield', 'new', 'delete', 'void'
]);

/**
 * MOOcode storage types
 */
const storageTypes = new Set([
  'const', 'let', 'var', 'function'
]);

/**
 * MOOcode built-in language variables
 */
const languageVariables = new Set([
  'player', 'this', 'caller', 'verb', 'args', 'argstr',
  'dobj', 'dobjstr', 'prepstr', 'iobj', 'iobjstr'
]);

/**
 * MOOcode type constants and exception keywords
 */
const typeConstants = new Set([
  'INT', 'FLOAT', 'OBJ', 'STR', 'LIST', 'ERR', 'MAP', 'WAIF', 'BOOL', 'FLYWEIGHT',
  'TYPE_INT', 'TYPE_FLOAT', 'TYPE_OBJ', 'TYPE_STR', 'TYPE_LIST', 'TYPE_ERR', 'TYPE_MAP', 'TYPE_WAIF', 'TYPE_BOOL', 'TYPE_FLYWEIGHT'
]);

/**
 * MOOcode built-in functions (from ACE mode-moo.js)
 */
const builtinFunctions = new Set([
  'abs', 'file_remove', 'recycle', 'acos', 'file_rename', 'renumber',
  'add_property', 'file_rmdir', 'reset_max_object', 'add_verb', 'file_seek',
  'resume', 'asin', 'file_size', 'rindex', 'atan', 'file_stat', 'rmatch',
  'binary_hash', 'file_tell', 'seconds_left', 'boot_player', 'file_type',
  'server_log', 'buffered_output_length', 'file_write', 'server_version',
  'builtin_index', 'file_writeline', 'set_connection_option', 'call_function',
  'floatstr', 'set_player_flag', 'caller_perms', 'floor', 'set_property_info',
  'callers', 'flush_input', 'set_task_perms', 'ceil', 'force_input',
  'set_verb_args', 'children', 'function_info', 'set_verb_code', 'chparent',
  'idle_seconds', 'set_verb_info', 'clear_property', 'index', 'setadd',
  'connected_players', 'is_clear_property', 'setremove', 'connected_seconds',
  'is_member', 'shutdown', 'connection_name', 'is_player', 'sin',
  'connection_option', 'kill_task', 'sinh', 'connection_options', 'length',
  'sqrt', 'cos', 'listappend', 'strcmp', 'cosh', 'listdelete', 'string_hash',
  'create', 'listen', 'strsub', 'crypt', 'listeners', 'substitute', 'ctime',
  'listinsert', 'suspend', 'db_disk_size', 'listset', 'tan', 'decode_binary',
  'log', 'tanh', 'delete_property', 'log10', 'task_id', 'delete_verb', 'match',
  'task_stack', 'disassemble', 'max', 'ticks_left', 'dump_database',
  'max_object', 'time', 'encode_binary', 'memory_usage', 'tofloat', 'equal',
  'messages', 'toint', 'eval', 'min', 'toliteral', 'exp', 'move', 'tonum',
  'file_io', 'notify', 'toobj', 'file_close', 'object_bytes', 'tostr',
  'file_eof', 'open_network_connection', 'trunc', 'file_last_access',
  'output_delimiters', 'typeof', 'file_last_change', 'parent', 'unlisten',
  'file_last_modify', 'pass', 'valid', 'file_list', 'pfileinfo', 'value_bytes',
  'file_mkdir', 'players', 'value_hash', 'file_mode', 'properties', 'verb_args',
  'file_name', 'property_info', 'verb_code', 'file_open', 'queue_info',
  'verb_info', 'file_openmode', 'queued_tasks', 'verbs', 'file_read', 'raise',
  'xml_parse_document', 'file_readline', 'random', 'xml_parse_tree',
  'file_readlines', 'read', 'sql_open', 'sql_close', 'sql_info', 'sql_query',
  'sql_connections', 'pcre_replace', 'parse_json', 'generate_json',
  'thread_pool', 'reverse', 'panic', 'yin', 'yin_suspend', 'occupants',
  'locations', 'locate_by_name', 'explode', 'implode', 'slice', 'mapdelete',
  'mapkeys', 'mapvalues', 'encode_base64', 'decode_base64', 'object_id',
  'floatceil', 'floatfloor', 'floatround', 'sort', 'ticks_remaining',
  'seconds_remaining', 'age', 'ctime_local', 'ctime_utc', 'ftime',
  'ftime_local', 'ftime_utc', 'getenv', 'setenv', 'unsetenv', 'chr', 'ord',
  'strcmp_i', 'strncmp', 'strncmp_i', 'strlower', 'strupper', 'strchr',
  'strrchr', 'strtr', 'parse_ansi', 'strip_ansi', 'ansi_tags'
]);

// ============================================================================
// Tokenizer State Interface
// ============================================================================

interface MooState {
  tokenize: (stream: StringStream, state: MooState) => string | null;
  lastToken: string | null;
  inRegex: boolean;
  inBacktick: boolean;  // Track if we're inside a backtick exception expression
}

// ============================================================================
// Tokenizer Functions
// ============================================================================

/**
 * Main tokenizer for MOOcode
 */
function tokenBase(stream: StringStream, state: MooState): string | null {
  // Skip whitespace
  if (stream.eatSpace()) {
    return null;
  }

  const ch = stream.peek();

  // Line comment: //
  if (ch === '/' && stream.match('//')) {
    stream.skipToEnd();
    return 'comment';
  }

  // MOOcode docstring comment: "..."; at start of line
  if (stream.sol() && ch === '"') {
    const pos = stream.pos;
    stream.next();
    while (!stream.eol()) {
      const c = stream.next();
      if (c === '"' && stream.peek() === ';') {
        stream.next();
        return 'comment';
      }
      if (c === '\\') {
        stream.next(); // skip escaped char
      }
    }
    // Not a docstring, reset and parse as string
    stream.pos = pos;
  }

  // Block comment: /* ... */
  if (ch === '/' && stream.match('/*')) {
    state.tokenize = tokenBlockComment;
    return tokenBlockComment(stream, state);
  }

  // Doc comment: /** ... */
  if (ch === '/' && stream.match('/**')) {
    state.tokenize = tokenDocComment;
    return tokenDocComment(stream, state);
  }

  // Double-quoted string
  if (ch === '"') {
    stream.next();
    state.tokenize = tokenDoubleString;
    return tokenDoubleString(stream, state);
  }

  // Single-quoted string OR closing of backtick exception expression
  if (ch === "'") {
    stream.next();
    // If we're inside a backtick expression, this closes it
    if (state.inBacktick) {
      state.inBacktick = false;
      return 'bracket';
    }
    // Otherwise, it's a single-quoted string
    state.tokenize = tokenSingleString;
    return tokenSingleString(stream, state);
  }

  // Hex number
  if (stream.match(/^0[xX][0-9a-fA-F]+/)) {
    return 'number';
  }

  // Decimal/float number
  if (stream.match(/^[+-]?\d+(?:(?:\.\d*)?(?:[eE][+-]?\d+)?)?/)) {
    return 'number';
  }

  // Object reference: #123 or $name
  if (ch === '#') {
    stream.next();
    if (stream.match(/^-?\d+/)) {
      return 'atom';
    }
    return 'operator';
  }

  if (ch === '$') {
    stream.next();
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
      return 'atom';
    }
    return 'operator';
  }

  // Error literal: E_PERM, E_INVARG, etc.
  if (ch === 'E' && stream.match(/^E_[A-Z]+/)) {
    return 'atom';
  }

  // Backtick expression (error catching): `expr ! ERROR => fallback'
  if (ch === '`') {
    stream.next();
    state.inBacktick = true;
    return 'bracket';
  }

  // Multi-character operators (check longer ones first)
  // Includes => for exception handlers: `expr ! ERROR => fallback'
  if (stream.match(/^(?:!==|===|<<=|>>=|>>>=|!=|==|<=|>=|<>|&&|\|\||\+\+|--|->|=>|\.\.)/)) {
    state.lastToken = 'operator';
    return 'operator';
  }

  // Assignment operators
  if (stream.match(/^(?:\+=|-=|\*=|\/=|%=|&=|\|=|\^=|=)/)) {
    state.lastToken = 'operator';
    return 'operator';
  }

  // Single-character operators
  if (stream.match(/^[+\-*\/%^&|~!?:<>]/)) {
    state.lastToken = 'operator';
    return 'operator';
  }

  // Brackets
  if (ch === '(' || ch === ')' || ch === '[' || ch === ']' || ch === '{' || ch === '}') {
    stream.next();
    state.lastToken = ch;
    return 'bracket';
  }

  // Punctuation
  if (ch === ',' || ch === ';') {
    stream.next();
    return 'punctuation';
  }

  // Property/verb call operator
  if (ch === '.' || ch === ':') {
    stream.next();
    return 'operator';
  }

  // Identifier
  if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
    const word = stream.current();

    // Check keyword
    if (keywords.has(word)) {
      return 'keyword';
    }

    // Check storage type
    if (storageTypes.has(word)) {
      return 'definitionKeyword';
    }

    // Check language variable
    if (languageVariables.has(word)) {
      return 'variableName.special';
    }

    // Check type constant
    if (typeConstants.has(word)) {
      return 'typeName';
    }

    // Check boolean literals
    if (word === 'true' || word === 'false') {
      return 'bool';
    }

    // Check builtin function
    if (builtinFunctions.has(word)) {
      return 'function.builtin';
    }

    // Regular identifier
    return 'variableName';
  }

  // Shebang
  if (stream.sol() && stream.match(/^#!.*/)) {
    return 'meta';
  }

  // Catch-all: advance one character
  stream.next();
  return null;
}

/**
 * Block comment tokenizer
 */
function tokenBlockComment(stream: StringStream, state: MooState): string {
  let maybeEnd = false;
  while (!stream.eol()) {
    const ch = stream.next();
    if (ch === '/' && maybeEnd) {
      state.tokenize = tokenBase;
      break;
    }
    maybeEnd = ch === '*';
  }
  return 'comment';
}

/**
 * Doc comment tokenizer for opening with slash-star-star and closing with star-slash
 */
function tokenDocComment(stream: StringStream, state: MooState): string {
  let maybeEnd = false;
  while (!stream.eol()) {
    const ch = stream.next();
    if (ch === '/' && maybeEnd) {
      state.tokenize = tokenBase;
      break;
    }
    maybeEnd = ch === '*';
  }
  return 'comment.doc';
}

/**
 * Double-quoted string tokenizer
 */
function tokenDoubleString(stream: StringStream, state: MooState): string {
  let escaped = false;
  while (!stream.eol()) {
    const ch = stream.next();
    if (ch === '"' && !escaped) {
      state.tokenize = tokenBase;
      break;
    }
    escaped = !escaped && ch === '\\';
  }
  return 'string';
}

/**
 * Single-quoted string tokenizer
 */
function tokenSingleString(stream: StringStream, state: MooState): string {
  let escaped = false;
  while (!stream.eol()) {
    const ch = stream.next();
    if (ch === "'" && !escaped) {
      state.tokenize = tokenBase;
      break;
    }
    escaped = !escaped && ch === '\\';
  }
  return 'string';
}

// ============================================================================
// StreamLanguage Definition
// ============================================================================

/**
 * MOOcode language definition using StreamLanguage
 */
const moocodeLanguage = StreamLanguage.define<MooState>({
  name: 'moocode',
  
  startState(): MooState {
    return {
      tokenize: tokenBase,
      lastToken: null,
      inRegex: false,
      inBacktick: false
    };
  },

  token(stream: StringStream, state: MooState): string | null {
    const style = state.tokenize(stream, state);
    return style;
  },

  blankLine(_state: MooState): void {
    // Reset state on blank lines if needed
  },

  copyState(state: MooState): MooState {
    return {
      tokenize: state.tokenize,
      lastToken: state.lastToken,
      inRegex: state.inRegex,
      inBacktick: state.inBacktick
    };
  },

  indent(_state: MooState, _textAfter: string): number | null {
    // Basic indentation - could be enhanced
    return null;
  },

  languageData: {
    commentTokens: {
      line: '//',
      block: { open: '/*', close: '*/' }
    },
    closeBrackets: {
      brackets: ['(', '[', '{', '"', "'", '`']
    }
  }
});

// ============================================================================
// Linter Implementation
// ============================================================================

// Note: Variable assignment patterns are defined inline in the linter
// to avoid catastrophic backtracking from nested quantifiers.

/**
 * Pattern to match variable usage via property/method access:
 * - $var. or $var:
 * - @var. or @var:
 * - identifier. or identifier:
 */
const checkPattern = /(?:([\$\@]?[a-zA-Z_][a-zA-Z0-9_]*)[\.\:])/g;

/**
 * Helper to find regions that should be skipped (comments and strings)
 */
function findSkipRegions(code: string): Array<{start: number, end: number}> {
  const regions: Array<{start: number, end: number}> = [];
  
  // Line comments
  const lineComment = /\/\/.*$/gm;
  let match: RegExpExecArray | null;
  while ((match = lineComment.exec(code)) !== null) {
    regions.push({ start: match.index, end: match.index + match[0].length });
  }
  
  // Block comments
  const blockComment = /\/\*[\s\S]*?\*\//g;
  while ((match = blockComment.exec(code)) !== null) {
    regions.push({ start: match.index, end: match.index + match[0].length });
  }
  
  // Double-quoted strings (handling escapes)
  const dqString = /"(?:[^"\\]|\\.)*"/g;
  while ((match = dqString.exec(code)) !== null) {
    regions.push({ start: match.index, end: match.index + match[0].length });
  }
  
  // Single-quoted strings
  const sqString = /'(?:[^'\\]|\\.)*'/g;
  while ((match = sqString.exec(code)) !== null) {
    regions.push({ start: match.index, end: match.index + match[0].length });
  }
  
  // MOO docstring comments: "...";
  const docString = /^"[^"]*";$/gm;
  while ((match = docString.exec(code)) !== null) {
    regions.push({ start: match.index, end: match.index + match[0].length });
  }
  
  return regions;
}

/**
 * Check if a position is inside a skip region
 */
function isInSkipRegion(pos: number, regions: Array<{start: number, end: number}>): boolean {
  return regions.some(r => pos >= r.start && pos < r.end);
}

/**
 * MOOcode linter that checks for undefined variables
 */
const moocodeLinter = linter((view) => {
  const diagnostics: Diagnostic[] = [];
  const code = view.state.doc.toString();
  
  // Find regions to skip (comments and strings)
  const skipRegions = findSkipRegions(code);

  // Collect all defined variables
  const defined = new Set<string>();
  
  // Add built-in language variables as always defined
  languageVariables.forEach(v => defined.add(v));
  
  // Add common object references as defined
  defined.add('$');
  
  // Track variable definitions
  let match: RegExpExecArray | null;
  
  // Find simple assignments: x = ... or x += ... etc.
  const simpleAssign = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=|\+=|-=|\*=|\/=)/g;
  while ((match = simpleAssign.exec(code)) !== null) {
    if (isInSkipRegion(match.index, skipRegions)) continue;
    if (match[1] && !keywords.has(match[1])) {
      defined.add(match[1]);
    }
  }

  // Find for-loop variables: for x in ... or for x, y in ...
  // Use a simple non-backtracking pattern
  const forPattern = /\bfor\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\b/g;
  while ((match = forPattern.exec(code)) !== null) {
    if (isInSkipRegion(match.index, skipRegions)) continue;
    if (match[1]) defined.add(match[1]);
  }
  
  // Find for-loop with two variables: for x, y in ...
  const forPattern2 = /\bfor\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*,\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+in\b/g;
  while ((match = forPattern2.exec(code)) !== null) {
    if (isInSkipRegion(match.index, skipRegions)) continue;
    if (match[1]) defined.add(match[1]);
    if (match[2]) defined.add(match[2]);
  }
  
  // Find except handler variables: except ex (E_...)
  const exceptPattern = /except\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  while ((match = exceptPattern.exec(code)) !== null) {
    if (isInSkipRegion(match.index, skipRegions)) continue;
    if (match[1]) defined.add(match[1]);
  }
  
  // Find fork variables: fork name (seconds)
  const forkPattern = /fork\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  while ((match = forkPattern.exec(code)) !== null) {
    if (isInSkipRegion(match.index, skipRegions)) continue;
    if (match[1]) defined.add(match[1]);
  }

  // Check for undefined variables being accessed
  const checkRegex = new RegExp(checkPattern.source, 'g');
  const checked = new Map<string, number[]>(); // variable -> positions

  while ((match = checkRegex.exec(code)) !== null) {
    const varName = match[1];
    
    // Skip if in comment/string
    if (isInSkipRegion(match.index, skipRegions)) continue;
    
    // Skip if it starts with $ or @ (object/system references)
    if (varName.startsWith('$') || varName.startsWith('@')) {
      continue;
    }
    
    // Skip if it's a keyword, built-in, or storage type
    if (keywords.has(varName) || builtinFunctions.has(varName) || 
        typeConstants.has(varName) || storageTypes.has(varName)) {
      continue;
    }
    
    if (!checked.has(varName)) {
      checked.set(varName, []);
    }
    checked.get(varName)!.push(match.index);
  }

  // Report undefined variables
  checked.forEach((positions, varName) => {
    if (!defined.has(varName)) {
      positions.forEach(pos => {
        diagnostics.push({
          from: pos,
          to: pos + varName.length,
          severity: 'warning',
          message: `Variable '${varName}' may not be defined`,
          source: 'moocode'
        });
      });
    }
  });

  return diagnostics;
});

// ============================================================================
// Public API
// ============================================================================

/**
 * Returns the MOOcode language extension for CodeMirror 6.
 * 
 * @param options - Configuration options
 * @param options.linting - Enable/disable linting (default: true)
 * @returns Extension array to use with CodeMirror
 * 
 * @example
 * ```typescript
 * import { moocode } from './moocode-lang';
 * 
 * // With linting enabled (default)
 * const extensions = [moocode()];
 * 
 * // Without linting
 * const extensions = [moocode({ linting: false })];
 * ```
 */
export function moocode(options: { linting?: boolean } = {}): Extension {
  const { linting = true } = options;
  
  const extensions: Extension[] = [
    moocodeLanguage,
  ];

  if (linting) {
    extensions.push(moocodeLinter);
  }

  return extensions;
}

/**
 * The MOOcode StreamLanguage definition
 * Useful if you need direct access to the language for advanced configurations
 */
export { moocodeLanguage };

/**
 * The MOOcode linter extension
 * Can be used separately if you want custom configuration
 */
export { moocodeLinter };

/**
 * Sets of language tokens for external use
 */
export const mooTokens = {
  keywords,
  storageTypes,
  languageVariables,
  typeConstants,
  builtinFunctions
};

