/**
 * query-selector-shadow-dom-modern
 *
 * Drop-in replacement for https://www.npmjs.com/package/query-selector-shadow-dom
 * with the same public API:
 *
 *   - querySelectorDeep(selector, root?, allElements?)
 *   - querySelectorAllDeep(selector, root?, allElements?)
 *   - collectAllElementsDeep(selector?, root?, cachedElements?)
 *
 * but faster and safer:
 *   - Native `querySelector(All)` does the heavy lifting whenever possible
 *     (whole-selector fast path when no shadow roots are involved, and a
 *     per-root pre-filter on the right-most compound selector otherwise).
 *   - Selector parsing is memoized (strings are immutable — safe to cache).
 *   - No DOM caching: results are always computed from the live tree, so
 *     dynamic pages never see stale data.
 *   - Full combinator support across shadow boundaries: ` `, `>`, `+`, `~`.
 *   - Cross-realm safe (iframe documents): no `instanceof` on DOM classes.
 *
 * One upstream bug is fixed: the original re-tests a `>` group at every
 * ancestor, which silently turns the child combinator into a descendant
 * combinator. Here `a > b` means "a is b's composed parent", exactly like a
 * native `querySelector` — just extended across shadow boundaries.
 */

export type QueryableNode = Document | DocumentFragment | Element;

const ELEMENT_NODE = 1;
const DOCUMENT_FRAGMENT_NODE = 11;

/** Cross-realm-safe Element check (`instanceof` fails across frames). */
function isElementNode(node: unknown): node is Element {
    return !!node && (node as Node).nodeType === ELEMENT_NODE;
}

/** Cross-realm-safe ShadowRoot check. */
function isHostedFragment(node: unknown): node is ShadowRoot {
    return (
        !!node &&
        (node as Node).nodeType === DOCUMENT_FRAGMENT_NODE &&
        !!(node as ShadowRoot).host
    );
}

/**
 * `el.matches()` that never throws (context-dependent pseudo-classes etc.).
 * When `state` is provided, a rejected selector is recorded so the caller can
 * re-validate and throw exactly like the original library does.
 */
function matchesSelector(
    el: Element,
    compound: string,
    state?: { invalid: boolean },
): boolean {
    try {
        return el.matches(compound);
    } catch {
        if (state) state.invalid = true;
        return false;
    }
}

/**
 * Parent in the composed (flat-ish) tree: crosses shadow boundaries towards
 * the host, and stops at the boundary the search was scoped to.
 * Matches the original library's findParentOrHost semantics.
 */
function composedParent(el: Element, boundary: QueryableNode): Element | null {
    if (el === boundary) return null;
    const parent = el.parentElement;
    // The search is scoped to `boundary`: the original library stops there and
    // never matches the boundary element itself from the inside.
    if (parent === boundary) return null;
    if (parent) return parent;
    const rootNode = el.getRootNode();
    if (rootNode === el || rootNode === boundary) return null;
    if (isHostedFragment(rootNode)) return rootNode.host;
    return null;
}

/**
 * The right-most compound of the last group — this is the compound the original
 * library pre-filters candidates with (note that `+` / `~` stay part of it).
 */
function rightMostCompound(groups: string[][]): string {
    const last = groups[groups.length - 1];
    return last[last.length - 1];
}

/**
 * Regroup tokenized compounds the way the original library does:
 *   - `>` keeps compounds in the same group ("a > b" → ["a", "b"])
 *   - whitespace starts a new group ("a b" → ["a"], ["b"])
 *   - `+` / `~` stay *inside* a compound and are resolved by native `matches()`
 */
function buildGroups(tokens: string[]): string[][] {
    const groups: string[][] = [];
    let group: string[] = [];
    let current = '';
    const flushCompound = () => {
        if (current) {
            group.push(current);
            current = '';
        }
    };

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token === ' ') {
            flushCompound();
            if (group.length) groups.push(group);
            group = [];
        } else if (token === '>') {
            flushCompound();
        } else if (token === '+' || token === '~') {
            current += token + (tokens[++i] ?? '');
        } else {
            current = token;
        }
    }
    flushCompound();
    if (group.length) groups.push(group);
    return groups;
}

