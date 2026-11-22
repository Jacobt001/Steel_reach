// The DOM layer: top bar, build bar, sheets, toasts and focus mode. render() runs every frame, so
// it only compares cached values and writes what changed; sheets are built once when opened and
// refreshed at 10 Hz. Nothing here touches the DOM at module load, so Node can import the graph.
import { BUILDINGS, RECIPES, ITEMS, RESEARCH, TIERS, BAL, TPS } from '../config.js';
import { researchState, buyResearch, anyResearchAffordable } from '../game/progress.js';
import { machineStatus, clearMachine } from '../sim/machines.js';
import { CRAFTERS } from '../game/state.js';
import { undo } from '../game/undo.js';
import {
  goalLines, tierLabel, formatDuration, topMade, itemsMade, fmtInt, createRateMeter, BUILD_TOOLS, TOOL_LABELS,
  RECIPE_MACHINES, toolState, markSeen, chipRecipe, recipesFor, recipeText, unlocksAt, ingredientRows, minerRate,
  netOf, netSupply, conveyorInfo, storageCounts, costLines, showsHint,
} from './format.js';

const TOAST_MS = 1800;
const SLOW_MS = 100;    // counts in the bars and sheets refresh at 10 Hz; nobody reads faster
const PERF_MS = 500;    // perf() may walk every belt, so it is polled gently and only while shown
const CONFIRM_MS = 3000; // a two-tap confirm forgets the first tap after this, so a stray tap can't arm it for good

// Constant markup only; game text never goes through innerHTML.
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const ICONS = {
  pan: svg('<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>'),
  belt: svg('<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M8 10l2 2-2 2M13 10l2 2-2 2"/>'),
  bridge: svg('<path d="M3 12h4M17 12h4M12 3v18"/><rect x="7" y="8" width="10" height="8" rx="2"/>'),
  tunnel: svg('<path d="M4 20v-8a8 8 0 0 1 16 0v8"/><path d="M9 20v-7a3 3 0 0 1 6 0v7M2 20h20"/>'),
  splitter: svg('<path d="M12 21v-8M12 13L6 7M12 13V4M12 13l6-6"/><path d="M6 11V7h4M18 11V7h-4M9.5 6.5L12 4l2.5 2.5"/>'),
  merger: svg('<path d="M5 5l7 7M19 5l-7 7M12 3v18"/><path d="M9 18l3 3 3-3"/>'),
  storage: svg('<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'),
  miner: svg('<rect x="6" y="3" width="12" height="5" rx="1"/><path d="M8 8l4 13 4-13M10 13h4"/>'),
  furnace: svg('<path d="M12 21c-4 0-7-3-7-7 0-4 4-6 4-11 3 2 5 4 5 7 1-1 2-2 2-3 2 2 3 4 3 7 0 4-3 7-7 7z"/>'),
  assembler: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
  fabricator: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>'),
  foundry: svg('<path d="M5 9h14l-2 11H7z"/><path d="M9 3c0 2 2 2 2 4M14 3c0 2 2 2 2 4"/>'),
  refinery: svg('<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>'),
  generator: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M13 8l-3 5h4l-3 5"/>'),
  pole: svg('<path d="M12 3v18M6 6h12M8 10h8M9 21h6"/>'),
  erase: svg('<path d="M20 20H9l-5-5L14 5l7 7-7 7M8 11l6 6"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  rotate: svg('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  flip: svg('<path d="M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7"/>'),
  check: svg('<path d="M5 12l5 5 9-10"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  research: svg('<path d="M9 3h6M10 3v6L4.2 19a1.4 1.4 0 0 0 1.2 2h13.2a1.4 1.4 0 0 0 1.2-2L14 9V3M7 15h10"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
};

// --- tiny DOM helpers ------------------------------------------------------------------------
// String children become text nodes, so any game text placed this way is never parsed as HTML.
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'icon') e.innerHTML = ICONS[v];
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}
const ico = (name) => h('span', { class: 'ico', icon: name });
const btn = (cls, text) => h('button', { class: cls, type: 'button', text });
const SHAPE_CLASS = { circle: 'circle', diamond: 'diamond' };
function swatch(item) {
  const s = h('span', { class: `sw ${SHAPE_CLASS[ITEMS[item]?.shape] ?? ''}` });
  s.style.background = ITEMS[item]?.color ?? '';
  return s;
}
function kv(label) {
  const v = h('span', { class: 'v' });
  return [h('div', { class: 'kv' }, h('span', { class: 'k', text: label }), v), v];
}
const pct = (f) => `${Math.round(f * 100)}%`;

