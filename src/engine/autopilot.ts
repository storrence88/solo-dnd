import type { Encounter } from './combat';
import type { Combatant } from './types';

/**
 * A simple, rules-only tactician that plays one turn for whoever is up. It stands in for the AI
 * until the DM and companion agents exist, so a whole fight can run with no model at all.
 */
export function takeTurn(enc: Encounter): void {
  const actor = enc.current();
  const foes = enc.combatants.filter((c) => c.side !== actor.side && c.status === 'ok');
  if (actor.kind === 'monster') monsterTurn(enc, actor, foes);
  else heroTurn(enc, actor, foes);
  if (!enc.isOver()) enc.endTurn();
}

/** Plays turns until someone wins or `maxRounds` pass. Returns the winner, or null if time ran out. */
export function runToEnd(enc: Encounter, maxRounds = 50): string | null {
  if (enc.round === 0) enc.start();
  while (!enc.isOver() && enc.round <= maxRounds) takeTurn(enc);
  return enc.winner;
}

function monsterTurn(enc: Encounter, actor: Combatant, foes: Combatant[]): void {
  const target = [...foes].sort((a, b) => a.ac - b.ac || a.hp - b.hp)[0];
  if (!target) return;
  if (actor.multiattack) {
    enc.multiattack(actor.id, [target.id, ...foes.filter((f) => f.id !== target.id).map((f) => f.id)]);
    return;
  }
  const melee = actor.attacks.find((a) => a.kind === 'melee') ?? actor.attacks[0];
  if (melee) enc.attack(actor.id, target.id, melee.id);
}

function heroTurn(enc: Encounter, actor: Combatant, foes: Combatant[]): void {
  const weakest = () => enc.combatants.filter((c) => c.side !== actor.side && c.status === 'ok').sort((a, b) => a.hp - b.hp)[0];
  const allies = enc.combatants.filter((c) => c.side === actor.side && c.id !== actor.id);
  const downedAlly = allies.find((a) => a.status === 'unconscious' || a.status === 'stable');
  const slots = actor.spellcasting?.slots ?? [];
  const knows = (spell: string) => actor.spellcasting?.spells.includes(spell) ?? false;
  const hasSlot = (level: number) => (slots[level] ?? 0) > 0;

  // Bonus actions first.
  if (downedAlly && knows('healingWord') && hasSlot(1)) {
    enc.cast(actor.id, 'healingWord', [downedAlly.id]);
  } else if (actor.resources.secondWind > 0 && actor.hp <= actor.maxHp / 2) {
    enc.secondWind(actor.id);
  } else if (actor.features.includes('cunningAction') && foes.length > 0) {
    enc.hide(actor.id);
  }

  const turn = enc.turnState();
  if (!turn || turn.actionsLeft < 1 || enc.isOver()) return;
  const target = weakest();
  if (!target) return;

  if (actor.spellcasting) {
    const hurtAlly = [actor, ...allies].find((a) => a.status === 'ok' && a.hp <= a.maxHp / 3);
    if (knows('cureWounds') && hasSlot(1) && !turn.bonusSpellCast && (downedAlly || hurtAlly)) {
      enc.cast(actor.id, 'cureWounds', [(downedAlly ?? hurtAlly)!.id]);
      return;
    }
    if (knows('burningHands') && hasSlot(1) && foes.length >= 2 && !turn.bonusSpellCast) {
      const group = [...foes].sort((a, b) => a.hp - b.hp).slice(0, 3);
      enc.cast(actor.id, 'burningHands', group.map((f) => f.id));
      return;
    }
    if (knows('scorchingRay') && hasSlot(2) && !turn.bonusSpellCast) {
      enc.cast(actor.id, 'scorchingRay', [target.id]);
      return;
    }
    if (knows('guidingBolt') && (slots[1] ?? 0) >= 3 && !turn.bonusSpellCast) {
      const toughest = [...foes].sort((a, b) => b.hp - a.hp)[0]!;
      enc.cast(actor.id, 'guidingBolt', [toughest.id]);
      return;
    }
    if (knows('magicMissile') && hasSlot(1) && !turn.bonusSpellCast) {
      enc.cast(actor.id, 'magicMissile', [target.id]);
      return;
    }
    const cantrip = actor.spellcasting.spells.find((s) => s === 'fireBolt' || s === 'sacredFlame');
    if (cantrip) {
      enc.cast(actor.id, cantrip, [target.id]);
      return;
    }
  }

  const weapon = actor.attacks.find((a) => a.kind === 'melee') ?? actor.attacks[0];
  if (!weapon) return;
  enc.attack(actor.id, target.id, weapon.id);
  if (actor.resources.actionSurge > 0 && !enc.isOver()) {
    const next = weakest();
    if (next) {
      enc.actionSurge(actor.id);
      enc.attack(actor.id, next.id, weapon.id);
    }
  }
}
