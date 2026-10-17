import { abilityModifier } from './abilities';
import { abilityCheck, passivePerception, savingThrow } from './checks';
import { getSpell, type SpellDef } from './data/spells';
import { parseDice, formatDice, resolveMode, rollD20, rollDice } from './dice';
import type { Rng } from './rng';
import type { Combatant, ConditionType, DamageType, GameEvent, Side, Status } from './types';

/** Thrown when an action breaks the rules (wrong turn, no action left, no spell slot...). Nothing changes when it is thrown. */
export class RulesError extends Error {}

interface TurnState {
  actorId: string;
  actionsLeft: number;
  bonusUsed: boolean;
  sneakAttackUsed: boolean;
  /** 5e: after a bonus-action spell, the only other spell this turn is an action cantrip, and vice versa. */
  bonusSpellCast: boolean;
  leveledActionSpellCast: boolean;
}

interface AttackProfile {
  name: string;
  kind: 'melee' | 'ranged';
  toHit: number;
  damage: string;
  damageType: DamageType;
  sneakAttackEligible: boolean;
  isSpell: boolean;
}

/**
 * One fight, run by the rules. State changes only through the action methods, and every change is
 * recorded in `events`. The same combatants and seed always produce the same fight.
 */
export class Encounter {
  readonly events: GameEvent[] = [];
  round = 0;
  winner: Side | null = null;
  private readonly byId = new Map<string, Combatant>();
  private order: string[] = [];
  private turnIndex = -1;
  private turn: TurnState | null = null;
  /** targetId -> ids of creatures in melee with it (used for Sneak Attack). */
  private readonly engaged = new Map<string, Set<string>>();

  constructor(combatants: Combatant[], private readonly rng: Rng) {
    for (const c of combatants) {
      if (this.byId.has(c.id)) throw new Error(`Duplicate combatant id: ${c.id}`);
      this.byId.set(c.id, structuredClone(c));
    }
  }

  get combatants(): Combatant[] {
    return [...this.byId.values()];
  }

  get initiativeOrder(): string[] {
    return [...this.order];
  }

  get(id: string): Combatant {
    const c = this.byId.get(id);
    if (!c) throw new RulesError(`No combatant with id "${id}"`);
    return c;
  }

  current(): Combatant {
    if (!this.turn) throw new RulesError('Combat has not started');
    return this.get(this.turn.actorId);
  }

  turnState(): Readonly<TurnState> | null {
    return this.turn ? { ...this.turn } : null;
  }

  isOver(): boolean {
    return this.winner !== null;
  }

  /** Rolls initiative and starts the first turn. */
  start(): void {
    if (this.round > 0) throw new RulesError('Combat already started');
    const rolls = this.combatants.map((c) => {
      const roll = this.rng.roll(20);
      return { id: c.id, roll, total: roll + abilityModifier(c.abilities.dex), dex: c.abilities.dex };
    });
    rolls.sort((a, b) => b.total - a.total || b.dex - a.dex || a.id.localeCompare(b.id));
    this.order = rolls.map((r) => r.id);
    this.emit({ type: 'initiative', order: rolls.map(({ id, roll, total }) => ({ id, roll, total })) });
    this.checkWinner();
    if (!this.winner) this.advance();
  }

  endTurn(): void {
    this.requireActive();
    this.advance();
  }

  // ---- Actions -------------------------------------------------------------

  attack(attackerId: string, targetId: string, attackId: string): void {
    const attacker = this.requireActor(attackerId);
    const weapon = attacker.attacks.find((a) => a.id === attackId);
    if (!weapon) throw new RulesError(`${attacker.name} has no attack "${attackId}"`);
    const target = this.requireTarget(targetId);
    this.spendAction();
    this.resolveAttack(attacker, target, { ...weapon, isSpell: false });
  }

