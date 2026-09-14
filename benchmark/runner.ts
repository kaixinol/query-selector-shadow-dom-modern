/**
 * Performance benchmark: old (query-selector-shadow-dom) vs new
 * (query-selector-shadow-dom-modern).
 *
 * Methodology
 *   - Both libraries are loaded into the SAME page and run against the SAME
 *     live DOM, so any difference is the implementation, not the fixture.
 *   - Each measurement is repeated ROUNDS times; the order of old/new is
 *     alternated per round to cancel out warm-up/drift effects, and the median
 *     is reported.
 *   - Every scenario gets a warm-up loop before timing starts.
 *
 * Usage: pnpm benchmark
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCENARIOS } from './scenarios.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OLD_LIB = path.resolve(
    __dirname,
    '..',
    'node_modules/query-selector-shadow-dom/dist/querySelectorShadowDom.js',
);
const NEW_LIB = path.resolve(__dirname, '..', 'dist/umd/index.js');

const ROUNDS = Number(process.env.ROUNDS ?? 7);

interface Row {
    scenario: string;
    selector: string;
    oldUs: number;
    newUs: number;
    speedup: number;
}

/**
 * Runs in the page. `selector` is null for collectAll-unfiltered / cold runs.
 */
function measure(args: {
    which: 'old' | 'new';
    selector: string | null;
    type: string;
    iterations: number;
    rootExpr: string;
}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lib = args.which === 'old' ? (window as any).__old : (window as any).__new;
    // eslint-disable-next-line no-new-func
    const root = new Function('return ' + args.rootExpr)();
    const cold = args.type === 'queryCold' || args.type === 'queryAllCold';
    const many = args.type === 'queryAll' || args.type === 'queryAllCold';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pool: string[] = (window as any).__coldSelectors || [];
    let k = 0;

    const fn = () => {
        const sel = cold ? pool[k++ % pool.length] : args.selector;
        if (args.type === 'collectAll') lib.collectAllElementsDeep(sel, root);
        else if (many) lib.querySelectorAllDeep(sel, root);
        else lib.querySelectorDeep(sel, root);
    };

    for (let i = 0; i < 10; i++) fn();
    const start = performance.now();
    for (let i = 0; i < args.iterations; i++) fn();
    return (performance.now() - start) / args.iterations;
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function launchBrowser() {
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
    const page = await browser.newPage();
    await page.goto('about:blank');
    // esbuild keepNames helper (see diff.ts)
    await page.evaluate('globalThis.__name = function (fn) { return fn; };');
    await page.addScriptTag({ path: OLD_LIB });
    await page.evaluate('window.__old = window.querySelectorShadowDom;');
    await page.addScriptTag({ path: NEW_LIB });
    await page.evaluate('window.__new = window.querySelectorShadowDom;');

    const rows: Row[] = [];

    for (const scenario of SCENARIOS) {
        for (const sel of scenario.selectors) {
            // Fresh DOM for every scenario.
            await page.evaluate(`document.body.innerHTML = ''; window.__coldSelectors = [];`);
            await page.evaluate(`(function () { ${scenario.setup} })()`);
            const uid = await page.evaluate('window.__uid');
            const selector =
                sel.resolve === 'null'
                    ? null
                    : (new Function('uid', `return ${sel.resolve}`)(uid) as string);

            const oldSamples: number[] = [];
            const newSamples: number[] = [];

            for (let round = 0; round < ROUNDS; round++) {
                const order = round % 2 === 0 ? ['old', 'new'] : ['new', 'old'];
                for (const which of order) {
                    const ms = await page.evaluate(measure, {
                        which: which as 'old' | 'new',
                        selector,
                        type: sel.type,
                        iterations: scenario.iterations,
                        rootExpr: sel.rootExpr ?? 'document',
                    });
                    (which === 'old' ? oldSamples : newSamples).push(ms);
                }
            }

            const oldUs = Math.round(median(oldSamples) * 1000);
            const newUs = Math.round(median(newSamples) * 1000);
            rows.push({
                scenario: scenario.name,
                selector: sel.label,
                oldUs,
                newUs,
                speedup: newUs === 0 ? 1 : oldUs / newUs,
            });
        }
    }

    console.log('\n========================================');
    console.log('  query-selector-shadow-dom benchmark');
    console.log(`  (median of ${ROUNDS} alternating rounds, same page/DOM)`);
    console.log('========================================\n');
    console.table(
        rows.map((r) => ({
            scenario: r.scenario,
            case: r.selector,
            'old (µs/op)': r.oldUs,
            'new (µs/op)': r.newUs,
            speedup: r.speedup.toFixed(2) + 'x',
        })),
    );

    const totalOld = rows.reduce((s, r) => s + r.oldUs, 0);
    const totalNew = rows.reduce((s, r) => s + r.newUs, 0);
    const geo = Math.exp(rows.reduce((s, r) => s + Math.log(r.speedup), 0) / rows.length);

    console.log(`\nTotal (old): ${totalOld} µs/op`);
    console.log(`Total (new): ${totalNew} µs/op`);
    console.log(`Overall speedup (sum):     ${(totalOld / totalNew).toFixed(2)}x`);
    console.log(`Overall speedup (geomean): ${geo.toFixed(2)}x`);
    const wins = rows.filter((r) => r.speedup > 1).length;
    console.log(`Rows faster than the original: ${wins}/${rows.length}\n`);

    await page.close();
    await browser.close();
}

main().catch((err) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
});
