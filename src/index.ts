export type QueryableNode = Document | DocumentFragment | Element;

const getComposedParent = (node: Element, rootNode: QueryableNode): Element | null => {
    if (!node || node === rootNode) return null;
    if (node.parentElement) return node.parentElement;

    const root = node.getRootNode();
    if (root instanceof ShadowRoot && root.host) {
        return root.host;
    }

    return null;
};

function* walkRoots(root: QueryableNode): Generator<QueryableNode, void, unknown> {
    yield root;

    const doc = root.ownerDocument || (root as Document);
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

    let node: Node | null;
    while ((node = walker.nextNode())) {
        if (node instanceof Element && node.shadowRoot) {
            yield* walkRoots(node.shadowRoot);
        }
    }
}

export function splitByComma(selector: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inQuotes = false, quoteChar = '';
    let brackets = 0, parens = 0;

    for (let i = 0; i < selector.length; i++) {
        const char = selector[i];
        if (inQuotes) {
            current += char;
            if (char === quoteChar && selector[i - 1] !== '\\') inQuotes = false;
            continue;
        }
        if (char === '"' || char === "'") {
            inQuotes = true; quoteChar = char; current += char; continue;
        }
        if (char === '[') brackets++;
        if (char === ']') brackets--;
        if (char === '(') parens++;
        if (char === ')') parens--;

        if (char === ',' && brackets === 0 && parens === 0) {
            parts.push(current.trim());
            current = '';
            continue;
        }
        current += char;
    }
    parts.push(current.trim());
    return parts.filter(Boolean);
}

export function tokenizePath(selector: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuotes = false, quoteChar = '';
    let brackets = 0, parens = 0;

    for (let i = 0; i < selector.length; i++) {
        const char = selector[i];

        if (inQuotes) {
            current += char;
            if (char === quoteChar && selector[i - 1] !== '\\') inQuotes = false;
            continue;
        }
        if (char === '"' || char === "'") {
            inQuotes = true; quoteChar = char; current += char; continue;
        }
        if (char === '[') brackets++;
        if (char === ']') brackets--;
        if (char === '(') parens++;
        if (char === ')') parens--;

        if (brackets === 0 && parens === 0) {
            if (['>', '+', '~'].includes(char)) {
                if (current.trim()) tokens.push(current.trim());
                tokens.push(char);
                current = '';
                continue;
            }
            if (char === ' ') {
                if (current.trim()) {
                    tokens.push(current.trim());
                    current = '';
                    tokens.push(' ');
                }
                continue;
            }
        }
        current += char;
    }
    if (current.trim()) tokens.push(current.trim());

    return tokens.filter((t, i, arr) => {
        if (t !== ' ') return true;
        const prev = arr[i - 1], next = arr[i + 1];
        return prev && next && !['>', '+', '~', ' '].includes(prev) && !['>', '+', '~'].includes(next);
    });
}

function matchPath(node: Element, tokens: string[], rootNode: QueryableNode): boolean {
    let currentNode: Element | null = node;
    let i = tokens.length - 1;

    if (!currentNode.matches(tokens[i])) return false;

    while (i > 0 && currentNode) {
        const combinator = tokens[i - 1];
        const targetSelector = tokens[i - 2];

        if (combinator === ' ') {
            let found = false;
            currentNode = getComposedParent(currentNode, rootNode);
            while (currentNode) {
                if (currentNode.matches(targetSelector)) {
                    found = true;
                    break;
                }
                currentNode = getComposedParent(currentNode, rootNode);
            }
            if (!found) return false;
        }
        else if (combinator === '>') {
            currentNode = getComposedParent(currentNode, rootNode);
            if (!currentNode || !currentNode.matches(targetSelector)) return false;
        }
        else if (combinator === '+') {
            currentNode = currentNode.previousElementSibling;
            if (!currentNode || !currentNode.matches(targetSelector)) return false;
        }
        else if (combinator === '~') {
            let found = false;
            currentNode = currentNode.previousElementSibling;
            while (currentNode) {
                if (currentNode.matches(targetSelector)) {
                    found = true;
                    break;
                }
                currentNode = currentNode.previousElementSibling;
            }
            if (!found) return false;
        }

        i -= 2;
    }
    return i <= 0;
}

const tokenCache = new Map<string, string[]>();
const getTokens = (sel: string): string[] => {
    if (!tokenCache.has(sel)) tokenCache.set(sel, tokenizePath(sel));
    return tokenCache.get(sel)!;
};

export function querySelectorAllDeep<T extends Element = HTMLElement>(
    selector: string,
    root: QueryableNode = document,
    _allElements: Element[] | null = null
): T[] {
    const results = new Set<T>();
    const commaSelectors = splitByComma(selector);

    for (const sel of commaSelectors) {
        const tokens = getTokens(sel);
        const rightMostToken = tokens[tokens.length - 1];

        for (const currentRoot of walkRoots(root)) {
            if (currentRoot === root) {
                const lightResults = root.querySelectorAll<T>(sel);
                for (let i = 0; i < lightResults.length; i++) {
                    results.add(lightResults[i]);
                }
                continue;
            }
            const candidates = currentRoot.querySelectorAll(rightMostToken);
            for (let i = 0; i < candidates.length; i++) {
                const candidate = candidates[i] as T;
                if (tokens.length === 1 || matchPath(candidate, tokens, root)) {
                    results.add(candidate);
                }
            }
        }
    }
    return Array.from(results);
}

export function querySelectorDeep<T extends Element = HTMLElement>(
    selector: string,
    root: QueryableNode = document,
    _allElements: Element[] | null = null
): T | null {
    const light = root.querySelector<T>(selector);
    if (light) return light;

    const commaSelectors = splitByComma(selector);

    for (const sel of commaSelectors) {
        const tokens = getTokens(sel);
        const rightMostToken = tokens[tokens.length - 1];

        for (const currentRoot of walkRoots(root)) {
            if (currentRoot === root) continue;
            const candidates = currentRoot.querySelectorAll(rightMostToken);

            for (let i = 0; i < candidates.length; i++) {
                const candidate = candidates[i] as T;
                if (tokens.length === 1 || matchPath(candidate, tokens, root)) {
                    return candidate;
                }
            }
        }
    }
    return null;
}

const findAllElements = (nodes: NodeListOf<Element>, results: Set<Element>) => {
    for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        results.add(el);
        if (el.shadowRoot) {
            findAllElements(el.shadowRoot.querySelectorAll('*'), results);
        }
    }
};

export function collectAllElementsDeep(
    selector: string | null = null,
    root: QueryableNode = document,
    cachedElements: Element[] | null = null
): Element[] {
    const results = new Set<Element>();

    if (cachedElements) {
        for (const el of cachedElements) results.add(el);
    } else {
        if (root instanceof Element && root.shadowRoot) {
            findAllElements(root.shadowRoot.querySelectorAll('*'), results);
        }
        if (root instanceof Document || root instanceof DocumentFragment || root instanceof Element) {
            findAllElements(root.querySelectorAll('*'), results);
        }
    }

    return selector
        ? Array.from(results).filter(el => el.matches(selector))
        : Array.from(results);
}
