// Completion for Rust without a language server: keywords, snippets, common
// std names and methods, and the words already in the file. After `.` it
// offers every common method name, unless type-aware completion
// (web/types.js) finds the methods of the type there.
import { completeAnyWord, snippetCompletion as snip } from "@codemirror/autocomplete";

const KEYWORDS = ("as async await break const continue crate dyn else enum extern false fn for if impl in let " +
  "loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while")
  .split(" ");

const TYPES = ("Vec String Option Some None Result Ok Err Box Rc Arc RefCell Cell Mutex RwLock HashMap HashSet " +
  "BTreeMap BTreeSet VecDeque BinaryHeap Ordering Iterator IntoIterator Default Clone Copy Debug Display " +
  "PartialEq Eq PartialOrd Ord Hash From Into TryFrom TryInto AsRef Fn FnMut FnOnce Drop Send Sync Sized " +
  "i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str").split(" ");

const MACROS = "println print eprintln eprint format vec assert assert_eq assert_ne panic todo unimplemented unreachable write writeln dbg matches"
  .split(" ");

const METHODS = ("abs as_bytes as_mut as_ref as_slice as_str borrow borrow_mut bytes capacity chain chars chunks " +
  "clear clone cloned collect contains contains_key copied count dedup drain ends_with entry enumerate eq " +
  "expect extend filter filter_map find first flat_map flatten fold for_each get get_mut get_or_insert " +
  "insert into_iter is_empty is_err is_none is_ok is_some iter iter_mut join keys last len lines lock map " +
  "map_err max max_by_key min min_by_key next ok ok_or or_insert or_insert_with parse partial_cmp peekable " +
  "pop pop_front position pow product push push_back push_front push_str read_line remove replace retain " +
  "rev skip sort sort_by sort_by_key sort_unstable split split_whitespace sqrt starts_with step_by sum swap " +
  "take take_while to_lowercase to_owned to_string to_uppercase trim truncate unwrap unwrap_or " +
  "unwrap_or_default unwrap_or_else values windows with_capacity zip").split(" ");

const COMMON = new Set(METHODS);

/** Associated functions, offered after `::`. */
const ASSOC = "new with_capacity from default from_str from_utf8 now spawn channel stdin stdout".split(" ");

const SNIPPETS = [
  snip("fn ${name}(${}) {\n\t${}\n}", { label: "fn", detail: "function", type: "keyword" }),
  snip("for ${item} in ${iter} {\n\t${}\n}", { label: "for", detail: "loop", type: "keyword" }),
  snip("if ${cond} {\n\t${}\n}", { label: "if", detail: "block", type: "keyword" }),
  snip("if let Some(${x}) = ${expr} {\n\t${}\n}", { label: "if let", detail: "block", type: "keyword" }),
  snip("match ${expr} {\n\t${pattern} => ${},\n}", { label: "match", detail: "block", type: "keyword" }),
  snip("while ${cond} {\n\t${}\n}", { label: "while", detail: "loop", type: "keyword" }),
  snip("struct ${Name} {\n\t${field}: ${Type},\n}", { label: "struct", detail: "definition", type: "keyword" }),
  snip("impl ${Type} {\n\t${}\n}", { label: "impl", detail: "block", type: "keyword" }),
  snip("#[derive(Debug, Clone, PartialEq)]", { label: "derive", detail: "attribute", type: "keyword" }),
];

const options = (names, type, apply = (n) => n) => names.map((n) => ({ label: n, type, apply: apply(n) }));
const GENERAL = [
  ...SNIPPETS,
  ...options(KEYWORDS, "keyword"),
  ...options(TYPES, "type"),
  ...MACROS.map((m) => snip(`${m}!(\${})`, { label: `${m}!`, type: "function" })),
];
const AFTER_DOT = options(METHODS, "method");
const AFTER_PATH = [...options(ASSOC, "function"), ...options(TYPES, "type")];

/** The completion source: what fits before the cursor, plus the file's
 *  own words. After a dot, `typeMethods(doc, from, to)` (if it returns a
 *  list rather than null) gives the methods of the type before the dot. */
export function rustCompletions(typeMethods = () => null) {
  return async (context) => {
    const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*!?$/);
    const from = word?.from ?? context.pos;
    const before = context.state.sliceDoc(Math.max(0, from - 2), from);
    if (!word && !context.explicit && !before.endsWith(".")) return null;
    if (before.endsWith(".")) {
      const typed = await typeMethods(context.state.doc.toString(), from, context.pos);
      // Common methods first.
      if (typed) return { from, options: typed.map((o) => (COMMON.has(o.label) ? { ...o, boost: 1 } : o)), validFor: /^\w*$/ };
    }
    const list = before.endsWith(".") ? AFTER_DOT : before === "::" ? AFTER_PATH : GENERAL;
    const words = (await completeAnyWord(context))?.options ?? [];
    const known = new Set(list.map((o) => o.label));
    return {
      from,
      options: [...list, ...words.filter((w) => !known.has(w.label))],
      validFor: /^[A-Za-z0-9_]*!?$/,
    };
  };
}
