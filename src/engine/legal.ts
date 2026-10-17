import { getSpell } from './data/spells';
import type { Encounter } from './combat';

/** One thing the current combatant may do right now. `apply` performs it through the rules engine. */
export type CombatAction =
  | { kind: 'attack'; attackId: string; targetId: string }
  | { kind: 'cast'; spellId: string; targetIds: string[] }
  | { kind: 'secondWind' }
  | { kind: 'actionSurge' }
  | { kind: 'dodge' }
  | { kind: 'hide' }
  | { kind: 'disengage' }
  | { kind: 'endTurn' };

export interface LegalAction {
  action: CombatAction;
  label: string;
}

/**
 * Lists the legal moves for whoever's turn it is. This is the menu the player sees in combat,
 * and later the fixed list companions choose from, so nobody can do something the rules forbid.
 */
export function legalActions(enc: Encounter): LegalAction[] {
  if (enc.isOver()) return [];
  const actor = enc.current();
  const turn = enc.turnState()!;
  const foes = enc.combatants.filter((c) => c.side !== actor.side && c.status === 'ok');
  const allies = enc.combatants.filter((c) => c.side === actor.side && c.status !== 'dead');
  const out: LegalAction[] = [];

  if (turn.actionsLeft > 0) {
    for (const attack of actor.attacks) {
      for (const foe of foes) {
        out.push({ action: { kind: 'attack', attackId: attack.id, targetId: foe.id }, label: `${attack.name} → ${foe.name}` });
      }
    }
    out.push({ action: { kind: 'dodge' }, label: 'Dodge' });
    if (!actor.features.includes('cunningAction')) {
      out.push({ action: { kind: 'hide' }, label: 'Hide' }, { action: { kind: 'disengage' }, label: 'Disengage' });
    }
  }
  if (actor.features.includes('cunningAction') && (!turn.bonusUsed || turn.actionsLeft > 0)) {
    out.push({ action: { kind: 'hide' }, label: 'Hide (Cunning Action)' }, { action: { kind: 'disengage' }, label: 'Disengage (Cunning Action)' });
  }

  const casting = actor.spellcasting;
  for (const spellId of casting?.spells ?? []) {
    const spell = getSpell(spellId);
    const isBonus = spell.castingTime === 'bonus';
    if (isBonus ? turn.bonusUsed || turn.leveledActionSpellCast : turn.actionsLeft < 1 || (turn.bonusSpellCast && spell.level > 0)) continue;
    if (spell.level > 0 && !(casting!.slots.slice(spell.level).some((n) => n > 0))) continue;
    const targets = spell.effect.kind === 'heal' ? allies.filter((a) => a.hp < a.maxHp) : foes;
    for (const t of targets) out.push({ action: { kind: 'cast', spellId, targetIds: [t.id] }, label: `${spell.name} → ${t.name}` });
  }

  if (actor.resources.secondWind > 0 && !turn.bonusUsed && actor.hp < actor.maxHp) out.push({ action: { kind: 'secondWind' }, label: 'Second Wind' });
  if (actor.resources.actionSurge > 0 && turn.actionsLeft === 0) out.push({ action: { kind: 'actionSurge' }, label: 'Action Surge' });
  out.push({ action: { kind: 'endTurn' }, label: 'End turn' });
  return out;
}

/** Performs an action for the current combatant. Spells use their lowest available slot. */
export function applyAction(enc: Encounter, action: CombatAction): void {
  const id = enc.current().id;
  switch (action.kind) {
    case 'attack':
      return enc.attack(id, action.targetId, action.attackId);
    case 'cast': {
      const spell = getSpell(action.spellId);
      const slots = enc.current().spellcasting?.slots ?? [];
      const slot = spell.level === 0 ? undefined : slots.findIndex((n, lvl) => lvl >= spell.level && n > 0);
      return enc.cast(id, action.spellId, action.targetIds, slot === -1 ? undefined : slot);
    }
    case 'secondWind':
      return enc.secondWind(id);
    case 'actionSurge':
      return enc.actionSurge(id);
    case 'dodge':
      return enc.dodge(id);
    case 'hide':
      enc.hide(id);
      return;
    case 'disengage':
      return enc.disengage(id);
    case 'endTurn':
      return enc.endTurn();
  }
}
