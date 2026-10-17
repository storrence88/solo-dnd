import type { Scene } from '../scene';
import { GREYFORD, GREYFORD_SOLO } from './greyford';
import { HOLLINS_REST } from './hollinsRest';

export const SCENES: Record<string, Scene> = { [GREYFORD.id]: GREYFORD, [GREYFORD_SOLO.id]: GREYFORD_SOLO, [HOLLINS_REST.id]: HOLLINS_REST };
