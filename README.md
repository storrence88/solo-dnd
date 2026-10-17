# Solo D&D

A solo tabletop RPG for the browser: you play one character, AI companions with their own personalities travel with you, and an AI Dungeon Master runs the world. Rules are 2014 5e (SRD 5.1), simplified to "5e-lite".

The core rule of the design: **rules live in code, story lives in the model.** Dice, HP, spell slots and conditions are computed by the rules engine in `src/engine`, which the AI can never fudge.

## Status

Phase 1 of the plan: the rules core. There is no AI yet. A small "autopilot" plays both sides so whole fights can run and be tested.

## Running it

```sh
npm install
npm test        # rules engine tests, including 100 seeded fights per scenario
npm run dev     # the rules sandbox page at http://localhost:5173
```

The sandbox page lets you pick a fight and a seed, then step through it turn by turn or run it to the end, with every roll in the event log.

## What the engine covers

- **Dice:** expressions like `2d6+3`, advantage and disadvantage, critical hits double the dice. All randomness comes from a seeded RNG, so a fight is reproducible from its seed.
- **Characters:** four classes at levels 1 to 3 (Fighter/Champion, Cleric/Life, Rogue, Wizard), with hit points, armor class, weapon attacks, proficiency, expertise, saves and spell slots computed from a short spec. Four pregenerated characters live in `src/engine/data/pregens.ts`.
- **Checks and saves:** ability checks, skill checks, saving throws and passive Perception.
- **Combat:** initiative, actions and bonus actions, attacks, damage, Multiattack, Second Wind, Action Surge, Sneak Attack, Cunning Action (Hide, Disengage), Dodge, and eight spells (Fire Bolt, Sacred Flame, Burning Hands, Cure Wounds, Guiding Bolt, Healing Word, Magic Missile, Scorching Ray) with upcasting.
- **Dying:** PCs drop to unconscious at 0 HP, roll death saves, can be stabilized or healed, and die from three failures or massive damage. Monsters die at 0 HP.
- **Event log:** every change is an event in `Encounter.events`. This is the record the DM and companion agents will read from in later phases.

## 5e-lite simplifications (for now)

- Theater of the mind: no grid, no movement or ranges. "In melee with" is tracked only for Sneak Attack.
- No opportunity attacks, reactions, concentration, encumbrance, ammunition, rations or spell components.
- Monster data is hand-entered from the SRD for a handful of creatures; a full SRD import comes later.

## Layout

```
src/engine/   rules engine (no UI or AI code)
  data/       classes, equipment, spells, monsters, pregens
src/ui/       the bare-bones sandbox page
```