/**
 * Verify that `el` (already known to match the right-most compound) satisfies
 * the whole selector path.
 *
 * A group is a chain of `>`-separated compounds that must match contiguous
 * composed ancestors; groups are separated from each other by a descendant
 * combinator, so each one is searched for at the current anchor and above it.
 * That is what a native `querySelector` would return on the flattened tree.
 *
 * The original library instead climbs the composed tree and re-tests the whole
 * group at every level, which is where its `a > b` degrades into `a b`.
 */
function matchesComposedPath(el: Element, groups: string[][], boundary: QueryableNode): boolean {
    let anchor = matchGroupAt(el, groups[groups.length - 1], boundary);
    if (!anchor) return false;

    // Groups to the left are joined by a descendant combinator → climb until
    // one of them matches.
    let walker = composedParent(anchor, boundary);
    for (let g = groups.length - 2; g >= 0; g--) {
        let hit: Element | null = null;
        let node: Element | null = walker;
        while (node) {
            hit = matchGroupAt(node, groups[g], boundary);
            if (hit) break;
            node = composedParent(node, boundary);
        }
        if (!hit) return false;
        walker = composedParent(hit, boundary);
    }
    return true;
}

/**
 * Match a `>`-separated run of compounds with its right-most compound anchored
 * at `node`. Returns the element the left-most compound matched (the anchor for
 * whatever sits further to the left), or null when the chain breaks.
 */
function matchGroupAt(
    node: Element,
    group: string[],
    boundary: QueryableNode,
): Element | null {
    let walker: Element | null = node;
    for (let k = group.length - 1; k >= 0; k--) {
        if (!walker || !matchesSelector(walker, group[k])) return null;
        if (k > 0) walker = composedParent(walker, boundary);
    }
    return walker;
}


/**
 * All queryable roots below (and including) `root`: the root itself plus every
 * open shadow root found underneath, in discovery order. Computed fresh on
 * every call — never cached, so dynamic DOMs are always correct.
 */
interface TreeScan {
    /** The root itself plus every open shadow root underneath. */
    roots: QueryableNode[];
    /** All elements in the original library's composed pre-order (when requested). */
    elements: Element[];
}

/**
 * One walk of the tree that collects both the queryable roots and — when the
 * caller needs result ordering — every element in composed pre-order. Doing it
 * in a single pass is what keeps `querySelectorAllDeep` from paying for two
 * full traversals. Computed fresh on every call, never cached, so dynamic DOMs
 * are always correct.
 */
function collectTree(root: QueryableNode, withElements: boolean): TreeScan {
    const roots: QueryableNode[] = [root];
    const elements: Element[] = [];

    const walk = (scope: QueryableNode) => {
        const all = scope.querySelectorAll('*');
        for (let i = 0; i < all.length; i++) {
            const el = all[i];
            if (withElements) elements.push(el);
            const shadowRoot = el.shadowRoot;
            if (shadowRoot) {
                roots.push(shadowRoot);
                walk(shadowRoot);
            }
        }
    };

    if (isElementNode(root) && root.shadowRoot) {
        roots.push(root.shadowRoot);
        walk(root.shadowRoot);
    }
    walk(root);
    return { roots, elements };
}

/**
 * Collect every element under `root` in the original library's order
 * (composed tree pre-order: a host's shadow content comes immediately after
 * the host element). One native `querySelectorAll('*')` per root — the
 * browser does the walking.
 */
function collectAllElements(
    root: QueryableNode,
    filter?: string,
    state?: { invalid: boolean },
): Element[] {
    const out: Element[] = [];
    // A root element's own shadow content is listed first (original behavior).
    const ownShadow = (root as Element).shadowRoot;
    if (ownShadow) collectList(ownShadow.querySelectorAll('*'), out, filter, state);
    collectList(root.querySelectorAll('*'), out, filter, state);
    return out;
}

