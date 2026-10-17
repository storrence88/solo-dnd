import type { Scene } from '../scene';
import { GREYFORD, GREYFORD_SOLO } from './greyford';

export const SCENES: Record<string, Scene> = { [GREYFORD.id]: GREYFORD, [GREYFORD_SOLO.id]: GREYFORD_SOLO };
