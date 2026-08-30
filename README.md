# BBGM Draft Class Workshop

A single-page, offline tool for reworking **Basketball GM** draft class files. Drop in
a `.json` draft class exported from the game, reshape it, look at the season it
implies, and export a file the game will read straight back in.

Open `index.html` in any browser. Nothing is uploaded and there is no build step.

---

## What it does

**1. Fills in the blank colleges.** Every prospect whose college is `""` (shown as
*None* in game) is sent somewhere real. There are twenty-four destinations —
**EuroLeague**, the **NBA G League**, **Liga ACB**, the **NBL**, the **Chinese CBA**,
**LNB Pro A**, the **EuroCup**, the **Basketball Bundesliga**, the **Adriatic
League**, the **Basketball Champions League**, the **Turkish BSL**, the **Greek
Basket League**, the **Israeli Premier League**, **Japan's B.League**, **Brazil's
NBB**, the **Basketball Africa League**, the Canadian **CEBL**, **NBL1**, **Overtime
Elite**, the **NBA Academies**, **prep and postgrad**, the **NAIA**, **DII NCAA**,
and **did not play** — each with its own weight, and each weight scaled by where the
player was born, across seven regions. A Serbian leans EuroLeague and the Adriatic
League, an Australian leans the NBL, a Nigerian leans LNB Pro A and the Basketball
Africa League, a Canadian leans the G League and the CEBL. Every one of them has
its own pace, game length and youth minutes cap, its own clubs and league table,
and its own honours.

**2. Rebuilds ratings into varied, specialised builds — without inflating anyone.**
Each player is assigned one of seventy-two archetypes (Floor General, Heliocentric
Guard, Movement Shooter, 3&D Wing, Point Center, Rim Protector, Stretch Big,
Lob Threat, Athletic Freak, …), gated by their height so a 7-footer never becomes
a point guard. The archetype pushes some ratings up and others down, then the whole
build is re-solved against **BBGM's own `ovr` formula** so the finished player comes
out at exactly the target overall. Specialising a player makes him lopsided, not
better.

Rarity weights span 0.34 to 3.6, so a Combo Guard is about ten times more likely
than a Point Center. A class then draws a **pool** of about fourteen of the
seventy-two builds and takes its players from the pool — which is what makes a
class "the year of the stretch bigs" rather than one of everything, every time.
It also draws a **flavour** (guard-heavy, defence-first, a weak year,
one-and-done heavy, a transfer-portal year, …) that tilts which builds enter the
pool and, for some flavours, bends the class itself: how old it is, how good the
top of it is, how it got here. A flavour only moves settings you have left alone.

Every class is also given two to four **forced anomalies** — a five-star bust, an
unranked recruit who turns into a lottery pick, a 24-year-old JUCO who took the
long road, a 7'4" project, a walk-on who ended up a draft pick. The prospect
table lists them as the story of the class.

**3. Simulates the season those prospects played.** All 368 colleges are built
into a real landscape: program strength starts from each school's draft frequency
(Kentucky 116, Wagner 0.1) on a log scale, plus this season's conference strength (which drifts
from year to year rather than being a constant), plus a year of variance — flat
across the country, with a rare down year or breakout on top, so a blue blood can
actually go 17–15 — plus a **coach**, whose playing style (four-out and
three-heavy, pack-line, run and gun, inside-out, full-court press, lob city)
changes what his players' shot charts look like and whose development moves how
much better the team is in March than in November. Prospects are layered on alongside synthetic returning teammates — capped just
below the best prospect on the roster, because a program that landed a draft pick
did not already have two of them. Injuries are drawn **before** a game is played,
so a man who misses fourteen games with a knee costs his team the games it would
have won with him.
Then **every one of the 368 programs** plays the same 31-game schedule, conference
tournaments, a 68-team national tournament and a 32-team NIT — with real scores,
overtimes, and teams a few points better in March than in November.

Every program is simulated, not only the forty with a prospect on them, which is
what makes the AP poll's ratings real and gives the award model an actual field to
rank against.

