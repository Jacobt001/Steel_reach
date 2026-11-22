// The Hub takes anything from any belt, so it never blocks.
import { TIERS } from '../config.js';
import { OK, NEVER } from './offer.js';
import { checkTier } from '../game/progress.js';

export function acceptHub(game, item, mode) {
  // Belts into the Hub and touching machines only; pass-by never feeds it.
  if (mode === 'passBy') return NEVER;
  game.stock[item] = (game.stock[item] ?? 0) + 1;
  // Progress is deliberately not capped at the goal; research spends stock, not progress.
  if (TIERS[game.tier - 1]?.goals[item] !== undefined) game.prog[item] = (game.prog[item] ?? 0) + 1;
  checkTier(game);
  game.hubPulse = game.tick; // the renderer pulses the Hub for 10 ticks after this
  return OK;
}