  /** Monsters with Multiattack make all their listed attacks as one action. Targets are used in order; extra attacks go to the last living one. */
  multiattack(attackerId: string, targetIds: string[]): void {
    const attacker = this.requireActor(attackerId);
    if (!attacker.multiattack) throw new RulesError(`${attacker.name} has no Multiattack`);
    if (targetIds.length === 0) throw new RulesError('Multiattack needs at least one target');
    targetIds.forEach((id) => this.requireTarget(id));
    this.spendAction();
    attacker.multiattack.forEach((attackId, i) => {
      if (this.winner) return;
      const weapon = attacker.attacks.find((a) => a.id === attackId);
      if (!weapon) throw new Error(`Bad multiattack data for ${attacker.name}: ${attackId}`);
      const candidates = [...targetIds.slice(Math.min(i, targetIds.length - 1)), ...targetIds].map((id) => this.get(id));
      const target = candidates.find((c) => c.status === 'ok');
      if (target) this.resolveAttack(attacker, target, { ...weapon, isSpell: false });
    });
  }

  cast(casterId: string, spellId: string, targetIds: string[], slotLevel?: number): void {
    const caster = this.requireActor(casterId);
    const casting = caster.spellcasting;
    if (!casting || !casting.spells.includes(spellId)) throw new RulesError(`${caster.name} cannot cast ${spellId}`);
    const spell = getSpell(spellId);
    const level = spell.level === 0 ? 0 : (slotLevel ?? spell.level);
    if (spell.level > 0) {
      if (level < spell.level) throw new RulesError(`${spell.name} needs a slot of level ${spell.level} or higher`);
      if ((casting.slots[level] ?? 0) < 1) throw new RulesError(`${caster.name} has no level ${level} slots left`);
    }
    const turn = this.turn!;
    if (spell.castingTime === 'bonus') {
      if (turn.bonusUsed) throw new RulesError(`${caster.name} has already used a bonus action`);
      if (turn.leveledActionSpellCast) throw new RulesError('A bonus-action spell cannot follow a leveled spell this turn');
    } else {
      if (turn.actionsLeft < 1) throw new RulesError(`${caster.name} has no action left`);
      if (turn.bonusSpellCast && spell.level > 0) throw new RulesError('After a bonus-action spell, only a cantrip can be cast this turn');
    }
    const targets = this.validateSpellTargets(caster, spell, targetIds);

    if (spell.castingTime === 'bonus') {
      turn.bonusUsed = true;
      turn.bonusSpellCast = true;
    } else {
      turn.actionsLeft -= 1;
      if (spell.level > 0) turn.leveledActionSpellCast = true;
    }
    if (spell.level > 0) casting.slots[level] = (casting.slots[level] ?? 0) - 1;
    this.emit({ type: 'spell', casterId, spellId, spellName: spell.name, slotLevel: level, targetIds: targets.map((t) => t.id) });
    this.resolveSpell(caster, spell, level, targets);
  }

  dodge(actorId: string): void {
    const actor = this.requireActor(actorId);
    this.spendAction();
    this.addCondition(actor, 'dodging');
  }

  /** Disengage: leave melee. Rogues with Cunning Action can do it as a bonus action. */
  disengage(actorId: string): void {
    const actor = this.requireActor(actorId);
    this.spendCunning(actor);
    for (const set of this.engaged.values()) set.delete(actor.id);
    this.emit({ type: 'feature', actorId, feature: 'Disengage' });
  }

  /** Hide: Stealth against the best passive Perception among conscious enemies. Success makes the next attack roll have advantage. */
  hide(actorId: string): boolean {
    const actor = this.requireActor(actorId);
    this.spendCunning(actor);
    const watchers = this.combatants.filter((c) => c.side !== actor.side && c.status === 'ok');
    const dc = Math.max(0, ...watchers.map(passivePerception));
    const check = abilityCheck(actor, 'stealth', dc, this.rng);
    this.emit({ type: 'check', actorId, label: 'Stealth (hide)', dc, rolls: check.rolls, total: check.total, success: check.success });
    if (check.success) this.addCondition(actor, 'hidden');
    return check.success;
  }

