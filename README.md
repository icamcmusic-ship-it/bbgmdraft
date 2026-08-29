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
teammates. Then every program plays the same 31-game schedule, conference
tournaments, and a 68-team national tournament — with real scores, overtimes and
teams that are a few points better in March than in November.

The stat model (turnover rate, free-throw rate, 3PA share, rim / mid-range / FT
percentages, usage-by-talent) is calibrated against 61,061 real D-I
player-seasons from 2009-2021, including all 1,435 drafted players — see
`js/calibration.js` for the empirical anchors. Possessions follow the standard
identity `Poss = FGA - ORB + TOV + 0.44*FTA`, so a team's *scoring chances*
exceed its possession count by its offensive rebounds (D-I ORB% ~29%, a ratio
near 1.15). The stat line carries points, an offensive/defensive rebound split,
assists, steals, blocks, turnovers, personal fouls, usage rate and the shooting
splits, and it reconciles: recomputing points from the attempts and percentages
printed beside it returns the same PPG.

**Non-NCAA prospects get a real season too.** EuroLeague, G League, NBL and DII
players are placed on an actual club (Real Madrid, Rio Grande Valley, Melbourne
United, …) with per-club strength, a full league table and a playoff, rather than
one anonymous synthetic team.

**4. Writes a scouting note for every player.** Which lines go in is yours to
choose under *Note template*: school/club and class year, team record and
postseason result, the stat line, shooting splits, advanced numbers (usage,
rebound split, fouls), the best single game of his season ("32 points in a win
over Kansas, 78-71"), the archetype label, and honours. This goes into the
player's `note` field, which BBGM displays on the player page.

**5. Hands out awards — against the whole of Division I.** A 70-man draft class
shares D-I with ~4,000 players this tool does not otherwise model, so every
returning player on every roster is scored on the same scale and prospects have
to finish ahead of them. Without that, awards were handed out by array index:
every class contained the National Player of the Year and all five Consensus
First Teamers. Now the POY shows up in roughly a third of classes and a typical
class has one or two First Team All-Americans, with conference honours, tournament
MVPs and the Final Four Most Outstanding Player decided the same way. DII players
compete for the DII awards, never for D-I ones.

**Class years are rolled, not read off the birthday.** BBGM draft classes are
almost entirely age 19, which used to make all 70 prospects freshmen and collapse
four award categories into one. Class year now comes from the prospect's standing
in the class plus a *Freshmen in the class* slider (age is used instead whenever
the file actually varies it).

**6. Shows the AP Top 25 and the full bracket**, including the First Four, all four
regions, upsets highlighted, and the last four in / first four out.

**7. Rerolls, locks and sharing.** Every result is a pure function of the seed and
the settings, so "Reroll class" gives a brand new class and "Re-apply" reproduces
the current one exactly. Click any row to edit a prospect and **lock** his overall,
potential, archetype or school — locks survive rerolls. The seed pill is
click-to-copy, recent seeds are one click away, and *Copy shareable link* puts the
seed, all settings and any locks in the URL, so one link reproduces a class exactly
(a seed alone never could).

**8. Tells you what you are looking at.** Search and filter the prospect table,
export it as CSV, read statistical leaderboards, eyeball ovr/PPG/usage histograms,
follow one team's path through the bracket, and run a batch of N classes with the
same settings to see the aggregate distributions.

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
| **Award strictness** | How far into the national and conference field the honours reach. |
| **Freshmen in the class** | Share of the class that stayed one year; the rest spread over So/Jr/Sr. |
| **Archetype frequencies** | Per-build rarity weights, editable for all 60 archetypes. |
| **Note template** | Which lines are written into each player's exported note. |

Presets (Loaded class, Weak class, Top heavy, Deep no stars, Specialist league,
Vanilla builds, One-and-done era, Veteran-heavy class, Chalk March, Total madness)
set several of these at once; the dropdown says "(modified)" once you change
anything by hand.

---

## Accuracy

`js/bbgm.js` reimplements BBGM's `ovr`, `pos`, `compositeRating` and `skills`
functions from the game's source. Checked against the five sample draft classes
(2289–2293, 420 players): **420/420 match on both `ovr` and `pos`**, so ratings this
tool writes evaluate identically inside the game.

Statistical output is calibrated against 61,061 real 2009–2021 D-I player-seasons
(all 1,435 drafted players included) and *verified*, not just intended.

```
node tools/validate.js [nSeeds] [--json]   # calibration bands
node tools/test.js [--update-golden]       # regression tests
```

`validate.js` runs the full engine over synthetic classes and asserts the outputs
land within ~10% of the empirical anchors: MPG 28.0, GP 32.3, USG 22.8 (p95 30.4),
TS 56.5, FT 72.3, 3P 34.6, FG ~47. It also checks the numbers a per-player rate
band cannot catch — **team points 68-77, team FGA 53-60, team possessions 63-74** —
which is what a broken possession model actually shows up in, plus award volume
and whether every stat line reconciles with its own shooting splits. `--json`
makes the results diffable in CI.

`test.js` covers what the prose used to only claim: a golden-file hash of the
exported JSON for three configurations, seed→output determinism, the 420/420
round-trip (exported ratings recompute to the same `ovr`/`pos`), solver property
tests at extreme targets, malformed-input handling, that locks survive rerolls,
and that non-D-I players never win D-I awards. Both run on every push
(`.github/workflows/ci.yml`).

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
js/engine.js        the pipeline, pro leagues, note text and file export
js/app.js           views and interaction
tools/validate.js   calibration bands against the empirical anchors
tools/test.js       golden-file, round-trip, determinism and property tests
tools/golden.json   recorded output hashes
```
