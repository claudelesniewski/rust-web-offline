// The command palette and quick open (Ctrl-Shift-P, Ctrl-P): what is typed
// picks items by a fuzzy match, its letters in order but not necessarily
// together, ignoring case.

const wordStart = (text, i) => i === 0 || !/[a-z0-9]/i.test(text[i - 1]);

/** How well `query` matches `text`, higher being better, or null if its
 *  letters aren't all in `text`, in order. Letters next to each other, at
 *  the start of a word, or at the very start count for more; gaps, less. */
export function score(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let best = null;
  // Greedy from each place the first letter is, keeping the best.
  for (let start = t.indexOf(q[0]); start >= 0; start = t.indexOf(q[0], start + 1)) {
    let s = 0;
    let at = start - 1;
    for (const c of q) {
      const i = t.indexOf(c, at + 1);
      if (i < 0) { s = null; break; }
      s += 1 + (i === at + 1 && at >= start ? 5 : 0) + (wordStart(t, i) ? 3 : 0) - Math.min(i - at - 1, 5) * 0.1;
      at = i;
    }
    if (s === null) break; // a later start can't match either
    if (start === 0) s += 10;
    if (best === null || s > best) best = s;
  }
  return best;
}

/** The `items` that match `query`, best first (in their order when equal),
 *  each matched by `label(item)`. */
export function rank(query, items, label = (item) => item) {
  return items
    .map((item, i) => ({ item, i, s: score(query, label(item)) }))
    .filter(({ s }) => s !== null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ item }) => item);
}