  secondWind(actorId: string): void {
    const actor = this.requireActor(actorId);
    if (actor.resources.secondWind < 1) throw new RulesError(`${actor.name} has no Second Wind left`);
    this.spendBonus();
    actor.resources.secondWind -= 1;
    const roll = rollDice('1d10', this.rng, { extraBonus: actor.level ?? 1 });
    this.emit({ type: 'feature', actorId, feature: 'Second Wind', detail: `${roll.expr} = ${roll.total}` });
    this.heal(actor, actor, roll.total);
  }

  actionSurge(actorId: string): void {
    const actor = this.requireActor(actorId);
    if (actor.resources.actionSurge < 1) throw new RulesError(`${actor.name} has no Action Surge left`);
    actor.resources.actionSurge -= 1;
    this.turn!.actionsLeft += 1;
    this.emit({ type: 'feature', actorId, feature: 'Action Surge' });
  }

  // ---- Rules internals -----------------------------------------------------

  private resolveAttack(attacker: Combatant, target: Combatant, profile: AttackProfile): boolean {
    const targetDown = target.status === 'unconscious' || target.status === 'stable';
    const advantage = attacker.conditions.includes('hidden') || target.conditions.includes('markedByGuidingBolt') || targetDown;
    const disadvantage = target.conditions.includes('dodging');
    const mode = resolveMode(advantage, disadvantage);
    const roll = rollD20(this.rng, profile.toHit, mode);
    const critRange = profile.isSpell ? 20 : attacker.critRange;
    let critical = roll.natural >= critRange;
    const hit = roll.natural !== 1 && (critical || roll.total >= target.ac);
    if (!hit) critical = false;
    if (hit && profile.kind === 'melee' && targetDown) critical = true;

    this.removeCondition(attacker, 'hidden');
    this.removeCondition(target, 'markedByGuidingBolt');
    this.emit({
      type: 'attack', attackerId: attacker.id, targetId: target.id, attackName: profile.name,
      rolls: roll.rolls, mode, total: roll.total, targetAc: target.ac, hit, critical,
    });
    if (profile.kind === 'melee') this.engagedWith(target.id).add(attacker.id);
    if (!hit) return false;

    const damage = rollDice(profile.damage, this.rng, { critical });
    let total = damage.total;
    let rolls = damage.rolls;
    let expr = damage.expr;
    let note: string | undefined;
    if (this.sneakAttackApplies(attacker, target, profile, mode)) {
      const sneak = rollDice(`${attacker.sneakAttackDice}d6`, this.rng, { critical });
      this.turn!.sneakAttackUsed = true;
      total += sneak.total;
      rolls = [...rolls, ...sneak.rolls];
      expr = `${expr} + ${sneak.expr}`;
      note = 'Sneak Attack';
    }
    this.applyDamage(target, attacker, { total, rolls, expr, damageType: profile.damageType, critical, note });
    return true;
  }

  private sneakAttackApplies(attacker: Combatant, target: Combatant, profile: AttackProfile, mode: string): boolean {
    if (profile.isSpell || !profile.sneakAttackEligible) return false;
    if (attacker.sneakAttackDice < 1 || this.turn?.actorId !== attacker.id || this.turn.sneakAttackUsed) return false;
    if (mode === 'disadvantage') return false;
    if (mode === 'advantage') return true;
    const allyNearTarget = [...this.engagedWith(target.id)].some((id) => {
      const ally = this.get(id);
      return id !== attacker.id && ally.side === attacker.side && ally.status === 'ok';
    });
    return allyNearTarget;
  }

