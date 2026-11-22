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

export function undo(game) {
  const rec = game.undo.pop();
  if (!rec) return false;
  // game.cur stays null here, so the reverts are not recorded as new actions.
  for (let i = rec.length - 1; i >= 0; i--) {
    const e = rec[i];
    if (e.op === 'add') {
      const ent = game.ents.get(e.id);
      if (ent) removeEnt(game, ent);
    } else {
      const { id, type, x, y, ...props } = e.snap;
      addEnt(game, type, x, y, { ...props, id });
    }
  }
  return true;
}
