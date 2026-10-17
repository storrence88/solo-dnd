# Solo D&D

A solo tabletop RPG for the browser: you play one character, AI companions with their own personalities travel with you, and an AI Dungeon Master runs the world. Rules are 2014 5e (SRD 5.1), simplified to "5e-lite".

The core rule of the design: **rules live in code, story lives in the model.** Dice, HP, spell slots and conditions are computed by the rules engine in `src/engine`, which the AI can never fudge.

## Status

Phase 5 of the plan: the campaign layer. Type an idea and pick a tone, and the DM plans a three-act campaign and writes each chapter as you reach it. You play Steven (a fighter) with two AI companions, Brenna (a cleric) and Quill (a rogue), who remember earlier scenes and react to your choices. The hand-written **The Road to Hollin's Rest** (Greyford Bridge, a night at camp, then Fever at Hollin's Rest) and a solo Greyford Bridge are still there as quick starts.

## Campaigns

- **Planning.** The DM model turns your premise and tone into an outline: a region and its places, two to four factions with conflicting goals, a central threat, three acts, hidden secrets, possible endings, and a reason for each of you to be on this road. You see the title, premise and region; the rest comes out in play.
- **Chapters.** Each morning the planner writes the next scene in the same shape as the hand-written ones (people, triggered secrets, enemies, endings) from the outline and everything that has happened. Enemies must be stat blocks from the rules engine, within an encounter budget. The narrating DM still sees only the campaign's public face and the secrets each scene unlocks.
- **Journal.** At the end of each scene the DM records what happened and updates your quests and how each faction feels about you (hostile, wary, neutral, friendly or allied). Changes show in the story and in the journal beside the party.
- **Acts.** When a scene meets the act's goal, the next act begins. An act aims for two or three chapters; the fourth is pushed to a climax, and a fifth moves on regardless. When the last act ends, the DM writes an epilogue.
- **Previously on…** Opening a saved game starts with a short recap of the story so far.
- **Companion hooks.** Brenna's and Quill's personas are the same in every campaign; why they are here, their mood at the start, and what a betrayal would look like are written per campaign.

## Running it

You need Node 22 or newer and an API key from a model provider. Groq's free tier is the default.

1. Create a key in the Groq console (**API Keys**, then **Create API Key**).
2. In this folder, copy `.env.example` to a new file named `.env` and put your key in it:
   ```
   GROQ_API_KEY=your-key-here
   ```
   `.env` is git-ignored, so the key stays on your computer. Never paste it into the code or a chat.
3. Install and start:
   ```sh
   npm install
   npm run dev     # open http://localhost:5173
   ```

Games save automatically to the `saves/` folder (also git-ignored), and the page offers to continue them.

Other commands:

```sh
npm test         # rules engine and DM loop tests (the DM loop uses a scripted fake model, so tests never call Groq or Claude)
npm run sandbox  # just the rules sandbox page, no server or key needed
```

The **Rules sandbox** tab lets you pick a fight and a seed, then step through it turn by turn with every roll in the event log.

### Using Claude, with Groq as a backup

Add an Anthropic API key to `.env` next to your Groq key:

```
ANTHROPIC_API_KEY=your-anthropic-key
GROQ_API_KEY=your-groq-key
```

Claude then runs the game: Sonnet 5.5 as the DM, and Haiku 5.5 for the companions and bookkeeping. Change the models with `CLAUDE_DM_MODEL`, `CLAUDE_COMPANION_MODEL` and `CLAUDE_HELPER_MODEL`, and how hard they think with `CLAUDE_EFFORT` (low by default).

If a Claude call fails for any reason, such as an outage, a rate limit, running out of credits, or Claude declining a request, that call goes to Groq instead. Claude then sits out for a minute before the game tries it again, and the server console says when this happens. Without a Groq key, Claude runs alone; without an Anthropic key, nothing changes.

### Using a different model

Any OpenAI-compatible endpoint works. For example, to run Ollama on your own PC, set these in `.env`:

```
LLM_BASE_URL=http://localhost:11434/v1
DM_MODEL=gpt-oss:120b
HELPER_MODEL=gpt-oss:20b
# COMPANION_MODEL defaults to DM_MODEL
```

## How a turn works

With companions, each beat goes: you act, then the companions react, then the DM resolves it all.

- **Perception:** every character's view is built from the shared story. A companion sees only what it could perceive, its own private thoughts, and never the DM's secrets or the other companion's thoughts. Quill's own secret lives only in Quill's prompt.
- **Spotlight:** after you act, each companion quickly says whether it wants to lead, support or pass, and how urgently. The code adds to that: naming a companion hands them the lead, moments touching their interests (Brenna: the sick, healing, faith; Quill: locks, coin, lies, Corrin) pull them in, and a companion who hasn't led in a while gets a nudge. One companion leads and the other reacts in a line. **Let the party act** holds you back so a companion takes the lead.
- **Approval:** after you act, every companion also judges your choice by their own values. A reaction moves their trust in you (0-10) by one point and is logged with its reason. You see "Brenna approves" in the story; the reason shows when you tick **Peek at companions' thoughts**, along with moods, trust and private thoughts.

## Between scenes

When a scene ends you can **make camp**:

- The DM writes a short factual summary of the scene. Later scenes are told to stay consistent with it, and it shows as a collapsible chapter above the story.
- The party takes a long rest (HP, spell slots and abilities come back).
- Each companion reflects: they write 2 to 5 memories of the day in their own words, rewrite their beliefs, and settle how they feel about you (shown on their party card). From then on, the memories that matter most for the moment go into their prompts.
- Brenna and Quill talk by the fire, and one of them comes to talk to you privately. You can talk back to either of them; the other doesn't hear.
- **Break camp** turns the night's talk into memories and opens the next scene.

Big moves are earned. A companion whose trust in you is 3 or lower, with at least three logged grievances, confronts you at camp; that is the warning. If their trust is still 1 or lower when you break camp, they may leave in the night and leave a note saying why. Quill may betray the party instead, in a way that fits the campaign (on the Road, by taking two crates of medicine). A companion who trusts you 8 or more may confide in you instead.

- You type what your character does. A small helper model checks whether you have met the trigger for any of the scene's hidden secrets; the DM is only ever shown secrets that have been unlocked.
- The DM replies with JSON: narration, a question handing the turn back, and one action (nothing, ask for a check, start combat, or end the scene). Replies that break a rule, such as revealing a locked secret or adding an enemy who isn't in the scene, are sent back once for a fix.
- Checks are rolled by the rules engine, then the DM narrates the result it was given.
- In combat, you choose from buttons listing only legal moves, companions pick theirs from the same kind of list, enemies are run by the engine, and the DM narrates each round from the event log. If the enemies lose half their total HP, the survivors break and flee. If you drop, you are knocked out, not killed.

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
- Monster data is hand-entered from the SRD for 17 creatures, from cultists to an ogre and a veteran, without special traits such as pack tactics or undead fortitude; a full SRD import comes later.

## Layout

```
src/engine/   rules engine (no UI or AI code)
  data/       classes, equipment, spells, monsters, pregens
src/game/     the DM loop: model client, prompts, reply validation, game state, companions,
              camp and memory, campaigns (outline, planner, journal) and scenes
server/       local server: holds the API key, runs the DM loop, saves games
src/ui/       the play page and the rules sandbox
```
