// Undo: each doAction is one step; the stack keeps the last BAL.undoMax steps.
import { BAL } from '../config.js';
import { addEnt, removeEnt } from './state.js';

export function doAction(game, fn) {
  if (game.cur) return fn(); // nested calls fold into the outer action
  game.cur = [];
  try { return fn(); }
  finally {
    const rec = game.cur;
    game.cur = null;
    if (rec.length) {
      game.undo.push(rec);
      while (game.undo.length > BAL.undoMax) game.undo.shift();
    }
  }
}

// A gesture spread over many pointer events (an erase drag) still has to undo as one step, but
// doAction only folds calls made inside its own callback. run() records into the group without
// leaving game.cur open between events (so the sim or an Undo tap in between can't write into
// it); commit() pushes everything as a single action; revert() takes it all back unrecorded,
// for a gesture that turned out to be something else (a second finger made it a pinch).
export function actionGroup(game) {
  const rec = [];
  return {
    run(fn) {
      const prev = game.cur;
      game.cur = rec;
      try { return fn(); } finally { game.cur = prev; }
    },
    commit() {
      if (rec.length) doAction(game, () => { game.cur.push(...rec); });
      rec.length = 0;
    },
    revert() {
      revert(game, rec);
      rec.length = 0;
    },
  };
}

// Plays one record backwards. Callers keep game.cur null, so the reverts are not recorded as a
// new action.
function revert(game, rec) {
  // Items on an auto-bridge's lanes, by tile: when the bridge goes, the belt that was there
  // comes back with the crossed line's items instead of dropping them.
  const carried = new Map();
  for (let i = rec.length - 1; i >= 0; i--) {
    const e = rec[i];
    if (e.op === 'add') {
      const ent = game.ents.get(e.id);
      if (ent) {
        if (ent.type === 'bridge') carried.set(`${ent.x},${ent.y}`, ent);
        removeEnt(game, ent);
      }
    } else if (e.op === 'dir') {
      const ent = game.ents.get(e.id);
      if (ent) { Object.assign(ent, e.before); game.topoDirty = true; }
    } else {
      const { id, type, x, y, ...props } = e.snap;
      const back = addEnt(game, type, x, y, { ...props, id });
      const br = type === 'belt' ? carried.get(`${x},${y}`) : null;
      if (br) back.items.push(...(back.dir === br.dirH ? br.laneH : back.dir === br.dirV ? br.laneV : []));
    }
  }
}

export function undo(game) {
  const rec = game.undo.pop();
  if (!rec) return false;
  revert(game, rec);
  return true;
}
