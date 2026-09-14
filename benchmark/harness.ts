/**
 * In-page half of the differential verification.
 *
 * Everything here runs *inside the browser* — these functions are serialized
 * and evaluated by whichever driver is in use (playwright in `diff.ts`, or the
 * chrome-devtools MCP with the standalone page built by `page.ts`). They must
 * therefore close over nothing but their arguments.
 *
 * Both libraries live in the same page, so results are compared by element
 * identity (`===`) instead of serialized paths.
 */

export const APIS = [
    'querySelectorDeep',
    'querySelectorAllDeep',
    'collectAllElementsDeep',
] as const;

export const MODES = ['document', 'element', 'cached'] as const;

/** DOM fixtures. Each is the body of `function (root) { ... }` run in the page. */
export const FIXTURES: Array<{ name: string; src: string }> = [
    {
        name: 'light-only',
        src: `
      root.innerHTML = '<div class="wrap" id="w1">' +
        '<span class="a" id="a1">1</span><span class="b">2</span><span class="a b" data-x="1">3</span>' +
        '<div class="inner"><span class="a">4</span></div></div>' +
        '<p class="b" data-x="2">p</p><span class="a">5</span>';
    `,
    },
    {
        name: 'single-shadow',
        src: `
      var h = document.createElement('x-one');
      var r = h.attachShadow({ mode: 'open' });
      r.innerHTML = '<div class="wrap"><span class="a"></span><span class="b"></span>' +
        '<div class="inner"><span class="a deep-target"></span></div></div>';
      root.appendChild(h);
    `,
    },
    {
        name: 'nested-shadow-with-slot',
        src: `
      var h = document.createElement('x-two');
      var r = h.attachShadow({ mode: 'open' });
      r.innerHTML = '<div class="lvl1"><x-three></x-three><slot></slot></div>';
      var inner = r.querySelector('x-three');
      var ir = inner.attachShadow({ mode: 'open' });
      ir.innerHTML = '<div class="lvl2"><span class="a deep"></span></div>';
      var slotted = document.createElement('span');
      slotted.className = 'a slotted';
      h.appendChild(slotted);
      root.appendChild(h);
    `,
    },
    {
        name: 'siblings-in-shadow',
        src: `
      var h = document.createElement('x-sib');
      var r = h.attachShadow({ mode: 'open' });
      r.innerHTML = '<div class="hdr"></div><span class="via-plus"></span><i></i>' +
        '<span class="via-tilde"></span><div><span class="a"></span></div>';
      root.appendChild(h);
    `,
    },
    {
        name: 'many-shadow-roots',
        src: `
      for (var i = 0; i < 25; i++) {
        var h = document.createElement('m-' + i);
        var r = h.attachShadow({ mode: 'open' });
        r.innerHTML = '<div class="box"><span class="a"></span><span class="b">x</span>' +
          (i === 17 ? '<em class="deep-target"></em>' : '') + '</div>';
        root.appendChild(h);
      }
    `,
    },
    {
        name: 'cross-boundary-comma',
        src: `
      var lightEl = document.createElement('div');
      lightEl.id = 'light-anchor';
      root.appendChild(lightEl);
      var compA = document.createElement('panel-a');
      var rootA = compA.attachShadow({ mode: 'open' });
      rootA.innerHTML = '<div class="item-a">shadow A</div>';
      root.appendChild(compA);
      var compB = document.createElement('panel-b');
      var rootB = compB.attachShadow({ mode: 'open' });
      var subB = document.createElement('sub-b');
      var subRootB = subB.attachShadow({ mode: 'open' });
      subRootB.innerHTML = '<div class="item-b">shadow B nested</div>';
      rootB.appendChild(subB);
      root.appendChild(compB);
    `,
    },
    {
        name: 'quoted-attributes',
        src: `
      var h = document.createElement('x-attr');
      var r = h.attachShadow({ mode: 'open' });
      r.innerHTML = '<div data-q="he llo" class="q1"></div>' +
        '<div data-q=\\'a,b\\' class="q2"></div>' +
        '<div data-c="x[y]" class="q3"></div>' +
        '<div data-e="a\\"b" class="q4"></div>';
      root.appendChild(h);
    `,
    },
    {
        name: 'closed-shadow',
        src: `
      var h = document.createElement('x-closed');
      var r = h.attachShadow({ mode: 'closed' });
      r.innerHTML = '<div class="closed-inner"></div>';
      root.appendChild(h);
      var open = document.createElement('x-open');
      var or = open.attachShadow({ mode: 'open' });
      or.innerHTML = '<div class="open-inner"></div>';
      root.appendChild(open);
    `,
    },
    {
        name: 'template-content',
        src: `
      root.innerHTML = '<template id="tpl"><div class="t-in"></div></template><div class="after"></div>';
    `,
    },
    {
        name: 'deep-7-levels',
        src: `
      function make(depth) {
        var host = document.createElement('level-' + depth);
        var sr = host.attachShadow({ mode: 'open' });
        if (depth === 0) {
          sr.innerHTML = '<div class="leaf-node" data-active="true">leaf</div>';
        } else {
          var w = document.createElement('div');
          w.className = 'wrapper-tier';
          w.appendChild(make(depth - 1));
          sr.appendChild(w);
        }
        return host;
      }
      for (var i = 0; i < 3; i++) root.appendChild(make(6));
    `,
    },
    {
        name: 'dual-light-and-shadow-match',
        src: `
      var light = document.createElement('div');
      light.className = 'dual';
      root.appendChild(light);
      var h = document.createElement('x-dual');
      var r = h.attachShadow({ mode: 'open' });
      r.innerHTML = '<div class="dual"></div><div class="dual"></div>';
      root.appendChild(h);
    `,
    },
    {
        name: 'pseudo-classes',
        src: `
      var h = document.createElement('x-pseudo');
      var r = h.attachShadow({ mode: 'open' });
      r.innerHTML = '<ul><li class="li">1</li><li class="li">2</li><li class="li">3</li></ul>' +
        '<div class="empty"></div><div class="only"><span class="solo"></span></div>';
      root.appendChild(h);
    `,
    },
    {
        name: 'mixed-app-shell',
        src: `
      for (var i = 0; i < 20; i++) {
        var shell = document.createElement('app-shell');
        var shellRoot = shell.attachShadow({ mode: 'open' });
        var pane = document.createElement('content-pane');
        var paneRoot = pane.attachShadow({ mode: 'open' });
        var card = document.createElement('ds-card');
        card.setAttribute('data-index', String(i));
        var cardRoot = card.attachShadow({ mode: 'open' });
        cardRoot.innerHTML = '<div class="card-header"><span class="a">Widget ' + i + '</span></div>' +
          '<div class="card-body"><slot></slot></div>';
        if (i === 11) {
          var slotted = document.createElement('div');
          slotted.className = 'deep-target';
          card.appendChild(slotted);
        }
        paneRoot.appendChild(card);
        shellRoot.appendChild(pane);
        root.appendChild(shell);
      }
    `,
    },
    {
        name: 'empty',
        src: `/* nothing */`,
    },
];

