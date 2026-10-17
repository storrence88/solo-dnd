import { pregens } from '../../engine';
import type { Scene } from '../scene';

/** The Phase 0 playtest scene, for a solo hero. */
export const GREYFORD_SOLO: Scene = {
  id: 'greyford-solo',
  title: 'The Toll at Greyford Bridge (solo)',
  opening:
    'Dusk. You are escorting a small wagon of fever medicine to Hollin\'s Rest, where your sister lives and the sickness is spreading. ' +
    'The river is swollen and loud. At Greyford Bridge, three armed figures block the narrow stone span.',
  situation:
    'The PC escorts a wagon of medicine to the village of Hollin\'s Rest, where a fever is spreading. Bandits block Greyford Bridge at dusk ' +
    'and demand a toll: half the medicine. The river below is swollen and dangerous.',
  location:
    'Greyford Bridge: a narrow stone span over a swollen river, just wide enough for the wagon. Dusk, the light failing. Wet stone, a broken rail on the north side.',
  npcs: [
    {
      id: 'vess',
      name: 'Vess',
      description: 'A scarred woman with a dark braid and a bruised cheek, leader of the bandits. Longsword at her hip.',
      goal: 'Get as much of the medicine as she can, without a fight if possible.',
      voice: 'Low, tired, clipped. Hard on the surface, wavers when pushed about why.',
    },
    {
      id: 'corrin',
      name: 'Corrin',
      description: 'A lanky bandit with a scimitar, restless, watching the wagon.',
      goal: 'Follow Vess, but he would rather take everything and be done.',
      voice: 'Sneering, quick to threaten.',
    },
    {
      id: 'gorr',
      name: 'Gorr',
      description: 'A broad-shouldered, hungry-looking bandit with a drawn scimitar.',
      goal: 'Eat tonight. Not die for it.',
      voice: 'Gruff, few words, more bluster than malice.',
    },
  ],
  secrets: [
    {
      id: 'sick-child',
      text: 'Vess\'s own daughter, Lira, has the same fever. Vess is desperate, not cruel. If someone treats Lira or promises her medicine, Vess will let the wagon pass.',
      trigger: 'The PC asks Vess why she wants the medicine, asks about her family, or succeeds at an Insight check on her.',
    },
    {
      id: 'ford',
      text: 'A mile downstream there is a ford. It can be crossed with a DC 14 Athletics check, but it costs about an hour, and the fever is worsening.',
      trigger: 'The PC looks for another way across, studies the river, or asks about other crossings.',
    },
    {
      id: 'gorr-wavers',
      text: 'Gorr is not committed. Offered food or a few coins, or intimidated well, he will step aside and refuse to fight.',
      trigger: 'The PC talks to Gorr directly, offers the bandits food or money, or tries to intimidate the group.',
    },
  ],
  enemies: [
    { id: 'vess', monster: 'vess', name: 'Vess' },
    { id: 'corrin', monster: 'bandit', name: 'Corrin' },
    { id: 'gorr', monster: 'bandit', name: 'Gorr' },
  ],
  moraleBreak: 0.5,
  endings: [
    'The party crosses the bridge with the medicine (by talk, trade, or force).',
    'The party takes the ford downstream.',
    'The bandits take the medicine.',
    'The PC turns back.',
  ],
  pc: pregens.STEVEN,
  companions: [],
};

/** The full playtest scene: Steven with Brenna and Quill against Vess and four bandits. */
export const GREYFORD: Scene = {
  ...GREYFORD_SOLO,
  id: 'greyford',
  title: 'The Toll at Greyford Bridge',
  opening:
    'Dusk. You, Brenna and Quill are escorting a small wagon of fever medicine to Hollin\'s Rest, where your sister lives and the sickness is spreading. ' +
    'The river is swollen and loud. At Greyford Bridge, five armed figures block the narrow stone span.',
  situation:
    'The party (the PC, Brenna the cleric and Quill the halfling rogue) escorts a wagon of medicine to the village of Hollin\'s Rest, where a fever is spreading. ' +
    'Five bandits block Greyford Bridge at dusk and demand a toll: half the medicine. The river below is swollen and dangerous.',
  npcs: [
    ...GREYFORD_SOLO.npcs,
    {
      id: 'sef-tam',
      name: 'Sef and Tam',
      description: 'Two young bandits with clubs and scimitars, hanging back behind Vess.',
      goal: 'Do what Vess says and not get hurt.',
      voice: 'Nervous mutters.',
    },
  ],
  secrets: [
    ...GREYFORD_SOLO.secrets,
    {
      id: 'corrin-knows-quill',
      text: 'Corrin recognises Quill: they ran jobs together in the river cities, and Quill got away when Corrin was caught and jailed. Corrin is bitter. He may expose Quill as a thief in front of the party, or offer Quill a private deal: help the bandits take the wagon and the past stays buried.',
      trigger: 'Corrin gets a good look at Quill (Quill comes close, speaks to the bandits, or the bandits study the party), or someone mentions Quill\'s past.',
    },
  ],
  enemies: [
    ...GREYFORD_SOLO.enemies,
    { id: 'sef', monster: 'bandit', name: 'Sef' },
    { id: 'tam', monster: 'bandit', name: 'Tam' },
  ],
  companions: ['brenna', 'quill'],
};
