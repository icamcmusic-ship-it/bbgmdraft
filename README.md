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
Each player is assigned one of 121 archetypes (Floor General, Heliocentric
Guard, Movement Shooter, 3&D Wing, Point Center, Rim Protector, Stretch Big,
Lob Threat, Athletic Freak, Drop-Coverage Anchor, Boom-or-Bust Tools, …), gated by
their height so a 7-footer never becomes a point guard. The archetype pushes some ratings up and others down, then the whole
build is re-solved against **BBGM's own `ovr` formula** so the finished player comes
out at exactly the target overall. Specialising a player makes him lopsided, not
better.

Rarity weights span 0.34 to 3.6, so a Combo Guard is about ten times more likely
than a Point Center. The realised spread is wider than the authored one — pool
membership is a draw without replacement, which amplifies any weight difference —
but two fixes keep it a gradient rather than a cliff: the effective weight is
compressed in log space (down from a measured 281×), and pool slots are drawn on
the *authored* weights rather than the exposure-divided ones, which had quietly
inverted the table (the three centre builds gated at the top of the height range
each made a quarter of all pools while Iron Man almost never did). A class then
draws a **pool** of about seventeen of the 121 builds and takes its players from the pool — which is what makes a
class "the year of the stretch bigs" rather than one of everything, every time.
It also draws a **flavour** (guard-heavy, defence-first, a weak year,
one-and-done heavy, a transfer-portal year, …) that tilts which builds enter the
pool and, for some flavours, bends the class itself: how old it is, how good the
top of it is, how it got here. A flavour only moves settings you have left alone.

How much of a team's offence a build is given is **derived, not tabulated**. It
used to be seventy-two hand-fitted constants, two builds missing entirely
(Injury-Prone Talent silently scored 1.0 and came out the highest-scoring build
in the class at 24.3 a game) and twelve clipped at the fit boundary. What that
table was compensating for is a known quantity: BBGM's usage composite measures
shot-*making*, so a build that loads on `fg` and `tp` takes volume it was never
given and one that loads on `diq` and `reb` loses volume it never should have.
That is computable straight off the build's own offset vector, plus a
self-creation term and a small per-tag intent — and `tools/rolefit.js` fits it,
so adding a build no longer costs a constant. An unknown archetype now throws
under the test harnesses instead of scoring 1.0.

Every class is also given about four **forced anomalies**, drawn from
thirty-two kinds — a five-star bust, an unranked recruit who turns into a
lottery pick, a 24-year-old JUCO who took the long road, a 7'4" project, a
walk-on who ended up a draft pick, the coach's son, a man who never played a high
school game, a convert from another sport, a season that ended in February. The
prospect table lists them as the story of the class.

**3. Simulates the season those prospects played.** All 368 colleges are built
into a real landscape: program strength starts from each school's draft frequency
(Kentucky 116, Wagner 0.1) on a log scale, plus this season's conference strength (which drifts
from year to year rather than being a constant), plus a year of variance — flat
across the country, with a rare down year or breakout on top, so a blue blood can
actually go 17–15 — plus a **coach**, whose playing style (four-out and
three-heavy, pack-line, run and gun, inside-out, full-court press, lob city)
changes what his players' shot charts look like and whose development moves how
much better the team is in March than in November — and whose **situation** (first
year, an interim who took over in December, on the hot seat, a fixture) moves
that development, the team's form and its strength. Conference membership is a
per-run fact too: some years a realignment takes two to five good programmes one
rung up, and the schedule, the conference tournaments and the all-conference
teams follow it. Prospects are layered on alongside synthetic returning teammates — capped just
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

**A college role is not an NBA rating.** How much of a team's offence a prospect
gets is decided by how long he has been in the programme, what kind of player he
is, and a genuine independent draw — not by three multiplicative terms in his
overall rating, which is what it used to be. `classYear` appeared exactly once in
the stat model, to set a reserve-year probability, so a 22-year-old senior at a
mid-major taking 30% of his team's shots — the single most common profile of a
draft class's leading scorer — was a player the model could not construct. The
measured correlation between overall rating and college scoring was 0.72 on a
realistically shaped class; real draft classes run 0.25–0.35, because Zach Edey
outscored every lottery pick in his and Bronny James averaged 4.8. It is 0.44
now, and upperclassmen finish better and turn it over less.