// Cached writers: each remembers the last value on the element, so an unchanged value costs a
// comparison and never touches the DOM (no style recalc, no layout).
function setText(e, v) { if (e._t !== v) { e._t = v; e.textContent = v; } }
function show(e, on) { on = !!on; if (e._s !== on) { e._s = on; e.hidden = !on; } }
function flag(e, cls, on) { on = !!on; const k = '_f' + cls; if (e[k] !== on) { e[k] = on; e.classList.toggle(cls, on); } }
function fill(e, f) {
  f = f > 1 ? 1 : f > 0 ? Math.round(f * 200) / 200 : 0;
  if (e._w !== f) { e._w = f; e.style.transform = `scaleX(${f})`; }
}
function setDisabled(e, d) { d = !!d; if (e._d !== d) { e._d = d; e.disabled = d; } }

const ENT_NAMES = { tunnel_in: 'Tunnel entrance', tunnel_out: 'Tunnel exit' };
const entName = (e) => ENT_NAMES[e.type] ?? BUILDINGS[e.type]?.name ?? e.type;
const CONVEYORS = new Set(['belt', 'bridge', 'tunnel_in', 'tunnel_out', 'splitter', 'merger']);

export function createUI({ root = document, game, tools, sfx, actions = {} }) {
  let g = game;
  const $ = (id) => root.querySelector('#' + id);
  const body = document.body;
  const E = {};
  for (const id of ['ui', 'tier', 'goals', 'research', 'menu', 'hint', 'undo', 'recipe', 'rotate', 'flip', 'cancel', 'ok', 'tools', 'toast', 'unfocus', 'scrim', 'sheet', 'sheet-title', 'sheet-close']) E[id] = $(id);
  for (const n of root.querySelectorAll('[data-icon]')) n.innerHTML = ICONS[n.dataset.icon] ?? '';
  const badge = E.research.querySelector('.badge');
  const chipSw = E.recipe.querySelector('.sw'), chipText = E.recipe.querySelector('.t');
  const sheetBody = E.sheet.querySelector('.sheet-body');

  // Every UI tap may be the page's first gesture, and iOS only lets audio start inside one.
  const tap = (fn) => (ev) => { sfx?.unlock?.(); fn(ev); };
  const on = (e, fn) => e.addEventListener('click', tap(fn));
  const click = () => sfx?.play?.('tap');

  // A first tap arms the button and relabels it; only a second tap within CONFIRM_MS acts.
  function twoTap(b, idle, armed, act, canArm = () => true) {
    let timer = 0;
    const reset = () => { clearTimeout(timer); timer = 0; b.textContent = idle; b.classList.remove('armed'); };
    reset();
    on(b, () => {
      if (!timer) {
        if (!canArm()) return;
        b.textContent = armed; b.classList.add('armed');
        timer = setTimeout(reset, CONFIRM_MS);
        return;
      }
      reset(); act();
    });
  }

  // --- toast ---------------------------------------------------------------------------------
  let toastTimer = 0;
  function toast(text) {
    setText(E.toast, String(text));
    show(E.toast, true);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => show(E.toast, false), TOAST_MS);
  }

  // --- sheets: one at a time -----------------------------------------------------------------
  // Modal sheets (welcome, tier-up, complete) dim the map and can't be replaced by a casual one.
  // Announcements queue behind each other so two quick tier-ups don't swallow a sheet.
  let sheet = null;
  const queue = [];
  function openSheet(title, build, { kind, modal = false, announce = false, ent = null } = {}) {
    if (sheet?.modal && !modal) return false;
    dismiss();
    const content = build();
    setText(E['sheet-title'], title);
    sheetBody.replaceChildren(...content.nodes);
    sheetBody.scrollTop = 0;
    show(E['sheet-close'], !modal);
    show(E.scrim, modal);
    E.sheet.setAttribute('aria-modal', modal ? 'true' : 'false');
    show(E.sheet, true);
    sheet = { kind, modal, announce, ent, update: content.update ?? null, onClose: content.onClose ?? null };
    sheet.update?.();
    return true;
  }
  // Closes without starting the next announcement; used when one sheet replaces another.
  function dismiss() {
    if (!sheet) return null;
    const s = sheet;
    sheet = null;
    show(E.sheet, false); show(E.scrim, false);
    sheetBody.replaceChildren();
    s.onClose?.();
    return s;
  }
  function closeSheet() {
    const s = dismiss();
    if (s?.announce && queue.length) queue.shift()();
  }
  function announce(fn) { if (sheet?.announce) queue.push(fn); else fn(); }
  const toggle = (kind, open) => { if (sheet?.kind === kind) closeSheet(); else open(); };
  on(E['sheet-close'], closeSheet);

  // --- top bar -------------------------------------------------------------------------------
  const rates = createRateMeter();
  let shownTier = null, lastSample = -Infinity, goalRows = [];
  function buildGoalStrip() {
    const lines = goalLines(g);
    goalRows = lines.map((l) => {
      const num = h('span'), rate = h('span', { class: 'r' }), bar = h('i');
      const row = h('span', { class: 'goal' },
        h('span', { class: 'gl' }, swatch(l.item), h('span', { class: 'n', text: l.name })),
        h('span', { class: 'gl' }, num, rate),
        h('span', { class: 'bar' }, bar));
      return { item: l.item, need: l.need, num, rate, bar, row };
    });
    E.goals.replaceChildren(...(goalRows.length ? goalRows.map((r) => r.row) : [h('span', { class: 'gdone', text: 'All tiers done · build anything' })]));
  }
  // Shared by the strip and the Goals sheet so both always agree.
  function paintGoal(r) {
    const have = g.prog[r.item] ?? 0;
    setText(r.num, `${fmtInt(Math.min(have, r.need))}/${fmtInt(r.need)}`);
    setText(r.rate, `${fmtInt(rates.rate(r.item))}/min`);
    fill(r.bar, have / r.need);
    flag(r.row, 'done', have >= r.need);
  }
  function sampleRates() {
    lastSample = g.tick;
    const counts = {};
    for (const r of goalRows) counts[r.item] = g.prog[r.item] ?? 0;
    rates.sample(g.tick, counts);
  }

  on(E.tier, () => { click(); toggle('goals', openGoals); });
  on(E.goals, () => { click(); toggle('goals', openGoals); });
  on(E.research, () => { click(); toggle('research', openResearch); });
  on(E.menu, () => { click(); toggle('menu', openMenu); });

  // --- hint card -----------------------------------------------------------------------------
  function retireHint() { g.settings.hintDone = true; show(E.hint, false); }
  on(E.hint.querySelector('button'), retireHint);

  // --- build bar -----------------------------------------------------------------------------
  const toolBtns = new Map();
  let toolsDirty = true, chipDirty = true, lastTool;
  for (const id of BUILD_TOOLS) {
    const lock = h('span', { class: 'lock', icon: 'lock' }), dot = h('span', { class: 'dot' });
    const b = h('button', { class: 'tool', type: 'button', 'aria-pressed': 'false' }, ico(id), h('span', { class: 'tl', text: TOOL_LABELS[id] }), lock, dot);
    show(lock, false); show(dot, false);
    on(b, () => pickTool(id));
    E.tools.append(b);
    toolBtns.set(id, { b, lock, dot });
  }
  function pickTool(id) {
    const st = toolState(g, id);
    if (st.locked) { toast(`Unlocks at Tier ${st.tier}`); return; }
    click();
    // Tapping the active tool again puts the finger back in Pan, the safe default.
    tools?.setTool?.(tools.tool === id && id !== 'pan' ? 'pan' : id);
    if (st.fresh) { markSeen(g, id); toolsDirty = true; }
  }
  function refreshTools() {
    toolsDirty = false;
    for (const [id, t] of toolBtns) {
      const st = toolState(g, id);
      flag(t.b, 'locked', st.locked);
      show(t.lock, st.locked);
      show(t.dot, st.fresh);
      const label = st.locked ? `${TOOL_LABELS[id]}, unlocks at Tier ${st.tier}` : st.fresh ? `${TOOL_LABELS[id]}, new` : TOOL_LABELS[id];
      if (t.b._l !== label) { t.b._l = label; t.b.setAttribute('aria-label', label); }
    }
  }
  function refreshChip() {
    chipDirty = false;
    if (!RECIPE_MACHINES.includes(lastTool)) return;
    const id = chipRecipe(g, lastTool);
    setText(chipText, id ? ITEMS[id].name : 'No recipe');
    const c = id ? ITEMS[id].color : '';
    if (chipSw._c !== c) { chipSw._c = c; chipSw.style.background = c; }
  }

  on(E.undo, () => { if (undo(g)) sfx?.play?.('undo'); else toast('Nothing to undo'); });
  on(E.rotate, () => tools?.rotate?.());
  on(E.flip, () => tools?.flip?.());
  on(E.cancel, () => tools?.cancel?.());
  on(E.ok, () => tools?.confirm?.());
  on(E.recipe, () => { click(); toggle('recipe', () => openRecipePicker(lastTool)); });

  // --- focus mode ----------------------------------------------------------------------------
  // Building needs the bar's ✓/✕, so focus mode drops back to Pan: map viewing plus tap-to-inspect.
  function setFocus(focus) {
    if (focus) { tools?.cancel?.(); tools?.setTool?.('pan'); }
    body.classList.toggle('focus', focus);
  }
  on(E.unfocus, () => setFocus(false));

  // --- sheets: goals & hub storage -----------------------------------------------------------
  function openGoals() {
    openSheet(tierLabel(g), () => {
      const tier = g.tier;
      const rows = goalLines(g).map((l) => {
        const num = h('span'), rate = h('span', { class: 'r' }), bar = h('i');
        const row = h('div', { class: 'goalrow' },
          h('div', { class: 'gl' }, swatch(l.item), h('span', { class: 'n', text: l.name }), h('span', { class: 'r' }, num, ' · ', rate)),
          h('span', { class: 'bar big' }, bar));
        return { item: l.item, need: l.need, num, rate, bar, row };
      });
      const next = tier < TIERS.length ? unlocksAt(tier + 1) : null;
      const nextText = next
        ? `Tier ${tier + 1} unlocks: ${[...next.buildings, ...next.recipes, ...next.ores].join(', ') || 'new goals'}`
        : tier === TIERS.length ? 'Finish this tier to complete the factory.' : 'Everything is unlocked.';
      const grid = h('div', { class: 'grid' });
      let stockKey = null, cells = new Map();
      function paintStock() {
        let key = '';
        for (const k in ITEMS) if (g.stock[k] > 0) key += k + ',';
        if (key !== stockKey) {
          stockKey = key; cells = new Map();
          const kids = [];
          for (const k in ITEMS) {
            if (!(g.stock[k] > 0)) continue;
            const n = h('span', { class: 'num' });
            kids.push(h('div', { class: 'row' }, swatch(k), h('span', { class: 'name', text: ITEMS[k].name }), n));
            cells.set(k, n);
          }
          grid.replaceChildren(...(kids.length ? kids : [h('span', { class: 'muted', text: 'Nothing delivered yet.' })]));
        }
        for (const [k, n] of cells) setText(n, fmtInt(g.stock[k]));
      }
      return {
        nodes: [
          ...(rows.length ? [h('h3', { text: 'Deliver to the Hub' }), ...rows.map((r) => r.row)] : [h('p', { class: 'lead', text: 'Sandbox mode: no goals, everything unlocked.' })]),
          h('p', { class: 'note', text: nextText }),
          h('h3', { text: 'Hub storage' }), grid,
        ],
        update() {
          if (g.tier !== tier) { openGoals(); return; }
          for (const r of rows) paintGoal(r);
          paintStock();
        },
      };
    }, { kind: 'goals' });
  }

  // --- sheets: research ----------------------------------------------------------------------
  function openResearch() {
    openSheet('Research', () => {
      // Built once per open: what's still to buy first, nearest tier first, finished ones last.
      const order = RESEARCH.map((r, i) => ({ r, i }))
        .sort((a, b) => (!!g.research[a.r.id] - !!g.research[b.r.id]) || a.r.tier - b.r.tier || a.i - b.i)
        .map((x) => x.r);
      const rows = order.map((r) => {
        const buy = btn('btn primary buy', 'Buy'), why = h('span', { class: 'why' }), done = h('span', { class: 'why', text: 'Researched' });
        const costs = costLines(g, r.cost).map((c) => {
          const num = h('span', { class: 'num' });
          return { item: c.item, need: c.need, num, el: h('span', { class: 'cost' }, swatch(c.item), num, h('span', { text: c.name })) };
        });
        const row = h('div', { class: 'res' },
          h('div', { class: 'grow' }, h('span', { class: 'nm', text: r.name }), h('span', { class: 'ds', text: r.desc }),
            h('div', { class: 'costs' }, ...costs.map((c) => c.el)), why, done),
          buy);
        on(buy, () => {
          const res = buyResearch(g, r.id);
          if (res.ok) { sfx?.play?.('research'); toast(`${r.name} researched`); } else toast(res.reason);
          if (sheet?.update) sheet.update();
        });
        return { r, row, buy, why, done, costs };
      });
      return {
        nodes: [h('p', { class: 'note', text: 'Paid instantly with items stored in the Hub.' }), h('div', null, ...rows.map((x) => x.row))],
        update() {
          for (const x of rows) {
            const st = researchState(g, x.r.id), owned = !!g.research[x.r.id];
            flag(x.row, 'done', owned);
            show(x.buy, !owned); setDisabled(x.buy, !st.can);
            show(x.done, owned);
            show(x.why, !owned && !st.can); setText(x.why, st.reason ?? '');
            for (const c of x.costs) {
              const have = g.stock[c.item] ?? 0;
              setText(c.num, owned ? fmtInt(c.need) : `${fmtInt(Math.min(have, c.need))}/${fmtInt(c.need)}`);
              flag(c.el, 'short', !owned && have < c.need);
            }
          }
        },
      };
    }, { kind: 'research' });
  }

  // --- sheets: recipe picker for the build bar chip ------------------------------------------
  function openRecipePicker(type) {
    if (!RECIPE_MACHINES.includes(type)) return;
    openSheet(`${BUILDINGS[type].name} recipe`, () => {
      const cur = chipRecipe(g, type);
      const items = recipesFor(g, type).map((r) => {
        const b = h('button', { class: `choice${r.id === cur ? ' on' : ''}`, type: 'button', 'aria-pressed': r.id === cur ? 'true' : 'false' },
          swatch(r.id), h('span', { class: 'grow' }, r.name, h('small', { text: r.unlocked ? recipeText(r.id) : `Unlocks at Tier ${r.tier}` })));
        b.disabled = !r.unlocked;
        // place() reads lastRecipe, so the next ghost of this machine uses the pick.
        on(b, () => { (g.settings.lastRecipe ??= {})[type] = r.id; chipDirty = true; click(); closeSheet(); });
        return b;
      });
      return { nodes: [h('div', { class: 'list' }, ...items)] };
    }, { kind: 'recipe' });
  }

  // --- sheets: inspector ---------------------------------------------------------------------
  function crafterPanel(m) {
    const status = h('p', { class: 'status' });
    const recipeLine = h('p', { class: 'note' });
    const rowsBox = h('div', { class: 'rows' });
    const bar = h('i');
    const [outRow, outVal] = kv('Output');
    const power = BUILDINGS[m.type].power > 0 ? kv('Power') : null;
    const picks = new Map();
    let picker = null;
    if (RECIPE_MACHINES.includes(m.type)) {
      picker = h('div', { class: 'picks' });
      for (const r of recipesFor(g, m.type)) {
        if (!r.unlocked) continue;
        const b = h('button', { class: 'pick', type: 'button' }, swatch(r.id), r.name);
        // Old ingredients can't feed the new recipe, so changing it clears the machine (R22).
        on(b, () => { if (m.recipe === r.id) return; m.recipe = r.id; clearMachine(g, m); click(); update(); });
        picker.append(b); picks.set(r.id, b);
      }
    }
    const clear = btn('btn wide danger', 'Clear');
    on(clear, () => { clearMachine(g, m); toast(`${entName(m)} cleared`); update(); });
    let shown, rows = [];
    function rebuild() {
      shown = m.recipe;
      setText(recipeLine, m.recipe ? `${recipeText(m.recipe)} · ${RECIPES[m.recipe].sec} s`
        : m.type === 'furnace' ? 'Picks its recipe from the first ore it gets.' : 'No recipe');
      rows = ingredientRows(m).map((r) => {
        const num = h('span', { class: 'num' }), tag = h('span', { class: 'tag', text: 'overstocked' });
        show(tag, false);
        return { ...r, num, tag, row: h('div', { class: 'row' }, swatch(r.item), h('span', { class: 'name', text: r.name }), tag, num) };
      });
      rowsBox.replaceChildren(...(rows.length ? rows.map((r) => r.row) : [h('span', { class: 'muted', text: 'Empty' })]));
      for (const [id, b] of picks) { flag(b, 'on', id === m.recipe); b.setAttribute('aria-pressed', id === m.recipe ? 'true' : 'false'); }
    }
    function update() {
      if (m.recipe !== shown) rebuild();
      const st = machineStatus(g, m);
      setText(status, st); flag(status, 'bad', st !== 'Working');
      for (const r of rows) {
        const have = m.buf[r.item] ?? 0;
        setText(r.num, `${fmtInt(have)} / ${r.cap}`);
        flag(r.row, 'over', have > r.cap); show(r.tag, have > r.cap);
      }
      fill(bar, m.recipe ? m.prog / (RECIPES[m.recipe].sec * TPS) : 0);
      setText(outVal, `${m.out.length} / ${BAL.outMax}`);
      if (power) setText(power[1], m.net < 0 ? `No power · ${pct(BAL.unpowered)} speed` : `Connected · ${pct(m.pmult)} speed`);
    }
    const nodes = [status];
    if (picker) nodes.push(h('h3', { text: 'Recipe' }), picker, h('p', { class: 'note', text: 'Changing the recipe throws away the items inside.' }));
    nodes.push(recipeLine, h('h3', { text: 'Ingredients' }), rowsBox, h('h3', { text: 'Progress' }), h('span', { class: 'bar big' }, bar), outRow);
    if (power) nodes.push(power[0]);
    nodes.push(clear, h('p', { class: 'note', text: 'Clear throws away the ingredients and output inside.' }));
    return { nodes, update };
  }

  function minerPanel(m) {
    const status = h('p', { class: 'status' });
    const [oreRow, oreVal] = kv('Ore'), [rateRow, rateVal] = kv('Rate'), [outRow, outVal] = kv('Output');
    oreVal.append(swatch(m.ore), ` ${ITEMS[m.ore]?.name ?? m.ore} · ${m.tiles} ore tile${m.tiles === 1 ? '' : 's'}`);
    return {
      nodes: [status, oreRow, rateRow, outRow],
      update() {
        const st = machineStatus(g, m);
        setText(status, st); flag(status, 'bad', st !== 'Working');
        setText(rateVal, `${fmtInt(minerRate(g, m))} / min`);
        setText(outVal, `${m.out.length} / ${BAL.outMax}`);
      },
    };
  }

  function storagePanel(e) {
    const [capRow, capVal] = kv('Holding');
    const list = h('div', { class: 'rows' });
    const empty = btn('btn wide danger', 'Empty');
    on(empty, () => { e.queue.length = 0; toast('Storage box emptied'); update(); });
    let key = null, nums = new Map();
    function update() {
      setText(capVal, `${fmtInt(e.queue.length)} / ${fmtInt(g.mods.storageCap)}`);
      const counts = storageCounts(e.queue);
      const k = counts.map((c) => c.item).join();
      if (k !== key) {
        key = k; nums = new Map();
        list.replaceChildren(...(counts.length ? counts.map((c) => {
          const n = h('span', { class: 'num' }); nums.set(c.item, n);
          return h('div', { class: 'row' }, swatch(c.item), h('span', { class: 'name', text: c.name }), n);
        }) : [h('span', { class: 'muted', text: 'Empty' })]));
      }
      for (const c of counts) setText(nums.get(c.item), fmtInt(c.count));
    }
    return { nodes: [capRow, h('h3', { text: 'Contents' }), list, empty, h('p', { class: 'note', text: 'Empty throws the contents away.' })], update };
  }

  function generatorPanel(e) {
    const status = h('p', { class: 'status' });
    const [fuelRow, fuelVal] = kv('Fuel'), [burnRow, burnVal] = kv('Burning');
    const [supRow, supVal] = kv('Network supply'), [demRow, demVal] = kv('Network demand'), [satRow, satVal] = kv('Satisfied');
    return {
      nodes: [status, fuelRow, burnRow, h('h3', { text: 'Power network' }), supRow, demRow, satRow],
      update() {
        const cells = g.tier >= 11 || e.fuel.fuel_cell > 0;
        setText(fuelVal, `${e.fuel.coal} coal${cells ? ` · ${e.fuel.fuel_cell} fuel cell${e.fuel.fuel_cell === 1 ? '' : 's'}` : ''} (max ${BAL.genFuelMax})`);
        setText(burnVal, e.burn > 0 ? `${(e.burn / TPS).toFixed(1)} s left · ${fmtInt(e.burnPower)} power` : 'No');
        const net = netOf(g, e);
        const supply = net ? netSupply(net) : 0, demand = net ? net.demand : 0;
        setText(supVal, net ? fmtInt(supply) : '—');
        setText(demVal, net ? fmtInt(demand) : '—');
        setText(satVal, !net ? '—' : demand > 0 ? pct(Math.min(1, supply / demand)) : 'Nothing to power');
        const empty = e.burn === 0 && e.fuel.coal + e.fuel.fuel_cell === 0;
        const st = empty ? 'Out of fuel' : !net ? 'Linking…' : demand === 0 ? 'Idle: nothing to power' : 'Working';
        setText(status, st); flag(status, 'bad', empty);
      },
    };
  }

  function polePanel() {
    const side = 2 * g.mods.coverHalf + 1;
    return {
      nodes: [
        h('p', { class: 'lead', text: `Links to poles and generators within ${g.mods.poleReach} tiles.` }),
        h('p', { class: 'lead', text: `Powers machines touching its ${side}×${side} area.` }),
      ],
    };
  }

  function conveyorPanel(e) {
    const status = h('p', { class: 'status' });
    const lanes = h('div', { class: 'rows' });
    const [spdRow, spdVal] = kv('Speed');
    let key = null;
    const itemsView = (list) => {
      if (!list.length) return h('span', { class: 'muted', text: 'Empty' });
      // Underground runs can hold dozens; past a belt's 4 a count per item reads better than chips.
      if (list.length > 4) return h('div', { class: 'items' }, ...storageCounts(list).map((c) => h('span', { class: 'item' }, swatch(c.item), `${c.name} × ${c.count}`)));
      return h('div', { class: 'items' }, ...list.map((id) => h('span', { class: 'item' }, swatch(id), ITEMS[id]?.name ?? id)));
    };
    return {
      nodes: [status, lanes, spdRow],
      update() {
        const info = conveyorInfo(e);
        const k = info.lanes.map((l) => l.items.join()).join('|');
        if (k !== key) {
          key = k;
          lanes.replaceChildren(...info.lanes.map((l) => h('div', { class: 'lane' }, l.label && h('h3', { text: l.label }), itemsView(l.items))));
        }
        // The sim writes this text ("Furnace can't use Coal"); no marker means nothing is wrong.
        // Coloured like the map marker: 'stall' (full of an item, clears itself) amber, anything else red.
        setText(status, info.blocked ?? 'Not blocked');
        const stall = !!info.blocked && info.kind === 'stall';
        flag(status, 'stall', stall); flag(status, 'bad', !!info.blocked && !stall);
        setText(spdVal, `${BAL.beltTilesPerSec[g.mods.beltLevel]} tiles/s`);
      },
    };
  }

  function inspectorFor(ent) {
    if (CRAFTERS.includes(ent.type)) return crafterPanel(ent);
    if (ent.type === 'miner') return minerPanel(ent);
    if (ent.type === 'storage') return storagePanel(ent);
    if (ent.type === 'generator') return generatorPanel(ent);
    if (ent.type === 'pole') return polePanel(ent);
    if (CONVEYORS.has(ent.type)) return conveyorPanel(ent);
    return { nodes: [h('p', { class: 'lead', text: entName(ent) })] };
  }

  function inspect(ent) {
    if (!ent) { if (sheet?.kind === 'inspect') closeSheet(); return; }
    if (ent.type === 'hub') { openGoals(); return; }
    if (sheet?.kind === 'inspect' && sheet.ent === ent) return;
    openSheet(entName(ent), () => {
      const p = inspectorFor(ent);
      return {
        nodes: p.nodes,
        update() {
          // Erased, undone or replaced by a load: the panel would describe a building that's gone.
          if (g.ents.get(ent.id) !== ent) { closeSheet(); return; }
          p.update?.();
        },
        onClose() {
          // Tools own the highlight; clear it only if it still points at this building.
          const v = tools?.view, s = v?.selected;
          if (v && (s === ent || s === ent.id || (s && s.id === ent.id))) v.selected = null;
        },
      };
    }, { kind: 'inspect', ent });
  }

  // --- sheets: menu --------------------------------------------------------------------------
  function openMenu() {
    openSheet('Menu', () => {
      const sound = btn('btn wide');
      on(sound, () => {
        const next = !g.settings.sfx;
        g.settings.sfx = next;
        if (actions.setSfx) actions.setSfx(next); else sfx?.setEnabled?.(next);
        if (next) click();
        update();
      });
      const overlay = btn('btn wide');
      on(overlay, () => { g.settings.powerOverlay = !g.settings.powerOverlay; click(); update(); });
      const focus = btn('btn wide', 'Focus mode');
      on(focus, () => { closeSheet(); setFocus(true); });
      const copy = btn('btn wide', 'Copy save code');
      on(copy, () => {
        // Called synchronously in the tap (R24): iOS only allows clipboard writes inside the gesture,
        // and even a microtask's delay can lose it. Only the result is awaited.
        let res;
        try { res = actions.copySaveCode ? actions.copySaveCode() : Promise.reject(new Error('No copy action')); }
        catch (err) { res = Promise.reject(err); }
        Promise.resolve(res).then(() => toast('Save code copied'), () => toast("Couldn't copy the save code"));
      });
      const paste = h('textarea', { placeholder: 'Paste a save code here', rows: '3', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Save code' });
      const load = btn('btn wide');
      let loading = false;
      twoTap(load, 'Load save code', 'Tap again to replace your game', () => {
        loading = true; setDisabled(load, true);
        Promise.resolve().then(() => actions.loadSaveCode?.(paste.value))
          .then((res) => {
            if (res && res.ok === false) toast(res.reason || 'Not a Steelreach save code');
            else { if (sheet?.kind === 'menu') closeSheet(); toast('Save loaded'); }
          }, (err) => toast(err?.message || 'Not a Steelreach save code'))
          .finally(() => { loading = false; setDisabled(load, false); });
      }, () => {
        if (loading) return false;
        if (!paste.value.trim()) { toast('Paste a save code first'); return false; }
        return true;
      });
      const perfBtn = btn('btn wide', 'Performance');
      const perfBox = h('div', { class: 'perf' });
      const perfCells = [h('span'), h('span'), h('span'), h('span')];
      perfBox.append(...perfCells);
      show(perfBox, false);
      let perfAt = -Infinity;
      on(perfBtn, () => { show(perfBox, perfBox.hidden); perfAt = -Infinity; update(); });
      const fresh = btn('btn wide danger');
      twoTap(fresh, 'New game', 'Tap again to start over', () => { closeSheet(); actions.newGame?.(); });

      function update() {
        setText(sound, g.settings.sfx ? 'Sound: On' : 'Sound: Off');
        sound.setAttribute('aria-pressed', g.settings.sfx ? 'true' : 'false');
        // The overlay only means something once power exists.
        show(overlay, g.tier >= BUILDINGS.generator.tier);
        setText(overlay, g.settings.powerOverlay ? 'Power overlay: On' : 'Power overlay: Off');
        if (!perfBox.hidden && actions.perf) {
          const now = performance.now();
          if (now - perfAt >= PERF_MS) {
            perfAt = now;
            const p = actions.perf() ?? {};
            setText(perfCells[0], `${fmtInt(p.fps ?? 0)} fps`);
            setText(perfCells[1], `${(p.tickMs ?? 0).toFixed(2)} ms per tick`);
            setText(perfCells[2], `${fmtInt(p.buildings ?? 0)} buildings`);
            setText(perfCells[3], `${fmtInt(p.items ?? 0)} items`);
          }
        }
      }
      return {
        nodes: [sound, overlay, focus, h('h3', { text: 'Save code' }), copy, paste, load,
          h('p', { class: 'note', text: 'Moves your game between the Claude link and the Home Screen app.' }),
          h('h3', { text: 'More' }), perfBtn, perfBox, fresh],
        update,
      };
    }, { kind: 'menu' });
  }

  // --- announcements -------------------------------------------------------------------------
  function showWelcome(onContinue, onNew) {
    openSheet('Steelreach', () => {
      const cont = btn('btn wide primary', 'Continue');
      on(cont, () => { closeSheet(); onContinue?.(); });
      const fresh = btn('btn wide');
      twoTap(fresh, 'New game', 'Tap again to start over', () => { closeSheet(); onNew?.(); });
      return { nodes: [h('p', { class: 'lead', text: `${tierLabel(g)} · ${formatDuration(g.stats.playTicks)} played` }), cont, fresh] };
    }, { kind: 'welcome', modal: true, announce: true });
  }

  function showTierUp(tier) {
    announce(() => {
      sfx?.play?.('tierUp');
      // Reaching tier 2 means the first-run advice worked; it shouldn't linger.
      retireHint();
      toolsDirty = chipDirty = true;
      const def = TIERS[tier - 1];
      openSheet(def ? `Tier ${tier} · ${def.name}` : `Tier ${tier}`, () => {
        const u = unlocksAt(tier);
        const nodes = [h('p', { class: 'lead', text: 'New tier reached!' })];
        const section = (title, list) => { if (list.length) nodes.push(h('h3', { text: title }), h('ul', { class: 'unl' }, ...list.map((t) => h('li', { text: t })))); };
        section('New buildings', u.buildings);
        section('New recipes', u.recipes);
        section('New resources', u.ores);
        section('New research', u.research);
        section('Also', u.extra);
        const goals = def ? Object.entries(def.goals).map(([k, n]) => `${fmtInt(n)} ${ITEMS[k].name}`) : [];
        if (goals.length) nodes.push(h('h3', { text: 'Next goals' }), h('p', { text: goals.join(' · ') }));
        const cont = btn('btn wide primary', 'Continue');
        on(cont, closeSheet);
        nodes.push(cont);
        return { nodes };
      }, { kind: 'tierUp', modal: true, announce: true });
    });
  }

  function showComplete() {
    announce(() => {
      sfx?.play?.('tierUp');
      openSheet('Factory complete', () => {
        const top = topMade(g.stats);
        const [timeRow, timeVal] = kv('Play time'), [madeRow, madeVal] = kv('Items made'), [topRow, topVal] = kv('Top item');
        timeVal.textContent = formatDuration(g.completedAt ?? g.stats.playTicks);
        madeVal.textContent = fmtInt(itemsMade(g.stats));
        if (top) topVal.append(swatch(top.item), ` ${top.name} × ${fmtInt(top.count)}`); else topVal.textContent = '—';
        const keep = btn('btn wide primary', 'Keep building');
        on(keep, closeSheet);
        return { nodes: [h('p', { class: 'lead', text: 'All 12 tiers done. Sandbox mode is on: everything is unlocked.' }), timeRow, madeRow, topRow, keep] };
      }, { kind: 'complete', modal: true, announce: true });
    });
  }

  // --- per-frame work ------------------------------------------------------------------------
  let slowAt = -Infinity;
  function tierChanged() {
    shownTier = g.tier;
    rates.reset(); lastSample = -Infinity;
    buildGoalStrip();
    toolsDirty = chipDirty = true;
    slowAt = -Infinity;
  }
  function render() {
    if (g.tier !== shownTier) tierChanged();
    // Sampled once per game second; a smaller tick means a different game was swapped in.
    if (g.tick - lastSample >= TPS || g.tick < lastSample) sampleRates();

    // Build bar state follows taps, so it is checked every frame (a few cached compares).
    const tool = tools?.tool ?? 'pan';
    if (tool !== lastTool) {
      // Every button, not just the previous one: sync() forgets lastTool, so the old highlight
      // can't be found that way. Only runs on a change, and the cached writers skip unchanged buttons.
      for (const [id, t] of toolBtns) {
        const pressed = id === tool;
        flag(t.b, 'on', pressed);
        if (t.b._p !== pressed) { t.b._p = pressed; t.b.setAttribute('aria-pressed', pressed ? 'true' : 'false'); }
      }
      lastTool = tool;
      show(E.rotate, BUILDINGS[tool]?.dir === true);
      show(E.recipe, RECIPE_MACHINES.includes(tool));
      chipDirty = true;
    }
    const v = tools?.view;
    const pending = !!(v && (v.ghost || v.beltPreview));
    show(E.ok, pending); show(E.cancel, pending); show(E.flip, !!(v && v.beltPreview));
    setDisabled(E.undo, !g.undo.length);
    if (chipDirty) refreshChip();

    const now = performance.now();
    if (now - slowAt < SLOW_MS) return;
    slowAt = now;
    setText(E.tier, tierLabel(g));
    for (const r of goalRows) paintGoal(r);
    show(badge, anyResearchAffordable(g));
    if (toolsDirty) refreshTools();
    sheet?.update?.();
  }

  // Game state changed outside the UI (load, undo by code, settings): repaint everything now.
  function sync() {
    shownTier = null; toolsDirty = chipDirty = true; lastTool = undefined; slowAt = -Infinity;
    render();
  }

  function setGame(next) {
    g = next;
    // Casual sheets describe the old game's buildings and stock; announcements belong to the player's flow.
    if (sheet && !sheet.modal) closeSheet();
    rates.reset(); lastSample = -Infinity;
    show(E.hint, showsHint(g));
    sync();
  }

  show(E.ui, true);
  show(E.hint, showsHint(g));
  sync();

  return { render, inspect, toast, showWelcome, showTierUp, showComplete, sync, setGame };
}
