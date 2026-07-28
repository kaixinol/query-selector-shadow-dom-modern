export type TestType = 'query' | 'collectAll';

export interface Scenario {
  name: string;
  setup: string;
  selectors: Array<{ label: string; resolve: string; type: TestType }>;
  iterations: number;
}

export const SCENARIOS: Scenario[] = [
  {
    name: 'Light DOM (no shadow)',
    setup: `
      window.__uid = Math.random().toString(36).slice(2, 8);
      for (let i = 0; i < 500; i++) {
        const div = document.createElement('div');
        div.className = 'item-' + window.__uid;
        div.textContent = 'item-' + i;
        document.body.appendChild(div);
      }
      const target = document.createElement('div');
      target.id = 'target-' + window.__uid;
      document.body.appendChild(target);
    `,
    selectors: [
      { label: '.class', resolve: '".item-" + uid', type: 'query' },
    ],
    iterations: 200,
  },
  {
    name: 'Single shadow root',
    setup: `
      window.__uid = Math.random().toString(36).slice(2, 8);
      for (let i = 0; i < 100; i++) {
        const host = document.createElement('my-el');
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = '<div class="item-' + window.__uid + '"><span class="nested-' + window.__uid + '">nested</span></div>';
        document.body.appendChild(host);
      }
    `,
    selectors: [
      { label: '.class in shadow', resolve: '".item-" + uid', type: 'query' },
    ],
    iterations: 200,
  },
  {
    name: 'Deeply nested shadow (4 levels)',
    setup: `
      window.__uid = Math.random().toString(36).slice(2, 8);
      function createNested(level) {
        const host = document.createElement('level-' + level);
        const root = host.attachShadow({ mode: 'open' });
        if (level === 0) {
          root.innerHTML = '<div class="deep-' + window.__uid + '">target</div>';
        } else {
          const child = createNested(level - 1);
          root.appendChild(child);
        }
        return host;
      }
      for (let i = 0; i < 30; i++) {
        document.body.appendChild(createNested(3));
      }
    `,
    selectors: [
      { label: '.deep 4 levels', resolve: '".deep-" + uid', type: 'query' },
    ],
    iterations: 200,
  },
  {
    name: '20 parallel shadow roots',
    setup: `
      window.__uid = Math.random().toString(36).slice(2, 8);
      for (let i = 0; i < 20; i++) {
        const host = document.createElement('par-el');
        const root = host.attachShadow({ mode: 'open' });
        for (let j = 0; j < 20; j++) {
          const div = document.createElement('div');
          div.className = 'par-item-' + window.__uid;
          root.appendChild(div);
        }
        document.body.appendChild(host);
      }
    `,
    selectors: [
      { label: '.class in 20 roots', resolve: '".par-item-" + uid', type: 'query' },
    ],
    iterations: 200,
  },
  {
    name: 'Complex combinator across shadow',
    setup: `
      window.__uid = Math.random().toString(36).slice(2, 8);
      for (let i = 0; i < 50; i++) {
        const outer = document.createElement('outer-el');
        const outerRoot = outer.attachShadow({ mode: 'open' });
        const innerHost = document.createElement('inner-el');
        const innerRoot = innerHost.attachShadow({ mode: 'open' });
        innerRoot.innerHTML = '<div class="leaf-' + window.__uid + '">leaf</div>';
        outerRoot.innerHTML = '<div class="middle-' + window.__uid + '"></div>';
        outerRoot.querySelector('.middle-' + window.__uid).appendChild(innerHost);
        document.body.appendChild(outer);
      }
    `,
    selectors: [
      { label: 'outer > middle leaf', resolve: '"outer-el > .middle-" + uid + " .leaf-" + uid', type: 'query' },
    ],
    iterations: 100,
  },
  {
    name: 'collectAllElementsDeep',
    setup: `
      window.__uid = Math.random().toString(36).slice(2, 8);
      for (let i = 0; i < 20; i++) {
        const host = document.createElement('col-el');
        const root = host.attachShadow({ mode: 'open' });
        for (let j = 0; j < 10; j++) {
          root.innerHTML += '<div class="col-' + window.__uid + '"><span>x</span></div>';
        }
        document.body.appendChild(host);
      }
    `,
    selectors: [
      { label: 'collectAllDeep no filter', resolve: 'null', type: 'collectAll' },
      { label: 'collectAllDeep with filter', resolve: '"div"', type: 'collectAll' },
    ],
    iterations: 100,
  },
  {
    name: 'Comma-separated selectors',
    setup: `
      window.__uid = Math.random().toString(36).slice(2, 8);
      function createWithId(tag, id) {
        const el = document.createElement(tag || 'div');
        if (id) el.id = id + '-' + window.__uid;
        document.body.appendChild(el);
        if (el.attachShadow) {
          const root = el.attachShadow({ mode: 'open' });
          root.innerHTML = '<span class="comma-' + window.__uid + '">in shadow</span>';
        }
        return el;
      }
      createWithId('div', 'a');
      const b = createWithId('my-com', 'b');
      const c = createWithId('div', 'c');
    `,
    selectors: [
      { label: 'comma separated', resolve: '"#a-" + uid + ", #b-" + uid + ", #c-" + uid', type: 'query' },
    ],
    iterations: 200,
  },
];