**No player lands on a bound.** Two clamps used to hold about 29% of every class
between them: a soft usage floor whose asymptote collected 11.5% of a class on
one percentage point, and the lower bound of the personal usage ceiling, which
gave everyone below it the same number and then saturated them towards it.
Raising a clamp only moves the pile — setting the floor to 19.0% pinned a quarter
of the class on 17.1% — so the floor is the *player's* now, moving with his
talent and his role, both remaining bounds are softplus rather than clamps, and
the raw distribution above them is wide enough that they rarely bind. The
harness checks the histogram's shape directly, because no band on a mean or a
percentile can see a wall.

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
in a background worker with a progress bar and a cancel button. Up to five
batches can be held under names and compared in one table, so a sweep across
five values of a setting is one reading rather than four pairwise comparisons
that never meet.

There is a page for every programme (its coach, its style, its prospects, its
home/away split and every game it played), conference standings for all 32
leagues, and a side-by-side comparison of up to four prospects — two is a head-to-head, but tiering a position needs three or four. The editor explains
each player: where his stat line comes from, why he is where he is on the board,
and the seasons before this one. `?` lists the keyboard shortcuts — `r` rerolls,
`1`–`9` jump to a tab, `/` focuses the search, `l` locks the focused row, `[` and
`]` step through the class one build at a time — and Ctrl+Z undoes a reroll, not
only a setting. Below 700
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
| **Class flavour** (the dropdown) | Which of the 29 flavours this class gets, instead of drawing one. Asking for "big-heavy" used to mean setting the strength to 2 and rerolling until it came up — which replaces the class you were keeping the seed for. |
| **Flavour strength** | How strongly the flavour leans (guard-heavy, defence-first, a weak year, one-and-done heavy, a transfer-portal year, European in style, a post-up renaissance, feast or famine, a coaching carousel year, …). Some flavours also bend the class itself — how old it is, how good the top of it is — but only settings you have left at their default. |
| **Variation** | The neighbourhood of a seed. 0 is the class that seed has always produced. 1, 2, 3… keep its flavour, its build pool and its curve and re-roll every individual player, so the year is still "the year of the stretch bigs, weak at the top" and the sixty-eight men in it are different. Every shareable link ever made is variation 0, so none of them moved. |
| **Avoid repeating recent builds** | How hard a build that was in one of the last three classes is pushed out of this one. Measured, the four heaviest builds returned in 14% of pools with this off and 6% with it at full strength — the ordering the weights describe survives, the repetition does not. |
| **Builds per class** | How many of the 121 archetypes one class is drawn from. Lower is more distinctive ("the year of the stretch bigs"); 0 makes every build eligible in every class, which is one of everything, every time. |
| **Anomalies per class** | How many forced surprises a class gets, drawn from thirty-two kinds: a five-star bust, an unranked riser, a 24-year-old JUCO, a 7'4" project, the coach's son, a man who never played a high school game, a season that ended in February — and six that change the numbers rather than the note: a suspension, an eligibility hold that costs the first ten games, a mid-season transfer, a double-double machine, a defensive breakout, and a year-long shooting slump that costs about seven points of 3P% off what his jumper says. |
| **Realignment** | How often the map of college basketball changes. A realignment moves two to five good programmes one rung up, and every conference stays schedulable. |
| **Earlier seasons** | `Simulate` runs each of a prospect's previous college years through the same stat model the draft year goes through. `Reconstruct` is the older behaviour: a backward-scaled copy of the draft-year line. |
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
| **Hot and cold streaks** | How far a team's season wanders around its own rating. Every game used to be an independent draw, so a season had a trend and no shape — no five-game run that put a bubble team in the field, no 2-8 stretch after the best player went down. |
| **Events during the season** | A top-ten upset, the game of the year, a coach fired in January, a fourteen-game winning streak, a snowstorm postponement. All of them are read off results the simulation already produced, so none of them can contradict a box score. |
| **Draft-day events** | What happens between the last game and the pick: a medical flag, a workout riser, a team trading up, a late-first reach, a green-room slide. 0 leaves the board as a plain ranking. |
| **Voter disagreement** | How far the award voters stray from the arithmetic. The six player-of-the-year trophies have their own electorates, each weighting the team's resume differently — the coaches' and broadcasters' panels lean on it, the writers' lean away — scaled by a mood drawn once per class, so some years the argument is about the best player and some years about the best team. |
| **National / conference / abroad award strictness** | Three separate dials. This used to be one slider driving three different mechanisms. |
| **Archetype frequencies** | Per-build rarity weights for every archetype, grouped by guards / wings / bigs / any size with a ×2 and ×½ per group, and showing what share of the last generated class each build actually came out as. Searchable by name or by tag ("shooting" finds the twenty builds that shoot, not the one called it), and each group folds. Hover a name to see its offset vector. |
| **Note template** | Which lines are written into each player's exported note. |

