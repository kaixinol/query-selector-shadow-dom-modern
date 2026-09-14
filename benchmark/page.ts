/**
 * Builds a self-contained HTML page that runs the differential sweep from
 * `harness.ts` in any browser — no test runner, no CDP client required.
 *
 * It exists so the verification can be driven by the **chrome-devtools MCP**
 * (or opened by hand when debugging a failing case):
 *
 *   npx tsx benchmark/page.ts --out=/tmp/qssdm-diff.html
 *   # chrome-devtools MCP:
 *   #   new_page         url: file:///tmp/qssdm-diff.html
 *   #   evaluate_script  function: () => window.runSweep({ fuzz: 3000, seed: 42 })
 *   #   evaluate_script  function: () => window.__RESULT
 *
 * Both libraries and the harness are inlined, so the page works offline from
 * `file://`.
 */
import { transform } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const OLD_LIB = path.resolve(
    ROOT,
    'node_modules/query-selector-shadow-dom/dist/querySelectorShadowDom.js',
);
const NEW_LIB = path.resolve(ROOT, 'dist/umd/index.js');

async function build(outFile: string): Promise<string> {
    const harness = await transform(readFileSync(path.join(__dirname, 'harness.ts'), 'utf8'), {
        loader: 'ts',
        format: 'iife',
        globalName: '__harness',
        target: 'es2020',
    });

    const html = `<!doctype html>
<meta charset="utf-8">
<title>query-selector-shadow-dom differential</title>
<body>
<script>
// esbuild's keepNames helper (may be injected into transpiled output).
globalThis.__name = globalThis.__name || function (fn) { return fn; };
</script>
<script>/* ---- original library ---- */
${readFileSync(OLD_LIB, 'utf8')}
</script>
<script>window.__old = window.querySelectorShadowDom;</script>
<script>/* ---- this library (dist/umd) ---- */
${readFileSync(NEW_LIB, 'utf8')}
</script>
<script>window.__new = window.querySelectorShadowDom;</script>
<script>/* ---- harness ---- */
${harness.code}
</script>
<script>
/**
 * Run the whole sweep. Options:
 *   { fuzz: <iterations>, seed: <number>, dump: <bool> }
 * Returns a summary; the full result is left in window.__RESULT.
 */
window.runSweep = function (opts) {
  opts = opts || {};
  var H = window.__harness;
  var out = {};

  out.matrix = H.runMatrix({
    fixtures: H.FIXTURES, selectors: H.SELECTORS, apis: H.APIS, modes: H.MODES
  });
  if (opts.fuzz) {
    out.fuzz = H.runFuzz({
      iterations: opts.fuzz, seed: opts.seed || 0xc0ffee, dump: !!opts.dump
    });
  }

  var checks = 0, diffs = 0, child = 0, dedup = 0;
  var samples = [];
  ['matrix', 'fuzz'].forEach(function (phase) {
    var r = out[phase];
    if (!r) return;
    checks += r.checks;
    diffs += r.diffs.length;
    child += r.childDiffs.length;
    dedup += r.dedupDiffs.length;
    r.diffs.slice(0, 10).forEach(function (d) {
      samples.push({ phase: phase, kind: d.kind, selector: d.selector, api: d.api, old: d.old, new: d.new });
    });
  });

  window.__RESULT = out;
  return {
    checks: checks,
    realDifferences: diffs,
    childCombinatorFixes: child,
    dedupeOnly: dedup,
    verdict: diffs === 0 ? 'IDENTICAL' : 'MISMATCH',
    samples: samples
  };
};

window.ready = !!(window.__old && window.__new && window.__harness);
</script>
</body>
`;

    writeFileSync(outFile, html);
    return outFile;
}

const outArg = process.argv.find((a) => a.startsWith('--out='));
const out = outArg ? outArg.slice(6) : '/tmp/qssdm-diff.html';
build(out)
    .then((file) => console.log(`wrote ${file}`))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
