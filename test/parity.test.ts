// @vitest-environment jsdom
/**
 * Behaviour-parity tests for the corners that a naive rewrite gets wrong.
 * Every case is checked against the original library running on the same DOM,
 * so "parity" is asserted rather than assumed.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  querySelectorDeep,
  querySelectorAllDeep,
  collectAllElementsDeep,
} from '../src/index';

interface OldLib {
  querySelectorDeep(selector: string, root?: Document | Element | DocumentFragment): Element | null;
  querySelectorAllDeep(selector: string, root?: Document | Element | DocumentFragment): Element[];
  collectAllElementsDeep(
    selector?: string | null,
    root?: Document | Element | DocumentFragment,
    cached?: Element[] | null,
  ): Element[];
}

let oldLib: OldLib;

beforeAll(() => {
  const file = path.resolve(
    __dirname,
    '../node_modules/query-selector-shadow-dom/dist/querySelectorShadowDom.js',
  );
  const code = readFileSync(file, 'utf8');
  (0, eval)(`${code}; globalThis.__oldLib = querySelectorShadowDom;`);
  oldLib = (globalThis as Record<string, unknown>).__oldLib as OldLib;
});

/** Runs `fn` and reports either its value or the error it threw. */
function outcome(fn: () => unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: (e as Error).name };
  }
}

function uniq(list: Element[]): Element[] {
  return [...new Set(list)];
}

describe('selector normalisation', () => {
  it('strips CSS comments like the original', () => {
    document.body.innerHTML = '<div><span class="a"></span></div>';
    for (const sel of ['div/*c*/ .a', 'div /*c*/ .a', '/*lead*/ .a', '.a/*trail*/']) {
      const oldValue = Array.from(oldLib.querySelectorAllDeep(sel));
      const newValue = querySelectorAllDeep(sel);
      expect(newValue, sel).toEqual(oldValue);
    }
  });

  it('collapses repeated whitespace / spaces around combinators', () => {
    document.body.innerHTML = '<div class="w"><span class="a"></span></div>';
    for (const sel of ['.w   .a', '  .a  ', '.w > .a', '.w>.a']) {
      expect(querySelectorAllDeep(sel), sel).toEqual(Array.from(oldLib.querySelectorAllDeep(sel)));
    }
  });
});

describe('result ordering', () => {
  it('groups results per comma part, like the original', () => {
    document.body.innerHTML =
      '<span class="a" id="a1"></span><span class="b" id="b1"></span><span class="a b" id="ab"></span>';
    const sel = '.b, .a';
    const oldValue = uniq(Array.from(oldLib.querySelectorAllDeep(sel)));
    expect(querySelectorAllDeep(sel)).toEqual(oldValue);
    // grouped, not document order: every `.b` first, then every `.a`
    expect(querySelectorAllDeep(sel).map((e) => e.id)).toEqual(['b1', 'ab', 'a1']);
  });

  it('de-duplicates matches (the original can return them twice)', () => {
    document.body.innerHTML = '<span class="a"></span><span class="a"></span>';
    const oldValue = Array.from(oldLib.querySelectorAllDeep('.a, .a'));
    const newValue = querySelectorAllDeep('.a, .a');
    expect(oldValue.length).toBe(4); // original duplicates
    expect(newValue.length).toBe(2);
    expect(newValue).toEqual(uniq(oldValue));
  });
});

describe('sibling combinators in the right-most compound', () => {
  it('keeps "+" inside the compound used for candidate filtering', () => {
    document.body.innerHTML = '<div></div><span class="s"></span><span class="s"></span>';
    const sel = 'div + .s';
    const oldValue = Array.from(oldLib.querySelectorAllDeep(sel));
    const newValue = querySelectorAllDeep(sel);
    expect(oldValue.length).toBe(1);
    expect(newValue).toEqual(oldValue);
  });

  it('keeps "~" inside the compound used for candidate filtering', () => {
    document.body.innerHTML = '<b class="k"></b><i></i><span class="s"></span>';
    const sel = '.k ~ .s';
    expect(querySelectorAllDeep(sel)).toEqual(Array.from(oldLib.querySelectorAllDeep(sel)));
  });
});