  private resolveSpell(caster: Combatant, spell: SpellDef, slotLevel: number, targets: Combatant[]): void {
    const casting = caster.spellcasting!;
    const extraLevels = spell.level > 0 ? slotLevel - spell.level : 0;
    const effect = spell.effect;
    switch (effect.kind) {
      case 'attack': {
        const damage = addDice(effect.damage, spell.upcast, extraLevels);
        const target = targets[0]!;
        const hit = this.resolveAttack(caster, target, {
          name: spell.name, kind: effect.range, toHit: casting.attackBonus, damage,
          damageType: effect.damageType, sneakAttackEligible: false, isSpell: true,
        });
        if (hit && effect.marksTarget && target.status !== 'dead') this.addCondition(target, 'markedByGuidingBolt');
        return;
      }
      case 'save': {
        const damage = rollDice(addDice(effect.damage, spell.upcast, extraLevels), this.rng);
        for (const target of targets) {
          if (this.winner) return;
          const save = savingThrow(target, effect.save, casting.saveDc, this.rng);
          this.emit({ type: 'save', actorId: target.id, ability: effect.save, dc: casting.saveDc, rolls: save.rolls, total: save.total, success: save.success });
          const amount = save.success ? (effect.halfOnSave ? Math.floor(damage.total / 2) : 0) : damage.total;
          if (amount > 0) {
            this.applyDamage(target, caster, {
              total: amount, rolls: damage.rolls, expr: damage.expr, damageType: effect.damageType,
              critical: false, note: save.success ? 'half on save' : undefined,
            });
          }
        }
        return;
      }
      case 'darts': {
        const darts = effect.darts + extraLevels * Number(spell.upcast ?? 0);
        for (let i = 0; i < darts; i++) {
          const target = pickLiving(targets, i);
          if (!target || this.winner) return;
          const roll = rollDice(effect.damage, this.rng);
          this.applyDamage(target, caster, { total: roll.total, rolls: roll.rolls, expr: roll.expr, damageType: effect.damageType, critical: false, note: `dart ${i + 1}` });
        }
        return;
      }
      case 'rays': {
        const rays = effect.rays + extraLevels * Number(spell.upcast ?? 0);
        for (let i = 0; i < rays; i++) {
          const target = pickLiving(targets, i);
          if (!target || this.winner) return;
          this.resolveAttack(caster, target, {
            name: `${spell.name} (ray ${i + 1})`, kind: 'ranged', toHit: casting.attackBonus, damage: effect.damage,
            damageType: effect.damageType, sneakAttackEligible: false, isSpell: true,
          });
        }
        return;
      }
      case 'heal': {
        const lifeBonus = caster.features.includes('discipleOfLife') && slotLevel > 0 ? 2 + slotLevel : 0;
        const mod = abilityModifier(caster.abilities[casting.ability]);
        const roll = rollDice(addDice(effect.dice, spell.upcast, extraLevels), this.rng, { extraBonus: mod + lifeBonus });
        this.heal(targets[0]!, caster, roll.total);
        return;
      }
    }
  }

  private validateSpellTargets(caster: Combatant, spell: SpellDef, targetIds: string[]): Combatant[] {
    if (targetIds.length === 0) throw new RulesError(`${spell.name} needs a target`);
    const targets = targetIds.map((id) => this.get(id));
    if (targets.some((t) => t.status === 'dead')) throw new RulesError(`${spell.name} cannot target the dead`);
    const effect = spell.effect;
    if (effect.kind === 'heal') {
      if (targets.length !== 1) throw new RulesError(`${spell.name} heals one creature`);
      if (targets[0]!.side !== caster.side) throw new RulesError(`${spell.name} targets an ally`);
    } else {
      if (targets.some((t) => t.side === caster.side)) throw new RulesError(`${spell.name} targets enemies here`);
      const max = effect.kind === 'save' ? effect.maxTargets : effect.kind === 'attack' ? 1 : Infinity;
      if (targets.length > max) throw new RulesError(`${spell.name} can target at most ${max}`);
    }
    return targets;
  }

