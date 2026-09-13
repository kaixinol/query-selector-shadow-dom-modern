# query-selector-shadow-dom-modern

[![Release](https://github.com/kaixinol/query-selector-shadow-dom-modern/actions/workflows/release.yml/badge.svg)](https://github.com/kaixinol/query-selector-shadow-dom-modern/actions/workflows/release.yml)

Modern drop-in replacement for [query-selector-shadow-dom](https://www.npmjs.com/package/query-selector-shadow-dom). Zero dependencies, full TypeScript support.

querySelector that can pierce Shadow DOM roots without knowing the path through nested shadow roots. Useful for automated testing of Web Components (Selenium, Puppeteer, Playwright, etc.).

## Install

```sh
npm install query-selector-shadow-dom-modern
# or
pnpm add query-selector-shadow-dom-modern
# or
yarn add query-selector-shadow-dom-modern
```

## Usage

```ts
import { querySelectorDeep, querySelectorAllDeep, collectAllElementsDeep } from 'query-selector-shadow-dom-modern';

// Find first matching element (pierces shadow roots)
const btn = querySelectorDeep('.btn-in-shadow-dom');

// Find all matching elements
const items = querySelectorAllDeep('my-component .item');

// Collect all elements on the page, including shadow DOM
const all = collectAllElementsDeep();
const filtered = collectAllElementsDeep('a[href]');
```

### UMD (browser)

```html
<!-- Full build (debuggable, with sourcemap) -->
<script src="node_modules/query-selector-shadow-dom-modern/dist/umd/index.js"></script>
<!-- Or minified (~1.9 KB gzipped) -->
<script src="node_modules/query-selector-shadow-dom-modern/dist/umd/index.min.js"></script>
<script>
  const btn = querySelectorShadowDom.querySelectorDeep('.btn-in-shadow-dom');
</script>
```

## API

- `querySelectorDeep(selector, root?)` — Returns the first matching element, piercing shadow roots
- `querySelectorAllDeep(selector, root?)` — Returns an array of all matching elements, piercing shadow roots
- `collectAllElementsDeep(selector?, root?)` — Collects all elements on the page, including those within shadow roots. Optionally filters by a CSS selector

Both `root` defaults to `document`. Pass a custom root to scope the search (e.g., an iframe's `contentDocument`).

## License

MIT
