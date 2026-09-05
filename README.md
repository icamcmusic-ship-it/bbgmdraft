# BBGM Draft Class Workshop

A single-page, offline tool for reworking **Basketball GM** draft class files. Drop in
a `.json` draft class exported from the game, reshape it, look at the season it
implies, and export a file the game will read straight back in.

Open `index.html` in any browser. Nothing is uploaded and there is no build step.

---

## What it does

**1. Fills in the blank colleges.** Every prospect whose college is `""` (shown as
*None* in game) is sent somewhere real. There are thirty-seven destinations —
**EuroLeague**, the **NBA G League**, **Liga ACB**, the **NBL**, the **Chinese CBA**,
**LNB Pro A**, the **EuroCup**, the **Basketball Bundesliga**, the **Adriatic
League**, the **Basketball Champions League**, the **Turkish BSL**, the **Greek
Basket League**, the **Israeli Premier League**, the **Italian LBA**, the
**Lithuanian LKL**, the **VTB United League**, the **Polish PLK**, the **BNXT
League**, **Japan's B.League**, the **Korean KBL**, the **Philippine PBA**,
**Brazil's NBB**, the **Argentine Liga Nacional**, the **Mexican LNBP**, **Puerto
Rico's BSN**, the **Basketball Africa League**, the Canadian **CEBL**, **NBL1**,
the **New Zealand NBL**, **Overtime Elite**, the **NBA Academies**, **prep and
postgrad**, the **NAIA**, **JUCO**, **DII NCAA**, **DIII NCAA**,
and **did not play** — each with its own weight, and each weight scaled by where the
player was born, across seven regions. A Serbian leans EuroLeague and the Adriatic
League, an Australian leans the NBL, a Nigerian leans LNB Pro A and the Basketball
Africa League, a Canadian leans the G League and the CEBL, an Argentine the Liga
Nacional, a Korean the KBL. Every one of them has
its own pace, game length and youth minutes cap, its own clubs and league table,
and its own honors.

**2. Rebuilds ratings into varied, specialized builds — without inflating anyone.**
Each player is assigned one of 205 archetypes (Floor General, Heliocentric
Guard, Movement Shooter, 3&D Wing, Point Center, Rim Protector, Stretch Big,
Lob Threat, Athletic Freak, Drop-Coverage Anchor, Boom-or-Bust Tools, …), gated by
their height so a 7-footer never becomes a point guard. The archetype pushes some ratings up and others down, then the whole
build is re-solved against **BBGM's own `ovr` formula** so the finished player comes
out at exactly the target overall — an integer touch-up after the bisection
closes the last point when every rating crosses .5 at once, which on an
integer base it did for a third of Balanced players. Forcing the build a
player already drew, or pinning one rating, leaves every other rating exactly
where it was; both used to skip an RNG draw and re-jitter the rest. Specializing a player makes him lopsided, not
better.

Rarity weights span 0.45 to 3.6, so a Combo Guard is about eight times more likely
than a Point Center. The realized spread is wider than the authored one — pool
membership is a draw without replacement, which amplifies any weight difference —
but two fixes keep it a gradient rather than a cliff: the effective weight is
compressed in log space (down from a measured 281×), and pool slots are drawn on
the *authored* weights rather than the exposure-divided ones, which had quietly
inverted the table (the three center builds gated at the top of the height range
each made a quarter of all pools while Iron Man almost never did). A class then
draws a **pool** of about nineteen of the 205 builds and takes its players from the pool — which is what makes a
class "the year of the stretch bigs" rather than one of everything, every time.
It also draws a **flavor** (guard-heavy, defense-first, a weak year,
one-and-done heavy, a transfer-portal year, …) that tilts which builds enter the
pool and, for some flavors, bends the class itself: how old it is, how good the
top of it is, how it got here. A flavor only moves settings you have left alone.

The 205 names are 205 shapes. Measured by cosine similarity over the offset
vectors, the table used to hold 96 pairs above 0.85 and sixteen above 0.95 —
Rim Protector and Shot-Blocking Anchor were the same vector behind two height
gates — so a nineteen-build pool that looked varied by name still drew several
members of one cluster, which is what "every class feels the same" is from the
inside. Every pair above 0.95 was pushed apart on at least one axis that means
something (an Anchor is verticality and timing with poor conditioning; a Rim
Protector is mobile and rebounds; a Glass-Eating Center is slow and
ground-bound where an Undersized Rebounder is quick and springy), and
`tools/test.js` holds the whole table under 0.93 so it cannot re-converge.

That check compares a build to a build, and a build is a shape **and a size**:
a post-up guard gated at hgt 24-46 and a post-up wing gated at 40-68 have
near-parallel offset vectors and are never alternatives for one prospect, while
a pair sharing a whole height band and a vector genuinely is one build with two
names. So similarity is scaled by how much the two height gates overlap, which
is what lets the table hold ten shapes it did not have — the putback specialist
who cannot defend the glass, the floater guard, the lob target who cannot
rebound, the help defender who produces no steals or blocks, the big who cannot
shoot a free throw — without any of them being a rename of something already
there. The
nine genuine-center builds gated at hgt 72 and up used to be crowded out of
the pool by the thirty bigs gated at 52 — Shot-Blocking Anchor appeared once in
2,800 players — so a pool now always carries at least three of them, and a
seven-footer draws a build made for him about 40% of the time. Every other
class also reserves one slot for a build the weights never reach — Point
Center and Jumbo Playmaker had been drawn zero times in 2,800 players — and a
build with a biography has to fit the man's: "Fifth-Year Senior" is drawn only
for seniors and graduates, "Overseas Pro Veteran" only for a prospect abroad or
one who came back from a professional contract, and an Iron Man is never a
freshman.

How much of a team's offense a build is given is **derived, not tabulated**. It
used to be seventy-two hand-fitted constants, two builds missing entirely
(Injury-Prone Talent silently scored 1.0 and came out the highest-scoring build
in the class at 24.3 a game) and twelve clipped at the fit boundary. What that
table was compensating for is a known quantity: BBGM's usage composite measures
shot-*making*, so a build that loads on `fg` and `tp` takes volume it was never
given and one that loads on `diq` and `reb` loses volume it never should have.
That is computable straight off the build's own offset vector, plus a
self-creation term and a small per-tag intent — and `tools/rolefit.js` fits it,
so adding a build no longer costs a constant. The table is computed off the
*normalized* offsets the fit measures; it used to be computed off the raw ones,
so 97 of 131 builds ran on multipliers the fit had never seen, and the
constants have been re-fitted since. An unknown archetype now throws
under the test harnesses instead of scoring 1.0.

**So is the potential gap.** How far a build's `pot` sits above its `ovr`
used to be a second hand-authored table of 132 integers that had to be kept
in sync with the archetype list by a human. Fitted against that table, the
gap is legible: it is how much *finished skill* the offset vector loads (feel,
conditioning, the jumper, the handle — a build that already has them is
already what he is going to be) plus a per-tag intent (a raw build is a wide
bet, a shooting build a narrow one). Athletic tools turned out to carry no
weight in the authored table at all: upside was never "he can jump", it was
"he cannot yet shoot". The formula explains about two thirds of the old
table; where the rest was the build's *biography* rather than its vector (a
fifth-year senior, a pro veteran, a rehab case, a project) the build carries
its own `pot` on its own row, beside the offsets it belongs with. A build
also carries an **injury axis** the same way: `availability` already decided
who missed games and when, and nothing tied a build's rating profile to that
draw, so a brittle athletic freak and an iron man were hurt at the same
rate. An Injury-Prone Talent is now hurt about twice as often as the class
and an Iron Man half as often.

What the fit is fitted **to** matters as much as the fit. It used to be asked
to bring every build's scoring residual against the class's own ovr line to
zero, and it did — and the consequence was that a Score-First Point and a
Perimeter-Switch Five scored within a couple of points of each other at equal
rating, usage ran 22-28% across the whole table and the tags a coach reads had
been fitted to do nothing. Each tag now **declares** its intent in points at
equal overall (`ROLE_INTENT`: a scorer +1.6, a stopper -1.2, a rebounder -0.9,
a shooter +0.4), the fit and the harness both measure the residual against
that declaration, and only the *unintended* part of a build's bias is fitted
away. Specialization you cannot see in the box score is a label.

Two more things the composites could not see. BBGM's `drawingFouls` composite
reads hgt, spd, drb, dnk and oiq, and its `fouling` composite hgt, diq and spd
— neither reads ins, stre or ft — so a Free-Throw Merchant drew fouls at
exactly the class rate and a Foul-Prone Enforcer fouled like everyone else. A
build's own offset vector now feeds a free-throw-rate term (inside scoring and
strength are rim pressure; a free-throw shooter gets sent there on purpose) and
a personal-foul term (strength used without feel), centered on the table so the
class anchor does not move. Measured at specialization 1.5, the foul-drawing
builds run about five points of FTr above the rest and the Enforcer a third of
a foul a game above the class.

**And a trait layer, which is a second axis rather than a longer list.** An
archetype is a *shape*: what a player's rating vector looks like, and therefore
what his box score looks like. Everything else a scout writes down — how long
his arms are, whether he plays hard, whether he can finish with his off hand,
whether the knee is a question, whether he wants the ball late — is not a
shape, and the tool had no vocabulary for it. A note could say a prospect was a
Rim Protector at 6'11" and could not say he had a plus-seven wingspan, which is
the first thing any human being would have written about him.

`js/traits.js` is about seventy-seven traits in twelve groups (frame,
athleticism, motor, character, finishing, shooting, passing, defense,
rebounding, medical, background, role). Each states its prerequisites — a
height band, a class year, build tags it needs or must not have, and bounds on
the build's own offset vector — so a seven-footer is never "explosive first
step", a freshman is never a natural leader, a guard never has a broken
free-throw stroke, and a Rim Runner never has a step-back. Traits are drawn
after the anomalies rather than before them, so a 7'4" outlier's traits are
about the man he became. Each player draws
about three, at most one from each group, off his own key so they survive a
re-run.

A trait that reaches nothing is a label, so every one of them reaches four
things: a clause in the scouting note, an adjective the news can use, a BBGM
`moodTraits` letter on export (F, L, $, W — the tool wrote none of them before,
so an imported class arrived with whatever BBGM happened to roll), and for the
handful the simulation can express, a number: **volatility** (a per-player
multiplier on the game log's night-to-night spread, so two eighteen-point
scorers no longer produce identical-looking logs and "Streaky Volume Scorer" is
finally a statement about a distribution), the **offensive/defensive rebound
split** (a putback specialist and a box-out merchant have the same rebounding
composite and are not the same player), and the **injury roll** (a prior
surgery, a chronic knee and a clean bill of health were the same draw).

Traits are orthogonal to builds, which is the whole argument for them: 205
builds and 77 traits multiply rather than add. A Rim Protector with a plus
wingspan and a great motor and a Rim Protector with short arms and questions
about the effort are two different prospects out of one row of the archetype
table. *Scouting traits per prospect* turns the whole layer off at 0.

**A class flavor is about the players; a season narrative is about the season
they played.** Nothing was the second one, so across forty classes the *shape*
of a season was the same shape every time with different names in it. Each
class now draws two or three **storylines** — a dominant favourite, a wide-open
year, a mid-major surge, an attrition season, a scoring explosion, a defensive
slog, a chaotic sideline, chalk all the way — and each bends a handful of the
settings the season simulation already reads. They stack, and where two of them
want the same setting the last one drawn wins rather than the two being
averaged: "a wide-open year" and "chalk all the way" is a contradiction and
averaging two contradictions gives an ordinary season, which is the outcome
this exists to avoid. Measured over sixteen classes, the season-to-season
spread in team scoring is about twice what it is with storylines off. A
setting the user has changed is still left alone. A storyline's pace bend is a
*shift* on the slider — it was written as one and applied as an absolute, so
"a scoring explosion" set the season to minus four possessions, the floor
caught it at 58, and half of all default seasons played the slowest basketball
since 1952. `tools/test.js` now holds a storyline to a few possessions either
side of the default.

That last rule has an escape hatch now. A flavor moved only settings sitting at
their default — the right principle, and it does mean a user who has customized
the exact settings a flavor wants gets a flavor that does less. *Flavor reaches
settings you changed* is 0 by default (the principle absolute), and above 0 a
flavor may move a random subset of them and only part of the way, so an
injury-year flavor can still be an injury year on a config somebody has been
playing with.