describe('scoped roots', () => {
  it('never matches the boundary element itself, like the original', () => {
    document.body.innerHTML = '<div id="scope"><span class="x"></span><div><span class="x"></span></div></div>';
    const scope = document.getElementById('scope')!;
    const sel = 'div > .x';
    const oldValue = Array.from(oldLib.querySelectorAllDeep(sel, scope));
    const newValue = querySelectorAllDeep(sel, scope);
    // the direct child of the boundary is excluded by the original
    expect(oldValue.map((e) => e.className)).toEqual(['x']);
    expect(newValue).toEqual(oldValue);
  });

  it('still finds shadow content when scoped to a host', () => {
    document.body.innerHTML = '';
    const host = document.createElement('x-host');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<div class="inner"><span class="leaf"></span></div>';
    document.body.appendChild(host);
    expect(querySelectorDeep('.leaf', host)).toBe(oldLib.querySelectorDeep('.leaf', host));
    expect(querySelectorAllDeep('.inner .leaf', host)).toEqual(
      Array.from(oldLib.querySelectorAllDeep('.inner .leaf', host)),
    );
  });
});

describe('degenerate and invalid selectors', () => {
  it('throws for an empty selector, exactly like the original', () => {
    document.body.innerHTML = '<div class="a"></div>';
    expect(outcome(() => querySelectorDeep(''))).toEqual(outcome(() => oldLib.querySelectorDeep('')));
    expect(outcome(() => querySelectorAllDeep(''))).toEqual(
      outcome(() => oldLib.querySelectorAllDeep('')),
    );
  });

  it('throws for invalid selectors, exactly like the original', () => {
    document.body.innerHTML = '<div class="a"></div>';
    for (const sel of [':bogus', 'div[', '..a', '.a[']) {
      expect(outcome(() => querySelectorAllDeep(sel)), sel).toEqual(
        outcome(() => oldLib.querySelectorAllDeep(sel)),
      );
      expect(outcome(() => querySelectorDeep(sel)), sel).toEqual(
        outcome(() => oldLib.querySelectorDeep(sel)),
      );
    }
  });

  it('treats an empty collectAll filter as "no filter"', () => {
    document.body.innerHTML = '<div class="a"></div><span></span>';
    const oldValue = oldLib.collectAllElementsDeep('', document);
    const newValue = collectAllElementsDeep('', document);
    expect(newValue.length).toBe(oldValue.length);
    expect(newValue).toEqual(Array.from(oldValue));
    // an empty filter means "every element", including <html>/<head>/<body>
    expect(newValue.length).toBe(document.querySelectorAll('*').length);
  });

  it('throws for an invalid collectAll filter, like the original', () => {
    document.body.innerHTML = '<div class="a"></div>';
    expect(outcome(() => collectAllElementsDeep(':bogus', document))).toEqual(
      outcome(() => oldLib.collectAllElementsDeep(':bogus', document)),
    );
  });
});

describe('third argument (caller-supplied element list)', () => {
  it('matches the original for both query APIs', () => {
    document.body.innerHTML = '';
    const host = document.createElement('x-one');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<div class="w"><span class="a"></span></div>';
    document.body.appendChild(host);

    const cached = collectAllElementsDeep(null, document);
    for (const sel of ['.a', '.w .a', 'x-one .a', '.a, .w']) {
      expect(querySelectorAllDeep(sel, document, cached), sel).toEqual(
        Array.from(oldLib.querySelectorAllDeep(sel, document, cached as never)),
      );
      expect(querySelectorDeep(sel, document, cached), sel).toBe(
        oldLib.querySelectorDeep(sel, document, cached as never),
      );
    }
  });

  it('collectAllElementsDeep reuses the cached list', () => {
    document.body.innerHTML = '<div class="a"></div><span></span>';
    const cached = collectAllElementsDeep(null, document);
    expect(collectAllElementsDeep('.a', document, cached)).toEqual(
      Array.from(oldLib.collectAllElementsDeep('.a', document, cached as never)),
    );
  });
});