Every control says which phases it re-runs, so a slider that costs 0.6 ms and one
that rebuilds the class are visibly different before you drag either.

Presets set several at once, and you can save your own; the dropdown says
"(modified)" once you change anything by hand, and lists exactly which settings
differ from the preset.

### The randomiser

The 🎲 **Randomise** button (shortcut `g`) draws new settings in the chosen
scope. *Everything, gently* draws a triangular distribution centred on each
setting's own default, reaching about a third of the way toward each end;
*everything, wide open* draws uniformly across each slider's declared range; the
remaining scopes randomise one fieldset (quality, builds, years, destinations,
season, awards). Every draw snaps to the control's step so the panel prints
clean numbers.

Three things it deliberately never touches:

- **The seed.** Reroll owns the seed; randomising both at once means you can't
  tell which produced what you're looking at.
- **The per-build rarity weights.** That is a curated 121-row table whose
  ordering is the authored intent, and a uniform draw over it destroys that
  invisibly. Flavour, pool size and diversity are randomised instead — those
  are the supported ways to move the mix.
- **Variation.** It is a seed-neighbourhood explorer, not a class property;
  randomising it does Reroll's job while making shared links confusing.

Destination weights are randomised *multiplicatively* off the built-ins, so a
randomised class is a different mix of the same twenty-four leagues rather than
a uniform one. A padlock next to each slider excludes that one setting from the
draw — "randomise everything except pace and era" is a click, not a wish. The
whole draw goes through one undo entry, so Ctrl+Z restores it in a single step;
there is no confirmation dialog, deliberately — the point is speed and undo is
one keystroke (Reset to defaults still confirms, because it is not a draw you
were iterating on).

---

## How to play

The in-app **Guide** button covers the same ground; this is the long version.

**1. Load a class.** Export a draft class from Basketball GM (*Tools → Export →
Draft class*) and drop the `.json` onto the page, or use *Load draft class…*.
Everything runs locally in your browser; nothing is uploaded. You can load
several files at once and switch between them in the header.

**2. Reroll until something catches your eye.** *Reroll* (`r`, or
Ctrl+Enter anywhere) draws a fresh seed: a new class flavour, a new build pool,
a new college season. The seed pill in the header identifies the class — click
it to copy the seed, shift-click to paste one in, and the dropdown beside it
remembers recent ones. *Re-apply* keeps the seed and re-runs the current
settings over it, which is how you tune sliders without losing the class you
liked. Ctrl+Z undoes a reroll like any other change.

**3. Shape the class.** Each fieldset in the settings panel is one idea:

- *Class quality & depth* shapes the overall curve — switch **Overall ratings**
  to "Rebuild the class curve" to unlock it; "Preserve" never inflates anyone.
- *Builds* decides how specialised players are, how many of the 121 archetypes
  one class draws from, the class flavour (pick one in the dropdown to keep the
  seed and change what kind of class it is), anomalies, and the pool memory
  that stops consecutive classes repeating themselves.
- *Class years & paths* sets how the class got here: freshmen, transfers,
  redshirts, reclassifications.
- *Players with no college* routes them across twenty-four real leagues and
  academies, weighted by where each player was born.
- *College season* is the era, pace, efficiency, injuries, upsets,
  realignment, streaks and mid-season events the class plays through.
- *Awards* controls how much hardware reaches the class and how much the
  voters disagree.

