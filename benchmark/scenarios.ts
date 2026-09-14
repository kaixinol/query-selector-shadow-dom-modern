export type TestType = 'query' | 'queryAll' | 'collectAll' | 'queryCold' | 'queryAllCold';

export interface Scenario {
    name: string;
    setup: string;
    selectors: Array<{
        label: string;
        /** JS expression (with `uid` in scope) producing the selector — or 'null'. */
        resolve: string;
        type: TestType;
        /** JS expression evaluated in the page for the `root` argument. */
        rootExpr?: string;
    }>;
    iterations: number;
}

export const SCENARIOS: Scenario[] = [
    {
        name: 'Real-world Design System Layout (Mixed Shadow & Light DOM)',
        setup: `
      window.__uid = 'u1';
      // 模拟现代化应用骨架：App Shell -> Layout -> Sidebar/Main -> Card Widgets
      for (let i = 0; i < 40; i++) {
        const shell = document.createElement('app-shell');
        const shellRoot = shell.attachShadow({ mode: 'open' });

        const contentPane = document.createElement('content-pane');
        const paneRoot = contentPane.attachShadow({ mode: 'open' });

        const card = document.createElement('ds-card');
        card.setAttribute('data-index', i);
        const cardRoot = card.attachShadow({ mode: 'open' });

        cardRoot.innerHTML = \`
          <div class="card-header \${i === 25 ? 'target-' + window.__uid : ''}">
            <span class="title">Widget \${i}</span>
          </div>
          <div class="card-body">
            <slot></slot>
          </div>
        \`;

        // 混合 Light DOM 子节点投影到 Slot
        if (i === 25) {
          const slotted = document.createElement('div');
          slotted.className = 'deep-target-' + window.__uid;
          slotted.textContent = 'Target Content';
          card.appendChild(slotted);
        }

        paneRoot.appendChild(card);
        shellRoot.appendChild(contentPane);
        document.body.appendChild(shell);
      }
    `,
        selectors: [
            { label: 'Deep mixed shadow & slot selector', resolve: '"ds-card .deep-target-" + uid', type: 'query' },
            { label: 'querySelectorAllDeep same selector', resolve: '"ds-card .deep-target-" + uid', type: 'queryAll' },
            { label: 'single class in shadow', resolve: '".title"', type: 'queryAll' },
        ],
        iterations: 100,
    },
    {
        name: 'Deeply Nested Component Tree (7 Levels)',
        setup: `
      window.__uid = 'u1';
      function createDeepTree(depth) {
        const host = document.createElement('level-' + depth);
        const root = host.attachShadow({ mode: 'open' });
        if (depth === 0) {
          root.innerHTML = \`<div class="leaf-node-\${window.__uid}" data-active="true">Found Me</div>\`;
        } else {
          const wrapper = document.createElement('div');
          wrapper.className = 'wrapper-tier';
          wrapper.appendChild(createDeepTree(depth - 1));
          root.appendChild(wrapper);
        }
        return host;
      }
      for (let i = 0; i < 15; i++) {
        document.body.appendChild(createDeepTree(6));
      }
    `,
        selectors: [
            { label: '7-level deep nested selector', resolve: '".leaf-node-" + uid', type: 'query' },
            { label: '7-level deep querySelectorAll', resolve: '".leaf-node-" + uid', type: 'queryAll' },
        ],
        iterations: 100,
    },
    {
        name: 'High-Density Dashboard (100 Parallel Shadow Roots)',
        setup: `
      window.__uid = 'u1';
      window.__coldSelectors = [];
      for (let i = 0; i < 100; i++) {
        const widget = document.createElement('metric-widget');
        const root = widget.attachShadow({ mode: 'open' });
        let innerHtml = '<div class="metric-container">';
        for (let j = 0; j < 15; j++) {
          const isTarget = (i === 75 && j === 10);
          innerHtml += \`<div class="metric-item \${isTarget ? 'target-' + window.__uid : ''}">metric-\${j}</div>\`;
        }
        innerHtml += '</div>';
        root.innerHTML = innerHtml;
        document.body.appendChild(widget);
        window.__coldSelectors.push('.metric-item.m' + i + '-x');
      }
      // 200 unique (non-matching) selectors: worst case for any parse cache
      for (let i = 0; i < 200; i++) window.__coldSelectors.push('.cold-' + i + ' .leaf');
    `,
        selectors: [
            { label: '.class in 100 heavy roots', resolve: '".target-" + uid', type: 'query' },
            { label: 'querySelectorAll .metric-item', resolve: '".metric-item"', type: 'queryAll' },
            { label: 'unique selector every call (cache miss)', resolve: 'null', type: 'queryCold' },
            { label: 'unique selector every call (queryAll)', resolve: 'null', type: 'queryAllCold' },
        ],
        iterations: 100,
    },
    {
        name: 'Complex Multi-Boundary Combinators & Attributes',
        setup: `
      window.__uid = 'u1';
      for (let i = 0; i < 30; i++) {
        const outer = document.createElement('complex-layout');
        const outerRoot = outer.attachShadow({ mode: 'open' });

        const inner = document.createElement('data-grid');
        const innerRoot = inner.attachShadow({ mode: 'open' });

        innerRoot.innerHTML = \`
          <div class="row-wrapper">
            <span class="cell target-cell-\${window.__uid}" data-status="active">Target</span>
          </div>
        \`;

        outerRoot.innerHTML = \`
          <header class="layout-header"></header>
          <div class="layout-body"></div>
        \`;
        outerRoot.querySelector('.layout-body').appendChild(inner);
        document.body.appendChild(outer);
      }
    `,
        selectors: [
            {
                label: 'complex shadow combinator + attr',
                resolve: '"complex-layout > .layout-body data-grid .target-cell-" + uid + "[data-status=\\"active\\"]"',
                type: 'query',
            },
        ],
        iterations: 100,
    },
    {
        name: 'Heavy-Scale collectAllElementsDeep with Filtering',
        setup: `
      window.__uid = 'u1';
      for (let i = 0; i < 50; i++) {
        const container = document.createElement('virtual-list');
        const root = container.attachShadow({ mode: 'open' });
        let html = '';
        for (let j = 0; j < 20; j++) {
          const matchType = j % 2 === 0 ? 'item-match-' + window.__uid : 'item-other';
          html += \`<div class="\${matchType}" data-id="\${j}"><span>Content \${j}</span></div>\`;
        }
        root.innerHTML = html;
        document.body.appendChild(container);
      }
    `,
        selectors: [
            { label: 'collectAllDeep massive unfiltered', resolve: 'null', type: 'collectAll' },
            { label: 'collectAllDeep massive filtered', resolve: '".item-match-" + uid', type: 'collectAll' },
        ],
        iterations: 50,
    },
    {
        name: 'Complex Comma-Separated Multi-Target Cross-Boundary',
        setup: `
      window.__uid = 'u1';

      // Light DOM anchor
      const lightEl = document.createElement('div');
      lightEl.id = 'light-anchor-' + window.__uid;
      document.body.appendChild(lightEl);

      // Shadow component A
      const compA = document.createElement('panel-a');
      const rootA = compA.attachShadow({ mode: 'open' });
      rootA.innerHTML = \`<div class="item-a-\${window.__uid}">shadow A</div>\`;
      document.body.appendChild(compA);

      // Shadow component B (Nested)
      const compB = document.createElement('panel-b');
      const rootB = compB.attachShadow({ mode: 'open' });
      const subB = document.createElement('sub-b');
      const subRootB = subB.attachShadow({ mode: 'open' });
      subRootB.innerHTML = \`<div class="item-b-\${window.__uid}">shadow B nested</div>\`;
      rootB.appendChild(subB);
      document.body.appendChild(compB);
    `,
        selectors: [
            {
                label: 'comma separated multi-boundary',
                resolve: '"#light-anchor-" + uid + ", .item-a-" + uid + ", .item-b-" + uid',
                type: 'query',
            },
            {
                label: 'comma separated (queryAll)',
                resolve: '"#light-anchor-" + uid + ", .item-a-" + uid + ", .item-b-" + uid',
                type: 'queryAll',
            },
        ],
        iterations: 150,
    },
    {
        name: 'Scoped Element Root (query from a container)',
        setup: `
      window.__uid = 'u1';
      const scope = document.createElement('div');
      scope.id = 'scope-root';
      document.body.appendChild(scope);
      for (let i = 0; i < 30; i++) {
        const host = document.createElement('scoped-widget');
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = '<div class="box"><span class="label">' + i + '</span>' +
          (i === 20 ? '<em class="hit-' + window.__uid + '"></em>' : '') + '</div>';
        scope.appendChild(host);
      }
      // decoy content outside the scope
      for (let i = 0; i < 30; i++) {
        const host = document.createElement('scoped-widget');
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = '<div class="box"><span class="label">x</span></div>';
        document.body.appendChild(host);
      }
    `,
        selectors: [
            {
                label: 'element root + shadow (query)',
                resolve: '"scoped-widget .hit-" + uid',
                type: 'query',
                rootExpr: "document.getElementById('scope-root')",
            },
            {
                label: 'element root + shadow (queryAll .label)',
                resolve: '".label"',
                type: 'queryAll',
                rootExpr: "document.getElementById('scope-root')",
            },
        ],
        iterations: 150,
    },
    {
        name: 'Light DOM Only (no shadow roots at all)',
        setup: `
      window.__uid = 'u1';
      let html = '';
      for (let i = 0; i < 500; i++) {
        html += '<div class="row"><span class="cell c' + (i % 10) + '">' + i + '</span>' +
          (i === 400 ? '<b class="needle-' + window.__uid + '"></b>' : '') + '</div>';
      }
      document.body.innerHTML = html;
    `,
        selectors: [
            { label: 'plain .class (native fast path)', resolve: '".needle-" + uid', type: 'query' },
            { label: 'querySelectorAll .cell', resolve: '".cell"', type: 'queryAll' },
            { label: 'collectAll unfiltered', resolve: 'null', type: 'collectAll' },
        ],
        iterations: 200,
    },
];
