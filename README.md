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
Each player is assigned one of 18 archetypes (Floor General, 3&D Wing, Rim Protector,
Stretch Big, Microwave Scorer, Athletic Freak, …), gated by his height so a 7-footer
never becomes a point guard. The archetype pushes some ratings up and others down,
then the whole build is re-solved against **BBGM's own `ovr` formula** so the finished
player comes out at exactly the target overall. Specialising a player makes him
lopsided, not better.

**3. Simulates the season those prospects played.** All 353 BBGM colleges are built
into a real landscape: program strength starts from each school's draft frequency
(Kentucky 116, Wagner 0.1) on a log scale, plus conference strength, plus a year of
variance. Prospects are layered onto their program alongside synthetic returning
teammates. Then everyone plays ~31 games, conference tournaments, and a 68-team
national tournament.

**4. Writes a scouting note for every player.** Team, conference, class year,
archetype, the full stat line (PPG / RPG / APG / SPG / BPG, FG% / 3P% / FT% / TS%),
the team's record and postseason run, and any honours won. This goes into the
player's `note` field, which BBGM displays on the player page.

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

Statistical output is calibrated to look like real Division I basketball — roughly
46–47% FG, 32–34% 3P, 69–71% FT across the class, with leaders in the low-to-mid 20s
in scoring, 11–13 rebounds, and 5–6 assists.

## Export

`Export JSON` writes `<original name>_customized.json`: the original file with each
player's `college`, ratings block (all 15 ratings plus `ovr`, `pot`, `pos`, `skills`),
`draft.ovr` / `draft.pot` / `draft.skills`, and `note` / `noteBool` updated. `pid`,
`face`, `born`, `relatives` and everything else are untouched, and the file is written
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
js/ratings.js       archetypes and the ovr-preserving build solver
js/teams.js         program strength, rosters, schedule, conference tournaments
js/stats.js         minutes, usage and the stat line model
js/tournament.js    AP poll, selection, seeding, the 68-team bracket
js/awards.js        national / conference / tournament honours
js/engine.js        the pipeline, note text and file export
js/app.js           views and interaction
```