export const SELECTORS: string[] = [
    // simple
    '.a', '#a1', 'span', 'div', '*', '[data-x]', '[data-x="1"]', '.a.b', 'div.a',
    // descendant / child
    '.wrap .a', '#w1 > .wrap', 'div > span', '.wrap > .a', '.inner .a',
    // siblings
    '.hdr + .via-plus', '.hdr ~ .via-tilde', '.a + .b', '.b + .a', '.a ~ .a',
    // across shadow boundaries
    'x-one .a', 'x-one .deep-target', 'x-one > .wrap .a',
    'x-two .deep', 'x-two x-three .deep', '.lvl1 .lvl2 .deep',
    'x-two .slotted', 'x-two > .slotted', 'x-sib .via-tilde', 'x-sib .a',
    'm-17 .deep-target', 'm-17 > .box > .deep-target',
    'level-6 .leaf-node', 'level-0 .leaf-node', '.wrapper-tier .leaf-node',
    'ds-card .deep-target', 'ds-card[data-index="11"] .deep-target',
    'x-closed .closed-inner', 'x-open .open-inner',
    // comma lists (incl. overlapping ones -> original duplicates matches)
    '.a, .b', '#a1, .b', '.nope, .a', '.a, .a', '#a1.a, .a', '.item-a, .item-b, #light-anchor',
    // attributes with quotes / brackets / escaped quotes
    '[data-q="he llo"]', "[data-q='a,b']", '[data-c="x[y]"]', 'x-attr .q2', 'x-attr .q4',
    // pseudo classes
    '.li:nth-child(2)', '.li:first-child', '.li:last-child', '.empty:empty',
    '.solo:only-child', ':not(.a)', 'div:not(.wrap)',
    // whitespace / comments
    '  .a  ', 'div   .a   ', 'div/*c*/.a', '/* lead */ .a', 'div/*c*/span',
    '.a /*x*/ .b', '/*a*/.a/*b*/',
    // template / negative
    '.t-in', 'template .t-in', '.after', '.nope', '.nope .deep', '*',
    // invalid / degenerate selectors (must behave like the original: throw)
    '', '   ', ',', ':bogus', 'div[', '..a', '.a[', '[data-x=]', 'div, :bogus',
];