The stat model (turnover rate, free-throw rate, 3PA share, rim / mid-range / FT
percentages, usage-by-talent) is calibrated against real data — see
`js/calibration.js` — and **which era it targets is a setting**:

| Era | Anchored on | Team points | Offensive rating |
| --- | --- | --- | --- |
| **2023–2026** (default) | NCAA official D-I team averages for 2023-24 and 2024-25 | 73.6 | 108.5 |
| **2009–2021** | 61,061 D-I player-seasons, 1,435 of them from eventual draft picks | 70.0 | 102.6 |

This matters more than it sounds. The tool was originally fitted to the
2009–2021 set and reproduced it almost exactly, which is the problem: that
window contains the 2014-15 scoring nadir — 67.6 points a game, the lowest since
1952 — and predates nearly all of the three-point and rim-pressure inflation
since. A BBGM draft class is implicitly *this year's* class, so every row read
about 5% light on points, 7% light on assists, 15% heavy on turnovers and 12%
heavy on free throws. An era carries both the empirical anchors and the shifts
the model applies to reach them, so the two cannot drift apart, and
`tools/validate.js` checks every era on every run.

Within an era the model targets the **draft-year** anchor: a prospect's final,
highest-usage college season, which is what a BBGM draft class actually
represents. Possessions follow the standard identity
`Poss = FGA - ORB + TOV + 0.44*FTA`, so a team's *scoring chances* exceed its
possession count by its offensive rebounds — turnovers are denominated in
possessions, offensive rebounds come off missed field goals, and personal fouls
are reconciled against free throws rather than modelled independently of them.
The stat line carries points, an offensive/defensive rebound split, assists,
steals, blocks, turnovers, personal fouls, contested shots, deflections, charges
drawn, a defensive rating, usage and the shooting splits — and it reconciles:
recomputing points from the attempts and percentages printed beside it returns
the same PPG.

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

There is a **finalist tier** as well as a winners' tier — Naismith finalists, the
Wooden Late Season Top 20, AP honourable mention, position-award finalists, a
Tisdale watch list. Ninety awards that are all binary throw away most of the
resolution the model has: the difference between the ninth-best player in the
country and the fortieth is real, and both used to finish the year with nothing to
show for it.

Prospects are ranked against every returning player in Division I — against their
**actual simulated seasons**, not a formula fitted to talent — so an All-America
slot has to be earned. A typical 70-man class takes about 12 of the 32 conference
Player of the Year awards and has one or two consensus first-team All-Americans.

**6. Shows the AP Top 25 and the full bracket**, including the First Four, all four
regions, upsets highlighted, a compact winners-only mode, the last four in / first
four out, and the NIT.

**7. Rerolls, locks, comparison and sharing.** Every result is a pure function of
the seed and the settings, so *Reroll* gives a brand new class and everything else
keeps the class you are looking at. Click any row to edit a prospect and **lock**
his overall, potential, archetype, school, name, listed height or any individual
rating — each independently, and locks survive rerolls; the lock column shows
*which* of those are pinned, not merely that something is. The overall box tells
you the range this build can actually be solved to before you type an impossible
number into it, and every field has a one-click revert. *Reroll just him* draws a
single prospect again and leaves the other sixty-nine exactly where they were —
the RNG streams are keyed per player, so it is one salt, not a re-roll of the
class — and one axis at a time (`↻ build`, `↻ school`, `↻ season`) redraws only
that, which is usually the thing you actually wanted. Tick several rows to edit them together. *Pin* keeps the current class as a
baseline; the Compare tab shows what moved and the main table carries a ± against
it. Settings, locks, column layout and theme survive a refresh; *Link* puts the
seed, all settings and any locks in the URL (and says so if a class has too many
locks to fit, rather than handing you a silently truncated link). The seed pill
carries a fingerprint of the generated class, so two people can tell whether they
are looking at the same seventy players and not merely the same seed.

