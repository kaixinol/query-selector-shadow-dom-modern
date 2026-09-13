// @vitest-environment jsdom
/**
 * Correctness tests: the new implementation must produce the same results as
 * the original query-selector-shadow-dom library on the same DOM fixtures.
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
  ): Element[];
}

let oldLib: OldLib;

beforeAll(() => {
  // The original dist is an IIFE that declares a global var; eval it in
  // global scope so `querySelectorShadowDom` becomes available.
  const file = path.resolve(
    __dirname,
    '../node_modules/query-selector-shadow-dom/dist/querySelectorShadowDom.js',
  );
  const code = readFileSync(file, 'utf8');
  (0, eval)(`${code}; globalThis.__oldLib = querySelectorShadowDom;`);
  oldLib = (globalThis as Record<string, unknown>).__oldLib as OldLib;
});

function resetBody() {
  document.body.innerHTML = '';
}

/** 3-level nested shadow tree with a light-DOM branch. */
function buildNestedFixture() {
  resetBody();
  for (let i = 0; i < 3; i++) {
    const shell = document.createElement('app-shell');
    const shellRoot = shell.attachShadow({ mode: 'open' });

    const pane = document.createElement('content-pane');
    const paneRoot = pane.attachShadow({ mode: 'open' });

    const card = document.createElement('ds-card');
    const cardRoot = card.attachShadow({ mode: 'open' });
    cardRoot.innerHTML = `
      <div class="card-header ${i === 1 ? 'target-header' : ''}">
        <span class="title">Widget ${i}</span>
      </div>
      <div class="card-body"><slot></slot></div>
    `;

    if (i === 1) {
      const slotted = document.createElement('div');
      slotted.className = 'slotted-content';
      slotted.textContent = 'Light child of ds-card';
      card.appendChild(slotted);
    }

    paneRoot.appendChild(card);
    shellRoot.appendChild(pane);
    document.body.appendChild(shell);
  }
}

