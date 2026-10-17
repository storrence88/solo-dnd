import type { CharacterSpec } from '../character';

/** The player character from the Phase 0 playtest. */
export const STEVEN: CharacterSpec = {
  id: 'steven',
  name: 'Steven',
  classId: 'fighter',
  level: 3,
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 12, cha: 10 },
  skills: ['athletics', 'perception', 'persuasion'],
  armor: 'chainMail',
  weapons: ['longsword', 'lightCrossbow'],
  fightingStyle: 'defense',
};

export const BRENNA: CharacterSpec = {
  id: 'brenna',
  name: 'Brenna Ashford',
  classId: 'cleric',
  level: 3,
  abilities: { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 12 },
  skills: ['medicine', 'insight', 'persuasion', 'religion'],
  armor: 'chainMail',
  shield: true,
  weapons: ['mace'],
  spells: ['sacredFlame', 'cureWounds', 'healingWord', 'guidingBolt'],
};

export const QUILL: CharacterSpec = {
  id: 'quill',
  name: 'Quill',
  classId: 'rogue',
  level: 3,
  abilities: { str: 10, dex: 16, con: 12, int: 12, wis: 12, cha: 14 },
  skills: ['stealth', 'sleightOfHand', 'deception', 'perception', 'acrobatics', 'insight'],
  expertise: ['stealth', 'sleightOfHand'],
  armor: 'leather',
  weapons: ['shortsword', 'handCrossbow'],
};

/** A spare wizard so all four Phase 1 classes have a pregen. */
export const ILSA: CharacterSpec = {
  id: 'ilsa',
  name: 'Ilsa Marrow',
  classId: 'wizard',
  level: 3,
  abilities: { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 },
  skills: ['arcana', 'history', 'investigation'],
  weapons: ['quarterstaff'],
  spells: ['fireBolt', 'magicMissile', 'burningHands', 'scorchingRay'],
};
