// Weapon and armor stats from the System Reference Document 5.1 (CC-BY-4.0). See NOTICE.md.
import type { DamageType } from '../types';

export interface WeaponDef {
  name: string;
  kind: 'melee' | 'ranged';
  damage: string;
  damageType: DamageType;
  finesse?: boolean;
  twoHanded?: boolean;
}

export const WEAPONS = {
  dagger: { name: 'Dagger', kind: 'melee', damage: '1d4', damageType: 'piercing', finesse: true },
  greataxe: { name: 'Greataxe', kind: 'melee', damage: '1d12', damageType: 'slashing', twoHanded: true },
  longsword: { name: 'Longsword', kind: 'melee', damage: '1d8', damageType: 'slashing' },
  mace: { name: 'Mace', kind: 'melee', damage: '1d6', damageType: 'bludgeoning' },
  quarterstaff: { name: 'Quarterstaff', kind: 'melee', damage: '1d6', damageType: 'bludgeoning' },
  rapier: { name: 'Rapier', kind: 'melee', damage: '1d8', damageType: 'piercing', finesse: true },
  scimitar: { name: 'Scimitar', kind: 'melee', damage: '1d6', damageType: 'slashing', finesse: true },
  shortsword: { name: 'Shortsword', kind: 'melee', damage: '1d6', damageType: 'piercing', finesse: true },
  handCrossbow: { name: 'Hand crossbow', kind: 'ranged', damage: '1d6', damageType: 'piercing' },
  lightCrossbow: { name: 'Light crossbow', kind: 'ranged', damage: '1d8', damageType: 'piercing', twoHanded: true },
  longbow: { name: 'Longbow', kind: 'ranged', damage: '1d8', damageType: 'piercing', twoHanded: true },
  shortbow: { name: 'Shortbow', kind: 'ranged', damage: '1d6', damageType: 'piercing', twoHanded: true },
} as const satisfies Record<string, WeaponDef>;
export type WeaponId = keyof typeof WEAPONS;

export interface ArmorDef {
  name: string;
  base: number;
  /** Maximum Dex bonus added to AC; null means no limit. */
  maxDex: number | null;
}

export const ARMOR = {
  leather: { name: 'Leather', base: 11, maxDex: null },
  studdedLeather: { name: 'Studded leather', base: 12, maxDex: null },
  scaleMail: { name: 'Scale mail', base: 14, maxDex: 2 },
  chainMail: { name: 'Chain mail', base: 16, maxDex: 0 },
} as const satisfies Record<string, ArmorDef>;
export type ArmorId = keyof typeof ARMOR;