function collectList(
    list: NodeListOf<Element>,
    out: Element[],
    filter?: string,
    state?: { invalid: boolean },
): void {
    if (filter) {
        for (let i = 0; i < list.length; i++) {
            const el = list[i];
            if (matchesSelector(el, filter, state)) out.push(el);
            const shadowRoot = el.shadowRoot;
            if (shadowRoot) collectList(shadowRoot.querySelectorAll('*'), out, filter, state);
        }
        return;
    }
    for (let i = 0; i < list.length; i++) {
        const el = list[i];
        out.push(el);
        const shadowRoot = el.shadowRoot;
        if (shadowRoot) collectList(shadowRoot.querySelectorAll('*'), out, filter, state);
    }
}

/**
 * Generator variant of the same traversal, for callers that can stop early.
 */
function* iterateDeep(root: QueryableNode): Generator<Element, void, undefined> {
    const stack: Element[] = [];
    const pushChildren = (scope: QueryableNode) => {
        const kids = scope.children;
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    };

    if (isElementNode(root)) {
        pushChildren(root);
        if (root.shadowRoot) pushChildren(root.shadowRoot);
    } else {
        pushChildren(root);
    }

    while (stack.length > 0) {
        const el = stack.pop()!;
        yield el;
        pushChildren(el);
        if (el.shadowRoot) pushChildren(el.shadowRoot);
    }
}

/** One comma-separated selector part: the raw text plus its [compound, combinator, ...] tokens. */
interface SelectorPart {
    raw: string;
    tokens: string[];
    /** Compounds regrouped the way the original library matches them. */
    groups: string[][];
}

interface ParsedSelector {
    parts: SelectorPart[];
    /** Comment-free, trimmed equivalent of the input — used for native queries. */
    normalized: string;
}

const PARSE_CACHE_LIMIT = 512;
const parseCache = new Map<string, ParsedSelector>();

/** Split into comma-separated parts, each tokenized as [compound, combinator, ...]. Memoized. */
function parseSelector(selector: string): ParsedSelector {
    const cached = parseCache.get(selector);
    if (cached) return cached;

    const parts: SelectorPart[] = [];
    for (const part of splitByComma(selector)) {
        const tokens = tokenizePath(part);
        if (tokens.length > 0) parts.push({ raw: part, tokens, groups: buildGroups(tokens) });
    }
    const parsed: ParsedSelector = {
        parts,
        normalized: parts.map((p) => p.raw).join(', '),
    };

    if (parseCache.size >= PARSE_CACHE_LIMIT) parseCache.clear();
    parseCache.set(selector, parsed);
    return parsed;
}

/**
 * Candidates for one tokenized selector part: elements matching the
 * right-most compound, natively pre-filtered inside each root.
 * Returns the candidates either as a single ordered list (when only one root
 * produced hits) or as a Set plus a flag that a composed-order walk is needed.
 */
function collectCandidates<T extends Element>(
    roots: QueryableNode[],
    rightMostCompound: string,
): { list: T[] | null; set: Set<T> | null; rootsWithHits: number; invalid: boolean } {
    let list: T[] | null = null;
    let set: Set<T> | null = null;
    let rootsWithHits = 0;
    let invalid = false;

    for (const root of roots) {
        let found: NodeListOf<T>;
        try {
            found = root.querySelectorAll<T>(rightMostCompound);
        } catch {
            invalid = true; // selector rejected by the engine — re-checked before returning
            continue;
        }
        if (found.length === 0) continue;
        rootsWithHits++;
        if (!list) {
            list = Array.from(found);
        } else {
            if (!set) set = new Set(list);
            for (let i = 0; i < found.length; i++) set.add(found[i]);
        }
    }
    return { list, set, rootsWithHits, invalid };
}

/**
 * The original library always runs a native `root.querySelector(selector)`
 * first, so an invalid selector throws a SyntaxError instead of silently
 * returning "not found". We only pay for that check on the rare paths where
 * the selector looks suspicious (nothing parsed, or rejected by the engine),
 * which keeps the happy path fast while staying behaviour-compatible.
 */
function assertValidSelector(root: QueryableNode, selector: string): void {
    root.querySelector(selector);
}

/**
 * Same idea for the filter of `collectAllElementsDeep`: the original throws
 * from `Element.matches()`, so re-run a native match to reproduce it.
 */