  private applyDamage(
    target: Combatant,
    source: Combatant,
    hit: { total: number; rolls: number[]; expr: string; damageType: DamageType; critical: boolean; note?: string },
  ): void {
    if (target.status === 'dead') return;
    const before = target.hp;
    target.hp = Math.max(0, target.hp - hit.total);
    this.emit({
      type: 'damage', targetId: target.id, sourceId: source.id, amount: hit.total, damageType: hit.damageType,
      rolls: hit.rolls, expr: hit.expr, hpAfter: target.hp, note: hit.note,
    });

    if (before > 0 && target.hp === 0) {
      const overflow = hit.total - before;
      if (target.kind === 'monster') this.setStatus(target, 'dead', 'dropped to 0 HP');
      else if (overflow >= target.maxHp) this.setStatus(target, 'dead', 'massive damage');
      else {
        target.deathSaves = { successes: 0, failures: 0 };
        this.setStatus(target, 'unconscious', 'dropped to 0 HP');
      }
      this.leaveMelee(target.id);
    } else if (before === 0) {
      if (hit.total >= target.maxHp) {
        this.setStatus(target, 'dead', 'massive damage while down');
      } else {
        target.deathSaves.failures += hit.critical ? 2 : 1;
        if (target.deathSaves.failures >= 3) this.setStatus(target, 'dead', 'three failed death saves');
        else if (target.status === 'stable') this.setStatus(target, 'unconscious', 'hit while stable');
      }
    }
    this.checkWinner();
  }

  private heal(target: Combatant, source: Combatant, amount: number): void {
    if (target.status === 'dead') throw new RulesError(`${target.name} is dead`);
    target.hp = Math.min(target.maxHp, target.hp + amount);
    this.emit({ type: 'heal', targetId: target.id, sourceId: source.id, amount, hpAfter: target.hp });
    if (target.status !== 'ok' && target.hp > 0) {
      target.deathSaves = { successes: 0, failures: 0 };
      this.setStatus(target, 'ok', 'healed');
    }
  }

  private deathSave(actor: Combatant): void {
    const roll = this.rng.roll(20);
    const saves = actor.deathSaves;
    if (roll === 20) {
      saves.successes = 0;
      saves.failures = 0;
      this.emit({ type: 'deathSave', actorId: actor.id, roll, successes: 0, failures: 0 });
      actor.hp = 1;
      this.setStatus(actor, 'ok', 'natural 20 on a death save');
      return;
    }
    if (roll === 1) saves.failures += 2;
    else if (roll >= 10) saves.successes += 1;
    else saves.failures += 1;
    this.emit({ type: 'deathSave', actorId: actor.id, roll, successes: saves.successes, failures: saves.failures });
    if (saves.failures >= 3) this.setStatus(actor, 'dead', 'three failed death saves');
    else if (saves.successes >= 3) this.setStatus(actor, 'stable', 'three successful death saves');
  }

  /** Moves to the next creature that can act, rolling death saves for the fallen on the way. */
  private advance(): void {
    for (let guard = 0; guard < this.order.length * 4 + 4; guard++) {
      this.checkWinner();
      if (this.winner) {
        this.turn = null;
        return;
      }
      this.turnIndex = (this.turnIndex + 1) % this.order.length;
      if (this.turnIndex === 0) {
        this.round += 1;
        this.emit({ type: 'roundStart', round: this.round });
      }
      const actor = this.get(this.order[this.turnIndex]!);
      if (actor.status === 'dead' || actor.status === 'stable') continue;
      this.emit({ type: 'turnStart', actorId: actor.id, round: this.round });
      this.removeCondition(actor, 'dodging');
      if (actor.status === 'unconscious') {
        this.deathSave(actor);
        if ((actor.status as Status) !== 'ok') continue;
      }
      this.turn = {
        actorId: actor.id, actionsLeft: 1, bonusUsed: false, sneakAttackUsed: false,
        bonusSpellCast: false, leveledActionSpellCast: false,
      };
      return;
    }
    throw new Error('Turn order could not find anyone able to act');
  }

