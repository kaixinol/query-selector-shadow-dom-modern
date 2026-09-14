// @vitest-environment jsdom
/**
 * The child combinator is matched the way CSS specifies it — the one place
 * where this library deliberately departs from query-selector-shadow-dom.
 *
 * The original re-tests a `>` group at every ancestor while climbing the
 * composed tree, which turns `a > b` into `a b`. Each case below is asserted
 * against both the original library (to pin the difference) and a native
 * `querySelector` (to pin the correct answer).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { querySelectorDeep, querySelectorAllDeep } from '../src/index';

interface OldLib {
  querySelectorDeep(selector: string, root?: Document | Element | DocumentFragment): Element | null;
  querySelectorAllDeep(selector: string, root?: Document | Element | DocumentFragment): Element[];
}

let oldLib: OldLib;

beforeAll(() => {
  const file = path.resolve(
    __dirname,
    '../node_modules/query-selector-shadow-dom/dist/querySelectorShadowDom.js',
  );
  const code = readFileSync(file, 'utf8');
  (0, eval)(`${code}; globalThis.__oldLibChild = querySelectorShadowDom;`);
  oldLib = (globalThis as Record<string, unknown>).__oldLibChild as OldLib;
});

/** Build a shadow host with `html` inside it and return the host. */
function host(html: string, tag = 'x-host'): Element {
  const el = document.createElement(tag);
  el.attachShadow({ mode: 'open' }).innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe('child combinator', () => {
  it('does not match deeper descendants, unlike the original', () => {
    document.body.innerHTML = '<ul class="c1"><li class="c1"><div class="c1"></div></li></ul>';
    const sel = 'ul.c1 > .c1';
    // the original picks up the nested `.c1` too — that is the bug being fixed
    expect(Array.from(oldLib.querySelectorAllDeep(sel)).length).toBe(2);
    expect(querySelectorAllDeep(sel).map((e) => e.tagName.toLowerCase())).toEqual(['li']);
  });

  it('agrees with a native querySelector on a flat tree', () => {
    document.body.innerHTML =
      '<div class="p"><section class="mid"><div class="q"></div></section>' +
      '<div class="q direct"></div></div>';
    const sel = '.p > .q';
    expect(querySelectorAllDeep(sel)).toEqual(Array.from(document.querySelectorAll(sel)));
    expect(querySelectorDeep(sel)).toBe(document.querySelector(sel));
  });

  it('handles a `>` chain without gaps', () => {
    document.body.innerHTML = '<div class="a"><div class="b"><span class="c"></span></div></div>';
    expect(querySelectorAllDeep('.a > .b > .c').length).toBe(1);
    expect(querySelectorAllDeep('.a > .c').length).toBe(0);
  });

  it('treats a group boundary as a descendant combinator', () => {
    document.body.innerHTML =
      '<div class="wrap"><section><ul class="l"><li class="item"></li></ul></section></div>';
    expect(querySelectorAllDeep('.wrap .l > .item').length).toBe(1);
    expect(querySelectorDeep('.wrap .l > .item')).toBe(document.querySelector('.item'));
  });

  it('steps across a shadow boundary', () => {
    document.body.innerHTML = '';
    const h = host('<div class="inner"><span class="leaf"></span></div>');
    h.classList.add('hostish');
    // the shadow root's child is a composed child of the host
    expect(querySelectorAllDeep('.hostish > .inner').length).toBe(1);
    expect(querySelectorDeep('.hostish > .inner')).toBe(h.shadowRoot!.querySelector('.inner'));
    // ...but the grandchild is not
    expect(querySelectorAllDeep('.hostish > .leaf').length).toBe(0);
  });

  it('is stricter than the original inside a shadow root too', () => {
    document.body.innerHTML = '';
    const h = host('<div class="box"><section><div class="box"></div></section></div>');
    // the original matches both `.box` levels; only the outer one is a composed
    // child of the host
    expect(Array.from(oldLib.querySelectorAllDeep('x-host > .box')).length).toBe(2);
    expect(querySelectorAllDeep('x-host > .box')).toEqual([h.shadowRoot!.querySelector('.box')]);
  });
});
