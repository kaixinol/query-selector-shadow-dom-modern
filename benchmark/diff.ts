/**
 * Differential verification: old (query-selector-shadow-dom) vs new
 * (query-selector-shadow-dom-modern).
 *
 * Unlike verify.ts (which compares serialized paths across two separate page
 * loads), this harness loads BOTH libraries into the SAME page, so both run
 * against the exact same live DOM and results can be compared by element
 * identity (`===`) — no serialization, no uid pinning, no cross-page drift.
 *
 * Coverage:
 *   - 3 APIs  : querySelectorDeep / querySelectorAllDeep / collectAllElementsDeep
 *   - 3 modes : default root (document) / scoped root (element) / caller-supplied
 *               element list (the third argument of the original API)
 *   - N fixtures x M selectors, plus an optional randomized fuzz phase.
 *
 * `>` follows the CSS spec here while the original degrades it into a
 * descendant combinator, so differences on selectors using `>` are reported
 * separately as `child-combinator-fix` (the upstream bug being fixed) rather
 * than as failures. Everything else must match element for element.
 *
 * Usage:
 *   pnpm verify:diff
 *   pnpm verify:diff -- --fuzz=3000 --seed=42
 *
 * For running the same sweep through the chrome-devtools MCP (or by hand in a
 * browser) see `page.ts`, which emits a self-contained HTML page.
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { FIXTURES, SELECTORS, APIS, MODES, runMatrix, runFuzz } from './harness';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OLD_LIB = path.resolve(
    __dirname,
    '..',
    'node_modules/query-selector-shadow-dom/dist/querySelectorShadowDom.js',
);
const NEW_LIB = path.resolve(__dirname, '..', 'dist/umd/index.js');

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
    const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(name));
    const fuzzArg = arg('--fuzz');
    const fuzzIterations = fuzzArg ? Number(fuzzArg.split('=')[1] || 2000) : 0;
    const seedArg = arg('--seed');
    const seed = seedArg ? Number(seedArg.split('=')[1]) : 0xc0ffee;
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto('about:blank');
    // esbuild's `keepNames` helper: injected into transpiled output, but not
    // defined in the page. Provide a no-op so in-page functions work.
    await page.evaluate('globalThis.__name = function (fn) { return fn; };');
    await page.addScriptTag({ path: OLD_LIB });
    await page.evaluate('window.__old = window.querySelectorShadowDom;');
    await page.addScriptTag({ path: NEW_LIB });
    await page.evaluate('window.__new = window.querySelectorShadowDom;');

    const bothLoaded = await page.evaluate(
        '!!(window.__old && window.__new && window.__old !== window.__new && window.__new.querySelectorDeep)',
    );
    if (!bothLoaded) {
        throw new Error('Failed to load both libraries into the page');
    }

    console.log('\n========================================');
    console.log('  Differential: old vs new (same page)');
    console.log('========================================');

    const matrix = await page.evaluate(runMatrix, {
        fixtures: FIXTURES,
        selectors: SELECTORS,
        apis: APIS,
        modes: MODES,
    });

    console.log(`\n[matrix] fixtures: ${FIXTURES.length}, selectors: ${SELECTORS.length}, ` +
        `apis: ${APIS.length}, modes: ${MODES.length}`);
    console.log(`[matrix] comparisons: ${matrix.checks}`);
    console.log(`[matrix] differences: ${matrix.diffs.length}`);
    console.log(`[matrix] \`>\` fixes (expected): ${matrix.childDiffs.length}`);
    console.log(`[matrix] dedupe-only differences (intentional improvement): ${matrix.dedupDiffs.length}`);

    const showDiffs = (label: string, list: unknown[]) => {
        if (!list.length) return;
        console.log(`\n--- ${label} ---`);
        for (const d of list.slice(0, 40)) {
            console.log(JSON.stringify(d));
        }
        if (list.length > 40) console.log(`... and ${list.length - 40} more`);
    };

    showDiffs('matrix differences', matrix.diffs);
    showDiffs('matrix `>` fixes', matrix.childDiffs);
    showDiffs('matrix dedupe differences', matrix.dedupDiffs);

    let totalChecks = matrix.checks;
    let totalDiffs = matrix.diffs.length;
    let totalChild = matrix.childDiffs.length;
    let totalDedup = matrix.dedupDiffs.length;

    if (fuzzIterations > 0) {
        const fuzz = await page.evaluate(runFuzz, {
            iterations: fuzzIterations,
            seed,
            dump: process.argv.includes('--dump'),
        });
        console.log(`\n[fuzz] iterations: ${fuzzIterations}, seed: ${seed}`);
        console.log(`[fuzz] comparisons: ${fuzz.checks}`);
        console.log(`[fuzz] differences: ${fuzz.diffs.length}`);
        console.log(`[fuzz] \`>\` fixes (expected): ${fuzz.childDiffs.length}`);
        console.log(`[fuzz] dedupe-only differences: ${fuzz.dedupDiffs.length}`);
        showDiffs('fuzz differences', fuzz.diffs);
        if (process.argv.includes('--dump')) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const withTree = [...fuzz.diffs, ...fuzz.childDiffs].filter((x: any) => x.tree);
            for (const d of withTree.slice(0, 3)) {
                console.log('\n===== case iter=' + d.iter + ' selector=' + JSON.stringify(d.selector) + ' =====');
                console.log(d.detail.join('\n'));
                console.log(d.tree);
            }
        }
        totalChecks += fuzz.checks;
        totalDiffs += fuzz.diffs.length;
        totalChild += fuzz.childDiffs.length;
        totalDedup += fuzz.dedupDiffs.length;
    }

    console.log('\n========================================');
    console.log(`  TOTAL comparisons : ${totalChecks}`);
    console.log(`  REAL differences  : ${totalDiffs}`);
    console.log(`  \`>\` fixes         : ${totalChild}`);
    console.log(`  Dedupe (expected) : ${totalDedup}`);
    console.log(`  Result            : ${totalDiffs === 0 ? 'IDENTICAL \u2705' : 'MISMATCH \u274c'}`);
    console.log('========================================\n');

    await page.close();
    await browser.close();
    if (totalDiffs > 0) process.exit(1);
}

main().catch((err) => {
    console.error('Differential run failed:', err);
    process.exit(1);
});