**8. Tells you what you are looking at.** Search the prospect table, filter by
position and conference, **filter on any number** ("PPG over 18", "overall 45 to
55"), and choose which of its forty-odd columns to show — including the shooting
*volume* behind every percentage (FGA, 3PA, FTA, 3PAr, FTr, eFG%), the efficiency
columns (offensive and defensive rating, assist-to-turnover, the production score
the award model itself ranks on), the team context a stat line depends on (record,
AP rank, NCAA seed) and the physicals. Sort by several columns at once with the
whole stack shown and each level removable, walk the class with `j`/`k` or the
arrow keys with the editor following you down, switch between per-game, season
totals and per-40, read statistical leaderboards, browse any prospect's game log,
eyeball histograms, follow one team's path through the bracket, read the mock
draft board with risers and fallers, and run a batch of N classes — reproducible
from its own seed, reported as a distribution rather than one row of averages —
in a background worker with a progress bar and a cancel button — held beside the
previous batch, so a calibration sweep is a diff and not two panels read from
memory.

There is a page for every programme (its coach, its style, its prospects, its
home/away split and every game it played), conference standings for all 32
leagues, and a side-by-side comparison of any two prospects. The editor explains
each player: where his stat line comes from, why he is where he is on the board,
and the seasons before this one. `?` lists the keyboard shortcuts. Below 700
pixels the table becomes one card per prospect.

---

## Settings

| Group | What it controls |
| --- | --- |
| **Overall ratings** | `Preserve` keeps each prospect's original ovr (nothing inflates — only builds change). `Rebuild the class curve` re-deals overalls along a curve you shape. |
| **Class quality / depth / elite prospects** | The shape of that curve. |
| **Potential bias / spread** | How far pot sits above ovr, and how much it varies. These do not re-play the season — potential is computed after it — but they are not cosmetic: the mock draft board scores `(pot − ovr) × 0.65`, so moving them moves the board. |
| **Specialisation** | 0 = BBGM's fairly uniform builds, 2.5 = extreme specialists. |
| **Archetype diversity** | Exactly `100 − v`% of the class stays Balanced. |
| **Class flavour** | How strongly each class leans one way (guard-heavy, defence-first, a weak year, one-and-done heavy, a transfer-portal year, …). Some flavours also bend the class itself — how old it is, how good the top of it is — but only settings you have left at their default. |
| **Builds per class** | How many of the 72 archetypes one class is drawn from. Lower is more distinctive ("the year of the stretch bigs"); 0 makes every build eligible in every class, which is one of everything, every time. |
| **Anomalies per class** | How many forced surprises a class gets: a five-star bust, an unranked riser, a 24-year-old JUCO, a 7'4" project. |
| **Build noise** | Per-rating jitter. |
| **Vary size** | Lets listed height and weight drift with the build. |
| **Freshmen / transfers / redshirts / reclassified** | Who is in what year, and how they got there. |
| **Destination weights** | Where blank-college prospects go, per league. |
| **Era** | Which empirical anchor set the stat model targets — 2023–2026 or 2009–2021. Moves the whole scoring environment, not a slider on top of it. |
| **Pace, scoring environment** | How many possessions a Division I game has. |
| **Shooting efficiency** | What a possession is worth. Pace and scoring environment are both possession dials; without this there was no way to ask for a class that scores its points more (or less) efficiently. |
| **Stat randomness** | Season-to-season luck. Division I only — every professional league abroad has its own environment. |
| **Injuries** | How injury-prone the season is. Drawn *before* a game is played, so a team's record and its selection resume respond to who was missing and when. |
| **March upsets** | 0 = chalk, 2 = total madness. Applies to the postseason only, which is why re-simulating March costs about 90ms and not a whole season. |
| **National / conference / abroad award strictness** | Three separate dials. This used to be one slider driving three different mechanisms. |
| **Archetype frequencies** | Per-build rarity weights for all 60 archetypes, grouped by guards / wings / bigs / any size with a ×2 and ×½ per group, and showing what share of the last generated class each build actually came out as. Hover a name to see its offset vector. |
| **Note template** | Which lines are written into each player's exported note. |

Every control says which phases it re-runs, so a slider that costs 0.6 ms and one
that rebuilds the class are visibly different before you drag either.

Presets set several at once, and you can save your own; the dropdown says
"(modified)" once you change anything by hand, and lists exactly which settings
differ from the preset.

---

## Performance

The pipeline is staged. Each phase declares which settings it reads, so a change
only re-runs what it actually invalidates.

Run `node tools/bench.js` to measure it yourself; `--md` prints the table below
and `--json` the raw numbers. Each row changes one setting on a runner that has
already run once, so what is timed is exactly what a staged re-run does. The
figures are a median over repeated runs, which is why they are not quoted to a
tenth of a millisecond: the number depends on the machine, and a table nobody can
reproduce is a table nobody should believe.

| Change | Phases re-run | Engine time |
| --- | --- | --- |
| Note template | notes | 0.1 ms |
| Award strictness | awards → stock → notes | 18 ms |
| Potential bias / spread | pot → awards → stock → notes | 17 ms |
| March upsets | postseason → stats → … | 88 ms |
| Pace, stat randomness | regular → postseason → stats → … | 166 ms |
| Specialisation, archetypes, seed | everything | 172 ms |

_Median of 9 runs on Node 22; a cold run of the whole pipeline is about 210 ms._

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
node tools/bench.js [reps] [--md|--json]   # staged-pipeline timings
```

`validate.js` runs the full engine over synthetic classes for **every era** and
asserts the outputs land near that era's anchors. The bands are *derived* from
the anchor set rather than typed in, because a band typed in by hand silently
belongs to whichever era it was written in. Four groups:

* **Prospects**, against the era's draft-year anchor: minutes, games, usage, true
  shooting, free-throw and three-point percentage, and the shape of the scoring,
  assist, rebound and block distributions.
* **The whole simulated field**, against the era's D-I rotation baseline. Every
  program is simulated, so "is the average Division I player right?" is a
  question with an answer.
* **Teams**, which is what catches a broken possession model that per-player rate
  bands cannot: points, attempts, possessions, assists, rebounds, blocks, steals,
  turnovers, free throws, fouls, and the ratio of free throws to fouls — the last
  four because they had no band at all, which is how turnovers drifted 15% high
  and fouls 9% low with every other check passing.
* **Relationships**, because the four things a user expects a draft class to
  express are not distributions and so nothing checked them: weaker conferences
  inflating stat lines, high-volume three-point shooters shooting a lower field
  goal percentage, athletic players producing defensive events, skilled players
  scoring more efficiently — plus scoring by size at equal overall rating, since
  a class whose seven-footers outscore its guards is a broken class no per-stat
  band can see.
* **The location bias**, which is the fault none of the above could see: every
  per-stat distribution passed while a programme's strength predicted a
  prospect's minutes two and a half times better than his own rating did.
  `corr(program level, MPG)`, `corr(ovr, MPG)` and the margin between them are
  banded directly, as is the scoring floor of the bottom third of a class and
  the worst archetype scoring residual — how much of a player's scoring is
  decided by his build rather than by how good he is.

Every band knows how many seeds it is being judged on. A mean's tolerance widens
as 1/√n; a per-class count or rate does the same; an extreme value's lower bound
falls with the sample, because the expected maximum of a small sample is smaller.
Bands only ever widen — they are modelling tolerances against an anchor, not
confidence intervals, so more seeds must not make them stricter. `node
tools/validate.js 3` and `node tools/validate.js 40` both pass, which is the
point: the documented invocation used to fail on sampling noise alone.

It also checks the documented per-player share ceilings against the team total, that
every program plays the same regular season, that a champion's record includes its
March run, that the schedule is in calendar order, and the award volume.
`--era=<name>` limits the run to one era; `--json` makes the results diffable in CI.

`test.js` covers what the prose used to only claim: a golden-file hash of the
exported JSON for three configurations, seed→output determinism, the 420/420
round-trip, solver property tests at extreme targets, malformed-input handling,
locks surviving rerolls, files with no `pid`, the staged pipeline producing exactly
what a cold run produces while skipping the phases it should skip, per-league
environments, program styles, game logs averaging back to the season line, and that
defensive awards are not gated on offensive production.

It also holds the line on everything the possession chain and the era table
depend on: that each era's stated team averages actually satisfy the possession
identity they are used to derive, that a run sets its own era rather than
inheriting the last one, that turnovers are per possession and offensive
rebounds are a share of missed shots, that fouls and free throws are consistent
with one another, that the defensive glass responds to how well the schedule
shot, that no rotation player finishes with an impossible assist line, that a
non-shooter does not launch threes, that the defensive archetypes keep more of
their offence than a uniform ovr-neutralising shift would leave them, that the
rarest builds actually turn up, that rerolling one prospect moves exactly one
prospect, that a season on fourteen programmes still produces a champion, that a
pressing schedule forces more turnovers without swamping the height gradient,
that every team still finishes on the same number of games, and that a batch is
reproducible from its seed, and that `OVR_W` — the copy of BBGM's rating weights
that makes every archetype ovr-neutral — still matches BBGM's own formula, which
is derived numerically by finite differences rather than compared against a
second transcription of it.

Both run on every push (`.github/workflows/ci.yml`), along with a
headless-browser smoke test that loads a class, renders every tab, exercises the
editor, the range filters, the sort stack, the era switch, the efficiency dial
and batch mode, opens the three explain panels in the editor, clears a lock from
its badge, exercises undo and redo, and checks for console errors (reporting the
stack, not just the message).

`node tools/bench.js` times the staged pipeline, so the performance table above
is reproducible rather than quoted.

## Export

`Export JSON` writes `<original name>_customized.json`: the original file with each
player's `college`, ratings block (all 15 ratings plus `ovr`, `pot`, `pos`, `skills`),
`draft.ovr` / `draft.pot` / `draft.skills`, and `note` / `noteBool` updated. `pid`,
`face`, `born`, `relatives` and everything else are untouched (`hgt`/`weight` are
rewritten only when *Vary size* is on, a height or weight is locked by hand, or the
source file lacked them), and the file is written with a BOM the same way BBGM writes
its own exports (so is the CSV — Excel reads a BOM-less UTF-8 file as the system
code page, which turns Dončić into mojibake). Load it back with **Tools → Import → Draft class**.

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
js/colleges.js      368 colleges + 24 non-NCAA destinations and their clubs
js/config.js        defaults + presets
js/calibration.js   the era table: empirical anchors and the shifts to reach them
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
tools/bench.js      staged-pipeline timings, for the performance table
tools/golden.json   recorded output hashes
```

## Known limits

* A draft class is one season. Earlier seasons shown in a player's career panel
  are **reconstructed**, not simulated — the same way the recruiting ranking and
  the transfer history are — and nothing in the tool ranks on them.
* The recruiting ranking, transfer history and redshirt status are biography
  generated to fit the class. They shape the note and the award categories a player
  is eligible for; they are not read from the file, because BBGM does not store them.
* Where a prospect plays still moves his stat line, and it should: a good player
  on a bad team really does take more of the shots. But it no longer moves his
  MINUTES much, which is what was wrong. Measured over 891 simulated seasons,
  where a prospect plays correlates with his minutes at −0.18 and how good he is
  at +0.45 (it used to be −0.78 against +0.29), and with his scoring at −0.37
  against +0.48. `tools/validate.js` bands all four, plus the margin between
  them, so it cannot drift back.
* The scoring floor of the back of a class is still a little low. The bottom
  third of a class has a 10th-percentile scoring average around 9 points where
  the real figure is 10–11; the class-wide distribution is on its anchors, so
  closing the last of it means moving the tail without moving the mean.
* The professional side is thinner than the NCAA side. Clubs, tables, playoffs,
  cups and relegation exist; individual pro awards, international competitions
  and national-team summers do not.
* Below 700 pixels the prospect table becomes one card per prospect, because a
  forty-column table on a 390-pixel screen is a horizontal scroll however it is
  arranged. The settings panel is still desktop-first.
* `ovrRange` in the editor — the floor and ceiling a build can be solved to — is
  computed on the post-noise base ratings, so it is the range for **this roll**
  of the build noise, not an invariant of the player. Re-rolling him moves it.