Two more places sameness was leaking. The **anomaly** draw had no memory —
thirty-two kinds and four draws a class meant the same eight or ten turned up
in most classes — so it now avoids what the last few classes used, exactly as
the build pool does. And a **coach's style** was a fixed row of numbers, so
every "four-out, three-heavy" programme in the country ran the same shot chart
and ran it again the next season; the style now drifts a little per coach and
per season, about a third of the gap between adjacent styles, so a four-out
team never becomes a pack-line team but is not the four-out team down the road
either.

Every class is also given about four **forced anomalies**, drawn from
thirty-two kinds — a five-star bust, an unranked recruit who turns into a
lottery pick, a 24-year-old JUCO who took the long road, a 7'4" project, a
walk-on who ended up a draft pick, the coach's son, a man who never played a high
school game, a convert from another sport, a season that ended in February. The
prospect table lists them as the story of the class.

**3. Simulates the season those prospects played.** All 364 Division I programs are built
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
per-run fact too: some years a realignment takes two to five good programs one
rung up, and the schedule, the conference tournaments, the auto bid and the
all-conference teams follow it — all of them, which for a while they did not:
the schedule and the tournaments read the static table, so a program that
moved to the ACC played eighteen games in the American, won the American's
tournament and took its bid while every label said ACC. A league's slate is
its size now, too — two round robins, fourteen to twenty games — so a six-team
league no longer meets every rival four times, and the first round of the
bracket never pairs two teams from one conference. Prospects are layered on alongside synthetic returning teammates — capped just
below the best prospect on the roster, because a program that landed a draft pick
did not already have two of them. Injuries are drawn **before** a game is played,
so a man who misses fourteen games with a knee costs his team the games it would
have won with him.
Then **every one of the 364 programs** plays the same 31-game schedule, conference
tournaments, a 68-team national tournament and a 32-team NIT — with real scores,
overtimes, and teams a few points better in March than in November.

**March is calibrated, not merely plausible.** The bracket used to look right
(real scores, real upsets, real overtimes) while being systematically more
chaotic than the real one: measured over forty seasons, a 1 seed beat a 16 seed
92% of the time against a real 99%, 1 seeds won 23% of titles against a real
55-65% and filled a fifth of the Final Four against a real two fifths, while an
8-9 game was the coin flip it should be. The cause was the *top* of the
strength curve, not the upset slider: the best program sat about twenty
rating points above the sixty-fourth against thirteen points of game-to-game
noise, so "March upsets: 0 = chalk" could not deliver chalk on a gradient that
shallow. Team strength above the top-64 line is now stretched the way real
efficiency margins are (the gap between No. 1 and No. 16 is about as large as
the gap between No. 16 and No. 150), the game noise comes down to the eleven
points a real game carries, and `tools/validate.js` bands the seed-line win
rates, the champion's seed and the Final Four's composition — with a top as
well as a floor, because a curve steep enough for the same school to win every
year is the opposite failure. Measured over sixty tournaments per fixture, a
1 seed now takes 47-58% of titles and 31-45% of Final Four places against a
real 55-65% and two fifths. Those three rows are samples of size *nSeeds*
rather than of size *nPlayers* — a champion's seed is one observation per
tournament — so their bands are drawn at two and a half standard errors of a
twenty-tournament run rather than at a figure that looks tight and fires on a
coin. Forty classes still produce about 26 different
champions. The Distributions tab shows the same readings for one class and
batch mode shows them as a histogram, so the chalkiness of a March is on
screen rather than only in an audit script.

**Four things a final score now knows about the teams playing it.** The
scoreboard used to read one number — the class's pace slider — for every game
in the country, and three real properties of a basketball game were missing
from it.

- **Tempo belongs to the fixture.** `PROGRAM_STYLES` moves possessions from
  -4.5 (pack-line, grind it out) to +5.5 (press and trap), the *stat* model
  read it, and the scoreboard did not — so a run-and-gun team's players got
  more possessions in the box score while its games finished on the same
  totals as everyone else's, and the style a note named was a label on
  nothing a reader could see in a result. A game is played at the average of
  the two teams' tempos now, which measures out at a twelve-point spread in
  mean total between the fastest style and the slowest.
- **Home courts are not identical.** A flat 3.2 points for every building in
  the country is every arena holding the same crowd; the edge scales with the
  program, from about two points to four and a half.
- **The last minute is not a random walk.** A symmetric margin ties at the
  buzzer about 2.6% of the time and Division I goes to overtime in about six
  percent of its games. The difference is the endgame — a team down one to
  four fouls to extend it, a team up three defends the arc — and a game still
  within a possession now has a real chance of being level, which puts the
  overtime rate where the sport's is.
- **An overtime period is worth what five minutes are worth.** It was a flat
  six points a side, which is a fifth low for a forty-minute college game and
  a third low for a forty-eight-minute professional one; it comes off the
  same pace the regulation score did. Its *margin* is derived the same way —
  the expected edge shrinks in proportion to the time and the noise in
  proportion to its square root — where it used to be a hand-picked mean and
  a spread a third too wide, which made an extra period close to a coin flip
  whoever was in it. That matters more than it sounds: with a realistic
  overtime rate, a beaten favourite was getting a free re-draw six times in a
  hundred, and the seed-line rates `tools/validate.js` bands moved with it.

**And the first weekend of March is played in pods.** The top seeds open forty
minutes from campus in front of their own crowd while the 16 seed has flown
across the country, which is worth about a point and is a real part of why the
top lines almost never lose early. It is a *share* of a home edge rather than a
home game, it stops when the regionals move to neutral sites, and the game log
still records a neutral court.

**A game log is a box score, not a column of counts.** Every game carries
minutes and the shooting behind the points — FGM-FGA, 3PM-3PA, FTM-FTA — so
"best game" can say whether a 30 was 11-of-15 or a 28-shot night. The log
reconciles both ways: every game's points equal `2·(FGM−3PM) + 3·3PM + FTM`
from its own line, and the season's attempts and makes summed off the log
are the season line's (an exchange pass trades a three for a two and a free
throw inside a game, which is points-neutral, until the totals meet). The
night-to-night spread is a square-root law now rather than a share of the
average: the old `sd = 0.34·avg + 2.6` put a 27-point scorer at a per-game
SD of 13 against the 7–8 a real one carries, and over 47,000 sampled games
produced 43 nights of 50, eight of 60 and an 81. Fouls are tighter still,
because a man on four sits: the foul-out rate came down from 31% of games to
about 7%, against a class whose starters average three fouls a night.

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
are reconciled against free throws rather than modeled independently of them.
The stat line carries points, an offensive/defensive rebound split, assists,
steals, blocks, turnovers, personal fouls, contested shots, deflections, charges
drawn, a defensive rating, usage and the shooting splits — and it reconciles:
recomputing points from the attempts and percentages printed beside it returns
the same PPG. It also carries the playmaking and lineup side a modern box score
has: an **assisted rate** (how much of his scoring came off a teammate's pass —
the engine already computed a creation term for role purposes and never
surfaced it), a **transition share**, a per-game **plus/minus** read off the
margins of the games he actually played and an estimated **on/off**, and a
**close-game split** (his record and scoring in games decided by five or fewer
or in overtime). Every prospect has a **hand**, too; about one in nine shoots
left-handed, it is the first thing a scout writes after the height, and the
note says so.

**A college role is not an NBA rating.** How much of a team's offense a prospect
gets is decided by how long he has been in the program, what kind of player he
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

**Four more walls came down in this pass.** Personal fouls: BBGM's `fouling`
composite *rises* as a player gets worse, so a class's prospects sat at 0.60
on it against the 0.38 the field is synthesized at, fouled thirty percent more
per minute than their teammates and an eighth of every class was pinned on
the ceiling; the prospect term is compressed toward the field's reference now
and a starter fouls a little less per minute than the bench. The youth minutes
cap abroad is drawn per player around the league's number rather than being
a clamp 61% of capped prospects sat on to the decimal. Every program played
exactly nine men; it plays eight to eleven. And on/off was the noise term
alone — the margin scaled by floor time cancelled exactly against the team's
margin — so it carries a production-based impact term and correlates with
something. Two smaller ones: exported offensive rebounds are apportioned to
the season line rather than rounded night by night (a third of totals drifted
by more than two), and the advanced statistics normalize a forty-eight-minute
club and a thirty-two-minute prep team on their own clocks. The potential gap
also reads the class year the tool *rolled*: a BBGM file writes 19 for
everyone, so a rolled senior exported at 22 with a freshman's upside.

**Defense is modeled, not implied.** Every team has a defensive profile built from
BBGM's `defenseInterior` and `defensePerimeter` composites, and it is applied to the
opponents that team actually played: a conference full of rim protectors holds
everyone below their usual rim percentage, and a pressing team forces turnovers.

