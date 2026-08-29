# BBGM Draft Class Workshop

A single-page, offline tool for reworking **Basketball GM** draft class files. Drop in
a `.json` draft class exported from the game, reshape it, look at the season it
implies, and export a file the game will read straight back in.

Open `index.html` in any browser. Nothing is uploaded and there is no build step.

---

## What it does

**1. Fills in the blank colleges.** Every prospect whose college is `""` (shown as
*None* in game) is sent somewhere real. There are thirteen destinations —
**EuroLeague**, the **NBA G League**, **Liga ACB**, the **NBL**, the **Chinese CBA**,
**LNB Pro A**, the **EuroCup**, the **Basketball Bundesliga**, the **Adriatic
League**, **NBL1**, **Overtime Elite**, the **NBA Academies** and **DII NCAA** — each
with its own weight, and each weight scaled by where the player was born. A Serbian
leans EuroLeague and the Adriatic League, an Australian leans the NBL, a Nigerian
leans LNB Pro A and the NBA Academy in Senegal.

**2. Rebuilds ratings into varied, specialised builds — without inflating anyone.**
Each player is assigned one of sixty archetypes (Floor General, Heliocentric
Guard, Movement Shooter, 3&D Wing, Point Center, Rim Protector, Stretch Big,
Lob Threat, Athletic Freak, …), gated by their height so a 7-footer never becomes
a point guard. The archetype pushes some ratings up and others down, then the whole
build is re-solved against **BBGM's own `ovr` formula** so the finished player comes
out at exactly the target overall. Specialising a player makes him lopsided, not
better.

Rarity weights span 0.16 to 3.6, so a Combo Guard is more than twenty times more
likely than a Point Center — and each class draws a **flavour** (guard-heavy,
big-heavy, defence-first, full of shooters, athletic and raw, …) that tilts the
weights for that class only. Rerolling produces a different *kind* of draft, not
the same mix with different names.

**3. Simulates the season those prospects played.** All 353 BBGM colleges are built
into a real landscape: program strength starts from each school's draft frequency
(Kentucky 116, Wagner 0.1) on a log scale, plus conference strength, plus a year of
variance, plus a **playing style** — four-out and three-heavy, pack-line, run and
gun, inside-out, full-court press, lob city — that changes what its players' shot
charts look like. Prospects are layered on alongside synthetic returning teammates.
Then **every one of the 353 programs** plays the same 31-game schedule, conference
tournaments, a 68-team national tournament and a 32-team NIT — with real scores,
overtimes, and teams a few points better in March than in November.

Every program is simulated, not only the forty with a prospect on them, which is
what makes the AP poll's ratings real and gives the award model an actual field to
rank against.

The stat model (turnover rate, free-throw rate, 3PA share, rim / mid-range / FT
percentages, usage-by-talent) is calibrated against 61,061 real D-I player-seasons
from 2009–2021 — see `js/calibration.js`. It targets the **draft-year** anchor
there: a prospect's final, highest-usage college season, which is what a BBGM draft
class actually represents. Possessions follow the standard identity
`Poss = FGA - ORB + TOV + 0.44*FTA`, so a team's *scoring chances* exceed its
possession count by its offensive rebounds. The stat line carries points, an
offensive/defensive rebound split, assists, steals, blocks, turnovers, personal
fouls, contested shots, deflections, charges drawn, a defensive rating, usage and
the shooting splits — and it reconciles: recomputing points from the attempts and
percentages printed beside it returns the same PPG.

**Defence is modelled, not implied.** Every team has a defensive profile built from
BBGM's `defenseInterior` and `defensePerimeter` composites, and it is applied to the
opponents that team actually played: a conference full of rim protectors holds
everyone below their usual rim percentage, and a pressing team forces turnovers.