/** Shadow tree exercising sibling and child combinators. */
function buildCombinatorFixture() {
  resetBody();
  const host = document.createElement('combo-box');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <div class="hdr"></div>
    <span class="via-plus"></span>
    <i></i>
    <span class="via-tilde"></span>
    <section class="inner"><b class="kid"></b></section>
  `;
  document.body.appendChild(host);

  const light = document.createElement('div');
  light.className = 'dual-match';
  document.body.appendChild(light);
  const dual = document.createElement('dual-box');
  const dualRoot = dual.attachShadow({ mode: 'open' });
  dualRoot.innerHTML = '<div class="dual-match"></div><div class="dual-match"></div>';
  document.body.appendChild(dual);
}

describe('new implementation matches the original library', () => {
  it('querySelectorDeep: simple class inside nested shadow roots', () => {
    buildNestedFixture();
    const oldResult = oldLib.querySelectorDeep('.target-header');
    const newResult = querySelectorDeep('.target-header');
    expect(newResult).toBe(oldResult);
    expect(newResult).not.toBeNull();
  });

  it('querySelectorDeep: descendant selector across shadow boundary', () => {
    buildNestedFixture();
    const sel = 'app-shell content-pane ds-card .title';
    const oldResult = oldLib.querySelectorDeep(sel);
    const newResult = querySelectorDeep(sel);
    expect(oldResult).not.toBeNull();
    expect(newResult).toBe(oldResult);
  });

  it('querySelectorDeep: slotted light child via native fast path', () => {
    buildNestedFixture();
    const sel = 'ds-card .slotted-content';
    const oldResult = oldLib.querySelectorDeep(sel);
    const newResult = querySelectorDeep(sel);
    expect(oldResult).not.toBeNull();
    expect(newResult).toBe(oldResult);
  });

  it('querySelectorDeep: child + descendant combinators across boundaries', () => {
    buildCombinatorFixture();
    const sel = 'combo-box > .inner .kid';
    const oldResult = oldLib.querySelectorDeep(sel);
    const newResult = querySelectorDeep(sel);
    expect(oldResult).not.toBeNull();
    expect(newResult).toBe(oldResult);
  });

  it('querySelectorDeep: adjacent sibling combinator inside shadow root', () => {
    buildCombinatorFixture();
    const sel = '.hdr + .via-plus';
    const oldResult = oldLib.querySelectorDeep(sel);
    const newResult = querySelectorDeep(sel);
    expect(oldResult).not.toBeNull();
    expect(newResult).toBe(oldResult);
  });

  it('querySelectorDeep: general sibling combinator inside shadow root', () => {
    buildCombinatorFixture();
    const sel = '.hdr ~ .via-tilde';
    const oldResult = oldLib.querySelectorDeep(sel);
    const newResult = querySelectorDeep(sel);
    expect(oldResult).not.toBeNull();
    expect(newResult).toBe(oldResult);
  });

  it('querySelectorDeep: returns null for missing element', () => {
    buildCombinatorFixture();
    const sel = '.does-not-exist';
    expect(oldLib.querySelectorDeep(sel)).toBeNull();
    expect(querySelectorDeep(sel)).toBeNull();
  });

  it('querySelectorDeep: comma-separated list spanning light and shadow DOM', () => {
    buildCombinatorFixture();
    const sel = '.kid, .dual-match';
    const oldResult = oldLib.querySelectorDeep(sel);
    const newResult = querySelectorDeep(sel);
    expect(oldResult).not.toBeNull();
    expect(newResult).toBe(oldResult);
  });

  it('querySelectorAllDeep: elements in both light and shadow DOM, same order', () => {
    buildCombinatorFixture();
    const sel = '.dual-match';
    const oldResult = Array.from(oldLib.querySelectorAllDeep(sel));
    const newResult = querySelectorAllDeep(sel);
    expect(oldResult.length).toBe(3);
    expect(newResult).toEqual(oldResult);
  });

  it('querySelectorAllDeep: comma-separated list matches original (minus original duplicates)', () => {
    buildCombinatorFixture();
    const sel = '.dual-match, .kid';
    const oldResult = Array.from(oldLib.querySelectorAllDeep(sel));
    const newResult = querySelectorAllDeep(sel);
    expect(newResult).toEqual(oldResult);
  });

  it('querySelectorAllDeep: deep descendant selector finds all matches', () => {
    buildNestedFixture();
    const sel = 'app-shell .title';
    const oldResult = Array.from(oldLib.querySelectorAllDeep(sel));
    const newResult = querySelectorAllDeep(sel);
    expect(oldResult.length).toBe(3);
    expect(newResult).toEqual(oldResult);
  });

  it('querySelectorAllDeep: attribute selector', () => {
    buildCombinatorFixture();
    const host = document.querySelector('dual-box')!;
    host.setAttribute('data-state', 'on');
    const sel = 'dual-box[data-state="on"] .dual-match';
    const oldResult = Array.from(oldLib.querySelectorAllDeep(sel));
    const newResult = querySelectorAllDeep(sel);
    expect(oldResult.length).toBe(2);
    expect(newResult).toEqual(oldResult);
  });

  it('querySelectorAllDeep: returns empty array for missing element', () => {
    buildCombinatorFixture();
    expect(Array.from(oldLib.querySelectorAllDeep('.nope'))).toEqual([]);
    expect(querySelectorAllDeep('.nope')).toEqual([]);
  });

  it('querySelectorAllDeep: works on plain documents without shadow roots', () => {
    resetBody();
    document.body.innerHTML = '<div class="a"></div><div class="a"></div><span class="a"></span>';
    const oldResult = Array.from(oldLib.querySelectorAllDeep('.a'));
    const newResult = querySelectorAllDeep('.a');
    expect(oldResult.length).toBe(3);
    expect(newResult).toEqual(oldResult);
  });

  it('querySelectorDeep: works on plain documents without shadow roots', () => {
    resetBody();
    document.body.innerHTML = '<div class="a"></div><div class="a"></div>';
    const oldResult = oldLib.querySelectorDeep('.a');
    const newResult = querySelectorDeep('.a');
    expect(newResult).toBe(oldResult);
  });

  it('collectAllElementsDeep: collects every element including shadow content, same order', () => {
    buildNestedFixture();
    const oldResult = oldLib.collectAllElementsDeep(null, document);
    const newResult = collectAllElementsDeep(null, document);
    expect(oldResult.length).toBeGreaterThan(0);
    expect(newResult).toEqual(oldResult);
  });

  it('collectAllElementsDeep: filtered by selector', () => {
    buildNestedFixture();
    const oldResult = oldLib.collectAllElementsDeep('.title', document);
    const newResult = collectAllElementsDeep('.title', document);
    expect(oldResult.length).toBe(3);
    expect(newResult).toEqual(oldResult);
  });

  it('supports the allElements cached-list third argument', () => {
    buildNestedFixture();
    const cached = collectAllElementsDeep(null, document);
    const oldResult = oldLib.querySelectorAllDeep('.title', document, cached as never);
    const newResult = querySelectorAllDeep('.title', document, cached);
    expect(newResult).toEqual(Array.from(oldResult));
  });

  it('scopes the search to a custom root element', () => {
    buildCombinatorFixture();
    const host = document.querySelector('dual-box')!;
    const oldResult = Array.from(oldLib.querySelectorAllDeep('.dual-match', host));
    const newResult = querySelectorAllDeep('.dual-match', host);
    expect(oldResult.length).toBe(2);
    expect(newResult).toEqual(oldResult);
  });

  it('never logs to the console', () => {
    buildNestedFixture();
    const logs: unknown[][] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args);
    };
    try {
      querySelectorDeep('.title');
      querySelectorAllDeep('.title');
      collectAllElementsDeep('.title', document);
    } finally {
      console.log = orig;
    }
    expect(logs).toEqual([]);
  });

  it('reflects live DOM changes (no stale caching)', () => {
    buildNestedFixture();
    expect(querySelectorAllDeep('.late-addition')).toEqual([]);
    const shell = document.querySelector('app-shell')!;
    const extra = document.createElement('div');
    extra.className = 'late-addition';
    shell.shadowRoot!.appendChild(extra);
    expect(querySelectorAllDeep('.late-addition').length).toBe(1);
  });
});