**Non-NCAA prospects get a real season too**, in their own environment. The G League
plays 48-minute games at 103 possessions — on the scoreboard as well as in the
box score, which used to run on the college pace slider and print a 120-point
club "winning 72-68" — its game logs are in date order, and a prospect abroad
carries no fabricated college seasons unless his biography put him at a
program; the EuroLeague plays 40 at 70; a
19-year-old at Real Madrid is capped at the minutes a 19-year-old at Real Madrid
actually gets. Each league has a club list, a table, a playoff with named rounds
(the EuroLeague's ends in a Final Four), a domestic cup, promotion and relegation
where it applies, and two-way contracts and loan spells where they apply. The
achievement layer on top of that scaffolding exists now: each league hands out
its own **MVP**, **first team**, **Finals MVP** and **cup-final MVP** on the
same production scale the youth awards use, with the bar raised by the
league's strength, and the top clubs of the domestic leagues play a
**continental competition** alongside their season — the EuroLeague, the
EuroCup and the Champions League for the European leagues, BCL Americas for
Brazil, the East Asia Super League for Japan, China and Australia — with a
result that reaches the note and, when the run goes deep, the honors.

**4. Writes a scouting note for every player.** It opens with one sentence a
scout would write — hand, size, class year, position, build, the number his
season was about, and what the jumper looks like — and then the lines you
choose under *Note template*: school/club and class year, how he got here
(recruiting ranking, transfer, redshirt, reclassification), team record and
postseason result, the stat line, shooting splits, advanced numbers, the defensive
line, the best single game of his season, season highs and streaks, postseason
splits, games missed and why, the archetype, honors, and his position on the draft
board. This goes into the player's `note` field, which BBGM displays on the player
page.

**5. Hands out honors — about a hundred distinguishable ones.** The six named
national player-of-the-year trophies (Naismith, Wooden, Oscar Robertson, AP, NABC,
Sporting News) each have their own electorate, so a clear best player sweeps and a
close year splits. Three national defensive awards, the five position awards (Cousy,
West, Erving, Duncan, Abdul-Jabbar), the Pete Newell, Lute Olson and Wayman Tisdale
awards, consensus All-America teams, NABC All-Defensive teams, NCAA All-Region
teams, the Final Four Most Outstanding Player, Academic All-America, NIT honors,
and per conference: Player, Defensive Player, Freshman, Sixth Man and Most Improved
of the Year, all-conference first and second teams, and all-defensive, all-freshman,
all-newcomer and all-tournament teams.

**And the team trophies, which nobody was carrying.** The bracket crowned a
champion, the conference tournaments crowned eight-and-thirty more, clubs
abroad won leagues and cups and continental competitions — and no player's
page said he was on any of them. A ring is not minutes-gated and it is on a
résumé for life, so every prospect who played a game for a national champion
carries *NCAA National Champion*, and the same for the runner-up, an NIT
champion, a conference tournament or regular-season champion, and a
professional league, cup or continental title abroad. They sort with the
honors they belong beside, they follow the export's award scope, and the
paper has a story for the champion's best prospect and for a prospect whose
club won a league.

**A player who stayed can win it twice.** An upperclassman's earlier seasons
are ranked too: each simulated year is measured against the bars this
season's field set — the score of the last man named to every honor — and a
sophomore season that would have made the first team this year is an
all-conference season on his record, at its own year. About a quarter of a
class's non-freshmen carry one, mostly all-conference and all-freshman rows
and the occasional All-America, so a two-time all-conference pick is a thing
the tool can produce and a one-and-done and a fourth-year senior no longer
finish with the same number of lines. They live beside the draft year's list,
never in it: the player page and the Awards tab show them under *Earlier
honors*, the note has a line for them, the export writes them as award rows
at their own seasons, and the paper has a kind for the repeat winner.

**The sideline has trophies of its own.** Every program's coach carried a
reputation "for Coach of the Year" and nothing ever voted. The Naismith, the
AP and the Henry Iba are voted against expectations — the season a program
had over the season its name and its coach's reputation said it would have,
each panel weighting the record, the surprise and the March run differently —
plus the Hugh Durham for the best season outside the power leagues, and a
Coach of the Year in every conference. The Awards tab lists them and the paper
writes the AP one up. A coach's **philosophy** reaches the box score now as
well: a stars-and-scrubs staff concentrates the offense in its best players
and an egalitarian one spreads it, a defensive-minded one forces a few more
turnovers. The philosophy was computed for every program and read by nothing
in the stat model. Coaches are also the age head coaches are — a median near
fifty rather than forty, so retirement is a thing that happens — and no two
programs share a head coach in one season.

There is a **finalist tier** as well as a winners' tier — Naismith finalists, the
Wooden Late Season Top 20, AP honorable mention, position-award finalists, a
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

There is a page for every program (its coach, its style, its prospects, its
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
| **Specialization** | 0 = BBGM's fairly uniform builds, 2.5 = extreme specialists. |
| **Archetype diversity** | Exactly `100 − v`% of the class stays Balanced. |
| **Class flavor** (the dropdown) | Which of the 41 flavors this class gets, instead of drawing one. Asking for "big-heavy" used to mean setting the strength to 2 and rerolling until it came up — which replaces the class you were keeping the seed for. |
| **Flavor strength** | How strongly the flavor leans (guard-heavy, defense-first, a weak year, one-and-done heavy, a transfer-portal year, European in style, a post-up renaissance, feast or famine, a coaching carousel year, …). Some flavors also bend the class itself — how old it is, how good the top of it is — but only settings you have left at their default. |
| **Variation** | The neighborhood of a seed. 0 is the class that seed has always produced. 1, 2, 3… keep its flavor, its build pool and its curve and re-roll every individual player, so the year is still "the year of the stretch bigs, weak at the top" and the sixty-eight men in it are different. Every shareable link ever made is variation 0, so none of them moved. |
| **Avoid repeating recent builds** | How hard a build that was in one of the last three classes is pushed out of this one. Measured, the four heaviest builds returned in 14% of pools with this off and 6% with it at full strength — the ordering the weights describe survives, the repetition does not. |
| **Builds per class** | How many of the 205 archetypes one class is drawn from. Lower is more distinctive ("the year of the stretch bigs"); 0 makes every build eligible in every class, which is one of everything, every time. |
| **Anomalies per class** | How many forced surprises a class gets, drawn from thirty-two kinds: a five-star bust, an unranked riser, a 24-year-old JUCO, a 7'4" project, the coach's son, a man who never played a high school game, a season that ended in February — and six that change the numbers rather than the note: a suspension, an eligibility hold that costs the first ten games, a mid-season transfer, a double-double machine, a defensive breakout, and a year-long shooting slump that costs about seven points of 3P% off what his jumper says. |
| **Realignment** | How often the map of college basketball changes. A realignment moves two to five good programs one rung up into a league whose footprint overlaps theirs — the database carries no state per school, so geography is a fact about the conference, and Tennessee State no longer lands in a New England league — and every conference stays schedulable. |
| **Earlier seasons** | `Simulate` runs each of a prospect's previous college years through the same stat model the draft year goes through. `Reconstruct` is the older behavior: a backward-scaled copy of the draft-year line. |
| **Build noise** | Per-rating jitter. |
| **Vary size** | Lets listed height and weight drift with the build. |
| **Freshmen / transfers / redshirts / reclassified** | Who is in what year, and how they got there. |
| **Destination weights** | Where blank-college prospects go, per league — grouped by region, each group collapsible with its own ×2 / ×½, because what anybody actually wants from thirty-odd number boxes is "more Europe". The grouping is derived from each league's own birthplace multipliers, so adding a league to `js/colleges.js` files it correctly with no second edit. |
| **Scouting traits per prospect** | How many traits from the ~77-row table each prospect carries (see above). 0 turns the layer off, along with the per-player volatility, the offensive-glass bias and the medical file. |
| **Avoid repeating recent anomalies** | The same memory the build pool has, one layer down. Thirty-two kinds and four draws a class is not enough separation on its own. |
| **Flavor reaches settings you changed** | 0 (the default) means a flavor only moves settings still at their default and never overrules a decision you made. Above 0 it may move a random subset of yours, and only part of the way. |
| **Universe mode** | Runs every loaded class file as one continuous world — see *Universe mode* below. It is a setting rather than a button because the button left every other tab showing a different world. |
| **Coaching turnover / realignment memory / star returners / transfer portal** | How much the sideline and the roster around the class change from one season to the next. Turnover at 100 moves 40–60 of the 364 head-coaching jobs a year, which is what Division I does. |
| **Season storylines** | Two or three macro storylines per class — a dominant favourite, a wide-open year, a mid-major surge, an attrition season, a chaotic sideline — each bending settings the season already reads. A class flavor says what kind of *players* the year has; this says what kind of *season* they played. |
| **Coaching style drift** | How far a coach's style wanders from its row and from last season. At 0 every "four-out" team in the country plays identical numbers, which is what it used to do. |
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
| **Archetype frequencies** | Per-build rarity weights for every archetype, grouped by guards / wings / bigs / any size with a ×2 and ×½ per group, and showing what share of the last generated class each build actually came out as. Searchable by name or by tag ("shooting" finds the twenty builds that shoot, not the one called it), filterable by the height a build is eligible at ("make this a rim-protector-heavy class" starts with the builds a seven-footer can draw) and by whether it is in the current class's pool, and each group folds. Hover a name to see its offset vector. The count and weight span in the hint are read off the table, not typed. |
| **Note template** | Which lines are written into each player's exported note. |

Every control says which phases it re-runs, colour-coded — green for
milliseconds, amber for a re-simulated season, red for a rebuilt class — so a
slider that costs 0.6 ms and one that rebuilds the class are visibly different
before you drag either.

Eighty-odd controls is more than anybody scrolls, so the panel has a **search
box** (matching labels, ids and hint text, opening the groups that match) and a
**show only what I have changed** toggle, which is the other question people
have of it — especially after a randomize.

Presets set several at once, and you can save your own; the dropdown says
"(modified)" once you change anything by hand, and lists exactly which settings
differ from the preset.

### The randomizer

The 🎲 **Randomize** button (shortcut `g`) draws new settings in the chosen
scope. *Everything, gently* draws a triangular distribution centered on each
setting's own default, reaching about a third of the way toward each end;
*everything, wide open* draws uniformly across each slider's declared range; the
remaining scopes randomize one fieldset (quality, builds, years, destinations,
season, awards). The scope is a row of chips rather than a dropdown, because the
button is one you press repeatedly and two clicks a press is one too many. Every draw snaps to the control's step so the panel prints
clean numbers.

Three things it deliberately never touches:

- **The seed.** Reroll owns the seed; randomizing both at once means you can't
  tell which produced what you're looking at.
- **The per-build rarity weights.** That is a curated 205-row table whose
  ordering is the authored intent, and a uniform draw over it destroys that
  invisibly. Flavor, pool size and diversity are randomized instead — those
  are the supported ways to move the mix.
- **Variation.** It is a seed-neighborhood explorer, not a class property;
  randomizing it does Reroll's job while making shared links confusing.

Destination weights are randomized *multiplicatively* off the built-ins, so a
randomized class is a different mix of the same thirty-seven leagues rather than
a uniform one. A padlock next to each slider excludes that one setting from the
draw — "randomize everything except pace and era" is a click, not a wish. The
whole draw goes through one undo entry, so Ctrl+Z restores it in a single step;
there is no confirmation dialog, deliberately — the point is speed and undo is
one keystroke (Reset to defaults still confirms, because it is not a draw you
were iterating on).

---

## How to play

The in-app **Guide** button covers the same ground; this is the long version.

**1. Load a class — or a whole league.** Export a draft class from Basketball
GM (*Tools → Export → Draft class*) and drop the `.json` onto the page, or use
*Load file…*.

A **league export** works too, and is usually what you want: drop the
`.json.gz` straight in. A BBGM league carries its next two or three draft
classes inside it as ordinary player rows with an undrafted tid and a future
`draft.year`, and the tool used to take exactly one of them — the year
matching the league's own season, which is the class already being drafted —
and throw the rest of the file away. It now loads **one editable class per
draft year**, which drops straight into the multi-file machinery: the header
picker lists them, universe mode runs them as one continuous world oldest
first, and *Export → Merge into a league file* offers to write all of them
straight back into the league they came from, without asking you to find the
same file on disk twice.

Everything runs locally in your browser; nothing is uploaded. You can load
several files at once and switch between them in the header. No export to
hand? *Try a sample class* loads a synthetic 70-man class — the same kind of
draft-slot-shaped fixture the calibration harness runs on, with names — through
exactly the path a real file takes, so every tab can be evaluated before
anything is exported from the game.

**2. Reroll until something catches your eye.** *Reroll* (`r`, or
Ctrl+Enter anywhere) draws a fresh seed: a new class flavor, a new build pool,
a new college season. The seed pill in the header identifies the class — click
it to copy the seed, shift-click to paste one in, and the dropdown beside it
remembers recent ones. *Re-apply* keeps the seed and re-runs the current
settings over it, which is how you tune sliders without losing the class you
liked. Ctrl+Z undoes a reroll like any other change.

**3. Shape the class.** Each fieldset in the settings panel is one idea:

- *Class quality & depth* shapes the overall curve — switch **Overall ratings**
  to "Rebuild the class curve" to unlock it; "Preserve" never inflates anyone.
- *Builds* decides how specialized players are, how many of the 205 archetypes
  one class draws from, the class flavor (pick one in the dropdown to keep the
  seed and change what kind of class it is), anomalies, and the pool memory
  that stops consecutive classes repeating themselves.
- *Class years & paths* sets how the class got here: freshmen, transfers,
  redshirts, reclassifications.
- *Players with no college* routes them across thirty-seven real leagues and
  academies, weighted by where each player was born.
- *College season* is the era, pace, efficiency, injuries, upsets,
  realignment, streaks and mid-season events the class plays through.
- *Awards* controls how much hardware reaches the class and how much the
  voters disagree.

Every slider prints what it means in units underneath ("top prospect ≈ 48
ovr", "≈70 team points per game") and which pipeline phases it re-runs, so a
0.6 ms tweak and a full rebuild are visibly different before you drag either.

**4. Or let the dice do it.** See *The randomizer* above. Gently for "surprise
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
A prospect's stat line, honors and draft stock all come from games that were
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

## Recruiting

Every NCAA prospect was recruited by somebody, and the tool used to be able to
say two things about it: a national rank and a star count. That is the box
score of a recruitment. The file now carries the recruitment.

- **A composite**, on the 247-style scale, derived from the national rank
  rather than typed — a star rating has four values and a rank has four
  hundred, and the number every recruiting argument is actually conducted in
  is the one between them.
- **A position rank.** "No. 2 point guard in the country" is a different
  sentence from "No. 23 nationally", and the model already knew where he
  plays.
- **Offers and a final list.** How many programs were in on him scales with
  his ranking, and the programs that call are the ones at his own level —
  centred on the higher of the school he signed with and the level his own
  ranking implies, so a top-five recruit who picks a mid-major was still
  being called by blue bloods rather than choosing between two other
  mid-majors. The cut is three to five schools with the one he picked on it,
  which is what makes "he chose us over Kansas" a sentence the tool can write.
- **When he signed** — the early period, the late one, or the spring, which
  is a real signal about how wanted he was.
- **The April all-star games** — McDonald's, the Jordan Brand Classic, the
  Iverson Classic — selected by national rank on a probability that falls
  away with it, because a recruiting rank is assigned *within* a high-school
  class and a flat cutoff over a four-cohort draft class handed the jersey to
  two thirds of it. Deliberately not written into the award list: these are
  high-school honors and the award model reads "All-American" as a Division I
  trophy.

All of it is drawn from the player's own key, so it survives a reroll of
somebody else and a warm phase skip. It reaches the player page, the note's
*path* line, and two stories in the paper — the recruitment that came down to
four schools, and the showcase circuit.

The aggregate every fan argues about is there too: **recruiting class
rankings** for all 364 programs, real signees plus synthetic ones, scored on
a 247-style per-recruit point value that decays with rank and has diminishing
returns after the top handful.

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
- **NET rank** — a blend of the two, over all 364 programs.
- **Quadrant records** — the standard Q1–Q4 map (home 1–30 / neutral 1–50 /
  away 1–75 is a Q1 game, and so on). With 364 programs the real ~360-team
  thresholds transfer directly.
- **The committee** — selection and seeding score NET rank, Q1/Q2 wins, bad
  losses, road record, the last twelve games and head-to-head among the
  bubble. `CONFERENCES[x].bids` finally has a job: a sanity expectation the
  selection view reports against ("the SEC got 11 in"), never a quota.
- **The AP poll** — voted weekly by sixty persistent voters, each with a bias
  vector over record, schedule, quality wins, bad losses and an eye-test
  prior, submitting 25-deep ballots aggregated by the real points system.
  Ballots anchor on the voter's previous week, so a team doesn't crater after
  one loss. The preseason ballot runs on reputation — prestige blended with a
  damped read of the program's level this season, the way a panel that has
  watched practice votes, so a roster that fell apart over the summer is not
  the preseason No. 1 (it was, in seven of thirty sampled seasons, and missed
  the tournament); you get first-place-vote
  splits, "others receiving votes", a week-by-week table, movement arrows,
  and each team's peak/preseason/final rank on its page.

## News

The News tab replaces the four ·-joined event strips. `js/news.js` turns the
material the sim already produces into dated articles grouped by month, with
headline variants drawn deterministically from the class's own seed and
**every player and team mention a live link** — the named star returners
included, who have a page of their own now. Within a kind, a raid of four
programs or a week of eight conference tournaments runs as one roundup
rather than eight near-identical blurbs; the dateline's year turns over in
January, where the calendar does, rather than mid-December; the recruiting
stories are about the men who signed this cycle rather than every five-star
on the roster; and a prospect story carries one concrete number from his
line. A headline that names a month or a class year is filled from the
article it sits on, so it cannot call a junior a senior. Which items run is drawn too:
of fifty-seven kinds, forty-two used to fire in every one of forty test
classes (the triple-double, the forty-point night, the overtime classic, the
scoring title, the stock riser and faller…), so the paper's table of contents
was the same every year and only the names changed. The load-bearing kinds —
the poll, the bracket, the champion, the awards, the draft — always run; the
notebook items are occasional, and `tools/test.js` holds the always-firing
share under a third. Around fifty distinct kinds, from
signing day and transfer-portal moves through the season and into the
draft: mid-season events, poll movement (a new No. 1, the biggest riser),
class flavor, a notable injury, a NET/AP-poll disagreement, conference
tournament champions (upsets first, then the power leagues), Selection
Sunday snubs and bid-count surprises, bracket upsets, a Cinderella run, the
Final Four field, the national championship, the NIT champion, the major
individual awards (Player of the Year, Freshman of the Year, Defensive
Player of the Year, the All-America team), the trophy the class lost to a
named returning player, a spotlight on the best player who wasn't draft
eligible, realignment, the anomaly stories, and draft day.

Eighteen more read things the season produced and nobody wrote up. A
national champion crowned a team and no prospect's page said he was on it,
so the champion's best prospect gets a story and so does a prospect whose
club won a league abroad — both off the championship honors described under
*Awards*. The rebounding, assist and shot-blocking leads existed in the
model and only the scoring title was ever printed. The game log already
carried a five-block night, a perfect night from the field and a game with
no turnovers in twenty-four minutes, and read none of them back. The rest
are season shapes: an unbeaten league run, a one-bid league's single team,
the country's most efficient high-volume scorer, the man who lives at the
free-throw line, a prospect who is a quarter of his team's points, a
transfer who moved up into a losing season, and — for the prospects abroad
— the national-team caps and the loan spell the development model was
already drawing.

**A hundred and thirty-nine kinds now, in three registers.** The material was always
there and the *writing* was the tell: one body template for most kinds, no
quotes anywhere, and every article in the same flat declarative.

- **Voices.** Wire, beat writer, columnist, analytics blog, local paper,
  timeline. A voice is a register, not a set of facts — it decides how likely
  an article is to carry a quote, whether it closes with a number or an
  opinion, and what the byline says. A class draws a *staff* of three to five
  rather than assigning voices independently, because a paper has a staff and
  the same bylines recur through a season.
- **Paragraphs.** A body is a lede plus, often, a paragraph drawn from a pool:
  the stat line, the efficiency behind it, the usage share, the season high,
  the team's record and résumé, the coach, the style, the draft stock, the
  scouting traits, a columnist's take. Five ledes and six second paragraphs is
  thirty articles, not eleven. The pool reads its facts back out of the article
  itself, so every existing kind got paragraphs without an edit at its own
  site, and a kind added later gets them without asking.
- **Quotes.** Forty-odd lines across seven situations, attributed to a coach,
  the player, an opposing coach or a scout in the building. Keyed on situation
  rather than on kind, because "we got beat by a better team tonight" is the
  same sentence whether the article is a bracket upset or a Tuesday in January.

And forty-five new kinds, as a **table** rather than as code: a kind whose
facts are one filter and a sort has no business being a block of plumbing.
Each row states what it needs, what it fills in, and at least three headlines
and three bodies — portal commitments, schedule releases, buzzer beaters, a
freshman's first twenty, twenty-rebound nights, road winless streaks, senior
night, bracketology, 15-over-2s, All-America snubs, combine measurements,
withdrawals, and a handful that only fire inside a universe. A row returning
"no story this year" is the normal case: a season does not have a 16-over-1 in
it, and a paper that runs one anyway is the machine showing.

The feed filters by kind (grouped), by team or player, and by "only my
prospects", which reads the prospect table's own filter so a filtered board and
a filtered feed agree.

## Player pages, links and faces

Every player name across the season views — including every row on the
**draft board** — is a link to a real player page: stats, shooting, career
(the simulated prior seasons), honors, recruiting path, trajectory,
scouting note, and an edit button. Team pages gained NET, quadrant records
and the AP rank history — the quadrant record drawn as a shape (segment width is
games played, the filled part the share won) and the rank history as an inline
sparkline, because "Q1 2-5 · Q2 4-3" and `[· · 18 15 11 9]` are the two formats
a reader cannot compare at a glance. **Every game in a schedule opens a box
score** for both teams: each prospect's own line, reconciled to his season
totals, so it cannot disagree with anything else in the tool. It deliberately
does not invent per-game lines for the returning players — their season
averages exist and their nights do not — and says so rather than filling the
space. Back/forward work: player, team and game pages ride on
`pushState`. Portraits render with **facesjs** — the same
library BBGM uses, vendored as `js/vendor/facesjs.js` so the no-build-step,
open-off-the-disk property survives. A file's own `face` blob renders as-is
when it is complete (a partial or legacy blob falls back to a generated face
rather than drawing a portrait with no eyes in it), and the stored blob is
never mutated, so a face round-trips into the export exactly as it arrived.
A player without one gets a face generated deterministically from his key, so
it survives rerolls and reloads. Faces are drawn in the player's own
program's kit — teammates match, schools differ — and always in a
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
directions), program strength (a breakout persists instead of being
redrawn; year-to-year level correlation ≈ 0.9), coaches (the same named man,
one year older, unless he was fired — then a named first-year hire replaces
him), the **named star returners** (a returning conference player of the year
who was a junior is a senior next season, on the same program, under the
same name, with a year of growth; a senior has left), the build-pool memory,
and an **alumni index** of the names each season sends forward. The coach-name
pool is 12,672 names deep, so a multi-season save does not start handing the
same man three programs. The Universe tab shows per-file diagnostics (a bad file is
rejected by name; the rest run), the timeline (champion, POY, No. 1 pick,
flavor, realignment, coaching changes per season), continuity threads
(repeat champions, programs with multiple No. 1 picks), and the alumni
index. The export stores seeds and file fingerprints, not simulated output —
with the same files loaded, importing it replays the identical world.

**The classes share rosters now.** A junior in the 2027 file was a freshman in
2025 and a sophomore in 2026, and until this he was not: each season was played
with its own prospects and synthesized returners, so the roster that would
carry next year's lottery pick as a freshman carried a made-up sophomore
instead, and the freshman-of-the-year race never had him in it. The chain runs
in three passes. First every file's **build phase** alone (class years,
colleges, transfers and builds are drawn there, from the seed and the pool
memory and nothing a season produces — so the preview is exactly the class the
full run builds later, and `tools/test.js` holds it to that). Then the seasons,
oldest first, each handed the later classes' underclassmen who were on campus
that year: on the school his transfer biography says, at the class year and
the overall he had then (the same arithmetic his own career page uses), as
real players — minutes, a stat line, a game log, and every honor the field can
win, so the 2025 Tisdale can go to a man whose draft is 2027. They never reach
the draft board or the export of a year that is not theirs; the team page
lists them under *From later draft classes*, the awards page names the class
they belong to, and the paper has a kind for it. Last, the seasons a player
actually played replace the ones his own file simulated for him alone: his
career table marks them ★ and links to that year, his earlier honors are the
ones he really took, and his note says so. The timeline counts the roster
spots each season filled from a later class.

**The chain is hard to break.** A universe used to be a chain of assumptions
about what would not change while it ran, and each of them is now a fact the
run records:

- **The config is frozen before season one.** Every season used to rebuild its
  config from the live settings, so a slider nudged during a forty-file run
  gave seasons 1–12 one world and 13–40 another, with nothing to say so. One
  config object is built at the start and handed down.
- **The seed is keyed on the file, not on the season number.** It was
  `baseSeed#season`, so two files both claiming `startingSeason: 2031` — which
  the file list already warned about — drew the identical seed and therefore
  the identical world. It is now the file's index, season and fingerprint.
- **Every season stores a fingerprint of what it PRODUCED**, alongside the seed
  and the file fingerprint, and the export names the `engineRev` that built it.
  Importing a universe replays it and compares the two: a season that comes out
  different is named ("season 2034 diverged") instead of being handed back as
  the same world.
- **Biographies are read.** The class year, redshirt, transfer path and college
  the export has always stored per player key are applied on import, so a
  shared universe replays the same *men* and not merely the same seeds. The
  field was write-only until now.
- **A gap in the files is time passing**, and so is a failed season. Five
  missing years used to age the world by one: coaches aged a year, program
  levels drifted one step, a senior star returner stayed a junior. The carry is
  now aged across the hole — coaches age and the oldest leave, levels regress
  toward the middle, class years advance and graduate out — and a season that
  throws does the same rather than freezing the world behind it.
- **There is a Stop button**, and the seasons already finished are kept.
- **Memory is bounded.** Past fifteen files the older results are dropped and
  rebuilt on demand from the config the chain recorded for each one.
- **Storage is budgeted.** A fifty-season timeline plus overrides was a
  plausible quota failure that took the settings down with it; the universe
  payload is capped, and if it still does not fit it is dropped rather than
  losing presets and pinned classes.

**Getting a universe into the game.** BBGM's draft-class import deletes
`stats` on every uploaded player, so a universe exported as a folder of
per-class files loses the thing the mode exists for. **Export universe players**
writes one BBGM players file for the whole world: every class at its own
`draft.year`, pids renumbered monotonically across the universe, awards deduped
on `{season, type}` at their own seasons, the multi-season statline each man
actually played, and `relatives` — father/son links between generations
twenty-odd years apart, which BBGM renders natively. Load it with
**Tools → Import players** and tick *include stats*. The seeds-and-fingerprints
export is still there (and the embedded variant is gzipped now, so a shared
universe is a file somebody will actually send).

**And the world means something.** Recruiting has momentum: a blank-college
prospect is recruited in proportion to the program's level, its banners and the
title it just won, so dynasties start recruiting like dynasties (the
*Recruiting momentum* dial, universe mode only). The paper reads the alumni
index, so a 2033 article can mention the 2027 player of the year and a
program's banner count. Every first-year hire is attributed to a head coach
working the season before, so after a decade a name has a **coaching tree**.
And the Universe tab carries a **records book**: all-time titles, title games,
seasons at AP No. 1, players of the year and No. 1 picks; the longest unbroken
run at No. 1; the best single season anybody had; a player of the decade; and a
hall of fame drawn from the alumni index. Continuity threads are structured
data now (`{kind, team, seasons, count, text}`), so a program in one is a link
to its team page rather than a word in a sentence.

`node tools/universe.js` is the harness that guards all of it: a three-file
chain run twice must produce identical rows, the same universe exported twice
must be byte-identical, the merged players file must survive both of BBGM's
import paths (reimplemented from its source) with nothing dropped, and the
timeline's player-of-the-year column and the alumni index must name the same
man. It runs in CI.

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
| Note template | notes | 0.2 ms |
| Award strictness | awards → stock → notes | 63 ms |
| Potential bias / spread | pot → awards → stock → notes | 60 ms |
| March upsets | postseason → stats → … | 297 ms |
| Pace, stat randomness | regular → postseason → stats → … | 406 ms |
| Specialization, archetypes, seed | everything | 446 ms |

_Median of 5 runs on Node 22; a cold run of the whole pipeline is about 550 ms._
The numbers grew: the stats phase now also simulates each upperclassman's
earlier seasons (about 220 ms of the total, and `Earlier seasons: reconstruct`
gets it back), and every program carries a coach with a situation and a
conference that may have changed. The September 2026 audit added to the two
heaviest rows again — a team's stat pool is anchored to the season it actually
played, the field's advanced block is computed on its own population, and the
schedule is balanced rather than drawn a game at a time — which is where a cold
run went from about 330 ms to about 550.

**`era` re-runs the season now, not only the stat model.** The scoreboard used
to multiply pace by one constant whatever era was selected, so a change there
invalidated the stats phase alone; it reads the era's own points per possession
since this pass, and a warm re-run that skipped the season left the box score
and the results page in two different eras. It is the amber row it always
looked like.

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
node tools/test.js [--update-golden]       # regression tests, tools/tests/*.js included
node tools/rolefit.js [nSeeds]             # re-fit the derived role-usage model
node tools/universe.js                     # universe determinism / idempotency / round trip
node tools/bench.js [reps] [--md|--json]   # staged-pipeline timings
node tools/uismoke.js                      # headless-browser smoke test
```

Both harnesses load **every module the page loads**, `js/news.js` and
`js/universe.js` included. They used to be left out, so nothing that ran in
CI ever read a News article's text, which is exactly how "a Arizona State
dunk" shipped. `test.js` now sweeps every generated note, article, season
event, draft-day event and anomaly story for the faults no reader should see
(a leaked `undefined`, a doubled space, a doubled full stop, an article that
disagrees with the word after it), and the one a/an rule every template shares
lives in `js/text.js`.

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
  per-stat distribution passed while a program's strength predicted a
  prospect's minutes two and a half times better than his own rating did.
  `corr(program level, MPG)`, `corr(ovr, MPG)` and the margin between them are
  banded directly, as is the scoring floor of the bottom third of a class and
  the worst archetype scoring residual — how much of a player's scoring is
  decided by his build rather than by how good he is, reported in points less
  the sampling error a sample that size carries anyway.
* **March**, because nothing banded it: the round-of-64 win rate on the
  1-16, 2-15, 5-12 and 8-9 lines, how often a 1 seed (and a 5 seed or worse)
  wins the title, the 1 seeds' share of the Final Four, and whether the first
  in-season AP top ten is drawn from the preseason top 25 — the last because a
  November ballot re-derived from two games once put a 2-0 Colgate at No. 2.
* **Shape**, because no band on a mean or a percentile can see a WALL. Two
  clamps used to pin about 29% of every class onto two usage values, which is
  what "the stats all feel the same" is from the inside, and every distribution
  band passed throughout. The busiest one-point usage bin is compared against
  what a smooth distribution of that width would put there.

Every band knows how many seeds it is being judged on. A mean's tolerance widens
as 1/√n; a per-class count or rate does the same; an extreme value's lower bound
falls with the sample, because the expected maximum of a small sample is smaller.
A rate with ONE observation per class — a champion's seed — also knows that it
can only take the values k/n, so its band carries one observation of slack at
each end: a bound of 0.65 on four tournaments means "at most two of four", and
rejecting three of four (0.75) at a true rate near 0.15 is arithmetic, not
evidence.
Bands only ever widen — they are modeling tolerances against an anchor, not
confidence intervals, so more seeds must not make them stricter. `node
tools/validate.js 3` and `node tools/validate.js 40` both pass, which is the
point: the documented invocation used to fail on sampling noise alone.

It also checks the documented per-player share ceilings against the team total, that
every program plays the same regular season, that a champion's record includes its
March run, that the schedule is in calendar order, and the award volume.
`--era=<name>` limits the run to one era; `--json` makes the results diffable in CI.

`test.js` also carries the September 2026 audit as checks: the game-log
spread (40-point nights under one game in five hundred, foul-outs under 10%,
a 20-point scorer's per-game SD between 4.5 and 9), the shooting identity in
every game, recruiting ranks unique within a recruiting class, the preseason
No. 1 making the tournament, December and January on the right side of New
Year, signing-day stories about freshmen, headline/body agreement on months
and class years, number agreement ("1 triple-doubles" is a fault the text
sweep now sees), a derived potential gap for a build that has no table entry,
the injury axis, geography-aware realignment, the college aliases and the
sample class.

The second round of that audit is in **`tools/tests/`**, one file per area —
`ratings`, `sim`, `awards`, `export`, `ui` — each exporting
`function (ok, V)` and picked up by `test.js` by being on the disk. `test.js`
had grown past four thousand lines with every pass appending to the same end
of it, which is also how two people auditing at once collide on a file
neither is really editing. A new area's checks are a new file; nothing has to
be threaded through the harness to run them.

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
non-shooter does not launch threes — the system he plays in and the shot-mix
noise are both scaled by how willing a shooter he is now, because a four-out
program does not turn a seven-footer with a three-point rating of 25 into a
shooter, it gives his shots to somebody else — that the defensive archetypes
keep more of their offense than a uniform ovr-neutralizing shift would leave them, that the
rarest builds actually turn up, that rerolling one prospect moves exactly one
prospect, that a season on fourteen programs still produces a champion, that a
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

The round trip is clean for stats rows as well as honors: a college row (tid
`DOES_NOT_EXIST`) in the draft year or the five before it is this tool's from
an earlier export and is replaced rather than appended — three exports used to
give a player two, four and six rows. A class pulled out of a full league
export goes back out as a class (`version`, `startingSeason`, `players`) rather
than as the whole league envelope with most of its players deleted, a stats
row carries the player's own jersey number, and a rating row without a
`season` or `fuzz` gets one. The sample class is shaped like BBGM's own export
(tid −2, an empty draft slot, a season on the rating row). A file whose
players' `draft.year` disagrees with its `startingSeason` is warned about, and
a birth year after the season is refused.

### The college statline

The **More ▾** dialog's *college statline*, *prior seasons* and *season highs* options
write the simulated season — Division I or not: a prospect at Real Madrid or in
Stockton gets his club's season as a row too, at his league's game length — into
each player's `stats` as **complete Basketball GM season rows** — every one of the 74 keys the game's own `addStatsRow` writes, in its
order: the counting stats, the three-zone shot chart (`fgAtRim` / `fgLowPost` /
`fgMidRange` and their attempts), `minAvailable`, blocked shots against, the
double-double / triple-double / five-by-five counts, all 18 derived statistics (PER, EWA,
the percentages, ORtg / DRtg, win shares, BPM, VORP) and the season highs. See
`js/bbgmstats.js`, which transcribes the schema and every advanced-stat formula from
BBGM's source rather than approximating them; the derived numbers are computed over the
whole simulated field at once, because PER is normalized against the league average and
BPM adjusts to the league average team.

Two details worth knowing:

* **A season high is `[value, gameId]`, not a number.** The game id points at a game
  that does not exist in the league you are importing into — the season was played by
  this simulator, not by BBGM — so it is a stable negative number that can never collide
  with a real game. The value, which is what every table shows, is exact and comes out of
  the same game log the totals were summed from.
* **`tid` is `-7`** (`PLAYER.DOES_NOT_EXIST`, rendered "DNE"), which is what BBGM itself
  stamps on stats rows imported from another league — a college program is not a team in
  your league.

**Which import you use decides whether any of it survives**, and the usual one throws it
away. Confirmed against BBGM's own source, all three routes in:

| Route | Statline | Awards | Season's team | Replaces the class |
| --- | --- | --- | --- | --- |
| **Draft → [year] → Import** | **No** | Yes | — | Yes |
| **Tools → Import players** (*Players file* export) | Yes | **No**, but see below | Always **DNE** | No, it adds |
| **Create New League → upload** (*Merge into a league file* export) | Yes | Yes | DNE | Yes |

Each of those is a fixed fact about BBGM's own import code, not a preference:

* `handleUploadedDraftClass` — the **Draft → [year] → Import** button — runs `delete p.stats`
  on every uploaded player before it reads anything else. No file can carry a statline
  through that button; awards and notes survive because that function never touches them.
* `importPlayers` — **Tools → Import players** — is the mirror image. It builds each
  imported player from a fixed list of fields: `stats` is on the list, `awards` is not.
  So the export writes a player's honors into his **note** as well whenever they are
  exported (the note *is* on the list, guarded by `noteBool`) — the honors line survives
  even when the note template drops it. That function also does
  `row.tid = PLAYER.DOES_NOT_EXIST` on every imported stats row before saving it, so the
  season's team reads "DNE" in the table no matter what the file said — a college
  abbreviation cannot be put there from outside the game.
* A league file is the game's own save format and keeps all of it.

The **Players file** export writes what `importPlayers` wants: `version`, `startingSeason`
and `players`, each player stripped of the fields BBGM's own player export strips, every
player marked `tid: -2` so the class arrives as a draft class. It deliberately does **not**
write `exportedSeason`: the Import players screen uses that field to guess a player's team
from his stats row for that season, that row's team is DNE here, and the guess fails into
"free agent" — without the field the screen reads his own `tid` and gets it right.

The draft year the merge works on comes from the **players being merged**, not from the
file's `startingSeason`: BBGM writes a class a year ahead with `startingSeason` on the
current season and `draft.year` on the draft, and matching on `startingSeason` used to
delete the league's *current* class as "the one being replaced" while appending the merged
class beside the real one. Whatever happens, everyone who is not a prospect of that draft
year comes out the other side — the merge counts them and refuses to write a file that
lost anybody.

More than one class can go into one league file in a single pass: with several class files
loaded, the merge asks which ones (all ticked), and each replaces the generated class for
its own draft year. Players an earlier class in the same merge wrote are protected from the
next one's sweep, and two classes for the *same* draft year are refused rather than one
silently winning.

Gzipped league files (`.json.gz`, which is how BBGM exports a big save) are accepted
anywhere a `.json` is — the gzip magic number is checked rather than the extension, and the
browser's own `DecompressionStream` unzips it.

The merge matches by `pid`, and only onto a player who is himself an undrafted prospect of
the same draft year — a class exported from a different league has pids that mean other
people, and those players are appended with fresh pids instead of overwriting anybody. It
is an overlay, not a swap: the league's own player object is the base (his `value`,
`contract`, `statsTids`, `moodTraits` and the rest survive) and only what the tool
produced goes on top — including his own `awards` and `injuries` at seasons this tool
does not write. A pid match is an identity only when the name agrees, an appended
prospect is written as an undrafted one (round 0, pick 0), the older `UNDRAFTED_2`
/ `UNDRAFTED_3` tids are recognized, and a league already past the class's draft
year is warned about. `tools/test.js` covers all of it.

The **More ▾** button next to it also writes the players file and merges the class into a
league file (both above), exports the prospect table as CSV, the whole simulated
season (records, bracket, awards, draft board) as JSON or CSV, the season as a
**BBGM-shaped league fragment** (`teams` and `teamSeasons` in the game's own
field names, one conference per college league, plus a `coaches` block this tool
defines — no players and no schedule, so it is a fragment to merge rather than a
league to load), the note text alone for a spreadsheet, and imports locks back
in from a CSV so a round trip through a spreadsheet works.

If you load several seasons at once, `Export all` writes each of them.

## The interface

The tool opens on the **Draft board**. The question a draft class answers is
"who is good, and in what order", and that is the board — the forty-column
editable spreadsheet is the power tool, not the front page, and opening on it
put the thing everybody came to look at behind a scroll. The prospect table is
still one click away and always in the same place: a **Player Edit** toggle on
the board itself, which is where you go to filter, sort, add columns, lock
ratings and open the editor. It is not a separate destination any more,
because it was never a separate thing — it is the same class, in edit mode.

The tab bar is a segmented control rather than a row of underlined links, so
the page you are on is a shape and not a two-pixel line, and the header's
small tools — undo, redo, pin, link, guide, shortcuts — are icon buttons
beside the two verbs that matter (*Reroll* and *Export*) rather than eight
equally weighted labelled buttons that read as one undifferentiated bar. The
settings panel closes at every width, on a desktop as well as a phone, and
hands its column back to the table when it does.

## Layout

```
index.html          UI shell
css/style.css
js/text.js          a/an, sentence endings, and the text-fault sweep every template shares
js/rng.js           seeded RNG (mulberry32) + distributions
js/bbgm.js          BBGM's own rating formulas, reimplemented
js/colleges.js      364 D-I programs + 37 non-NCAA destinations and their clubs
js/config.js        defaults + presets
js/calibration.js   the era table: empirical anchors and the shifts to reach them
js/ratings.js       archetypes, class flavor, potential and the ovr-preserving solver
js/teams.js         program strength, styles, rosters, schedule, conference tournaments
js/stats.js         minutes, usage, the stat line model, defense and game logs
js/tournament.js    AP poll, selection, seeding, the 68-team bracket, the NIT
js/awards.js        national / conference / tournament / pro honors
js/engine.js        the staged pipeline, pro leagues, note text and file export
js/sample.js        the synthetic class behind "Try a sample class"
js/batch.js         what a batch run measures (shared with the worker)
js/worker.js        batch mode off the main thread
js/views.js         the tab views
js/app.js           state, settings, editing, persistence, export
tools/validate.js   calibration bands against the empirical anchors
tools/rolefit.js    fits the derived role-usage model and reports per-build residuals
tools/test.js       golden-file, round-trip, determinism and property tests
tools/tests/*.js    one suite per area, loaded by test.js off the disk
tools/universe.js   universe determinism, idempotency and BBGM round trip
tools/uismoke.js    headless-browser smoke test
tools/bench.js      staged-pipeline timings, for the performance table
tools/golden.json   recorded output hashes
```

## The audit pass of September 2026, second round

Six areas were audited against the running tool rather than against the prose
here — the build and trait layer, the season simulation and the advanced
block, the awards and the paper, the file the game reads, the databases
underneath all of it, and the page itself in a browser. What each one found,
and what changed, in its own words.

### Builds, traits and the pool

A size anomaly used to change a prospect's height, re-solve his ratings and keep
the build he already had, and every build in the table is gated on a height
band. Measured over thirty classes, five of the six physical outliers ended
outside their own build's gate: a Shot-Blocking Anchor (min hgt 76) at 5'8", a
Movement Shooter (max 56) at 7'4". The label in the table and the rating vector
beside it were describing different players, and everything downstream that
reads the build — the potential model, the role-usage term, the trait gates —
was looking at a build that prospect could not have had. The anomaly now redraws
the archetype when the new height puts the old one out of band, from the same
pool and with the same weights the build phase used; a build the user locked is
left alone. Zero of the outliers in twenty-four classes are off-band now.

Two silent NaN paths are closed. A source file whose last ratings row carried no
`ovr` or `pot` made the ovr-to-potential gap NaN, and that NaN reached
`ratings.pot`, `draft.pot` and the displayed potential of every player in the
class — `validateLeagueFile` checked the fifteen rating keys and had never
checked those two. Overall is now recomputed from the ratings when it is
missing, potential defaults to ten points of room, and the load warns that the
gap those players were meant to carry is gone. Separately, a non-numeric
`archetypeDiversity` (a string out of a URL or localStorage) turned every
archetype weight into NaN, and the weighted draw then handed back the first
eligible build — every player in the class came out Balanced, with no error
anywhere. It is coerced now.

The normalizer that makes a build ovr-neutral used to reverse the sign of small
authored boosts: Matchup-Zone Defender's `stre +4` became -2.25, Wing Stopper's
`+6` became 0, Point-of-Attack Menace's `+6` became -0.25. The editor's tooltip
reads the authored vector, so the one place a user can see what a build is FOR
disagreed with what the solver did to it. The subtraction now runs in passes: a
rating authored positive is floored at zero rather than pushed through it, the
ovr the floor leaves unspent comes out of the ratings the build did not author
positive, and it repeats until the vector is neutral again. Sign flips across
the whole table went from four to zero, the worst residual push is 0.10 against
a 0.35 tolerance, and the usage-composite protection the normalizer already had
is untouched.

Three things about the class pool were not what the label said. The pool size
was a lie by two to four every class — the rare slot, the three guaranteed
centre builds and the height-band probes were all added on TOP of the number,
so "19 builds per class" realized 20-23 and the one flavor whose whole identity
is a small pool (three-and-D only, which asks for 8) got 10-12. The guarantees
now come out of the budget, and the pool is exactly the size asked for; the
default moved from 19 to 21 so the realized size is what it always was. The rare
slot filtered on the authored weight and so read straight past a build the user
had zeroed — one made the pool in 23 of 40 classes, spending the slot meant for
a rare build on one that had been switched off; it filters on the effective
weight now, and 0 of 40. And the guaranteed slots ignored the pool memory
entirely, because a guarantee is not a weighted draw: Shot-Blocking Anchor sat
in 28-31 of 60 consecutive pools at every memory setting. The guarantees now
rotate away from the last class's builds, and consecutive-class pool overlap
fell from 0.10/0.08/0.06 to 0.09/0.05/0.03 at memory 0/0.6/1.

Variety, measured over 2,100 players in thirty classes. A build with no height
gate is eligible for everybody, so once it made the pool it owned the class:
Athletic Freak turned up 50 times and Raw Project 43, while a gated build that
made a pool drew 0 of its 47 eligible players. A class now counts its own draws
and halves a build's weight past six of them — the largest single build count
fell to 40 — and inside the top ten a build already used up there is quartered
per use, which took classes with a duplicated build in the top five from 12 in
30 to 5. Five builds were never drawn at all across those thirty classes; three
are now. On the trait side, four heavy rows were taking the one-per-group rule
as a clear run at every player: "clean medical" landed on 10.1% of all
prospects, two and a half times the median trait. Capping the drawn weight at
1.6 takes that to 7.3% and the max/median ratio from 2.52 to 1.76. Drawing the
group first and the trait inside it was the other candidate and measured worse —
rebounding has four traits and three are height-gated, so a flat group draw
handed "chases his own miss" one draw in twelve and 307 appearances. Flavors can
now tilt the trait groups as well as the build mix (`traits: {group: mult}` on
nine of the twenty-nine): the year everybody got hurt goes from 21% of the class
carrying a medical trait to 40%.

Traits had prerequisites about height and class year and none at all about the
build's own shape, so "genuinely strong" was drawable on nineteen builds
authoring stre -8 or worse (Toughness Question at -22), "explosive first step"
on thirty-eight with spd -8 or worse, "chronic knee" on Iron Man, and
"maxed-out frame" on a senior built as a Frame to Fill Out. They are gated on
the authored offsets and on the build's injury multiplier now, and the
undocumented `minInj`/`maxInj` fields are written down in the header where the
rest of the prerequisites are.

Finally, four smaller things. `solveToOvr` and `ovrRange` read only the KEYS of
the pinned vector and never its values, so asking for tp 100 came back with tp
45 for every caller that had not already written the pin into the base. Pinning
all fifteen ratings replaced the class's target overall with whatever those
ratings came to, and said nothing; it reports now. The room-scaling that keeps a
build's negative offsets off the 1 floor only ever bit at specialization 1,
where it was measured — at 3 the cut is three times the size and the room is the
same, and 6.2% of a class's ratings sat on exactly 1, a vector with no shape
left in it. The scaling now carries the whole cut and the solver's downward
shift eases onto the floor over its last ten points instead of driving through
it; the floor share at specialization 3 is 1.9% and at 1 it is 0.09%, and 35% of
a 70-man class's ratings move by an average of 1.2 points. Two guard builds were
tagged in a way their own gates contradicted (Sharpshooter runs to 6'8" and
Slasher to 6'9", and neither could be reached by a wing-leaning flavor); both
carry `wing` now.

One thing was left for the UI: `archetypePool` was clamped at 60 against a
205-build table, so the documented "a size at or above the table turns the pool
off" could not be said. The clamp is the table size now, but the slider in
index.html still stops at 40.

### The season, the scoreboard and the advanced block

#### A team's points existed three times and none of them agreed

The stat pool summed its rotation to one number, `teamBox` summed the same
lines to a second, and js/teams.js had already played thirty-one games whose
final scores said a third. Over 3,640 team-seasons the box said 73.4 points and
the season the team actually played said 70.6; 1,231 programs differed by more
than five points and the worst was off by twenty-one, which is a box score and a
results page describing two different teams. Worse, everything that is a
DIFFERENCE between the two inherited the gap: net rating, plus/minus, on/off and
both team ratings all read the model's offense against the scoreboard's defense,
so the country netted +3.6 points per hundred possessions on a true margin of
-0.19.

Two things were wrong. The scoreboard multiplied pace by a hardcoded 2.06
whatever era was selected — one number for a modern game anchored at 73.6 points
on 67.4 possessions (2.184 a possession pair) and for 2009-2021 at 70.0 on 68.5
(2.044) — so switching era moved the stat model and left the scoreboard where it
was, and both eras scored about 70. It reads the era's own anchor now. And the
stat pool answered to nothing outside itself; after reconciliation it is scaled
by one factor per team so the rotation's points are the points the team actually
scored. One factor, not a per-player fit: the SHARES are the stat model's answer
and were never in question, only the total. Measured after: the box and the
scoreboard agree to 0.05 points on average, three teams of 2,184 differ by more
than five, the two eras score 75.4 and 70.6 against their own anchors, and the
country's mean net rating is -0.36 against a true margin of -0.19.

#### Box plus/minus, and an on/off that reached +295

The exported advanced block was never banded, and it showed. On/off ran from
-217 to +295 points per hundred possessions with a 99th percentile of +117,
against a real college range of +10 to +20 and an extreme near +25.

Three separate faults stacked. The impact term added to a player's plus/minus
was not zero-sum over the rotation — five men are on the floor for every point
of a team's margin, so a term that is positive for good players and negative for
nobody hands the team more margin than it won, and BBGM's on/off reads the
surplus off the off-court minutes, of which a starter has about nine a night.
The term was also on a per-GAME scale in a formula that amplifies by
1/(share × (1-share)) — six times for a thirty-minute starter and seventeen for
a thirty-seven-minute one — so five points a game of impact is fifty points of
on/off. And an earlier season's opponent column was built from the FIELD's
average points rather than from the margin that season was played to, so a prior
year's on/off was measured against a team nobody played. The impact term is now
defined per hundred possessions, bounded there, and centred on the rotation's own
production; the per-night plus/minus noise is recentred so the SEASON number is
exactly the margin he was on the floor for plus his impact; and a prior season
carries its own margin. On/off now runs -18 to +45 with a 99th percentile of
+26, and per-game plus/minus tops out at +24 rather than +30. EWA was also
normalizing every club on the run's nominal forty minutes instead of its own, so
a G League season's value over replacement was out by as much as 1.6 wins; the
other identities were already exact (VORP to 1e-16) and win shares sum to 1.04
times the wins there were.

#### Walls, blocks, and where a game is played

A hard ceiling does not remove the players who would have gone past it, it
stacks them on it: 245 lines of 33,617 finished with exactly 3.90 personal
fouls, 639 sat to the decimal on the per-40 rebounding cap and 319 on the
blocked-shot share cap. Every one of those ceilings bends now — above a knee the
curve saturates toward the limit instead of arriving at it — and the largest
group sharing one value in the top decile of any of them is under 0.3%. Blocks
had a second problem: the national leader averaged 5.6 a game against a real
3.6, with 110 lines over 4.5. The exponent that produces the big-versus-guard
separation stays where it was (flattening it to 2.5 dropped the ratio to 3.7 and
failed the band that exists to protect it); instead the share cap was softened to
0.52 and an absolute per-40 ceiling was added, as rebounds and assists already
had. The leader now averages 4.1-4.4 and nothing clears 4.5.

Home games ran from 3 to 27 in a 31-game season, against a real 13 to 19,
because the higher-prestige side always hosted a non-conference game and a
conference game flipped a coin with no return leg. Three rules replace them: a
second meeting is the return leg and is played at the other building, a single
meeting goes to whoever has fewer home dates, and a non-conference game is a
negotiation whose odds come from the prestige gap with about one in seven played
somewhere neutral. Home games now run 8 to 21 and 99% of teams are within a game
of half their conference slate. Conference tournaments no longer cap the field at
twelve — six ACC and Big Ten teams used to finish a season without one — and the
seeding tie-break reads head-to-head and the conference record instead of the
sim's hidden true rating, which decided 1,062 ties over ten seasons.

#### The AP electorate was reading the answer key

This file's own header says the poll votes on observables, and three of its six
features read `g.quality`, which js/teams.js stamps on every log row straight off
the opponent's hidden rating. Strength of schedule, quality wins and bad losses
all come off the NET ranking `computeRankings` has already derived from the game
log. A poll recomputed with every `quality` field blanked now keeps 24 of its
top 25; it kept 16 before. Two smaller ones alongside it: a neutral-court game
was counted as a road win, and every filler line in the country carried
`astdRate: NaN` (66,243 of them over twenty classes, exported as null) because
the composite it reads was never defined for a filler.

Conference-tournament games are still excluded from the resume, and that is now
a deliberate choice rather than an oversight: adding them was measured and put
five seeds past twelve seeds 81% of the time against a real 64% and the harness's
78% ceiling. Championship week is played on neutral floors against the rest of
your own league, and folding it into a NET built for a 31-game schedule sharpens
the seed line rather than describing it.

#### Twenty seasons that were too alike at the bottom and too chaotic at the top

One volatility of 7 for all 364 programs, plus a 9% chance of a down year drawn
on top, was too much for the top of the sport and not enough for the bottom:
Kentucky missed the tournament in three seasons of twenty while the same program
won a one-bid league in eight to ten of them. That is backwards on both ends, and
for a real reason — a blue blood's floor is structural, and a one-bid league is
two rosters wide. Volatility now runs from 4 at the top of the sport to 10 at the
bottom and a down year is rarer for a program with everything to lose: Kentucky
misses two of twenty, and the most frequent one-bid champion won seven rather
than ten. The preseason ballot was a table — it read reputation and this season's
level, both stable by design, and voted the same program No. 1 in seven seasons
of twenty — so it now carries October's story as well, a draw that moves the
ballot and nothing else, weighted by how far up the ballot the program already
is — a preseason story is about a contender, and a flat draw moved teams into
and out of the top 25 rather than around inside it. Eight different programs are
preseason No. 1 over twenty seasons rather than six.

The draw is deliberately much smaller than variety alone would want, and that is
the one place this whole pass had to give something back. A ballot is judged on
whether it is any good: with no hype at all, 71.7% of preseason top-25 teams
reach the tournament, and a wide enough draw to make thirteen seasons of twenty
have a different No. 1 takes that to 63.7% — a noisier poll rather than a more
interesting one, and past the 65% the harness requires. At the sigma actually
shipped it is 68%. The point is WHICH blue blood is No. 1, not whether the
ballot means anything.

The one target not reached is the final top 25's season-to-season overlap, which
sits at 0.18 against a real 0.45. It is not the programs: setting the level draw
to zero entirely only lifts it to 0.22, because the ceiling is set by a 31-game
schedule with eleven points of per-game margin noise and by the conference drift,
and because twenty seeds of this tool are twenty unrelated universes rather than
twenty consecutive seasons of one.

Finally, a season's mid-season events were a fixed budget of seven, topped up
from a flavor pool, so every season had exactly seven things happen in it and
each KIND of thing happened in twelve to seventeen seasons of twenty. The budget
is a Poisson draw now (the slider is its mean, with a floor of four — a Division
I season is never empty) and the gates on the result-driven kinds were loosened
to match: 5.7 events a season, the most common kind fires in fifteen seasons of
twenty rather than seventeen, and the rest are spread from seven to fourteen
instead of bunched at twelve to sixteen.

### Awards, the paper and the draft board

The awards pass, the paper and the draft board carried a set of faults that a
reader could catch and the harness could not. The largest was structural: **a
draft class could not win a national defensive award.** The unseen field —
every returning rotation player in Division I — has no rating vector, so its
defensive score was re-derived from event rates, and the two halves were not on
the same scale. The composite term of a prospect's defensive score runs mean
-1.7 with a maximum of +2.2 (three bounded composites cannot go far); the
rate-derived stand-in ran mean +0.4 with a maximum of +8.9, and the stat model
hands a filler event rates it never hands a prospect (6.0 blocks a game against
a prospect maximum of 2.9). That was a systematic two-point gift to four
thousand players plus a tail four times as long, and over fifteen classes the
Naismith DPOY, the NABC DPOY and the Lefty Driesell went to the field **45 times
out of 45**. The field is now held to the envelope the model produces for the
players it rates in full: each defensive rate and the defensive rating are
capped at the class's own maximum, and the rate-derived term is mapped onto the
mean and spread of the real one. Ordering inside the field is untouched — a
better defender is still a better defender — only the scale it is compared on.
Over forty seeds the class now wins a national defensive trophy in **15 of 40
classes** and takes some national defensive honor in **33 of 40**, and the field
still wins most of them, which is right: it is thirty times the population.

Three stories were printing things the model did not believe. The "sweeps the
hardware" article filtered on `/Player of the Year/`, which is a rule about the
words and not about the trophies — "WCC Player of the Year" matches it — so it
fired in fifteen classes of fifteen and in nine of them the man it crowned held
no national trophy at all ("took 1 national honors"), in a paper that was
simultaneously running the field-honors story naming whoever actually won. It
now reads the named national trophies from `js/awards.js`, demands two of them
before it says "sweeps", pluralizes, and stands down when a returning player
took one. The conference-player-of-the-year story required an NCAA player, since
a prospect in prep ball holds an award of the same shape and the template was
rendering "Prep / Postgrad" as a clickable team. And the mock-draft and
stock-movement stories were reading a board the draft-day events had already
reordered: `boardRank` and `stockMove` were assigned after the events ran, so a
late reach who moved up 22 places on the night printed as "has climbed 22 spots
from his preseason ranking", and eight of fifty-nine events had a rise story
sitting on a faller's number with the scouting note's Board line saying "down 3"
underneath it. The ranking is now assigned on the pre-event board — which is
what a mock draft is — and where a man was actually taken is a separate
`draftSlot` that the draft-night stories and the note read. Each event's
sentence is also measured from the board slot rather than from the half-shuffled
intermediate position, which was off by one to three spots against the rank
printed beside it.

Smaller corrections around the honors: a pro MVP is now on his league's first
team (it was an `if/else`, so the one certain first-teamer in each league was
the only man left off it — 40 of them); a league whose own honors list opens
with a player of the year no longer also mints an MVP for the same season (nine
classes in fifteen had a man holding both); the domestic cup runs only for
leagues that are actually professional, ending the "Division II Cup Winner" and
"Prep / Postgrad Cup Winner"; a "newcomer" has to have arrived from somewhere,
so the walk-on who won a scholarship is no longer All-Conference Newcomer at the
school he never left; and the conference player-of-the-year races lost to the
field are recorded rather than silently dropped, so the paper can say which
returning senior beat the class to the A-10.

The prose fixes are mostly one helper each. `Text` gained `ordinal()` — "1th
season" and "3th game" were shipping — and its fault sweep now reads lowercase
words after an article (that is how "a old-school disciplinarian coach" got out)
and flags a bad ordinal, so neither can come back. The coaching-philosophy
labels are model keys, and "neutral" is the do-nothing archetype: it was
printing as "He is a neutral coach". They are mapped to readable adjectives now
and the article in front of them goes through `Text`. An overtime body said the
overtimes twice because the score text already carries "(3OT)". Four templates
asserted history the tool does not simulate — eleven straight losses to ranked
teams, a first bid in a programme's history, a decade without a second weekend —
and now say what the model actually selected on. And the pre-draft calendar
exists: everything past the bracket used to be clamped to "March", so 171
articles a run — the lottery, the combine, the pro days, the draft itself —
were filed from the wrong month.

Against staleness, the thin template tails were the problem: three draft-day
headlines covered four events a class ("The pick that made the room gasp" ran 23
times) and the "new No. 1" body had exactly one template for 26 articles. The
draft headlines are now keyed to what happened to the man — a slide, a workout
riser, a trade-up, a reach — with six each, and the poll story reads the poll's
own history ("had been No. 2 a week ago", "after three weeks"). The most-repeated
headline template fell from 23 to 17 occurrences (1.4% to 1.0% of articles).
`statBlurb`, which every scouting note opens on, had four branches and a
fallback, so 53% of players got the identical true-shooting sentence; it now has
seventeen shapes — the offensive glass, a real three-point season, assists
against turnovers, free-throw volume, minutes, low usage and high efficiency —
and the most common covers 12%. The quote pool reads the trait layer for the
first time (a scout who has actually read the file talks about the motor, the
medical or the release), and the paragraph the beat writers file has six
openings rather than one.

Eight new kinds run off facts the model already had and nothing printed: the
Final Four Most Outstanding Player and the all-tournament team (the award was
assigned and never mentioned), a career-milestone story off the earlier seasons,
a conference player of the week off the game log, a coaching-record story, a
transfer facing the school he left, the conference player-of-the-year race the
class lost, a return from a long injury, and a prospect at a small programme
beating a ranked team on his own. Over fifteen classes they fired 5, 11, 13, 7,
11, 10, 12 and 3 times respectively. Finally the draft board reads two things it
did not: a prospect's draft age — taken from his class year, because most source
files carry 19 for everybody — so a senior and a freshman with the same ratings
no longer tie; and only the honors a scout cares about, since 46% of an award
list is team trophies and finalist tiers and a reserve on the national champion
was collecting three or four points of draft stock for other people's rings.

### Import, export and the merge

The file a class is written into is the only part of this tool the game ever
sees, and an audit of that path found nine ways a file could come out of here
saying something the tool did not mean. The worst of them killed the run: every
random stream and every editor lock is keyed off `Engine.playerKey`, which
returned the pid whenever the pid was a number, so two rows carrying the same
pid shared one key — the same build, the same college, the same lock — and the
draft-day stream handed the second man events the first had already consumed,
where `applyDraftEvents` died with "ev.say is not a function". `validateLeagueFile`
had only warned about it. The key is now unique for the second and later
occurrence of a pid (`4`, `4#2`), and unchanged for a well-formed file, so a
class that was fine before keys exactly as it always did.

Two things were wrong about what the file said. It dropped `version` from any
source that lacked one, and BBGM reads a versionless file as a pre-versioning
save: `augmentPartialPlayer` then recomputes every ratings row's `hgt` from the
player's listed height and rewrites the ratings season and draft year, so a
class solved to the exact rating arrived in the game as a different class.
Everything written here now carries `LEAGUE_DATABASE_VERSION` (73), stated once
in `js/bbgm.js` and stamped by both export routes and by the sample class. And
the tool's own height map was a 66-to-90 span where BBGM's `heightToRating.ts`
is 66-to-93. Every height derived from a rating was therefore short, and short
by more the taller the player: across 560 prospects in files with no listed
height the mean listed height moved from 6'5.5" to 6'6.9", the largest single
correction was three inches, and the number of seven-footers went from 42 to
102 — which is the population the archetype gates actually care about. The three
places in the build phase that converted inches back into rating points used the
same wrong span and now read one shared constant.

A class exported for a draft the league has not reached yet was dated to the
wrong year throughout. `result.season` is the file's `startingSeason` — the
season the league was in — and for BBGM's own year-ahead exports (startingSeason
2026, `draft.year` 2027 on every player) the export stamped 2026 on the ratings
row, on every honor, on every college stats row and on `born.year`, so a
prospect's final college season was labelled the year before the draft he was in.
The merge already read the year off the players; the export does now too, and
shifts every season it writes by the difference.

Three fixes are about not saying more than the tool knows. The class file did
not force `tid: -2`, and BBGM's draft import filters the uploaded file to
UNDRAFTED before it reads anything else — a class pulled out of a league export
by hand carried its rows' team tids and imported as zero players, with no error
on either side. Numeric strings passed validation (`Number.isFinite(Number(v))`
checked the value and then kept the raw object) and exported as `ovr: null`;
every rating key, season, fuzz, `born.year`, `draft.year`, `hgt` and `weight` is
now coerced with `Number()` where it is read and where it is written. And
`hgt: -5`, `hgt: 120` and `weight: 0` all exported verbatim, because the only
test on any of them was whether they were numbers: heights outside 58-96 inches,
weights outside 120-400 and ratings outside 0-100 are warned about and clamped
where they are read. The validator still never edits the file it is handed.

The league merge overlaid the whole exported player onto the league's
(`Object.assign({}, target, p)`), and a draft-class file is not a complete
player: a file from an older run wrote its stale `value`, `contract`, `born`,
`hgt`, `weight`, `injury`, `face` and `relatives` over the league's current
ones, so a prospect the user had already edited in-game silently reverted. Only
what this tool actually produces goes on top of him now — college, the class
season's ratings row, `draft.ovr/pot/skills`, the note, awards, injuries, stats,
mood traits and jersey number, with height and weight only when the tool
rewrote them.

Four smaller gaps: a file carrying a single `name` instead of `firstName` /
`lastName` exported with neither and showed a nameless player, and is split on
the way through; nobody wrote `injury`, so a prospect arrived with whatever
BBGM rolled; `born.loc` and the seeded face the tool draws on its own pages were
never written, so the man you scouted and the man in the game were different
people; and `college` for a prospect abroad held the LEAGUE — "LNB Pro A" — under
a heading BBGM prints as College. The club is already drawn, and the club is
what goes in the field; a club-to-league table takes him back to the right
competition when the same file is loaded again. That last step is exact for
every club that plays in one league and only nearly exact for the 44 that play
in two — a club name alone cannot say whether a Barcelona prospect was reached
through the EuroLeague or the ACB, so about one prospect abroad in ten comes
back in the neighbouring competition.

On the data side, the conference table had been drifting between two seasons at
once; it is now stated as, and consistent with, 2027-28 — UC Davis in the
Mountain West, Louisiana Tech in the Sun Belt, New Haven in the NEC and St.
Francis (PA), Division II since 2026, out. Eleven reverse aliases were added, so
a modded file that says "Dixie State", "UMKC", "IPFW", "College of Charleston",
"Central Florida", "Southern Mississippi", "Miami", "UConn", "Mississippi" or
"Penn" lands on the right program instead of falling out of the database
entirely. Seven programs got their real abbreviations, where the initials
generator had confidently produced IC, MO, II, WG, GC, TAC and SPS for UIC,
M-OH, IUI, UWG, GCU, TAMUCC and SPU. The EuroCup listed two clubs twice under
two names apiece, four clubs were named differently in their domestic league and
in the continental table (and the pro-league sim matches a club by name), six
relegated or defunct sides were still playing, and four notable ones were
missing. `EURO_HINTS` did not match "United Kingdom" — which is the string BBGM
itself writes — so a British prospect got a flat 1.0 on every destination
abroad, and sixteen of its entries were duplicates.

Finally the synthetic returners, who fill out every roster the class plays
against: 28 first names by 28 last ones is 784 combinations for about 3,200
players a season, so every name in the pool was used four times over and the
honors page read like a family reunion. They were also entirely American, in a
sport whose rosters are not. The pools are now 180 by 209 — 37,620 combinations
— with the range of origins a Division I roster actually holds, and the coach
first names, which were one generation of Anglo names, carry another hundred.
The "International class" preset had the same shape of problem: it named twelve
destinations, and the twenty-four leagues added to the table since kept their
ordinary weights while those twelve were boosted around them, so the preset
whose whole purpose is to send a class abroad was quietly holding back most of
the world. It names all thirty-six now.

### The page itself

This pass drove the running page rather than reading it: the sample class loaded
through the “Try a sample class” button, every tab screenshotted at 1400×900 and
390×844 in both the light and the dark palette, and then the verbs exercised one
by one — reroll, undo, redo, re-apply, pin and compare, the editor's locks and
its three ↻ buttons, “Reroll just him”, search, the range filters, the sort
stack, the column picker, the keyboard shortcuts, the settings search and its
only-what-I-changed toggle, the randomizer scopes and padlocks, presets, the
Link round trip, the seed pill and its history, the CSV lock import, all nine
export routes, batch mode with its progress and its cancel, universe mode over
two sample files, back and forward navigation on the player, team and box-score
pages, and the phone card layout. Almost all of it worked, and the run raised
no console error or warning anywhere. What it did find was in the chrome — the
header, the dialog and the palettes — which is the part nothing was reading.

The copy-link button ate its own icon. `copyText` flashes “Copied ✓” on the
button and then restores a label the CALL SITE passes; the header's button is
the 🔗 glyph and the call site passed the word “Link”, so one click replaced the
icon with a word for the rest of the session, and the wider button reflowed the
toolbar. It now puts back the label the button actually had. Beside it, the
header's flex spacer had a height of its own: the header wraps at 1400px as soon
as the seed history appears and “Undo …” grows a label, and a wrapped
`flex: 1` item becomes an empty band — a measured 96px of nothing between the
two toolbar rows. The spacer collapses now, and the undo label, which is written
from the action it will undo, is capped at 17ch so it cannot re-wrap the bar
mid-session.

Two of the three dark palettes failed WCAG on the most-pressed button in the
tool. White on `#4da3ff` is 2.63:1; Export JSON and the selected randomizer chip
both wore it. A `--on-accent` token per palette makes that dark text on the
light-blue accents (6.7:1) and leaves the light themes as they were. The same
sweep turned up three tokens that no palette has ever defined — `--ok`,
`--warn` and `--win`, read by the phase-cost hints and the poll movement column,
which meant those rules painted one light-theme hex in every theme (3.19:1 and
3.30:1 on white; a dark green on a dark panel) — plus `--upset-bg2` and
`--upset-bg3`, so a dark bracket drew its heaviest upsets in the light theme's
browns. All of them now read tokens the palettes set. `tools/tests/ui.js` is a
new static check that fails on any `var(--x)` the stylesheet never defines,
because a `var()` with a fallback is valid CSS that renders in silence and that
is exactly how those five survived.

The bracket scrolled the whole page sideways on a phone. `.regionbox` sized
itself to the full 814px bracket inside a 366px column, so the March Madness tab
made the document 826px wide at a 390px viewport: every other tab then sat in a
half-width column with the rest of the screen blank. The regions are capped to
their column now and the bracket scrolls inside its own box, which is what
`.bracket { overflow-x: auto }` was always for. In the export dialog, the
five-column table of BBGM import routes was 200px wider than the 560px dialog,
so the two columns that answer “does this keep my awards” sat off the right edge
behind a scrollbar nobody looks for inside a dialog; it wraps to a fixed layout
now.

Two small verbs earned their place. Every note card carries its own Copy button
— “Copy all notes” wrote seventy of them into the clipboard, which is the wrong
verb for pasting one prospect into a forum post — and every export now names the
file it wrote: `download()` records the name and the statuses that used to read
“Season exported.” read “Wrote season_249663942.csv — …”, which is the only
confirmation a browser that saves silently to a download folder ever gives.

Measured, on the 70-man sample class: a reroll is 647ms end to end (median of
five, busy indicator up throughout), a re-apply 98ms, and a batch of six 3.5s
on the worker. Tab renders are 13–45ms except the AP poll (143ms), the game log
(110ms) and the bracket (251ms); the bracket is the one worth a second look if
the tab switching ever feels heavy. `tools/uismoke.js` grew twelve checks over
the chrome — the copy button's label, the wrapped header, the phone bracket, the
accent contrast in all three dark themes, the dialog's route table, the per-note
copy and the named export.

---

## Known limits

* A draft class is one season, but the seasons before it are **simulated** for
  D-I prospects: the player re-solved to the overall he had then, carrying that
  year's class year, in a rotation rebuilt at his program's level with the men
  he was behind actually on it. Pooled over three classes that runs 24.1 minutes
  and 9.4 points as a freshman against 31.3 and 15.7 in the draft year. Each
  one carries nights now — a drawn schedule (the program's own conference,
  results off its level that year) and a game log reconciled to the line, so
  an earlier season has season highs, a best game, a twenty-point count and a
  record, on the Career table, in the note's highs line and on the exported
  row — and honors, measured against this season's bars (see *Hands out
  honors*). `priorSeasons: "reconstruct"` restores the old backward-scaled
  line, with none of that.
* Depth that used to be missing and now exists: the AP poll is voted weekly by
  a persistent 60-member electorate; selection runs a committee model over
  observables (NET, quadrants, road record, stretch form) instead of peeking at
  the hidden team rating; star returners have names and take trophies under
  them; and in Universe mode coaches persist (a fired one is replaced by a
  named first-year hire), program strength drifts continuously and
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
* The two candidates for the next round of depth, in order: a mid-season
  transfer gets no partial line at the school he left (the season is played
  once, on one roster, so he carries one line), and the professional leagues
  abroad are still biography rather than a simulated season — see below.
* **Universe mode shares rosters across class files, one direction.** A
  later class's underclassmen play the earlier seasons (see *Universe mode*).
  What it still does not do is the reverse: a 2025 class's freshman who went
  undrafted does not reappear as a 2026 sophomore, because a class file only
  knows about the men who were drafted out of it. A universe's earlier
  seasons also run once with the later classes' rosters and once without
  when a single file is re-run outside the chain, which is why the chain is
  the world and a standalone run of one of its files is not.
* **Returning rotation players have season averages, not nights.** They are
  named, they take trophies, they have pages, and the box-score view will not
  print a line for them, because dividing a season average by games and calling
  it a game is a fabrication in the one view whose whole claim is that it is a
  record. Per-game logs for all ten rotation players is roughly three times the
  stats phase and is the obvious next thing.
* About one rating in a hundred sits exactly on the floor of 1 after a
  rebuild, concentrated in the ovr 20–39 band. Half of that arrives in the
  input (a draft-slot-shaped class has walk-on candidates whose ratings are
  already there); the rest is the ovr-preserving shift taking the points a
  build's signature ratings gained out of ratings that had none to give. A
  negative offset is scaled by the room it has so the *base* cannot go
  through the floor, and `tools/test.js` holds what the builder adds under
  0.6% of the class's ratings.
* The professional side is thinner than the NCAA side. Clubs, tables, playoffs,
  cups, relegation, each league's own MVP and first team, and a continental
  competition for the top clubs exist; national-team summers do not, and the
  continental run is a drawn result rather than a simulated bracket. The
  conference map is the 2027-28 one (Gonzaga, Oregon State, Washington State
  and Texas State in the rebuilt Pac-12; Grand Canyon, UTEP and UC Davis in the
  Mountain West; Louisiana Tech in the Sun Belt; Seattle in the WCC; Delaware in
  Conference USA; UMass in the MAC; Merrimack in the MAAC; New Haven in the NEC
  and St. Francis (PA) gone from Division I) and the club lists are the 2025-26
  ones; both will date. It used to be authored to two seasons at once, which is
  how UC Davis sat in the Big West while UTEP had already moved.
* The field's block tail is thinner than it was and is not gone: the national
  leader averages 4.1-4.4 against a real 3.6, where he used to average 5.6 with
  110 lines a season over 4.5. What is left is the exponent that separates a
  centre from a guard, which the harness bands in the other direction, so the
  next move there is a per-position block model rather than another cap.
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
* A mid-season transfer is modeled as the games he sat waiting to be cleared,
  plus the biography. He does not get a partial line at the school he left:
  that needs two rosters and two rotations for one player, which is a larger
  change than the anomaly is worth.
* The field's stars are synthetic. A returning player's talent was drawn from
  his program's level and nothing else, so the best player in the country was
  by construction always somebody in the draft class and the national player of
  the year came out of the class in 100% of seasons. About a dozen **star
  returners** now exist across the 364 programs — the excellent college player
  who is not an NBA prospect, which several of the 2024 consensus first-team
  All-Americans were — and the class takes the trophy in 80% of seasons and 2.4
  of the five consensus first-team spots instead. Each has a name, a class year
  and a kind, and in Universe mode the ones with eligibility left come back to
  the same program the next season as the same men. In a single-class run
  they are still drawn fresh with the rest of the roster.
* The default class-year mix (46% freshmen at the default `freshmanShare`)
  is younger than a typical real 60-70 man class, which runs closer to a third
  freshmen. The knob works exactly as labeled; whether the default should
  move is a design choice, and the "veteran" and "portal" flavors already
  produce the older class when drawn.
* **For contributors introspecting a run result:** `Engine.run` returns
  live objects with cycles in them (`team.members[i].player.proTeam` points
  back at the team), so `JSON.stringify(res)` throws. Use `Engine.exportSeason`,
  `Engine.exportLeagueFragment` or `BatchStats.summarize` for a flat view, or
  walk `res.players` / `res.teams` directly the way `tools/validate.js` does.
* The professional side has no multi-year history: a prospect abroad still gets
  the reconstructed career panel rather than a simulated one, because there is
  no prior-year club roster to put him on.