**Non-NCAA prospects get a real season too**, in their own environment. The G League
plays 48-minute games at 103 possessions; the EuroLeague plays 40 at 70; a
19-year-old at Real Madrid is capped at the minutes a 19-year-old at Real Madrid
actually gets. Each league has a club list, a table, a playoff with named rounds
(the EuroLeague's ends in a Final Four), a domestic cup, promotion and relegation
where it applies, and two-way contracts and loan spells where they apply.

**4. Writes a scouting note for every player.** Which lines go in is yours to
choose under *Note template*: school/club and class year, how he got here
(recruiting ranking, transfer, redshirt, reclassification), team record and
postseason result, the stat line, shooting splits, advanced numbers, the defensive
line, the best single game of his season, season highs and streaks, postseason
splits, games missed and why, the archetype, honours, and his position on the draft
board. This goes into the player's `note` field, which BBGM displays on the player
page.

**5. Hands out honours — about ninety distinguishable ones.** The six named
national player-of-the-year trophies (Naismith, Wooden, Oscar Robertson, AP, NABC,
Sporting News) each have their own electorate, so a clear best player sweeps and a
close year splits. Three national defensive awards, the five position awards (Cousy,
West, Erving, Malone, Abdul-Jabbar), the Pete Newell, Lute Olson and Wayman Tisdale
awards, consensus All-America teams, NABC All-Defensive teams, NCAA All-Region
teams, the Final Four Most Outstanding Player, Academic All-America, NIT honours,
and per conference: Player, Defensive Player, Freshman, Sixth Man and Most Improved
of the Year, all-conference first and second teams, and all-defensive, all-freshman,
all-newcomer and all-tournament teams.

Prospects are ranked against every returning player in Division I — against their
**actual simulated seasons**, not a formula fitted to talent — so an All-America
slot has to be earned. A typical 70-man class takes about 12 of the ~31 conference
Player of the Year awards and has one or two consensus first-team All-Americans.

**6. Shows the AP Top 25 and the full bracket**, including the First Four, all four
regions, upsets highlighted, a compact winners-only mode, the last four in / first
four out, and the NIT.

**7. Rerolls, locks, comparison and sharing.** Every result is a pure function of
the seed and the settings, so *Reroll* gives a brand new class and everything else
keeps the class you are looking at. Click any row to edit a prospect and **lock**
his overall, potential, archetype, school, name, listed height or any individual
rating — each independently, and locks survive rerolls. Tick several rows to edit
them together. *Pin* keeps the current class as a baseline and the Compare tab shows
what moved. Settings, locks, column layout and theme survive a refresh; *Link* puts
the seed, all settings and any locks in the URL.

**8. Tells you what you are looking at.** Search and filter the prospect table,
choose which of its 30-odd columns to show, sort by several at once, switch between
per-game, season totals and per-40, read statistical leaderboards, browse any
prospect's game log, eyeball histograms, follow one team's path through the bracket,
read the mock draft board with risers and fallers, and run a batch of N classes in a
background worker with a progress bar and a cancel button.

---

## Settings

| Group | What it controls |
| --- | --- |
| **Overall ratings** | `Preserve` keeps each prospect's original ovr (nothing inflates — only builds change). `Rebuild the class curve` re-deals overalls along a curve you shape. |
| **Class quality / depth / elite prospects** | The shape of that curve. |
| **Potential bias / spread** | How far pot sits above ovr, and how much it varies. Cosmetic: potential never feeds the simulation, so moving these does not re-play the season. |
| **Specialisation** | 0 = BBGM's fairly uniform builds, 2.5 = extreme specialists. |
| **Archetype diversity** | Exactly `100 − v`% of the class stays Balanced. |
| **Class flavour** | How strongly each class leans one way (guard-heavy, defence-first, …). |
| **Build noise** | Per-rating jitter. |
| **Vary size** | Lets listed height and weight drift with the build. |
| **Freshmen / transfers / redshirts / reclassified** | Who is in what year, and how they got there. |
| **Destination weights** | Where blank-college prospects go, per league. |
| **Pace, scoring environment, stat randomness** | The **Division I** scoring environment. Every professional league abroad has its own. |
| **March upsets** | 0 = chalk, 2 = total madness. Applies to the postseason only, which is why re-simulating March costs 120ms and not a whole season. |
| **National / conference / abroad award strictness** | Three separate dials. This used to be one slider driving three different mechanisms. |
| **Archetype frequencies** | Per-build rarity weights for all 60 archetypes; hover a name to see its offset vector. |
| **Note template** | Which lines are written into each player's exported note. |

Presets set several at once, and you can save your own; the dropdown says
"(modified)" once you change anything by hand.

---

## Performance

The pipeline is staged. Each phase declares which settings it reads, so a change
only re-runs what it actually invalidates. Measured in Chromium on a 70-man class
over 353 programs:

| Change | Phases re-run | Engine time |
| --- | --- | --- |
| Note template | notes | **0.6 ms** |
| Award strictness | awards → board → notes | 22 ms |
| Potential bias / spread | potential → awards → board → notes | 20 ms |
| March upsets | postseason → stats → … | 126 ms |
| Pace, stat randomness | stats → … | 108 ms |
| Specialisation, archetypes, seed | everything | 213 ms |

Batch mode runs in a Web Worker with a progress bar and a cancel button; where a
browser refuses to start a worker — which includes opening `index.html` straight
off the disk — it falls back to a chunked run on a timer that yields to the UI and
cancels the same way.

---

## Accuracy

`js/bbgm.js` reimplements BBGM's `ovr`, `pos`, `compositeRating` and `skills`
functions from the game's source. Checked against the five sample draft classes
(2289–2293, 420 players): **420/420 match on both `ovr` and `pos`**, so ratings this
tool writes evaluate identically inside the game.

```
node tools/validate.js [nSeeds] [--json]   # calibration bands
node tools/test.js [--update-golden]       # regression tests
```

`validate.js` runs the full engine over synthetic classes and asserts the outputs
land near the empirical anchors, in three groups:

* **Prospects**, against the draft-year anchor: MPG 30.6, GP 33.5, USG 25.0
  (p95 32.5), TS 57.0, FT 72.6, 3P 34.8.
* **The whole simulated field**, against the D-I rotation baseline: TS 53.4,
  3P 33.8, FT 70.6, ORtg 102.6. Every program is simulated, so "is the average
  Division I player right?" is a question with an answer.
* **Teams**, which is what catches a broken possession model that per-player rate
  bands cannot: points 66–74, FGA 52–59, possessions 63–73, assists 12–15,
  rebounds 32–37.

It also checks the documented per-player share ceilings against the team total, that
every program plays the same regular season, that a champion's record includes its
March run, that the schedule is in calendar order, and the award volume. `--json`
makes the results diffable in CI.

`test.js` covers what the prose used to only claim: a golden-file hash of the
exported JSON for three configurations, seed→output determinism, the 420/420
round-trip, solver property tests at extreme targets, malformed-input handling,
locks surviving rerolls, files with no `pid`, the staged pipeline producing exactly
what a cold run produces while skipping the phases it should skip, per-league
environments, program styles, game logs averaging back to the season line, and that
defensive awards are not gated on offensive production. Both run on every push
(`.github/workflows/ci.yml`), along with a headless-browser smoke test that loads a
class, renders every tab and checks for console errors.

## Export

`Export JSON` writes `<original name>_customized.json`: the original file with each
player's `college`, ratings block (all 15 ratings plus `ovr`, `pot`, `pos`, `skills`),
`draft.ovr` / `draft.pot` / `draft.skills`, and `note` / `noteBool` updated. `pid`,
`face`, `born`, `relatives` and everything else are untouched (`hgt`/`weight` are
rewritten only when *Vary size* is on, a height or weight is locked by hand, or the
source file lacked them), and the file is written with a BOM the same way BBGM writes
its own exports. Load it back with **Tools → Import → Draft class**.

The ▾ button next to it also exports the prospect table as CSV, the whole simulated
season (records, bracket, awards, draft board) as JSON or CSV, the note text alone
for a spreadsheet, and imports locks back in from a CSV so a round trip through a
spreadsheet works.

If you load several seasons at once, `Export all` writes each of them.

## Layout

```
index.html          UI shell
css/style.css
js/rng.js           seeded RNG (mulberry32) + distributions
js/bbgm.js          BBGM's own rating formulas, reimplemented
js/colleges.js      353 colleges + 13 non-NCAA leagues and their clubs
js/config.js        defaults + presets
js/calibration.js   empirical targets from 61k real 2009-21 D-I player-seasons
js/ratings.js       archetypes, class flavour, potential and the ovr-preserving solver
js/teams.js         program strength, styles, rosters, schedule, conference tournaments
js/stats.js         minutes, usage, the stat line model, defence and game logs
js/tournament.js    AP poll, selection, seeding, the 68-team bracket, the NIT
js/awards.js        national / conference / tournament / pro honours
js/engine.js        the staged pipeline, pro leagues, note text and file export
js/batch.js         what a batch run measures (shared with the worker)
js/worker.js        batch mode off the main thread
js/views.js         the tab views
js/app.js           state, settings, editing, persistence, export
tools/validate.js   calibration bands against the empirical anchors
tools/test.js       golden-file, round-trip, determinism and property tests
tools/uismoke.js    headless-browser smoke test
tools/golden.json   recorded output hashes
```

## Known limits

* A draft class is one season. There is no multi-year progression — a prospect's
  sophomore year is not derived from his freshman year, because the file contains
  one year.
* The recruiting ranking, transfer history and redshirt status are biography
  generated to fit the class. They shape the note and the award categories a player
  is eligible for; they are not read from the file, because BBGM does not store them.