Every slider prints what it means in units underneath ("top prospect ≈ 48
ovr", "≈70 team points per game") and which pipeline phases it re-runs, so a
0.6 ms tweak and a full rebuild are visibly different before you drag either.

**4. Or let the dice do it.** See *The randomiser* above. Gently for "surprise
me a little", wide open for "show me something I wouldn't have set", one
fieldset when the rest is already right, padlocks for the settings that must
survive.

**5. Lock what must survive a reroll.** Open any prospect (Enter on a focused
row) and lock his overall, potential, archetype, school, name, height or any
individual rating; `l` locks the focused row as-is. Locks live outside the
seed, so you can reroll the class around a player you are keeping. Bulk
editing works from the checkbox column, and locks import/export as CSV.

**6. Read the season, not just the board.** The class plays a full college
season — standings, a bracket, awards, game logs, box scores, coaches, events.
A prospect's stat line, honours and draft stock all come from games that were
actually simulated, so every claim in the Notes tab is defensible from the
season tabs. The number keys `1`–`9` jump between tabs; `/` focuses the search.

**7. Compare, pin, and keep what you like.** *Pin* (`p`) keeps the current
class as a baseline the Compare tab measures against; the Compare tab also
holds up to four prospects side by side. *Save preset…* names your slider
setup; *Link* copies a URL that reproduces the exact class, settings and locks.

**8. Export back to BBGM.** *Export JSON* writes a draft class file BBGM
imports directly — every player is re-solved against BBGM's own `ovr` formula,
so what you see here is what the game computes. *More ▾* has CSV, season data,
locked prospects and the settings on their own.

---

## Rankings, selection and the AP poll

The postseason no longer runs on a scalar `resume` that read the sim's hidden
true strength. `js/rankings.js` derives everything from **observable results**:

- **Team value** — per-game credit weighted by opponent strength and location
  (a road win beats a home win; a home loss costs more), where opponent
  strength is itself derived from results by fixed-point iteration, not read
  off the rating.
- **Adjusted efficiency** — per-game margin, capped at ±10 like the real NET
  so blowouts don't pay, adjusted for opponent quality and venue by the same
  iteration.
- **NET rank** — a blend of the two, over all 368 programmes.
- **Quadrant records** — the standard Q1–Q4 map (home 1–30 / neutral 1–50 /
  away 1–75 is a Q1 game, and so on). With 368 programmes the real ~360-team
  thresholds transfer directly.
- **The committee** — selection and seeding score NET rank, Q1/Q2 wins, bad
  losses, road record, the last twelve games and head-to-head among the
  bubble. `CONFERENCES[x].bids` finally has a job: a sanity expectation the
  selection view reports against ("the SEC got 11 in"), never a quota.
- **The AP poll** — voted weekly by sixty persistent voters, each with a bias
  vector over record, schedule, quality wins, bad losses and an eye-test
  prior, submitting 25-deep ballots aggregated by the real points system.
  Ballots anchor on the voter's previous week, so a team doesn't crater after
  one loss. The preseason ballot runs on reputation; you get first-place-vote
  splits, "others receiving votes", a week-by-week table, movement arrows,
  and each team's peak/preseason/final rank on its page.

## News

The News tab replaces the four ·-joined event strips. `js/news.js` turns the
material the sim already produces into dated articles grouped by month, with
headline variants drawn deterministically from the class's own seed and
**every player and team mention a live link**. 28 distinct kinds, from
signing day and transfer-portal moves through the season and into the
draft: mid-season events, poll movement (a new No. 1, the biggest riser),
class flavour, a notable injury, a NET/AP-poll disagreement, conference
tournament champions (upsets first, then the power leagues), Selection
Sunday snubs and bid-count surprises, bracket upsets, a Cinderella run, the
Final Four field, the national championship, the NIT champion, the major
individual awards (Player of the Year, Freshman of the Year, Defensive
Player of the Year, the All-America team), the trophy the class lost to a
named returning player, a spotlight on the best player who wasn't draft
eligible, realignment, the anomaly stories, and draft day.

## Player pages, links and faces

Every player name across the season views — including every row on the
**draft board** — is a link to a real player page: stats, shooting, career
(the simulated prior seasons), honours, recruiting path, trajectory,
scouting note, and an edit button. Team pages gained NET, quadrant records
and the AP rank history. Back/forward work: player and team pages ride on
`pushState`. Portraits render with **facesjs** — the same
library BBGM uses, vendored as `js/vendor/facesjs.js` so the no-build-step,
open-off-the-disk property survives. A file's own `face` blob renders as-is
when it is complete (a partial or legacy blob falls back to a generated face
rather than drawing a portrait with no eyes in it), and the stored blob is
never mutated, so a face round-trips into the export exactly as it arrived.
A player without one gets a face generated deterministically from his key, so
it survives rerolls and reloads. Faces are drawn in the player's own
programme's kit — teammates match, schools differ — and always in a
basketball jersey: facesjs draws from every sport it knows, so left alone a
third of the class turned up in baseball and hockey shirts. No hats: the
"accessories" range is caps, headbands, eye black, a Santa hat and a
football facemask, and only a headband or nothing survives — a hat becomes
a house style the moment enough of the class is wearing one. Glasses are
curated the same way: three of facesjs's six styles render as an oversized,
reflective lens shape that swallows both eyes, so only the two that draw at
a normal scale (thin wire frames, bold rec specs) survive alongside none.

## Universe mode

Load several class files and run them as **one continuous world**, oldest
season first. Each season hands the next: conference membership (realignment
has memory — consecutive seasons can never move the same school in opposite
directions), programme strength (a breakout persists instead of being
redrawn; year-to-year level correlation ≈ 0.9), coaches (the same named man,
one year older, unless he was fired — then a named first-year hire replaces
him), the build-pool memory, and an **alumni index** of the names each season
sends forward. The Universe tab shows per-file diagnostics (a bad file is
rejected by name; the rest run), the timeline (champion, POY, No. 1 pick,
flavour, realignment, coaching changes per season), continuity threads
(repeat champions, programmes with multiple No. 1 picks), and the alumni
index. The export stores seeds and file fingerprints, not simulated output —
with the same files loaded, importing it replays the identical world.

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
| Award strictness | awards → stock → notes | 25 ms |
| Potential bias / spread | pot → awards → stock → notes | 24 ms |
| March upsets | postseason → stats → … | 143 ms |
| Pace, stat randomness | regular → postseason → stats → … | 269 ms |
| Specialisation, archetypes, seed | everything | 291 ms |

_Median of 9 runs on Node 22; a cold run of the whole pipeline is about 330 ms._
The numbers grew: the stats phase now also simulates each upperclassman's
earlier seasons (about 220 ms of the total, and `Earlier seasons: reconstruct`
gets it back), and every programme carries a coach with a situation and a
conference that may have changed.

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
node tools/validate.js 20 --fixture=realistic   # the default fixture only, twice as fast
node tools/test.js [--update-golden]       # regression tests
node tools/rolefit.js [nSeeds]             # re-fit the derived role-usage model
node tools/bench.js [reps] [--md|--json]   # staged-pipeline timings
node tools/uismoke.js                      # headless-browser smoke test
```

`validate.js` runs the full engine for **every era** and asserts the outputs
land near that era's anchors. The bands are *derived* from the anchor set rather
than typed in, because a band typed in by hand silently belongs to whichever era
it was written in.

**The fixture is the load-bearing part.** Every band used to be measured against
a class whose ratings were drawn from N(45, 13) — mean overall 45, half the
field at 45 or better, one player in a hundred under 30. No BBGM export looks
like that: a draft class is a ranked list, so a real one runs overall 20–55 with
a mean near 35 and a large low-overall mass. Every band passed on the synthetic
class while the same engine, handed a realistically shaped one, produced 12.7
points a game against an anchor of 14.6 and a quarter of the class under 9
points. The default fixture is now a draft-slot curve (`53 − 31·slot^0.8` plus
scouting noise); the old one is kept as a second fixture and rows are tagged by
scope, so prospect-facing bands run on the realistic class and whole-field and
structural ones run on both. Four groups:

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
  decided by his build rather than by how good he is, reported in points less
  the sampling error a sample that size carries anyway.
* **Shape**, because no band on a mean or a percentile can see a WALL. Two
  clamps used to pin about 29% of every class onto two usage values, which is
  what "the stats all feel the same" is from the inside, and every distribution
  band passed throughout. The busiest one-point usage bin is compared against
  what a smooth distribution of that width would put there.

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

The **More ▾** button next to it also exports the prospect table as CSV, the whole simulated
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
tools/rolefit.js    fits the derived role-usage model and reports per-build residuals
tools/test.js       golden-file, round-trip, determinism and property tests
tools/uismoke.js    headless-browser smoke test
tools/bench.js      staged-pipeline timings, for the performance table
tools/golden.json   recorded output hashes
```

## Known limits

* A draft class is one season, but the seasons before it are **simulated** for
  D-I prospects: the player re-solved to the overall he had then, carrying that
  year's class year, in a rotation rebuilt at his programme's level with the men
  he was behind actually on it. Pooled over three classes that runs 24.1 minutes
  and 9.4 points as a freshman against 31.3 and 15.7 in the draft year. Nothing
  ranks on them beyond the "was better as a sophomore" note line, and
  `priorSeasons: "reconstruct"` restores the old backward-scaled line.
* Depth that used to be missing and now exists: the AP poll is voted weekly by
  a persistent 60-member electorate; selection runs a committee model over
  observables (NET, quadrants, road record, stretch form) instead of peeking at
  the hidden team rating; star returners have names and take trophies under
  them; and in Universe mode coaches persist (a fired one is replaced by a
  named first-year hire), programme strength drifts continuously and
  realignment keeps its memory. In a single-class run, coaches and the map
  still reset between rerolls by design — a reroll is a different world.
* The recruiting ranking, transfer history and redshirt status are biography
  generated to fit the class. They shape the note and the award categories a player
  is eligible for; they are not read from the file, because BBGM does not store them.
* Where a prospect plays still moves his stat line, and it should: a good player
  on a bad team really does take more of the shots. But it no longer moves his
  MINUTES much, which is what was wrong. Measured over 1,162 simulated seasons
  on a realistically shaped class, where a prospect plays correlates with his
  minutes at −0.20 and how good he is at +0.43 (it used to be −0.78 against
  +0.29), and with his scoring at −0.12 against +0.44. `tools/validate.js` bands
  all four, plus the margin between them, so it cannot drift back.
* The scoring floor of the back of a class is still the softest number in the
  model. On a realistically shaped class the bottom third has a 10th-percentile
  scoring average near 7 points; the last ten men on the board average about 11,
  which is right, so what remains is the shape of the tail rather than its
  level. `tools/validate.js` bands both.
* The professional side is thinner than the NCAA side. Clubs, tables, playoffs,
  cups and relegation exist; individual pro awards, international competitions
  and national-team summers do not.
* Below 700 pixels the prospect table becomes one card per prospect, because a
  forty-column table on a 390-pixel screen is a horizontal scroll however it is
  arranged — and a card is the twelve fields a scout reads first, not the same
  forty stacked, because that is a taller version of the same problem. The
  layout control in the table bar overrides the width, and "all columns" opts
  back in to everything. Below 860 the settings panel becomes a toggle in the
  header rather than eight fieldsets between the user and the table.
* The pro-league side of the international pipeline is biography, not
  simulation. A prospect abroad carries a youth system, a first-team debut age,
  a loan spell and age-group national-team caps, drawn from the club and league
  he is actually in and from his own birth country when the file gives one —
  the international equivalent of the recruiting rank every NCAA prospect has.
  None of it is a season that was played.
* A mid-season transfer is modelled as the games he sat waiting to be cleared,
  plus the biography. He does not get a partial line at the school he left:
  that needs two rosters and two rotations for one player, which is a larger
  change than the anomaly is worth.
* The field's stars are synthetic. A returning player's talent was drawn from
  his programme's level and nothing else, so the best player in the country was
  by construction always somebody in the draft class and the national player of
  the year came out of the class in 100% of seasons. About a dozen **star
  returners** now exist across the 368 programmes — the excellent college player
  who is not an NBA prospect, which several of the 2024 consensus first-team
  All-Americans were — and the class takes the trophy in 80% of seasons and 2.4
  of the five consensus first-team spots instead. They are still a rate, not
  people: nothing gives one of them a name or a story.
* The professional side has no multi-year history: a prospect abroad still gets
  the reconstructed career panel rather than a simulated one, because there is
  no prior-year club roster to put him on.