  private checkWinner(): void {
    if (this.winner) return;
    const standing = (side: Side) => this.combatants.some((c) => c.side === side && c.status === 'ok');
    const partyUp = standing('party');
    const enemiesUp = standing('enemy');
    if (partyUp && enemiesUp) return;
    // Fallen PCs still roll death saves in 5e, but with no one left standing on a side the fight is decided.
    this.winner = partyUp ? 'party' : 'enemy';
    this.emit({ type: 'combatEnd', winner: this.winner, round: this.round });
  }

  // ---- Small helpers -------------------------------------------------------

  private requireActive(): void {
    if (this.winner) throw new RulesError('Combat is over');
    if (!this.turn) throw new RulesError('Combat has not started');
  }

  private requireActor(actorId: string): Combatant {
    this.requireActive();
    if (this.turn!.actorId !== actorId) throw new RulesError(`It is not ${this.get(actorId).name}'s turn`);
    const actor = this.get(actorId);
    if (actor.status !== 'ok') throw new RulesError(`${actor.name} cannot act`);
    return actor;
  }

  private requireTarget(targetId: string): Combatant {
    const target = this.get(targetId);
    if (target.status === 'dead') throw new RulesError(`${target.name} is already dead`);
    return target;
  }

  private spendAction(): void {
    if (this.turn!.actionsLeft < 1) throw new RulesError(`${this.current().name} has no action left`);
    this.turn!.actionsLeft -= 1;
  }

  private spendBonus(): void {
    if (this.turn!.bonusUsed) throw new RulesError(`${this.current().name} has already used a bonus action`);
    this.turn!.bonusUsed = true;
  }

  /** Cunning Action turns Dash, Disengage or Hide into a bonus action; everyone else spends their action. */
  private spendCunning(actor: Combatant): void {
    if (actor.features.includes('cunningAction') && !this.turn!.bonusUsed) this.spendBonus();
    else this.spendAction();
  }

  private engagedWith(targetId: string): Set<string> {
    let set = this.engaged.get(targetId);
    if (!set) {
      set = new Set();
      this.engaged.set(targetId, set);
    }
    return set;
  }

  private leaveMelee(id: string): void {
    this.engaged.delete(id);
    for (const set of this.engaged.values()) set.delete(id);
  }

  private addCondition(target: Combatant, condition: ConditionType): void {
    if (target.conditions.includes(condition)) return;
    target.conditions.push(condition);
    this.emit({ type: 'condition', targetId: target.id, condition, added: true });
  }

  private removeCondition(target: Combatant, condition: ConditionType): void {
    if (!target.conditions.includes(condition)) return;
    target.conditions = target.conditions.filter((c) => c !== condition);
    this.emit({ type: 'condition', targetId: target.id, condition, added: false });
  }

  private setStatus(target: Combatant, status: Status, reason: string): void {
    target.status = status;
    if (status !== 'ok') target.conditions = [];
    this.emit({ type: 'status', targetId: target.id, status, reason });
  }

  private emit(event: GameEvent): void {
    this.events.push(event);
  }
}

/** Adds upcast dice: "4d6" + "1d6" x2 = "6d6". */
function addDice(base: string, upcast: string | number | undefined, times: number): string {
  if (!upcast || typeof upcast === 'number' || times <= 0) return base;
  const b = parseDice(base);
  const extra = parseDice(upcast);
  if (b.sides !== extra.sides) throw new Error(`Cannot add ${upcast} to ${base}`);
  return formatDice({ ...b, count: b.count + extra.count * times });
}

/** Round-robin over targets, skipping the fallen. */
function pickLiving(targets: Combatant[], index: number): Combatant | undefined {
  for (let i = 0; i < targets.length; i++) {
    const t = targets[(index + i) % targets.length]!;
    if (t.status === 'ok') return t;
  }
  return undefined;
}