function assertValidFilter(root: QueryableNode, filter: string): void {
    const probe = root.querySelector('*');
    if (probe) probe.matches(filter);
}

/**
 * Finds the first matching element on the page, piercing any number of nested
 * shadow roots. Same signature and semantics as the original library.
 */
export function querySelectorDeep<T extends Element = HTMLElement>(
    selector: string,
    root: QueryableNode = document,
    allElements: Element[] | null = null,
): T | null {
    if (selector == null) return null;

    const { parts, normalized } = parseSelector(selector);

    // Native fast path — identical to the original library: a plain
    // light-DOM match always wins, no matter what lives in shadow roots.
    // (Also makes invalid selectors throw exactly like the original.)
    const lightElement = root.querySelector<T>(normalized);
    if (lightElement) return lightElement;

    if (parts.length === 0) {
        assertValidSelector(root, normalized);
        return null;
    }

    // Caller-supplied element list (original API's third argument).
    if (allElements) {
        let invalid = false;
        const match = (el: Element, compound: string): boolean => {
            try {
                return el.matches(compound);
            } catch {
                invalid = true;
                return false;
            }
        };
        for (const part of parts) {
            const last = rightMostCompound(part.groups);
            const single = part.groups.length === 1 && part.groups[0].length === 1;
            for (const el of allElements) {
                if (match(el, last) && (single || matchesComposedPath(el, part.groups, root))) {
                    return el as T;
                }
            }
        }
        if (invalid) assertValidSelector(root, normalized);
        return null;
    }

    const { roots, elements } = collectTree(root, true);
    // Without shadow roots the native query above is authoritative: `>` is
    // matched exactly the way the engine matches it (see matchesComposedPath),
    // so there is nothing left to find.
    if (roots.length === 1) return null;

    // Few roots + many elements → let the browser pre-filter with one native
    // query per root. Many tiny roots → a single scan in composed order is
    // cheaper than the per-query overhead (and it can stop at the first hit).
    const nativePerRoot = roots.length * 4 <= elements.length;
    const state = { invalid: false };

    for (const part of parts) {
        const last = rightMostCompound(part.groups);
        const single = part.groups.length === 1 && part.groups[0].length === 1;

        if (!nativePerRoot) {
            if (elements.length === 0) {
                assertValidSelector(root, normalized);
                continue;
            }
            for (let i = 0; i < elements.length; i++) {
                const el = elements[i] as T;
                if (!matchesSelector(el, last, state)) continue;
                if (single || matchesComposedPath(el, part.groups, root)) return el;
            }
            continue;
        }

        const { list, set, rootsWithHits, invalid } = collectCandidates<T>(roots, last);
        if (invalid) state.invalid = true;
        if (!list) continue;

        const verified = (el: T): boolean =>
            single || matchesComposedPath(el, part.groups, root);

        if (rootsWithHits === 1) {
            // All candidates live in a single root → that root's native order is composed order.
            for (const el of list) {
                if (verified(el)) return el;
            }
        } else {
            const candidates = set ?? new Set(list);
            for (const el of iterateDeep(root)) {
                if (candidates.has(el as T) && verified(el as T)) return el as T;
            }
        }
    }
    if (state.invalid) assertValidSelector(root, normalized);
    return null;
}

/**
 * Finds all matching elements on the page, piercing any number of nested
 * shadow roots. Same signature and semantics as the original library
 * (results are additionally de-duplicated).
 */
