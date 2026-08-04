/* Shared app chrome for every mockup screen — guarantees pixel-identical
   sidebar/topbar across the gallery. Rendered at load; Playwright waits for it. */

const I = {
  dash: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  pos: 'M3 6h18v12H3zM3 10h18M7 15h4',
  chef: 'M6 20h12M7 17h10V9.5a4 4 0 1 0-2.8-6.8A4 4 0 0 0 7 5.2 3.4 3.4 0 0 0 7 17z',
  box: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  truck: 'M3 6h11v10H3zM14 9h4l3 3v4h-7zM7.5 19a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM17.5 19a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z',
  bank: 'M3 21h18M4 10h16M5 10v11M19 10v11M9 10v11M15 10v11M12 3l9 5H3z',
  users: 'M16 20v-1.6a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M9 10.4a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2zM22 20v-1.6a4 4 0 0 0-3-3.8M17 3.4a4 4 0 0 1 0 7.2',
  hr: 'M4 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6',
  chart: 'M3 3v18h18M7 15v3M12 10v8M17 6v12',
  spark: 'M12 2.5l2.1 5.6 5.6 2.1-5.6 2.1L12 18l-2.1-5.7L4.3 10.2l5.6-2.1zM19 3v3M20.5 4.5h-3M5.5 17v2.5M6.75 18.25h-2.5',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  msg: 'M21 15a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z',
  cog: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15h-.2a2 2 0 1 1 0-4H3a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6V4a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.3.9z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.2-4.2',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  chev: 'M6 9l6 6 6-6',
  branch: 'M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  bolt: 'M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12z',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  check: 'M20 6L9 17l-5-5',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  arrowDown: 'M12 5v14M19 12l-7 7-7-7',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1-.6-1.4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 1.4.6l6.4 6.4a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  refresh: 'M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5',
  filter: 'M3 4h18l-7 8v7l-4 2v-9z',
  plus: 'M12 5v14M5 12h14',
  flame: 'M12 22c4 0 7-2.7 7-6.5 0-4.5-4-6-4-9.5-2 1-3 3-3 5 0-1.5-.7-3-2-4-1.4 1.6-2 3.4-2 5.5C8 15 5 15.5 5 15.5 5 19.3 8 22 12 22z',
  scale: 'M12 3v18M8 21h8M6 7h12M6 7l-3 7h6zM18 7l3 7h-6z',
};

function ico(k, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round"><path d="${I[k]}"/></svg>`;
}
window.ico = ico;

const NAV = [
  ['Operations', [
    ['dash', 'Dashboard', 'dashboard'],
    ['pos', 'Point of Sale', 'pos', { count: '18' }],
    ['chef', 'Kitchen Display', 'kds', { count: '7' }],
    ['box', 'Inventory', 'inventory', { count: '3' }],
    ['truck', 'Purchasing', 'purchasing'],
  ]],
  ['Intelligence', [
    ['spark', 'AI Insights', 'insights', { tag: '6' }],
    ['trend', 'Forecasting', 'forecast'],
    ['scale', 'Menu Profit', 'menu'],
    ['msg', 'Ask Your Data', 'nlq', { tag: 'AI' }],
  ]],
  ['Back Office', [
    ['bank', 'Finance', 'finance'],
    ['users', 'CRM & Loyalty', 'crm'],
    ['hr', 'People & Payroll', 'hr'],
    ['chart', 'Reports', 'reports'],
  ]],
];

function sidebar(active) {
  const groups = NAV.map(([label, items]) => `
    <div class="nav-label">${label}</div>
    ${items.map(([icon, name, key, o = {}]) => `
      <div class="nav-item${key === active ? ' on' : ''}">
        ${ico(icon)}<span>${name}</span>
        ${o.tag ? `<span class="tag">${o.tag}</span>` : ''}
        ${o.count ? `<span class="count">${o.count}</span>` : ''}
      </div>`).join('')}
  `).join('');

  return `<aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">R</div>
      <div>
        <div class="brand-name">RestaurantOS</div>
        <div class="brand-sub">Bayleaf Group</div>
      </div>
    </div>
    <nav class="nav">${groups}</nav>
    <div class="side-foot">
      <div class="avatar">SA</div>
      <div style="min-width:0">
        <div style="font-size:11.5px;font-weight:600">Saad Ahmed</div>
        <div style="font-size:10px;color:var(--fg-dim)">Branch Manager</div>
      </div>
      ${ico('cog', 'ml')}
    </div>
  </aside>`;
}

function topbar(crumbs, right = '') {
  const path = crumbs
    .map((c, i) => (i === crumbs.length - 1 ? `<b>${c}</b>` : `${c} <span style="opacity:.4">/</span>`))
    .join(' ');
  return `<header class="topbar">
    <div class="crumb">${path}</div>
    <div class="topbar-right">
      ${right}
      <div class="input" style="width:190px">${ico('search')}<span>Search or ask…</span>
        <span class="mono" style="margin-left:auto;font-size:10px;opacity:.55">⌘K</span></div>
      <div class="chip">${ico('branch')} Clifton, Karachi ${ico('chev')}</div>
      <div class="chip" style="padding:0 7px">${ico('bell')}</div>
    </div>
  </header>`;
}

window.shell = function shell(active, crumbs, right) {
  document.body.insertAdjacentHTML('afterbegin',
    `<div class="app">${sidebar(active)}<div class="main">${topbar(crumbs, right)}` +
    `<div class="content">${document.getElementById('screen').innerHTML}</div></div></div>`);
  document.getElementById('screen').remove();
  document.querySelectorAll('.side-foot svg').forEach(s => {
    s.style.cssText = 'width:14px;height:14px;margin-left:auto;color:var(--fg-dim);flex:none';
  });
  document.body.dataset.ready = '1';
};
