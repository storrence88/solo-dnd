import { pregens } from '../../engine';
import type { Scene } from '../scene';

/** The second scene of "The Road to Hollin's Rest": the village with the fever, the morning after Greyford. */
export const HOLLINS_REST: Scene = {
  id: 'hollins-rest',
  title: 'Fever at Hollin\'s Rest',
  opening:
    'Morning, grey and damp. The road drops into the valley and Hollin\'s Rest comes into view: thin chimney smoke, shuttered windows, ' +
    'and a rope strung across the road where two village men with cudgels are turning back a family with a handcart. ' +
    'Somewhere past them is the chapel, and your sister Maren.',
  situation:
    'The party arrives at Hollin\'s Rest, where the PC\'s sister Maren lives and a fever is spreading, with whatever medicine they still have after Greyford Bridge. ' +
    'Reeve Aldous Penn has closed the village: nobody in or out. The sick are kept in the chapel, where the healer Mother Agathe is overwhelmed. ' +
    'A stranded merchant, Harl Vine, is waiting out the closure at the inn with two hired men.',
  location:
    'Hollin\'s Rest: one muddy street of timber houses, a chapel turned sickhouse, an inn called the Lamb, and two wells, east and west. A rope barrier and two guards at the road in. A back lane runs out past the tannery.',
  npcs: [
    {
      id: 'penn',
      name: 'Reeve Aldous Penn',
      description: 'A heavy, grey-faced man in a good coat gone shabby, standing behind the guards with a ledger.',
      goal: 'Keep the fever from spreading and keep control of his village. Afraid of looking weak or unfair.',
      voice: 'Officious, quotes "the rules", snaps when cornered, then sags.',
    },
    {
      id: 'bram-ottie',
      name: 'Bram and Ottie',
      description: 'Two village men with cudgels guarding the rope: Bram is big and nervous, Ottie small and shifty.',
      goal: 'Do what the reeve says and not catch the fever.',
      voice: 'Bram apologetic; Ottie mutters and avoids eyes.',
    },
    {
      id: 'agathe',
      name: 'Mother Agathe',
      description: 'An old village healer in a stained apron, running the chapel sickhouse with no sleep.',
      goal: 'Save as many as she can. Will take help from anyone who is useful and nothing from anyone who is not.',
      voice: 'Sharp, fast, no patience for speeches. Kind under it.',
    },
    {
      id: 'maren',
      name: 'Maren',
      description: 'The PC\'s sister, a weaver in her late twenties, lying feverish on a pallet in the chapel.',
      goal: 'Make sure the children in the chapel are treated before her.',
      voice: 'Weak but stubborn, teases her sibling even now.',
    },
    {
      id: 'harl',
      name: 'Harl Vine',
      description: 'A well-fed merchant in travelling silks, friendly to everyone, with two big hired men always near him.',
      goal: 'Buy the medicine cheap and sell it dear in the city of Thornwick, where the fever has reached the rich quarter.',
      voice: 'Warm, flattering, always talking about "fair prices".',
    },
  ],
  secrets: [
    {
      id: 'east-well',
      text: 'The fever comes from the east well, fouled by runoff from the tannery up the back lane. Nearly every sick household draws from it. Medicine treats the sick, but only closing the east well stops new cases.',
      trigger: 'The party examines the sick, asks Mother Agathe or anyone where the sick live or what they share, inspects the wells or the tannery, or makes a successful Medicine or Investigation check about the fever.',
    },
    {
      id: 'harl-offer',
      text: 'Harl will pay 200 gold for the medicine, more than a year\'s wages. He has a cart ready on the back lane and has bribed Ottie to let it through at night. He would rather deal with Quill quietly than with the PC, and will try to catch Quill alone.',
      trigger: 'Harl meets the party, or someone asks about the inn, the merchant, or how goods get in or out of the closed village.',
    },
    {
      id: 'reeve-son',
      text: 'Penn\'s own son Tobin is sick in the chapel. Penn hid it so nobody could say he favoured his family. If confronted with it gently, or shown the chapel, he gives way and lets the party in.',
      trigger: 'The PC presses the reeve on why he is so afraid, asks about his family, or succeeds at an Insight check on him.',
    },
  ],
  enemies: [
    { id: 'harl', monster: 'bandit', name: 'Harl Vine' },
    { id: 'dace', monster: 'thug', name: 'Dace' },
    { id: 'rook', monster: 'thug', name: 'Rook' },
  ],
  moraleBreak: 0.5,
  endings: [
    'The medicine reaches the sickhouse and the sick are treated.',
    'The source of the fever is found and stopped.',
    'The medicine is sold, stolen or lost.',
    'The party leaves Hollin\'s Rest.',
  ],
  pc: pregens.STEVEN,
  companions: ['brenna', 'quill'],
};