export function querySelectorAllDeep<T extends Element = HTMLElement>(
    selector: string,
    root: QueryableNode = document,
    allElements: Element[] | null = null,
): T[] {
    if (selector == null) return [];

    const { parts, normalized } = parseSelector(selector);
    if (parts.length === 0) {
        assertValidSelector(root, normalized);
        return [];
    }

    // Caller-supplied element list (original API's third argument).
    if (allElements) {
        const out: T[] = [];
        const seen = new Set<Element>();
        let invalid = false;
        const match = (el: Element, compound: string): boolean => {
            try {
                return el.matches(compound);
            } catch {
                invalid = true;
                return false;
            }
        };
        for (const part of parts) {
            const last = rightMostCompound(part.groups);
            const single = part.groups.length === 1 && part.groups[0].length === 1;
            for (const el of allElements) {
                if (seen.has(el) || !match(el, last)) continue;
                if (single || matchesComposedPath(el, part.groups, root)) {
                    seen.add(el);
                    out.push(el as T);
                }
            }
        }
        if (invalid) assertValidSelector(root, normalized);
        return out;
    }

    const { roots, elements } = collectTree(root, true);

    // No shadow roots below `root` → hand everything to the browser, one comma
    // part at a time so results keep the original's per-part grouping (and an
    // invalid part still throws). Only safe for non-element roots: the original
    // never matches the boundary element itself, while a native query on an
    // element root does (e.g. `querySelectorAllDeep('div > span', divRoot)`).
    if (roots.length === 1 && !isElementNode(root)) {
        const out: T[] = [];
        const seen = new Set<T>();
        for (const part of parts) {
            for (const el of root.querySelectorAll<T>(part.raw)) {
                if (seen.has(el)) continue;
                seen.add(el);
                out.push(el);
            }
        }
        return out;
    }

    const results: T[] = [];
    const seen = new Set<T>();
    const state = { invalid: false };
    // Two ways to find the candidates for a comma part:
    //   - one native query per root: cheap when there are few roots and many
    //     elements (the browser does the filtering);
    //   - a single JS pass over the composed element list: cheaper when there
    //     are many tiny roots, where per-query overhead would dominate.
    const nativePerRoot = roots.length * 4 <= elements.length;

    for (const part of parts) {
        const last = rightMostCompound(part.groups);
        const single = part.groups.length === 1 && part.groups[0].length === 1;

        if (!nativePerRoot) {
            if (elements.length === 0) {
                // Nothing to match against, so an invalid selector would slip
                // through unnoticed — validate it the way the original does.
                assertValidSelector(root, normalized);
                continue;
            }
            for (let i = 0; i < elements.length; i++) {
                const el = elements[i] as T;
                if (seen.has(el) || !matchesSelector(el, last, state)) continue;
                if (single || matchesComposedPath(el, part.groups, root)) {
                    seen.add(el);
                    results.push(el);
                }
            }
            continue;
        }

        const { list, set, rootsWithHits, invalid } = collectCandidates<T>(roots, last);
        if (invalid) state.invalid = true;
        if (!list) continue;

        if (rootsWithHits === 1) {
            // All candidates live in a single root → that root's native order is composed order.
            for (const el of list) {
                if (seen.has(el)) continue;
                if (single || matchesComposedPath(el, part.groups, root)) {
                    seen.add(el);
                    results.push(el);
                }
            }
        } else {
            // Candidates spread across roots → merge in composed tree order.
            const candidates = set ?? new Set(list);
            for (let i = 0; i < elements.length; i++) {
                const el = elements[i] as T;
                if (!candidates.has(el) || seen.has(el)) continue;
                if (single || matchesComposedPath(el, part.groups, root)) {
                    seen.add(el);
                    results.push(el);
                }
            }
        }
    }
    if (state.invalid) assertValidSelector(root, normalized);
    return results;
}

/**
 * Finds all elements on the page, inclusive of those within shadow roots.
 * Optionally filtered by a CSS selector.
 * Same signature and semantics as the original library.
 */
export function collectAllElementsDeep<T extends Element = HTMLElement>(
    selector: string | null = null,
    root: QueryableNode = document,
    cachedElements: Element[] | null = null,
): T[] {
    // The original only checks `selector ? ... : ...` (it never trims here), so
    // an empty string means "no filter" while a blank one is handed to
    // `matches()` and throws — bug-for-bug compatible.
    const filter = selector ? selector : undefined;

    if (cachedElements) {
        const all = cachedElements as T[];
        if (!filter) return all;
        let invalid = false;
        const out = all.filter((el) => {
            try {
                return el.matches(filter);
            } catch {
                invalid = true;
                return false;
            }
        });
        if (invalid) assertValidFilter(cachedElements[0], filter);
        return out;
    }

    // Single pass: elements are filtered while the tree is being walked.
    const state = { invalid: false };
    const out = collectAllElements(root, filter, state) as T[];
    if (state.invalid && filter) assertValidFilter(root, filter);
    return out;
}

