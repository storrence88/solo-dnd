import { ABILITIES, SKILL_ABILITY, type Ability, type Skill } from '../engine';
import { ModelError, parseJsonObject } from './model';

export type DmAction =
  | { type: 'none' }
  | { type: 'check'; who: string; check: Skill | Ability; dc: number; reason: string }
  | { type: 'combat'; enemies: string[]; reason: string }
  | { type: 'endScene'; outcome: string };

export interface DmReply {
  narration: string;
  action: DmAction;
  revealed: string[];
  /** Companions who could not perceive this narration. */
  hiddenFrom: string[];
  prompt: string;
}

export interface DmReplyRules {
  allowCheck: boolean;
  allowCombat: boolean;
  enemyIds: string[];
  unlockedSecrets: string[];
  /** The player character's id, and the companions who can act. */
  pcId: string;
  companionIds: string[];
}

/** Checks the DM's JSON against the rules. Anything off throws, and the caller asks the model to try again. */
export function parseDmReply(text: string, rules: DmReplyRules): DmReply {
  const raw = parseJsonObject(text) as Record<string, unknown>;
  const narration = typeof raw.narration === 'string' ? raw.narration.trim() : '';
  if (!narration) throw new ModelError('"narration" must be a non-empty string');
  const prompt = typeof raw.prompt === 'string' && raw.prompt.trim() ? raw.prompt.trim() : 'What do you do?';
  const revealed = Array.isArray(raw.revealed) ? raw.revealed.filter((r): r is string => typeof r === 'string') : [];
  for (const id of revealed) if (!rules.unlockedSecrets.includes(id)) throw new ModelError(`"revealed" names "${id}", which is not an unlocked secret`);

  const a = (raw.action ?? { type: 'none' }) as Record<string, unknown>;
  let action: DmAction;
  switch (a.type) {
    case undefined:
    case 'none':
      action = { type: 'none' };
      break;
    case 'check': {
      if (!rules.allowCheck) throw new ModelError('A check was just resolved; narrate its result instead of asking for another');
      const check = String(a.check ?? '').trim();
      const known = check in SKILL_ABILITY || (ABILITIES as readonly string[]).includes(check);
      if (!known) throw new ModelError(`Unknown check "${check}"`);
      const dc = Number(a.dc);
      if (!Number.isInteger(dc) || dc < 5 || dc > 30) throw new ModelError('"dc" must be a whole number from 5 to 30');
      const who = typeof a.who === 'string' && a.who.trim() ? a.who.trim() : rules.pcId;
      if (who !== rules.pcId && !rules.companionIds.includes(who)) {
        throw new ModelError(`"who" must be one of: ${[rules.pcId, ...rules.companionIds].join(', ')}`);
      }
      action = { type: 'check', who, check: check as Skill | Ability, dc, reason: String(a.reason ?? '') };
      break;
    }
    case 'combat': {
      if (!rules.allowCombat) throw new ModelError('Combat cannot start right now');
      const requested = Array.isArray(a.enemies) ? a.enemies.map(String) : rules.enemyIds;
      const enemies = requested.length ? requested : rules.enemyIds;
      const unknown = enemies.filter((id) => !rules.enemyIds.includes(id));
      if (unknown.length) throw new ModelError(`Unknown or absent enemies: ${unknown.join(', ')}. Choose from: ${rules.enemyIds.join(', ')}`);
      action = { type: 'combat', enemies, reason: String(a.reason ?? '') };
      break;
    }
    case 'endScene':
      action = { type: 'endScene', outcome: String(a.outcome ?? '').trim() || 'The scene ends.' };
      break;
    default:
      throw new ModelError(`Unknown action type "${String(a.type)}"`);
  }
  const hiddenFrom = Array.isArray(raw.hiddenFrom) ? raw.hiddenFrom.map(String).filter((id) => rules.companionIds.includes(id)) : [];
  return { narration, action, revealed, hiddenFrom, prompt };
}