/**
 * Deterministic sweep: every fixture x root mode x selector x API.
 *
 * Differences on selectors that use `>` are reported separately as
 * `childDiffs`: that combinator is the one place where this library
 * deliberately diverges from the original (it follows the CSS spec), so those
 * are the fix showing up rather than regressions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function runMatrix(args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fixtures: Array<{ name: string; src: string }>;
    selectors: string[];
    apis: readonly string[];
    modes: readonly string[];
    mode: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const OLD = (window as any).__old;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const NEW = (window as any).__new;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function pathOf(el: any): string {
        if (el === null) return 'null';
        if (el === undefined) return 'undefined';
        if (!el || !el.nodeName) return String(el);
        const parts: string[] = [];
        let node = el;
        let guard = 0;
        while (node && guard++ < 60) {
            let seg = node.nodeName.toLowerCase();
            if (node.id) seg += '#' + node.id;
            if (node.classList && node.classList.length) {
                seg += '.' + Array.prototype.join.call(node.classList, '.');
            }
            const p = node.parentNode;
            if (!p) {
                parts.unshift(seg);
                break;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (p.nodeType === 11 && (p as any).host) {
                parts.unshift(seg + '{shadow}');
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                node = (p as any).host;
                continue;
            }
            const idx = Array.prototype.indexOf.call(p.children, node);
            parts.unshift(seg + '[' + (idx < 0 ? '?' : idx) + ']');
            node = p;
        }
        return parts.join(' > ');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function describe(v: any): string {
        if (Array.isArray(v)) return '[' + v.map(pathOf).join(', ') + ']';
        return pathOf(v);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function call(lib: any, api: string, selector: string, root: any, extra: any) {
        if (api === 'collectAllElementsDeep') return lib.collectAllElementsDeep(selector, root, extra);
        if (extra != null) return lib[api](selector, root, extra);
        return lib[api](selector, root);
    }

    /**
     * `>` is the one deliberate divergence from the original library (this one
     * follows the CSS spec), so a difference on a selector that uses `>` is the
     * fix showing up, not a regression.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function usesChildCombinator(api: string, selector: string): boolean {
        if (api === 'collectAllElementsDeep') return false;
        try {
            const parts = NEW.splitByComma(selector);
            for (const part of parts) {
                if (NEW.tokenizePath(part).indexOf('>') !== -1) return true;
            }
        } catch {
            // unparseable: let it be reported as a real difference
        }
        return false;
    }

    let checks = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const diffs: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dedupDiffs: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childDiffs: any[] = [];

    for (const fixture of args.fixtures) {
        for (const mode of args.modes) {
            document.body.innerHTML = '';
            const box = document.createElement('div');
            box.id = 'fixture-root';
            document.body.appendChild(box);
            // eslint-disable-next-line no-new-func
            (new Function('root', fixture.src))(box);

            const root = mode === 'element' ? box : document;
            let extra: unknown = null;
            if (mode === 'cached') {
                extra = OLD.collectAllElementsDeep(null, root);
            }

            for (const selector of args.selectors) {
                for (const api of args.apis) {
                    checks++;
                    let oldRes: unknown;
                    let newRes: unknown;
                    let oldErr: string | null = null;
                    let newErr: string | null = null;
                    let oldMsg = '';
                    let newMsg = '';
                    try {
                        oldRes = call(OLD, api, selector, root, extra);
                    } catch (e) {
                        oldErr = (e as Error).constructor.name + '/' + (e as Error).name;
                        oldMsg = String((e as Error).message || e);
                    }
                    try {
                        newRes = call(NEW, api, selector, root, extra);
                    } catch (e) {
                        newErr = (e as Error).constructor.name + '/' + (e as Error).name;
                        newMsg = String((e as Error).message || e);
                    }

                    if (oldErr || newErr) {
                        if (oldErr !== newErr) {
                            diffs.push({
                                fixture: fixture.name,
                                mode,
                                api,
                                selector,
                                kind: oldErr && newErr ? 'different-error' : oldErr ? 'old-throws' : 'new-throws',
                                old: (oldErr ?? 'ok') + ' :: ' + (oldMsg || describe(oldRes)),
                                new: (newErr ?? 'ok') + ' :: ' + (newMsg || describe(newRes)),
                            });
                        }
                        continue;
                    }

                    if (api === 'querySelectorDeep') {
                        if (oldRes !== newRes) {
                            const entry = {
                                fixture: fixture.name,
                                mode,
                                api,
                                selector,
                                old: describe(oldRes),
                                new: describe(newRes),
                            };
                            if (usesChildCombinator(api, selector)) {
                                childDiffs.push({ ...entry, kind: 'child-combinator-fix' });
                            } else {
                                diffs.push({ ...entry, kind: 'different-element' });
                            }
                        }
                        continue;
                    }

                    // array APIs
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const o = (oldRes as any[]) || [];
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const n = (newRes as any[]) || [];
                    if (o.length === n.length && o.every((el, i) => el === n[i])) continue;

                    // Known intentional improvement: the new implementation
                    // de-duplicates results; the original can return the same
                    // element twice when it matches more than one comma part.
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const deduped: any[] = [];
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const seen = new Set<any>();
                    for (const el of o) {
                        if (!seen.has(el)) {
                            seen.add(el);
                            deduped.push(el);
                        }
                    }
                    if (deduped.length === n.length && deduped.every((el, i) => el === n[i])) {
                        dedupDiffs.push({
                            fixture: fixture.name,
                            mode,
                            api,
                            selector,
                            oldCount: o.length,
                            newCount: n.length,
                        });
                        continue;
                    }

                    const entry = {
                        fixture: fixture.name,
                        mode,
                        api,
                        selector,
                        kind: o.length === n.length ? 'different-elements' : 'different-count',
                        old: describe(o),
                        new: describe(n),
                    };
                    if (usesChildCombinator(api, selector)) {
                        childDiffs.push({ ...entry, kind: 'child-combinator-fix' });
                    } else {
                        diffs.push(entry);
                    }
                }
            }
        }
    }

    return { checks, diffs, dedupDiffs, childDiffs };
}

/**
 * Randomized phase: a fresh random shadow tree plus a random selector, per
 * iteration (xorshift32 — deterministic for a given seed).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function runFuzz(args: { iterations: number; seed: number; dump: boolean }): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const OLD = (window as any).__old;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const NEW = (window as any).__new;

    let state = args.seed >>> 0 || 1;
    function rnd(): number {
        state ^= state << 13;
        state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        return state / 0x100000000;
    }
    const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length) % arr.length];

    const TAGS = ['div', 'span', 'p', 'em', 'section', 'ul', 'li'];
    const CLASSES = ['c1', 'c2', 'c3', 'c4'];
    const CUSTOM = ['w-a', 'w-b', 'w-c'];

    let idSeq = 0;

    function buildTree(parent: Element, depth: number, maxDepth: number) {
        const count = 1 + Math.floor(rnd() * 4);
        for (let i = 0; i < count; i++) {
            let el: Element;
            const roll = rnd();
            if (roll < 0.25 && depth < maxDepth) {
                el = document.createElement(pick(CUSTOM));
            } else {
                el = document.createElement(pick(TAGS));
            }
            if (rnd() < 0.6) el.className = pick(CLASSES) + (rnd() < 0.3 ? ' ' + pick(CLASSES) : '');
            if (rnd() < 0.25) el.id = 'n' + idSeq++;
            if (rnd() < 0.3) el.setAttribute('data-k', pick(['v1', 'v2', 'v3']));
            parent.appendChild(el);

            if ((el as HTMLElement).tagName.includes('-') && rnd() < 0.85) {
                const sr = el.attachShadow({ mode: 'open' });
                buildTree(sr, depth + 1, maxDepth);
            } else if (depth < maxDepth && rnd() < 0.5) {
                buildTree(el, depth + 1, maxDepth);
            }
        }
    }

    function compound(): string {
        const roll = rnd();
        if (roll < 0.35) return '.' + pick(CLASSES);
        if (roll < 0.5) return pick(TAGS);
        if (roll < 0.6) return pick(CUSTOM);
        if (roll < 0.7) return '[data-k="' + pick(['v1', 'v2', 'v3']) + '"]';
        if (roll < 0.78) return '.' + pick(CLASSES) + '.' + pick(CLASSES);
        if (roll < 0.86) return pick(TAGS) + '.' + pick(CLASSES);
        if (roll < 0.93) return '*';
        return '.' + pick(CLASSES) + '[data-k]';
    }

    function selector(): string {
        const parts: string[] = [];
        const partCount = rnd() < 0.15 ? 2 : 1;
        for (let p = 0; p < partCount; p++) {
            const compounds: string[] = [compound()];
            const extra = Math.floor(rnd() * 3);
            for (let i = 0; i < extra; i++) {
                const comb = pick([' ', ' ', ' ', '>', '+', '~']);
                compounds.push(comb);
                compounds.push(compound());
            }
            parts.push(compounds.join(''));
        }
        return parts.join(', ');
    }

    let checks = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const diffs: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dedupDiffs: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childDiffs: any[] = [];
    let dumped = 0;

    // Number every node in composed pre-order so results can be reported as ids.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function buildIndex(rootNode: unknown): Map<any, number> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const index = new Map<any, number>();
        let counter = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        function walk(node: any, depth: number) {
            if (node.nodeType === 1) index.set(node, counter++);
            const kids = node.children || [];
            for (let i = 0; i < kids.length; i++) walk(kids[i], depth + 1);
            if (node.nodeType === 1 && node.shadowRoot) walk(node.shadowRoot, depth + 1);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        walk(rootNode as any, 0);
        return index;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function dumpTree(rootNode: unknown, index: Map<any, number>): string {
        const lines: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        function walk(node: any, depth: number) {
            const pad = '  '.repeat(depth);
            if (node.nodeType === 1) {
                let seg = node.nodeName.toLowerCase();
                if (node.id) seg += '#' + node.id;
                if (node.classList && node.classList.length) {
                    seg += '.' + Array.prototype.join.call(node.classList, '.');
                }
                if (node.getAttribute && node.getAttribute('data-k')) {
                    seg += '[k=' + node.getAttribute('data-k') + ']';
                }
                lines.push(pad + '[' + index.get(node) + '] ' + seg);
            }
            const kids = node.children || [];
            for (let i = 0; i < kids.length; i++) walk(kids[i], depth + 1);
            if (node.nodeType === 1 && node.shadowRoot) {
                lines.push(pad + ' #shadow-root');
                walk(node.shadowRoot, depth + 1);
            }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        walk(rootNode as any, 0);
        return lines.join('\n');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function ids(list: any, index: Map<any, number>): string {
        if (Array.isArray(list)) return '[' + list.map((e) => index.get(e)).join(',') + ']';
        return list == null ? 'null' : '[' + index.get(list) + ']';
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    /**
     * `>` is the one deliberate divergence from the original library (this one
     * follows the CSS spec), so a difference on a selector that uses `>` is the
     * fix showing up, not a regression.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function usesChildCombinator(api: string, selector: string): boolean {
        if (api === 'collectAllElementsDeep') return false;
        try {
            const parts = NEW.splitByComma(selector);
            for (const part of parts) {
                if (NEW.tokenizePath(part).indexOf('>') !== -1) return true;
            }
        } catch {
            // unparseable: let it be reported as a real difference
        }
        return false;
    }

    for (let iter = 0; iter < args.iterations; iter++) {
        document.body.innerHTML = '';
        const box = document.createElement('div');
        document.body.appendChild(box);
        buildTree(box, 0, 3);

        const sel = selector();
        const before = diffs.length + childDiffs.length;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const iterResults: any[] = [];
        for (const api of ['querySelectorDeep', 'querySelectorAllDeep', 'collectAllElementsDeep']) {
            checks++;
            let oldRes: unknown;
            let newRes: unknown;
            let oldErr: string | null = null;
            let newErr: string | null = null;
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                oldRes = (OLD as any)[api](sel, document);
            } catch (e) {
                oldErr = String((e as Error).message || e);
            }
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                newRes = (NEW as any)[api](sel, document);
            } catch (e) {
                newErr = String((e as Error).message || e);
            }

            if (oldErr || newErr) {
                if (oldErr !== newErr) {
                    diffs.push({
                        iter,
                        api,
                        selector: sel,
                        kind: oldErr ? 'old-throws' : 'new-throws',
                        old: oldErr,
                        new: newErr,
                    });
                }
                continue;
            }

            if (api === 'querySelectorDeep') {
                iterResults.push({ api, oldRes, newRes });
                if (oldRes !== newRes) {
                    if (usesChildCombinator(api, sel)) {
                        childDiffs.push({ iter, api, selector: sel, kind: 'child-combinator-fix' });
                    } else {
                        diffs.push({
                            iter,
                            api,
                            selector: sel,
                            kind: 'different-element',
                            old: oldRes
                                ? (oldRes as Element).nodeName + '.' + (oldRes as Element).className
                                : 'null',
                            new: newRes
                                ? (newRes as Element).nodeName + '.' + (newRes as Element).className
                                : 'null',
                        });
                    }
                }
                continue;
            }

            iterResults.push({ api, oldRes, newRes });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const o = (oldRes as any[]) || [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const n = (newRes as any[]) || [];
            if (o.length === n.length && o.every((el, i) => el === n[i])) continue;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const deduped: any[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const seen = new Set<any>();
            for (const el of o) {
                if (!seen.has(el)) {
                    seen.add(el);
                    deduped.push(el);
                }
            }
            if (deduped.length === n.length && deduped.every((el, i) => el === n[i])) {
                dedupDiffs.push({ iter, api, selector: sel, oldCount: o.length, newCount: n.length });
                continue;
            }

            if (usesChildCombinator(api, sel)) {
                childDiffs.push({
                    iter,
                    api,
                    selector: sel,
                    kind: 'child-combinator-fix',
                    old: o.length,
                    new: n.length,
                });
                continue;
            }

            diffs.push({
                iter,
                api,
                selector: sel,
                kind: o.length === n.length ? 'different-elements' : 'different-count',
                old: o.length,
                new: n.length,
            });
        }

        if (args.dump && diffs.length + childDiffs.length > before && dumped < 3) {
            dumped++;
            const index = buildIndex(document.body);
            const last = childDiffs.length ? childDiffs[childDiffs.length - 1] : diffs[diffs.length - 1];
            last.tree = dumpTree(document.body, index);
            last.detail = iterResults.map(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (r: any) => r.api + ' old=' + ids(r.oldRes, index) + ' new=' + ids(r.newRes, index),
            );
        }
    }

    return { checks, diffs, dedupDiffs, childDiffs };
}
