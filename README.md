# query-selector-shadow-dom-modern

[![Release](https://github.com/kaixinol/query-selector-shadow-dom-modern/actions/workflows/release.yml/badge.svg)](https://github.com/kaixinol/query-selector-shadow-dom-modern/actions/workflows/release.yml)

Modern drop-in replacement for [query-selector-shadow-dom](https://www.npmjs.com/package/query-selector-shadow-dom). Zero dependencies, full TypeScript support.

querySelector that can pierce Shadow DOM roots without knowing the path through nested shadow roots. Useful for automated testing of Web Components (Selenium, Puppeteer, Playwright, etc.).

> **Heads-up if you are migrating:** one upstream bug is fixed — the child combinator `>` now
> follows the CSS spec instead of degrading into a descendant combinator. It is the only behavioural
> difference from `query-selector-shadow-dom`; see [Fixed: the child combinator](#fixed-the-child-combinator-).

## Install

```sh
npm install query-selector-shadow-dom-modern
# or
pnpm add query-selector-shadow-dom-modern
# or
yarn add query-selector-shadow-dom-modern
```

## Usage

```ts
import { querySelectorDeep, querySelectorAllDeep, collectAllElementsDeep } from 'query-selector-shadow-dom-modern';

// Find first matching element (pierces shadow roots)
const btn = querySelectorDeep('.btn-in-shadow-dom');

// Find all matching elements
const items = querySelectorAllDeep('my-component .item');

// Collect all elements on the page, including shadow DOM
const all = collectAllElementsDeep();
const filtered = collectAllElementsDeep('a[href]');
```

### UMD (browser)

```html
<!-- Via CDN, minified (~2.5 KB gzipped) -->
<script src="https://cdn.jsdelivr.net/npm/query-selector-shadow-dom-modern/dist/umd/index.min.js"></script>
<!-- Or unpkg -->
<script src="https://unpkg.com/query-selector-shadow-dom-modern/dist/umd/index.min.js"></script>
<!-- Debuggable full build (with sourcemap): use dist/umd/index.js instead of index.min.js -->
<script>
  const btn = querySelectorShadowDom.querySelectorDeep('.btn-in-shadow-dom');
</script>
```

## API

- `querySelectorDeep(selector, root?)` — Returns the first matching element, piercing shadow roots
- `querySelectorAllDeep(selector, root?)` — Returns an array of all matching elements, piercing shadow roots
- `collectAllElementsDeep(selector?, root?)` — Collects all elements on the page, including those within shadow roots. Optionally filters by a CSS selector

Both `root` defaults to `document`. Pass a custom root to scope the search (e.g., an iframe's `contentDocument`).
All three also accept the original library's third argument (a pre-collected element list).

## Drop-in compatibility

Verified against `query-selector-shadow-dom@1.0.1` with a differential harness that loads **both
libraries into the same page** and compares results by element identity:

```sh
pnpm verify:diff                           # deterministic matrix (14 fixtures x 78 selectors)
pnpm verify:diff -- --fuzz=4000 --seed=1   # + randomized DOM/selector fuzzing
pnpm verify:page -- --out=/tmp/diff.html   # self-contained page, for the chrome-devtools MCP
```

The last command writes a page with both libraries and the harness inlined, so the same sweep can
be driven from the chrome-devtools MCP (or a browser opened by hand):

```js
// evaluate_script on the generated page
() => window.runSweep({ fuzz: 3000, seed: 42 })
// => { checks: 18828, realDifferences: 0, childCombinatorFixes: 14, verdict: 'IDENTICAL', ... }
```

Latest run: **4 seeds x ~19k comparisons (≈75k total), 0 real differences** in real
Chrome, covering nested/open/closed shadow roots, slots, light+shadow mixes, sibling and child
combinators, quoted/bracketed attributes, pseudo-classes, CSS comments, scoped element roots, the
cached-list third argument, plus empty and invalid selectors (which throw the same way). Both the
playwright and the chrome-devtools-MCP driver produce identical numbers.

Every comparison falls into one of three buckets:

| bucket | expected | meaning |
| --- | --- | --- |
| real differences | **0** | a genuine behavioural regression |
| `>` fixes | any | differences on selectors using `>` — the upstream bug below being fixed |
| dedupe-only | any | the improvement described below |

### Fixed: the child combinator `>`

The original re-tests a `>` group at every ancestor while climbing the composed tree, so `>`
silently degrades into a descendant combinator. Given
`<ul class="c1"><li class="c1"><div class="c1"></div></li></ul>`:

| `querySelectorAllDeep('ul.c1 > .c1')` | result |
| --- | --- |
| native `document.querySelectorAll` | `[li]` |
| query-selector-shadow-dom | `[li, div]` |
| **this library** | **`[li]`** |

`a > b` means "a is b's composed parent", so `>` also works across a shadow boundary:
`my-host > .panel` matches the shadow root's child. If you are migrating and something stopped
matching, `>` is the thing to check — the old behaviour was `a b` in disguise.

Other intentional differences, both safe improvements:

1. **Results are de-duplicated.** The original can return the same element twice when it matches
   more than one comma-separated part (`.a, .a`). This library never does, matching
   `querySelectorAll` semantics.
2. **An unmatchable selector is rejected.** Invalid selectors still throw the same
   `SyntaxError`/`DOMException`; only the wording of the message can differ (both come from the
   browser).

Everything else — including the remaining quirks — is reproduced on purpose: the composed result
order, per-comma-part grouping, and never matching the boundary element itself when a search is
scoped to an element.

## Performance

`pnpm benchmark` runs both libraries against the same DOM in the same page (median of alternating
rounds). Typical results on Chrome 153 (µs/op, lower is better):

| Scenario | original | modern | speedup |
| --- | --- | --- | --- |
| Deep mixed shadow & slot (`querySelectorDeep`) | 48 | 35 | 1.37x |
| 7-level nested tree (`querySelectorDeep`) | 34 | 23 | 1.48x |
| `.class` across 100 heavy shadow roots | 145 | 81 | 1.79x |
| `.metric-item` across 100 roots (`querySelectorAllDeep`) | 354 | 199 | 1.78x |
| Unique selector every call (parse-cache miss) | 195 | 76 | 2.57x |
| Cross-boundary combinator + attribute | 51 | 15 | 3.40x |
| Comma-separated multi-boundary (`querySelectorAllDeep`) | 10 | 2 | 5.00x |
| Scoped element root | 14 | 9 | 1.56x |
| Pure light DOM `querySelectorAll` | 138 | 83 | 1.66x |

**Overall: 1.68x faster by sum, 1.66x geometric mean, faster on 17 of 19 measured cases**, with the
remaining cases at parity. The wins come from letting native `querySelector(All)` do the filtering
(whole-selector fast path when there is no shadow DOM — now including `>` selectors — per-root
pre-filter otherwise), a memoized selector parser, and a single tree walk instead of the original's
two. Set `ROUNDS=15 pnpm benchmark` for a lower-noise run.

## License

MIT
