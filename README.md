# BBGM Draft Class Workshop

A single-page, offline tool for reworking **Basketball GM** draft class files. Drop in
a `.json` draft class exported from the game, reshape it, look at the season it
implies, and export a file the game will read straight back in.

Open `index.html` in any browser. Nothing is uploaded and there is no build step.

---

## What it does

**1. Fills in the blank colleges.** Every prospect whose college is `""` (shown as
*None* in game) is reassigned to **EuroLeague**, **NBA G League** or **NBL**, with a
rare roll for **DII NCAA**. The weights are yours to set, and they are modified by
where the player was born — a Serbian leans EuroLeague, an Australian leans NBL, an
American leans G League.

**2. Rebuilds ratings into varied, specialised builds — without inflating anyone.**
Each player is assigned one of nearly 60 archetypes (Floor General, Heliocentric
Guard, Movement Shooter, 3&D Wing, Point Center, Rim Protector, Stretch Big,
Lob Threat, Athletic Freak, …), gated by their height so a 7-footer never becomes
a point guard. Rarer builds (Post-Up Guard, Point Center, Foul-Prone Enforcer)
carry rarity weights so they show up occasionally, not every class. The archetype pushes some ratings up and others down,
then the whole build is re-solved against **BBGM's own `ovr` formula** so the finished
player comes out at exactly the target overall. Specialising a player makes him
lopsided, not better.

**3. Simulates the season those prospects played.** All 353 BBGM colleges are built
into a real landscape: program strength starts from each school's draft frequency
(Kentucky 116, Wagner 0.1) on a log scale, plus conference strength, plus a year of
variance. Prospects are layered onto their program alongside synthetic returning
teammates. Then everyone plays ~31 games, conference tournaments, and a 68-team
national tournament. The stat model (turnover rate, free-throw rate, 3PA share,
rim / mid-range / FT percentages, usage-by-talent) is calibrated against 61,061
real D-I player-seasons from 2009-2021, including all 1,435 drafted players —
see `js/calibration.js` for the empirical anchors.

**4. Writes a scouting note for every player.** School, conference, class year,
the full stat line (PPG / RPG / APG / SPG / BPG, FG% / 3P% / FT% / TS%), and any
honours won. This goes into the player's `note` field, which BBGM displays on the
player page. (Team record, age and archetype are deliberately left out of the
exported note; the archetype still shows in the tool's own table.)

**5. Hands out awards.** National Player of the Year, Consensus All-America teams,
National Defensive Player of the Year, Freshman of the Year, conference Player /
Defensive Player / Freshman of the Year, All-Conference teams, conference tournament
MVPs, Final Four Most Outstanding Player and All-Tournament team — plus pro-league
equivalents for the EuroLeague / G League / NBL players.

**6. Shows the AP Top 25 and the full bracket**, including the First Four, all four
regions, upsets highlighted, and the last four in / first four out.

**7. Rerolls.** Every result is a pure function of the seed and the settings, so
"Reroll class" gives a brand new class and "Re-apply" reproduces the current one
exactly. Paste an old seed back in to get that class again.

---

## Settings

| Group | What it controls |
| --- | --- |
| **Overall ratings** | `Preserve` keeps each prospect's original ovr (nothing inflates — only builds change). `Rebuild the class curve` re-deals overalls along a curve you shape. |
| **Class quality** | Shifts the whole curve up or down. |
| **Depth** | Top-heavy (a few stars, a cliff) through deep (little separation). |
| **Elite prospects** | How many genuine blue-chippers sit at the top. |
| **Potential bias / spread** | How far pot sits above ovr, and how much it varies. |
| **Specialisation** | 0 = BBGM's fairly uniform builds, 2.5 = extreme specialists. |
| **Archetype diversity** | How often a distinct archetype is used instead of a balanced build. |
| **Build noise** | Per-rating jitter. |
| **Vary size** | Lets listed height and weight drift with the build. |
| **Blank-college weights** | EuroLeague / G League / NBL shares and the DII chance. |
| **Pace, scoring environment, stat randomness** | The college scoring environment the notes are generated in. |
| **March upsets** | 0 = chalk, 2 = total madness. |
| **Award strictness** | How hard it is to clear an award bar. |

Presets (Loaded class, Weak class, Top heavy, Deep no stars, Specialist league,
Vanilla builds, Chalk March, Total madness) set several of these at once.

---

## Accuracy

`js/bbgm.js` reimplements BBGM's `ovr`, `pos`, `compositeRating` and `skills`
functions from the game's source. Checked against the five sample draft classes
(2289–2293, 420 players): **420/420 match on both `ovr` and `pos`**, so ratings this
tool writes evaluate identically inside the game.

Statistical output is calibrated against 61,061 real 2009–2021 D-I player-seasons
(all 1,435 drafted players included) and *verified*, not just intended:
`node tools/validate.js` runs the full engine over synthetic classes and asserts
the outputs land in bands around the empirical anchors — ~47% FG, ~33.5% 3P,
~72% FT, TS ~56%, USG capped at a physical 33%, scoring leaders in the low 20s,
rebound/assist/block leaders around 14 / 8 / 3.8. Run it after touching the
stat model; it exits non-zero when calibration drifts.

## Export

`Export JSON` writes `<original name>_customized.json`: the original file with each
player's `college`, ratings block (all 15 ratings plus `ovr`, `pot`, `pos`, `skills`),
`draft.ovr` / `draft.pot` / `draft.skills`, and `note` / `noteBool` updated. `pid`,
`face`, `born`, `relatives` and everything else are untouched (`hgt`/`weight` are
rewritten only when *Vary size* is on or the source file lacked them), and the file is written
with a BOM the same way BBGM writes its own exports. Load it back with
**Tools → Import → Draft class**.

If you load several seasons at once, `Export all` writes each of them.

## Layout

```
index.html          UI shell
css/style.css
js/rng.js           seeded RNG (mulberry32) + distributions
js/bbgm.js          BBGM's own rating formulas, reimplemented
js/colleges.js      353 colleges: frequency, conference, prestige; non-NCAA leagues
js/config.js        defaults + presets
js/calibration.js   empirical targets from 61k real 2009-21 D-I player-seasons
js/ratings.js       archetypes and the ovr-preserving build solver
js/teams.js         program strength, rosters, schedule, conference tournaments
js/stats.js         minutes, usage and the stat line model
js/tournament.js    AP poll, selection, seeding, the 68-team bracket
js/awards.js        national / conference / tournament honours
js/engine.js        the pipeline, note text and file export
js/app.js           views and interaction
```
