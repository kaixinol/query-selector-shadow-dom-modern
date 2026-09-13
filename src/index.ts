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

/** `el.matches()` that never throws (context-dependent pseudo-classes etc.). */
function matchesSelector(el: Element, compound: string): boolean {
    try {
        return el.matches(compound);
    } catch {
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
    if (parent) return parent;
    const rootNode = el.getRootNode();
    if (rootNode === el || rootNode === boundary) return null;
    if (isHostedFragment(rootNode)) return rootNode.host;
    return null;
}

/**
 * Verify that `el` (already known to match the right-most compound) satisfies
 * the whole selector path, walking the composed tree right-to-left.
 * `tokens` looks like: [compound, combinator, compound, ...].
 */
function matchesComposedPath(el: Element, tokens: string[], boundary: QueryableNode): boolean {
    let node: Element | null = el;
    let i = tokens.length - 1;

    while (i > 0 && node) {
        const combinator = tokens[i - 1];
        const compound = tokens[i - 2];

        if (combinator === '>') {
            node = composedParent(node, boundary);
            if (!node || !matchesSelector(node, compound)) return false;
        } else if (combinator === '+') {
            node = node.previousElementSibling;
            if (!node || !matchesSelector(node, compound)) return false;
        } else if (combinator === '~') {
            node = node.previousElementSibling;
            let found = false;
            while (node) {
                if (matchesSelector(node, compound)) {
                    found = true;
                    break;
                }
                node = node.previousElementSibling;
            }
            if (!found) return false;
        } else {
            // descendant combinator
            node = composedParent(node, boundary);
            let found = false;
            while (node) {
                if (matchesSelector(node, compound)) {
                    found = true;
                    break;
                }
                node = composedParent(node, boundary);
            }
            if (!found) return false;
        }
        i -= 2;
    }
    return i <= 0;
}

/**
 * All queryable roots below (and including) `root`: the root itself plus every
 * open shadow root found underneath, in discovery order. Computed fresh on
 * every call — never cached, so dynamic DOMs are always correct.
 */
function collectRoots(root: QueryableNode): QueryableNode[] {
    const roots: QueryableNode[] = [root];
    const pending: QueryableNode[] = [];

    if (isElementNode(root) && root.shadowRoot) {
        roots.push(root.shadowRoot);
        pending.push(root.shadowRoot);
    }

    let scope: QueryableNode | undefined = root;
    while (scope) {
        const all = scope.querySelectorAll('*');
        for (let i = 0; i < all.length; i++) {
            const shadowRoot = (all[i] as Element).shadowRoot;
            if (shadowRoot) {
                roots.push(shadowRoot);
                pending.push(shadowRoot);
            }
        }
        scope = pending.pop();
    }
    return roots;
}

/**
 * Collect every element under `root` in the original library's order
 * (composed tree pre-order: a host's shadow content comes immediately after
 * the host element). One native `querySelectorAll('*')` per root — the
 * browser does the walking.
 */
function collectAllElements(root: QueryableNode, filter?: string): Element[] {
    const out: Element[] = [];
    collectInto(root, out, filter);
    return out;
}

function collectInto(scope: QueryableNode, out: Element[], filter?: string): void {
    // A root element's own shadow content is listed first (original behavior).
    if (isElementNode(scope) && scope.shadowRoot) {
        collectList(scope.shadowRoot.querySelectorAll('*'), out, filter);
    }
    collectList(scope.querySelectorAll('*'), out, filter);
}

function collectList(list: NodeListOf<Element>, out: Element[], filter?: string): void {
    for (let i = 0; i < list.length; i++) {
        const el = list[i];
        if (!filter || matchesSelector(el, filter)) {
            out.push(el);
        }
        const shadowRoot = el.shadowRoot;
        if (shadowRoot) {
            collectList(shadowRoot.querySelectorAll('*'), out, filter);
        }
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

const PARSE_CACHE_LIMIT = 512;
const parseCache = new Map<string, string[][]>();

/** Split into comma-separated parts, each tokenized as [compound, combinator, ...]. Memoized. */
function parseSelector(selector: string): string[][] {
    const cached = parseCache.get(selector);
    if (cached) return cached;

    const parts: string[][] = [];
    for (const part of splitByComma(selector)) {
        const tokens = tokenizePath(part);
        if (tokens.length > 0) parts.push(tokens);
    }

    if (parseCache.size >= PARSE_CACHE_LIMIT) parseCache.clear();
    parseCache.set(selector, parts);
    return parts;
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
): { list: T[] | null; set: Set<T> | null; rootsWithHits: number } {
    let list: T[] | null = null;
    let set: Set<T> | null = null;
    let rootsWithHits = 0;

    for (const root of roots) {
        let found: NodeListOf<T>;
        try {
            found = root.querySelectorAll<T>(rightMostCompound);
        } catch {
            continue; // selector not valid in this root's context
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
    return { list, set, rootsWithHits };
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
    if (!selector || !selector.trim()) return null;

    // Native fast path — identical to the original library: a plain
    // light-DOM match always wins, no matter what lives in shadow roots.
    const lightElement = root.querySelector<T>(selector);
    if (lightElement) return lightElement;

    const parts = parseSelector(selector);
    if (parts.length === 0) return null;

    // Caller-supplied element list (original API's third argument).
    if (allElements) {
        for (const tokens of parts) {
            const last = tokens[tokens.length - 1];
            for (const el of allElements) {
                if (
                    matchesSelector(el, last) &&
                    (tokens.length === 1 || matchesComposedPath(el, tokens, root))
                ) {
                    return el as T;
                }
            }
        }
        return null;
    }

    const roots = collectRoots(root);
    if (roots.length === 1) return null; // no shadow roots; native query already failed

    for (const tokens of parts) {
        const last = tokens[tokens.length - 1];
        const { list, set, rootsWithHits } = collectCandidates<T>(roots, last);
        if (!list) continue;

        const verified = (el: T): boolean =>
            tokens.length === 1 || matchesComposedPath(el, tokens, root);

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
    if (!selector || !selector.trim()) return [];

    const parts = parseSelector(selector);
    if (parts.length === 0) return [];

    // Caller-supplied element list (original API's third argument).
    if (allElements) {
        const out: T[] = [];
        const seen = new Set<Element>();
        for (const tokens of parts) {
            const last = tokens[tokens.length - 1];
            for (const el of allElements) {
                if (seen.has(el) || !matchesSelector(el, last)) continue;
                if (tokens.length === 1 || matchesComposedPath(el, tokens, root)) {
                    seen.add(el);
                    out.push(el as T);
                }
            }
        }
        return out;
    }

    const roots = collectRoots(root);

    // No shadow roots below `root` → hand everything to the browser.
    if (roots.length === 1) {
        return Array.from(root.querySelectorAll<T>(selector));
    }

    const results: T[] = [];
    const seen = new Set<T>();

    for (const tokens of parts) {
        const last = tokens[tokens.length - 1];
        const { list, set, rootsWithHits } = collectCandidates<T>(roots, last);
        if (!list) continue;

        if (rootsWithHits === 1) {
            // All candidates live in a single root → its native order is composed order.
            for (const el of list) {
                if (seen.has(el)) continue;
                if (tokens.length === 1 || matchesComposedPath(el, tokens, root)) {
                    seen.add(el);
                    results.push(el);
                }
            }
        } else {
            // Candidates spread across roots → merge in composed tree order.
            const candidates = set ?? new Set(list);
            const all = collectAllElements(root);
            for (let i = 0; i < all.length; i++) {
                const el = all[i] as T;
                if (!candidates.has(el) || seen.has(el)) continue;
                if (tokens.length === 1 || matchesComposedPath(el, tokens, root)) {
                    seen.add(el);
                    results.push(el);
                }
            }
        }
    }
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
    if (cachedElements) {
        const all = cachedElements as T[];
        return selector ? all.filter((el) => matchesSelector(el, selector)) : all;
    }

    // Single pass: elements are filtered while the tree is being walked.
    return collectAllElements(root, selector ?? undefined) as T[];
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

                    let nextChar = '';
                    for (let j = i + 1; j < selector.length; j++) {
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
                    continue;
                }
            }
        }

        current += char;
    }

    pushCurrent();

    return tokens;
}
