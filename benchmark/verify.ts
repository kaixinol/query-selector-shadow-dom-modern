/**
 * Correctness verification: run every benchmark scenario (plus edge cases)
 * against BOTH the original query-selector-shadow-dom and the new
 * implementation, and compare the results element-by-element.
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCENARIOS } from './scenarios.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OLD_LIB = path.resolve(__dirname, '..', 'node_modules/query-selector-shadow-dom/dist/querySelectorShadowDom.js');
const NEW_LIB = path.resolve(__dirname, '..', 'dist/umd/index.js');

function wrapCode(code: string): string {
  return '(function() { ' + code + ' })()';
}

// Runs in the page: compute comparable results for one selector.
// Returns element "paths" so identity can be compared across loads.
const EVAL_TEMPLATE = `
  var lib = window.querySelectorShadowDom;
  var selector = %SELECTOR%;
  var type = %TYPE%;

  function pathOf(el) {
    if (!el) return null;
    var parts = [];
    var node = el;
    while (node) {
      var seg = node.tagName ? node.tagName.toLowerCase() : '?';
      if (node.id) seg += '#' + node.id;
      if (node.className && typeof node.className === 'string') seg += '.' + node.className.split(/\\s+/).join('.');
      var parent = node.parentElement;
      if (!parent) {
        var r = node.getRootNode();
        if (r && r.host) { parts.unshift(seg + ' <in-shadow>'); node = r.host; continue; }
        parts.unshift(seg); break;
      }
      var idx = Array.prototype.indexOf.call(parent.children, node);
      seg += ':nth-child(' + (idx + 1) + ')';
      parts.unshift(seg);
      node = parent;
    }
    return parts.join(' > ');
  }

  var out = {};
  if (type === 'collectAll') {
    var all = lib.collectAllElementsDeep(selector, document);
    out.count = all.length;
    out.first = pathOf(all[0] || null);
    out.last = pathOf(all[all.length - 1] || null);
  } else {
    var one = lib.querySelectorDeep(selector);
    out.one = pathOf(one);
    var many = lib.querySelectorAllDeep(selector);
    out.manyCount = many.length;
    out.many = many.map(pathOf);
  }
  return out;
`;

interface CompareResult {
  scenario: string;
  selector: string;
  ok: boolean;
  oldOut: unknown;
  newOut: unknown;
}

// Extra edge cases on top of the benchmark scenarios.
const EDGE_SETUP = `
  window.__uid = 'edge';
  // sibling combinators inside shadow
  var s1 = document.createElement('sib-box');
  var r1 = s1.attachShadow({ mode: 'open' });
  r1.innerHTML = '<div class="hdr"></div><span class="via-plus"></span><i></i><span class="via-tilde"></span>';
  document.body.appendChild(s1);
  // child combinator across boundary
  var s2 = document.createElement('kid-box');
  var r2 = s2.attachShadow({ mode: 'open' });
  r2.innerHTML = '<section class="inner"><b class="kid-target"></b></section>';
  document.body.appendChild(s2);
  // light DOM + shadow DOM both matching
  var light = document.createElement('div');
  light.className = 'dual-match';
  document.body.appendChild(light);
  var s3 = document.createElement('dual-box');
  var r3 = s3.attachShadow({ mode: 'open' });
  r3.innerHTML = '<div class="dual-match"></div><div class="dual-match"></div>';
  document.body.appendChild(s3);
`;

const EDGE_SELECTORS = [
  '.hdr + .via-plus',
  '.hdr ~ .via-tilde',
  'kid-box > .inner .kid-target',
  'sib-box .via-tilde',
  '.dual-match',
  '.dual-match, .kid-target',
  '.nonexistent-xyz',
];

async function launchBrowser() {
  // Prefer an already-running Chrome via CDP (fast, no download needed).
  try {
    return await chromium.connectOverCDP('http://127.0.0.1:9222');
  } catch {
    try {
      return await chromium.launch({ headless: true, channel: 'chrome' });
    } catch {
      return await chromium.launch({ headless: true });
    }
  }
}

async function main() {
  const browser = await launchBrowser();
  const results: CompareResult[] = [];
  let failures = 0;

  async function compare(setupCode: string, label: string, selector: string | null, type: string) {
    const escaped = selector === null ? 'null' : JSON.stringify(selector);
    const evalCode = wrapCode(
      EVAL_TEMPLATE.replace('%SELECTOR%', escaped).replace('%TYPE%', JSON.stringify(type)),
    );

    const oldPage = await browser.newPage();
    await oldPage.goto('about:blank');
    await oldPage.addScriptTag({ path: OLD_LIB });
    await oldPage.evaluate(wrapCode(setupCode));
    const oldOut = await oldPage.evaluate(evalCode);
    await oldPage.close();

    const newPage = await browser.newPage();
    await newPage.goto('about:blank');
    await newPage.addScriptTag({ path: NEW_LIB });
    await newPage.evaluate(wrapCode(setupCode));
    const newOut = await newPage.evaluate(evalCode);
    await newPage.close();

    const ok = JSON.stringify(oldOut) === JSON.stringify(newOut);
    if (!ok) failures++;
    results.push({ scenario: label, selector: String(selector), ok, oldOut, newOut });
  }

  for (const scenario of SCENARIOS) {
    for (const sel of scenario.selectors) {
      // uid is random per page load; resolve separately per engine would diverge,
      // so pin uid by injecting a fixed one before setup.
      const pinned = scenario.setup.replace(
        /window\.__uid = Math\.random\(\)\.toString\(36\)\.slice\(2, 8\);/,
        "window.__uid = 'pinned1';",
      );
      const uid = 'pinned1';
      if (sel.type.endsWith('Cold')) continue; // needs a selector pool, see runner.ts
      const resolved: string | null =
        sel.resolve === 'null' ? null : new Function('uid', `return ${sel.resolve}`)(uid);
      // 'queryAll' exercises the same code path as 'query' here (both APIs are
      // compared); only 'collectAll' needs a different call shape.
      const type = sel.type === 'collectAll' ? 'collectAll' : 'query';
      await compare(pinned, scenario.name, resolved, type);
    }
  }

  for (const sel of EDGE_SELECTORS) {
    await compare(EDGE_SETUP, 'edge-cases', sel, 'query');
  }

  console.log('\n========================================');
  console.log('  Correctness: old vs new');
  console.log('========================================\n');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  [${r.scenario}] ${r.selector}`);
    if (!r.ok) {
      console.log('  old:', JSON.stringify(r.oldOut));
      console.log('  new:', JSON.stringify(r.newOut));
    }
  }
  console.log(`\n${results.length - failures}/${results.length} checks passed\n`);

  await browser.close();
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
