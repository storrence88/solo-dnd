import type { GameEvent } from './types';

/** Turns an engine event into one plain line, for the sandbox page now and the DM's context later. */
export function describeEvent(e: GameEvent, nameOf: (id: string) => string): string {
  switch (e.type) {
    case 'initiative':
      return `Initiative: ${e.order.map((o) => `${nameOf(o.id)} ${o.total}`).join(', ')}`;
    case 'roundStart':
      return `Round ${e.round}`;
    case 'turnStart':
      return `${nameOf(e.actorId)}'s turn`;
    case 'attack': {
      const dice = e.rolls.length > 1 ? `[${e.rolls.join(', ')}] ${e.mode}` : `${e.rolls[0]}`;
      const outcome = e.critical ? 'CRITICAL HIT' : e.hit ? 'hit' : 'miss';
      return `${nameOf(e.attackerId)} attacks ${nameOf(e.targetId)} with ${e.attackName}: d20 ${dice} = ${e.total} vs AC ${e.targetAc}, ${outcome}`;
    }
    case 'damage':
      return `${nameOf(e.targetId)} takes ${e.amount} ${e.damageType} (${e.expr}: ${e.rolls.join(', ') || 'flat'})${e.note ? `, ${e.note}` : ''}; HP ${e.hpAfter}`;
    case 'heal':
      return `${nameOf(e.targetId)} regains ${e.amount} HP; HP ${e.hpAfter}`;
    case 'save':
      return `${nameOf(e.actorId)} ${e.ability.toUpperCase()} save: ${e.rolls.join(', ')} → ${e.total} vs DC ${e.dc}, ${e.success ? 'success' : 'failure'}`;
    case 'check':
      return `${nameOf(e.actorId)} ${e.label}: ${e.rolls.join(', ')} → ${e.total} vs DC ${e.dc}, ${e.success ? 'success' : 'failure'}`;
    case 'spell':
      return `${nameOf(e.casterId)} casts ${e.spellName}${e.slotLevel > 0 ? ` (level ${e.slotLevel} slot)` : ''} at ${e.targetIds.map(nameOf).join(', ')}`;
    case 'feature':
      return `${nameOf(e.actorId)} uses ${e.feature}${e.detail ? `: ${e.detail}` : ''}`;
    case 'condition':
      return `${nameOf(e.targetId)} ${e.added ? 'is now' : 'is no longer'} ${e.condition}`;
    case 'status':
      return `${nameOf(e.targetId)} is ${e.status} (${e.reason})`;
    case 'deathSave':
      return `${nameOf(e.actorId)} death save: ${e.roll} (successes ${e.successes}, failures ${e.failures})`;
    case 'combatEnd':
      return `Combat over after round ${e.round}: the ${e.winner} wins`;
  }
}

