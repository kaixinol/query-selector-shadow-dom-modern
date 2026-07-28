import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCENARIOS } from './scenarios.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ScenarioResult {
  scenario: string;
  selector: string;
  oldUs: number;
  newUs: number;
  speedup: string;
}

const MEASURE_TEMPLATE = `
  var lib = window.querySelectorShadowDom;
  var type = %TYPE%;
  var selector = %SELECTOR%;
  var iterations = %ITERATIONS%;
  var fn = function() {
    if (type === 'collectAll') {
      lib.collectAllElementsDeep(selector, document);
    } else {
      lib.querySelectorDeep(selector);
    }
  };
  for (var i = 0; i < 10; i++) fn();
  var start = performance.now();
  for (var i = 0; i < iterations; i++) fn();
  return (performance.now() - start) / iterations;
`;

function wrapCode(code: string): string {
  return '(function() { ' + code + ' })()';
}

async function runBenchmark() {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
  });
  const results: ScenarioResult[] = [];

  for (const scenario of SCENARIOS) {
    for (const sel of scenario.selectors) {
      // ---- Old library ----
      const oldPage = await browser.newPage();
      await oldPage.goto('about:blank');
      await oldPage.addScriptTag({
        path: path.resolve(
          __dirname,
          '..',
          'node_modules/query-selector-shadow-dom/dist/querySelectorShadowDom.js',
        ),
      });
      await oldPage.evaluate(wrapCode(scenario.setup));
      const uid = await oldPage.evaluate('window.__uid');
      const resolvedSelector: string | null = sel.resolve === 'null'
        ? null
        : new Function('uid', `return ${sel.resolve}`)(uid);
      const escapedSelector = resolvedSelector === null
        ? 'null'
        : JSON.stringify(resolvedSelector);

      const measureCode = MEASURE_TEMPLATE
        .replace('%TYPE%', JSON.stringify(sel.type))
        .replace('%SELECTOR%', escapedSelector)
        .replace('%ITERATIONS%', String(scenario.iterations));

      const oldAvg: number = await oldPage.evaluate(wrapCode(measureCode));
      await oldPage.close();

      // ---- New library ----
      const newPage = await browser.newPage();
      await newPage.goto('about:blank');
      await newPage.addScriptTag({
        path: path.resolve(__dirname, '..', 'dist/umd/index.js'),
      });
      await newPage.evaluate(wrapCode(scenario.setup));
      const newAvg: number = await newPage.evaluate(wrapCode(measureCode));
      await newPage.close();

      const oldUs = Math.round(oldAvg * 1000);
      const newUs = Math.round(newAvg * 1000);
      results.push({
        scenario: scenario.name,
        selector: sel.label,
        oldUs,
        newUs,
        speedup: oldUs === 0 ? 'N/A' : (oldUs / newUs).toFixed(2) + 'x',
      });
    }
  }

  console.log('\n========================================');
  console.log('  query-selector-shadow-dom Benchmarks');
  console.log('========================================\n');
  console.table(results);

  const totalOld = results.reduce((s, r) => s + r.oldUs, 0);
  const totalNew = results.reduce((s, r) => s + r.newUs, 0);
  console.log(`\nTotal (old): ${totalOld} μs/op`);
  console.log(`Total (new): ${totalNew} μs/op`);
  console.log(`Overall speedup: ${(totalOld / totalNew).toFixed(2)}x\n`);

  await browser.close();
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});