/**
 * Split a selector list on top-level commas (ignores commas inside quotes,
 * attribute brackets and pseudo-class parentheses).
 */
export function splitByComma(selector: string): string[] {
    if (!selector || !selector.trim()) return [];

    const results: string[] = [];
    let current = '';
    let parenDepth = 0;
    let bracketDepth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escaped = false;

    for (let i = 0; i < selector.length; i++) {
        const char = selector[i];

        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }

        if (char === '\\') {
            escaped = true;
            current += char;
            continue;
        }

        if (char === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            current += char;
            continue;
        }

        if (char === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            current += char;
            continue;
        }

        if (!inSingleQuote && !inDoubleQuote) {
            // CSS comments are stripped by the original library's normalizer —
            // replace them with a space so commas inside a comment never split
            // a part and the raw part stays valid for native queries.
            if (char === '/' && selector[i + 1] === '*') {
                const end = selector.indexOf('*/', i + 2);
                i = end === -1 ? selector.length : end + 1;
                current += ' ';
                continue;
            }
            if (char === '(') parenDepth++;
            else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
            else if (char === '[') bracketDepth++;
            else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
            else if (char === ',' && parenDepth === 0 && bracketDepth === 0) {
                results.push(current.trim());
                current = '';
                continue;
            }
        }

        current += char;
    }

    if (current.trim()) {
        results.push(current.trim());
    }

    return results;
}

/**
 * Tokenize a CSS selector into compounds and combinators:
 * 'div > p span' → ['div', '>', 'p', ' ', 'span'].
 */
export function tokenizePath(selector: string): string[] {
    if (!selector || !selector.trim()) return [];

    const tokens: string[] = [];
    let current = '';
    let parenDepth = 0;
    let bracketDepth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escaped = false;

    const pushCurrent = () => {
        const trimmed = current.trim();
        if (trimmed) {
            tokens.push(trimmed);
        }
        current = '';
    };

    // Emit the implicit descendant combinator when two compounds are separated
    // by whitespace and/or a CSS comment (the original library normalizes
    // comments to whitespace before parsing).
    const pushDescendantIfNeeded = (nextIndex: number) => {
        let nextChar = '';
        for (let j = nextIndex; j < selector.length; j++) {
            if (!/\s/.test(selector[j])) {
                nextChar = selector[j];
                break;
            }
        }
        const lastToken = tokens[tokens.length - 1];
        const isLastCombinator =
            lastToken === ' ' || lastToken === '>' || lastToken === '+' || lastToken === '~';
        if (
            tokens.length > 0 &&
            !isLastCombinator &&
            nextChar &&
            nextChar !== '>' &&
            nextChar !== '+' &&
            nextChar !== '~'
        ) {
            tokens.push(' ');
        }
    };

    for (let i = 0; i < selector.length; i++) {
        const char = selector[i];

        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }

        if (char === '\\') {
            escaped = true;
            current += char;
            continue;
        }

        if (char === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            current += char;
            continue;
        }

        if (char === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            current += char;
            continue;
        }

        if (!inSingleQuote && !inDoubleQuote) {
            // A CSS comment acts as whitespace (original: normalizeSelector).
            if (char === '/' && selector[i + 1] === '*') {
                pushCurrent();
                const end = selector.indexOf('*/', i + 2);
                i = end === -1 ? selector.length : end + 1;
                pushDescendantIfNeeded(i + 1);
                continue;
            }

            if (char === '(') parenDepth++;
            else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
            else if (char === '[') bracketDepth++;
            else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);

            if (parenDepth === 0 && bracketDepth === 0) {
                if (char === '>' || char === '+' || char === '~') {
                    pushCurrent();
                    tokens.push(char);
                    continue;
                }

                if (/\s/.test(char)) {
                    pushCurrent();
                    while (i + 1 < selector.length && /\s/.test(selector[i + 1])) {
                        i++;
                    }
                    pushDescendantIfNeeded(i + 1);
                    continue;
                }
            }
        }

        current += char;
    }

    pushCurrent();

    return tokens;
}
