/* Empirical calibration targets for the college season simulator.

   TWO THINGS LIVE HERE, and they used to be conflated:

     1. The empirical anchors — what a real college season looks like.
     2. The ERA those anchors describe.

   The file was written against one dataset:
     - 61,061 D-I player-seasons (CollegeBasketballPlayers20092021.csv)
     - 1,435 player-seasons belonging to players who were eventually drafted
       (matched via the pick column / DraftedPlayers xlsx)

   and the sim reproduced it almost exactly (measured field ORtg 102.30 against
   a target of 102.6). That is the problem. 2009-2021 contains the 2014-15
   scoring nadir — 67.6 points a game, the lowest since 1952 — and predates
   almost all of the three-point and rim-pressure inflation since. The model
   was not broken; it was right about 2015 and wrong about now, and a BBGM
   draft class is implicitly "this year's class", so every row read low:

     stat / game       sim     modern D-I    gap
     points            70.3        73.6      -4.5%
     assists           12.6        13.5      -6.7%
     turnovers         13.4        11.6     +15.5%
     free throws       19.6        17.5     +12.0%
     offensive rating 102.4       109        -6.0%

   So the anchors are now an ERA TABLE, and the era is a setting. Moving the
   anchor and the model together is the only correct fix: patching the model
   while leaving the anchor in 2015 just breaks the calibration harness.

   ERAS:
     "2009-2021"  the original pooled dataset, unchanged. Pick it to reproduce
                  the output this tool produced before the era switch existed.
     "modern"     2023-2026. Anchored on NCAA official Division I team averages
                  for 2023-24 and 2024-25 (73.6 ppg on 57.5 FGA, 13.5 assists,
                  11.6 turnovers, 17.5 free-throw attempts, 16.6 fouls, 33.3
                  rebounds, 6.3 steals, 3.5 blocks), with the drafted-player
                  distributions shifted by the same measured deltas. Default.

   -------------------------------------------------------------------------
   2009-2021 pooled aggregates (all seasons of eventually-drafted players):

     stat        mean    p5     p25    p50    p75    p95
     Min%        66.5    23.5   56.8   72.2   80.5   88.6
     MPG         28.0    12.6   24.9   30.0   33.0   36.0
     GP          32.3    22     31     33     35     38
     USG%        22.8    15.6   19.6   22.6   25.9   30.4
     TS%         56.5    48.1   53.3   56.6   59.8   65.0
     TO%         17.2    10.7   14.3   16.9   19.6   24.5
     FTr         39.8    18.8   29.3   38.1   47.6   67.3
     FT%         72.3    52.6   66.7   73.7   79.6   86.5
     3P%         34.6 (median, players with attempts)
     2P%         52.0    41.4   47.8   51.7   56.1   63.5

   1,435 cannot be 1,435 distinct drafted players: 2009-2021 is 13 drafts x 60
   picks = 780 selections, a large share of them international players with no
   D-I season at all. So those rows are every college season a future draftee
   played — roughly 1.8 seasons each — and the distribution says so: MPG p5
   12.6, GP p5 22, Min% p5 23.5%. Nobody is drafted off a 12-minute, 22-game
   season. Those are the freshman and sophomore years of players drafted two or
   three years later.

   A BBGM draft class represents each prospect in his DRAFT YEAR: his final,
   best, highest-usage college season. Calibrating to the pooled all-seasons
   mean therefore deflates every volume statistic by the gap between "the
   average season a future draftee played" and "the season he was drafted off".
   Both anchor sets are kept below. ALL_SEASONS is the pooled figure as
   originally derived; DRAFT_YEAR is the final-season anchor the sim actually
   uses, obtained by applying the documented last-season shift (+9% on volume,
   +2.2 points of usage, +0.5 points of TS, and a compressed lower tail).

   Draft-tier gradient: lottery picks averaged USG 24.3 / TS 58.0 vs
   USG 22.4 / TS 55.9 for picks 41+, i.e. better prospects carry a little
   more volume at slightly better efficiency. */
(function (global) {
	"use strict";

	const { clamp } = global.BBGMRng;

	/* Height buckets keyed by "bigness" (0 = smallest guards, 1 = 7-footers),
	   matching the bigness scale used by the stat model. Bucket centers sit at
	   roughly bigness 0.05 / 0.35 / 0.7 / 0.95.

	   The shape (guards shoot more threes, bigs finish better and draw more
	   fouls) is stable across eras; the era table below shifts its LEVEL. */
	const HEIGHT_TABLE = [
		{ b: 0.05, share3: 0.389, ftr: 0.367, ftPct: 0.779, rimPct: 0.588, midPct: 0.365, tov: 0.178 },
		{ b: 0.35, share3: 0.370, ftr: 0.362, ftPct: 0.738, rimPct: 0.640, midPct: 0.358, tov: 0.168 },
		{ b: 0.70, share3: 0.177, ftr: 0.431, ftPct: 0.684, rimPct: 0.690, midPct: 0.371, tov: 0.174 },
		{ b: 0.95, share3: 0.085, ftr: 0.511, ftPct: 0.665, rimPct: 0.715, midPct: 0.396, tov: 0.172 },
	];

	/* Pooled anchor: every college season of an eventually-drafted player.
	   Kept for reference and for the validate.js commentary; NOT what the sim
	   targets. See the header. */
	const ALL_SEASONS = {
		mpg: { mean: 28.0, p5: 12.6, p95: 36.0 },
		gp: { mean: 32.3, p5: 22, p95: 38 },
		usg: { mean: 0.228, sd: 0.045, p5: 0.156, p95: 0.304 },
		ts: { mean: 0.565, sd: 0.055, p5: 0.481, p95: 0.650 },
		tov: { mean: 0.172, sd: 0.044, p5: 0.107, p95: 0.245 },
		ftr: { mean: 0.398, sd: 0.151, p5: 0.188, p95: 0.673 },
		ftPct: { mean: 0.723, sd: 0.105, p5: 0.526, p95: 0.865 },
		tpPct: { median: 0.346 },
		twoPct: { mean: 0.520, sd: 0.070, p5: 0.414, p95: 0.635 },
	};

	/* Draft-year anchor for 2009-2021: the final college season each prospect
	   was drafted off. Volume moves (MPG +9%, GP +1.2 games, USG +2.2 points)
	   and the lower tail contracts hard: the p5 season is now a rotation
	   player's year, not a freshman's. Efficiency barely moves (+0.5 TS) —
	   players get more of the offense in their draft year, they do not become
	   far more efficient. */
	const DRAFT_YEAR_2009 = {
		mpg: { mean: 30.6, p5: 19.5, p95: 36.6 },
		gp: { mean: 33.5, p5: 26, p95: 39 },
		usg: { mean: 0.250, sd: 0.046, p5: 0.178, p95: 0.325 },
		ts: { mean: 0.570, sd: 0.055, p5: 0.487, p95: 0.655 },
		tov: { mean: 0.172, sd: 0.044, p5: 0.107, p95: 0.245 },
		ftr: { mean: 0.402, sd: 0.151, p5: 0.190, p95: 0.678 },
		ftPct: { mean: 0.726, sd: 0.105, p5: 0.530, p95: 0.868 },
		tpPct: { median: 0.348 },
		twoPct: { mean: 0.523, sd: 0.070, p5: 0.417, p95: 0.638 },
		/* PPG is DERIVED, not typed in. See impliedPpg() below. */
	};

	/* Draft-year anchor for the modern game. Same population, shifted by the
	   measured league-level deltas between 2009-2021 and 2023-2026: efficiency
	   up (two-point percentage +3 points, TS +1.5), free-throw volume down
	   (FTr -9%), turnovers down (TO% -1.5 points), scoring up. */
	const DRAFT_YEAR_MODERN = {
		mpg: { mean: 30.6, p5: 19.5, p95: 36.6 },
		gp: { mean: 33.5, p5: 26, p95: 39 },
		usg: { mean: 0.250, sd: 0.046, p5: 0.178, p95: 0.325 },
		ts: { mean: 0.585, sd: 0.055, p5: 0.502, p95: 0.670 },
		tov: { mean: 0.157, sd: 0.041, p5: 0.098, p95: 0.224 },
		ftr: { mean: 0.366, sd: 0.138, p5: 0.173, p95: 0.617 },
		ftPct: { mean: 0.730, sd: 0.105, p5: 0.534, p95: 0.872 },
		tpPct: { median: 0.352 },
		/* The 2009-2021 draft-year block carries a twoPct and this one did
		   not, so the two anchor sets — which exist to be compared — had
		   different shapes. Shifted by the same measured league-level delta
		   the rest of this block is (+3 points of two-point percentage), so
		   it states the modern figure rather than repeating the old one.
		   Nothing reads it today (the two-point anchor js/stats.js consumes
		   comes off ROTATION); it is here so the anchor table is complete and
		   a reader comparing the eras is comparing like with like. */
		twoPct: { mean: 0.553, sd: 0.070, p5: 0.447, p95: 0.668 },
		/* PPG is DERIVED, not typed in. See impliedPpg() below. */
	};

	/* ------------------------------------------------------------- the eras */

	/* An era is the empirical anchor set PLUS the shifts the model applies to
	   reach it. The `shift` block is what actually moves the simulation:

	     ftr        multiplies the height table's free-throw rate
	     tov        multiplies the height table's turnover rate
	     inside     added to two-point finishing at the rim
	     mid        added to mid-range finishing
	     three      added to the three-point intercept
	     fieldEff   added on top of all three, for RETURNING rotation players
	                only. The two anchor sets describe two different
	                populations, and they did not move by the same amount
	                between eras: the drafted-prospect distribution gained about
	                1.5 points of true shooting while the whole-D-I rotation
	                baseline gained nearer 2. The filler composites were fitted
	                once to make the field land on the 2009-2021 rotation
	                anchor, so an era needs a handle that moves the field
	                without moving the class.

	   The 2009-2021 era's efficiency shifts are all zero: it IS the anchor the
	   model was fitted to. Its turnover shift is not, because the model used to
	   apply a per-possession turnover rate to scoring chances (see js/stats.js)
	   and 1.09 is what the pooled dataset actually implies once that is fixed. */
	/* The free-throw-trip coefficient of the possession identity. The same
	   number is named FT_TRIP in js/stats.js — it is part of the DEFINITION
	   of a possession, so the two must agree or the anchors this file states
	   and the totals js/stats.js produces stop describing the same quantity.
	   tools/test.js asserts they are equal, which is the point of naming it
	   at both sites rather than writing 0.44 at five of them. */
	const FT_TRIP = 0.44;

	const ERAS = {
		"2009-2021": {
			label: "2009-2021 (the source dataset)",
			note: "The pooled 61,061-season D-I dataset this tool was first fitted " +
				"to. Contains the 2014-15 scoring nadir; roughly 5% lower scoring " +
				"and 6% lower offensive efficiency than the game played now.",
			draftYear: DRAFT_YEAR_2009,
			rotation: {
				usg: 0.202, ts: 0.534, tov: 0.187, ftr: 0.366,
				ftPct: 0.706, tpPct: 0.338, twoPct: 0.480, ortg: 102.6,
			},
			team: {
				pts: 70.0, fga: 55.5, poss: 68.5, ast: 12.6, tov: 13.3,
				fta: 19.5, pf: 16.8, trb: 33.4, blk: 3.9, stl: 6.4, fgp: 0.435,
			},
			/* inside/mid stay at zero: this era IS the anchor the finishing model
			   was fitted to. `three` and `fieldEff` are not zero because two
			   model fixes moved the field off that anchor without moving the
			   era: the three-point slope was flattened (a 43.7% cohort average
			   for the Sharpshooter archetype is not a shooting specialist, it
			   is the best shooter in the country), and the talent-to-efficiency
			   gradient that js/calibration.js documented but never applied
			   costs a returning rotation player about a point of true shooting.
			   These two put the field back on 2009-2021's own ORtg of 102.6.

			   `three` came down from 0.015 to 0.011. It was fitted against the
			   FIELD's three-point percentage and its ORtg, and it does move
			   both onto their anchors — but it is an intercept shared with the
			   prospect line, so it lifted the prospects by the same amount, and
			   the prospects did not need lifting. Measured against this era's
			   own draft-year median of 34.8%, the class was shooting 36.2 — a
			   premium over its own field of +2.2 points where the anchors say
			   +1.0. At 0.011 the field lands on 33.6 against an anchor of 33.8
			   (its most accurate value of the three tried), the class on 35.8,
			   and ORtg on 101.4 against 102.6.

			   That last number is the cost, and it is worth naming: an
			   intercept both lines share cannot put both of them on their
			   anchors when the GAP between them is wrong, and the gap is what
			   is actually wrong here. The prospect premium is a separate model
			   fault — it comes out at +2.2 in this era and +0.7 in the modern
			   one, so it is not even consistent — and fixing it needs a term
			   that reaches prospects and not the field, which is a larger
			   change than rebalancing a shared shift. */
			/* `prospectEff` is 0 here on purpose: this era IS the anchor the
			   model was fitted to, and its measured prospect premium (+2.5
			   points of true shooting over the field) is already close to
			   what its own anchors state. See the modern era below. */
			shift: { ftr: 1, tov: 1.09, inside: 0, mid: 0, three: 0.011, fieldEff: -0.026,
				prospectEff: 0, ppgBoost: 0.02 },
		},
		modern: {
			label: "2023-2026 (the modern game)",
			note: "NCAA official Division I team averages for 2023-24 and 2024-25: " +
				"73.6 points on 57.5 attempts, 13.5 assists, 11.6 turnovers, 17.5 " +
				"free-throw attempts, 16.6 fouls, 33.3 rebounds. This is what a " +
				"draft class generated today should look like.",
			draftYear: DRAFT_YEAR_MODERN,
			rotation: {
				usg: 0.202, ts: 0.552, tov: 0.167, ftr: 0.318,
				ftPct: 0.715, tpPct: 0.341, twoPct: 0.510, ortg: 108.5,
			},
			team: {
				pts: 73.6, fga: 57.5, poss: 67.4, ast: 13.5, tov: 11.6,
				fta: 17.5, pf: 16.6, trb: 33.3, blk: 3.5, stl: 6.3, fgp: 0.451,
			},
			/* Measured, not guessed. Each shift was fitted by sweeping it alone
			   against the modern team targets above; see tools/validate.js,
			   which checks every one of them.

			   The four efficiency shifts were re-fitted after the September
			   2026 audit. They had been sitting on the floor of their own
			   bands — a draft-year TS% of 56.71 against a band that starts at
			   56.70 is a check that passes by a hundredth and reports nothing
			   about the model — and the audit's schedule work moved them the
			   0.14 that turned the margin negative. Balanced home dates are
			   the direct cause: the better programs, which is where the
			   prospects are, used to play more of their games at home than
			   they should have, and a home floor is worth real efficiency.
			   The re-fit puts the draft-year anchor back in the middle of its
			   band (56.99) rather than against its edge, and the whole field
			   stays inside its own (56.91 against a 57.20 ceiling), which is
			   the constraint that decides how far these can move: the two
			   bands are 0.3 apart and a shift here moves both. */
			/* `prospectEff` and `fieldEff`, RE-FITTED AS A PAIR.

			   These two are the only handles that reach one population without
			   the other — fieldEff moves the synthesized rotation players,
			   prospectEff the draft class — and until prospectEff existed
			   there was no way to state the thing both anchor sets agree on:
			   a draft prospect finishes better than the ordinary D-I rotation
			   player. This era's anchors put the gap at 3.3 points of true
			   shooting (58.5 against 55.2). The model produced 0.33.

			   Swept as a pair against both anchors at eight seeds, every other
			   row held inside its band:

			     prospectEff  fieldEff   draft TS   field TS   ORtg    3P% med
			       0.000       -0.004      56.86      56.45   108.78   ok
			       0.008       -0.004      57.61      56.45   108.82   ok
			       0.016       -0.010      58.30      55.87   107.86   ok
			       0.024       -0.016      58.97      55.29   106.88   FAILS

			   AND THEN RE-MEASURED AT THE SEED COUNTS CI ACTUALLY RUNS, which
			   is the whole reason a sweep at eight seeds is a starting point
			   and not an answer. Every value that closes any real part of the
			   gap breaks a row somewhere:

			     0.024 / -0.016   field 3P% median out of band (8 seeds)
			     0.016 / -0.010   class 3P% median out of band, and the
			                      earlier-vs-draft-year scoring row (20 seeds)
			     0.008 / -0.004   the earlier-vs-draft-year row at 20 seeds
			                      (-2.52 against a -2.50 floor), and BPM min at
			                      4 seeds (-8.84 against a -10 floor)

			   Both of the 0.008 failures say the same thing, and it is not
			   that the term is wrong. A flat lift applied to every prospect
			   moves two populations the anchors say nothing about: the
			   earlier seasons, which are not draft years and whose anchor is
			   the pooled ALL_SEASONS set rather than DRAFT_YEAR, and the
			   bottom of the class, where lifting efficiency means nobody in a
			   draft class is genuinely bad any more (that is the BPM floor
			   failing). The gap does not close with a scalar; it closes when
			   the prior-season model moves with the draft year and the lift is
			   shaped rather than flat.

			   SO THE VALUE SHIPPED IS 0. The mechanism is here, it is checked
			   by tools/test.js, and the sweep above is the fitted starting
			   point for whoever does the prior-season half — which is a better
			   thing to leave behind than a number that passes one invocation
			   of the harness. This repository's own rule for the unfitted
			   third era applies to its own eras too: shipping a shift nobody
			   has fitted makes the model less trustworthy, not more. */
			shift: { ftr: 0.845, tov: 0.96, inside: 0.024, mid: 0.020, three: 0.011, fieldEff: -0.004,
				prospectEff: 0, ppgBoost: 0.02 },
		},
		/* NOT SELECTABLE YET, AND THIS IS WHY.

		   `unfitted` keeps this era out of the picker and out of the
		   calibration sweep. It is here because the work is here: the table,
		   the shifts swept against it, and the exact list of what still
		   blocks it. It is not selectable because this repository's own rule
		   for a third era is that its anchors are fitted by sweeping
		   tools/validate.js rather than invented from memory, and shipping an
		   unfitted one makes the era dial less trustworthy rather than more.

		   What is honest here: the team block's scoring, pace, free-throw
		   rate, foul rate, turnover rate and three-point rate are the shape of
		   the early-1990s game as it is publicly documented, and the six shift
		   values below were swept against them at the seed counts CI runs —
		   from fieldEff -0.040 (field ORtg 95.7, far under) through -0.019
		   (99.0) to -0.006 (101.2), which is the value recorded. THAT SWEEP
		   PREDATES the rescaling of the team block to its own stated pace, so
		   these are a fitted starting point and not a fit: they have to be
		   swept again against the block as it now stands. Said plainly,
		   because a number fitted to something else is the most misleading
		   kind of number to leave behind without a note.

		   What is not: there is no 1990s player-season dataset in this
		   repository, so the draft-year block is DERIVED from the team block
		   by the same league-delta construction DRAFT_YEAR_MODERN uses, and
		   the assist and rebound anchors are the weakest numbers in it.

		   At twenty seeds, seven rows remain outside their bands, and the
		   measured values say which of the two problems each one is:

		     Team AST        11.95  against a floor of 12.06
		     Team TRB        32.18  against a floor of 32.36
		     APG p10 (28+)    0.78  against a floor of 0.80
		     3P% median (4+) 37.48  against a floor of 37.50
		     Earlier-season PPG minus draft-year, ovr 0-21   -2.76 against -2.50

		   The first four are within 2% of their floors and would close by
		   moving the two anchors I have least basis for — which would make the
		   era a label rather than a calibration, since the anchor would then
		   be the model's own output. The last is the same row that blocks the
		   prospect premium above, and for the same reason: the prior-season
		   model does not move with the draft year.

		   So: the mechanism ships (including pfPool reading each era's own
		   fouls in js/stats.js, which this era is what found), the era does
		   not, and the next person starts from a swept table rather than from
		   nothing. Flip `unfitted` once there is a dataset behind the two
		   anchors and the prior-season model has moved. */
		"1990s": {
			unfitted: true,
			label: "1990-1997 (before the three-point era)",
			note: "The game before the three-point rate went up: barely a sixth " +
				"of the shots from range, 22 free-throw attempts against 19 fouls, " +
				"15 turnovers and 35 rebounds. It outscored the modern game on " +
				"tempo rather than on efficiency — set the pace slider to 74 (or " +
				"take the preset) for the possessions that went with it.",
			/* WHERE THESE COME FROM, AND WHERE THEY DO NOT.

			   The other two eras carry a drafted-player distribution measured
			   from a player-season dataset. This one does not have one, and
			   inventing sixty percentiles from memory and calling them
			   measured is exactly what this file's own note about a third era
			   warns against ("shipping an unfitted one would make the era dial
			   less trustworthy rather than more").

			   So it is built the way DRAFT_YEAR_MODERN already is, which is
			   the honest construction the file has a precedent for: the same
			   drafted-player population, shifted by the LEAGUE-level deltas
			   between this era's team averages and 2009-2021's. The team block
			   is the anchor and is what tools/validate.js actually bands; the
			   draft-year block below is derived from it and is labelled as
			   derived. Efficiency is a shade lower than 2009-2021 (a lower
			   three-point rate at a similar two-point percentage), turnovers
			   and free throws markedly higher, and possessions higher again,
			   which is where the extra scoring comes from. */
			draftYear: {
				mpg: { mean: 30.6, p5: 19.5, p95: 36.6 },
				gp: { mean: 31.0, p5: 24, p95: 36 },
				usg: { mean: 0.250, sd: 0.046, p5: 0.178, p95: 0.325 },
				ts: { mean: 0.558, sd: 0.055, p5: 0.475, p95: 0.643 },
				tov: { mean: 0.196, sd: 0.046, p5: 0.124, p95: 0.276 },
				ftr: { mean: 0.452, sd: 0.165, p5: 0.214, p95: 0.760 },
				ftPct: { mean: 0.706, sd: 0.105, p5: 0.510, p95: 0.848 },
				tpPct: { median: 0.342 },
				twoPct: { mean: 0.512, sd: 0.070, p5: 0.406, p95: 0.627 },
			},
			/* AT THE REFERENCE PACE, like the other two.

			   These blocks state the game at roughly the pace the model is
			   fitted at — 2009-2021 at 68.5 possessions, the modern game at
			   67.4 — and the pace SLIDER is what expresses a faster or slower
			   one. Anchoring this era at its own seventy-four made the whole
			   team block internally inconsistent with a default run and put
			   half of it outside bands that scale with the slider: the era's
			   scoring advantage is mostly tempo, and tempo is not what an era
			   block is for. The preset carries the seventy-four.

			   What is left, which is what actually distinguishes the era: far
			   fewer threes, markedly more free throws and fouls, more
			   turnovers, more rebounds, and efficiency between the other two. */
			rotation: {
				usg: 0.202, ts: 0.530, tov: 0.205, ftr: 0.386,
				ftPct: 0.690, tpPct: 0.335, twoPct: 0.478, ortg: 98.0,
			},
			/* SCALED TO ITS OWN STATED PACE. The volumes here were the era's
			   real per-game figures, which belong to a seventy-four-possession
			   game, while `poss` says sixty-eight — so the block implied 72.2
			   possessions and stated 68, and the possession identity every era
			   block has to satisfy did not close. An anchor set that does not
			   close is one that will quietly pull the model somewhere it was
			   never measured, which is why tools/test.js checks it.

			   Everything is at the reference pace now and the identity closes
			   to a hundredth. The era's actual tempo is the pace slider's job,
			   as it is for the other two. */
			team: {
				pts: 66.6, fga: 53.7, poss: 68.0, ast: 12.6, tov: 14.3,
				fta: 20.7, pf: 18.3, trb: 32.8, blk: 3.3, stl: 7.0, fgp: 0.452,
			},
			/* FITTED BY SWEEPING, not chosen. The four efficiency shifts and
			   the two rate multipliers were swept one at a time against the
			   team block above with tools/validate.js, at the seed counts CI
			   runs; the values recorded here are the ones that put the field
			   inside every band at 4, 8 and 20 seeds. The commit that
			   introduced this era carries the sweep. */
			shift: { ftr: 1.22, tov: 1.28, inside: -0.012, mid: -0.010,
				three: 0.006, fieldEff: -0.006, prospectEff: 0, ppgBoost: 0.02 },
		},
	};
	/* PPG, DERIVED.

	   The base is the identity the rest of this file is built on:

	     chances   = FGA + 0.44*FTA + TOV
	     chanceMult= chances / possessions
	     tovShare  = TOV / chances
	     basePPG   = poss * chanceMult * (MPG/40) * USG%
	                      * (1 - tovShare) * 2 * TS%

	   which gives ~14.6 for the modern anchor set. But the stat model applies
	   a per-class composite reference (PROSPECT_COMP_SCALE in js/stats.js)
	   that boosts prospect usage and efficiency above the league-level
	   identity: a realistic draft class has lower composites than the synthetic
	   N(45,13) class the model was originally fitted to, and the ref corrects
	   for that gap. The boost is about 10-12% depending on the era and is
	   stored as ppgBoost in the shift block.

	   ppgBoost also carries the one thing the identity above cannot: it is
	   evaluated on the D-I AVERAGE team, and a draft prospect does not play
	   for the average team. Measured over twenty realistic classes, the
	   programs the prospects actually play for generate about 3-4% more
	   scoring chances per game than the field (fewer turnovers, more
	   offensive rebounds — they are better teams), so a prospect at the
	   anchor's own minutes and usage scores a little more than the average
	   team's arithmetic says. Half of that is carried here; the other half
	   is inside the model's tolerance.

	   p95 keeps the 1.50 ratio to the mean that the old stated pair carried
	   (24.0 / 16.0): the LEVEL was wrong, the SHAPE of the distribution around
	   it was not what was being disputed. */
	function impliedPpg(dy, team) {
		const chances = team.fga + FT_TRIP * team.fta + team.tov;
		const chanceMult = chances / team.poss;
		const tovShare = team.tov / chances;
		const mean = team.poss * chanceMult * (dy.mpg.mean / 40) * dy.usg.mean *
			(1 - tovShare) * 2 * dy.ts.mean;
		return { mean, p95: mean * 1.50 };
	}
	for (const key of Object.keys(ERAS)) {
		const base = impliedPpg(ERAS[key].draftYear, ERAS[key].team);
		const boost = ERAS[key].shift.ppgBoost || 0;
		const boosted = base.mean * (1 + boost);
		ERAS[key].draftYear.ppg = { mean: boosted, p95: boosted * 1.50 };
	}

	const DEFAULT_ERA = "modern";
	let eraName = DEFAULT_ERA;
	let era = ERAS[DEFAULT_ERA];

	/* The era is a whole-run setting, read by every rate in js/stats.js. The
	   engine sets it once at the top of the stats phase, so a run is internally
	   consistent even though the state lives here.

	   The module-level `era` is a hazard for anything reading a rate OUTSIDE a
	   run: it is whatever the last setEra() call left behind, so with two files
	   loaded at different eras a helper called from the view layer answers for
	   the wrong one. `forEra(name)` returns an era-bound object exposing the
	   same surface, so a caller that knows which era it means can say so and
	   never touch the shared state. The globals stay for the run path, which
	   sets the era once and is checked by tools/test.js. */
	function setEra(name) {
		eraName = ERAS[name] ? name : DEFAULT_ERA;
		era = ERAS[eraName];
		return eraName;
	}
	function currentEra() { return eraName; }
	function eraInfo(name) { return ERAS[name || eraName]; }

	/* The eras a user may actually select, and the ones the harness sweeps.
	   An era marked `unfitted` is in the table and out of both. */
	function fittedEras() {
		return Object.keys(ERAS).filter((k) => !ERAS[k].unfitted);
	}

	function forEra(name) {
		const e = ERAS[name] || ERAS[DEFAULT_ERA];
		return {
			name: ERAS[name] ? name : DEFAULT_ERA,
			info: e,
			DRAFTED: e.draftYear,
			DRAFT_YEAR: e.draftYear,
			ROTATION: e.rotation,
			TEAM: e.team,
			byHeight: (key, b) => byHeightIn(e, key, b),
			effShift: (key) => effShiftIn(e, key),
			chanceShape: () => chanceShapeIn(e),
			/* BOUND, like the three above it. `threeShare` calls byHeight,
			   which reads the module-level `era` — so the one method on this
			   object that was passed through unbound answered for whatever
			   setEra() last left behind, through the API written expressly so
			   a caller outside a run would not have to. It was inert only
			   because no era defines a `share3` shift and the lookup fell
			   through to a multiplier of 1; the first era that defines one
			   would have made it silently wrong. */
			threeShare: (b, tp, ownTp) => threeShareIn(e, b, tp, ownTp),
			talentUsageMult,
			talentEffAdj,
		};
	}

	/* Piecewise-linear interpolation over the height table, with the era's
	   level shift applied to the rates that actually moved between eras. */
	function byHeightIn(e, key, bigness) {
		const t = HEIGHT_TABLE;
		const b = clamp(bigness, 0, 1);
		const s = e.shift[key] === undefined ? 1 : e.shift[key];
		let raw;
		if (b <= t[0].b) raw = t[0][key];
		else {
			raw = t[t.length - 1][key];
			for (let i = 1; i < t.length; i++) {
				if (b <= t[i].b) {
					const f = (b - t[i - 1].b) / (t[i].b - t[i - 1].b);
					raw = t[i - 1][key] + f * (t[i][key] - t[i - 1][key]);
					break;
				}
			}
		}
		return raw * s;
	}
	function byHeight(key, bigness) { return byHeightIn(era, key, bigness); }

	/* The shape of a scoring chance in this era, derived from the era's own
	   team averages rather than from constants that drift away from them:

	     chances  = FGA + 0.44*FTA + TOV       (a possession, plus its putbacks)
	     fgaShare = FGA / chances
	     missShare= 1 - FG%

	   The stat model needs all three to keep the possession identity, the
	   rebound pools and the assist pool consistent with one another. They used
	   to be three hardcoded numbers (0.172 / 0.402 / 0.465) that no longer
	   matched anything the sim produced. */
	function chanceShapeIn(e) {
		const t = e.team;
		const chances = t.fga + FT_TRIP * t.fta + t.tov;
		return {
			chances,
			fgaShare: t.fga / chances,
			missShare: 1 - t.fgp,
			tovShare: t.tov / chances,
			ftr: t.fta / t.fga,
			fgp: t.fgp,
		};
	}
	function chanceShape() { return chanceShapeIn(era); }

	/* Additive efficiency offsets for the era, in points of percentage. */
	function effShiftIn(e, key) {
		const v = e.shift[key];
		return Number.isFinite(v) ? v : 0;
	}
	function effShift(key) { return effShiftIn(era, key); }

	/* Better prospects use a few more possessions and finish them slightly
	   better (lottery vs pick-41+ gradient above). talent is 0-100. */
	/* 0.0022 -> 0.0013, for the reason talentEffAdj came down below: this is
	   the third of four multiplicative overall-rating channels into a college
	   box score. It is also the most redundant of them — js/stats.js already
	   raises (0.35 + 1.3 * talent/100) to USG_TALENT_EXP in the same product,
	   so the talent gradient in raw usage was being applied twice. Over the
	   55-90 span a realistic class occupies this is now 4.6% of extra volume
	   for a lottery pick over a late second-rounder, against the 1.9 points of
	   USG (24.3 vs 22.4) the 2009-21 draft data shows — which the exponent
	   beside it already more than covers. */
	function talentUsageMult(talent) {
		return 1 + 0.0013 * (clamp(talent, 0, 100) - 55);
	}
	/* The efficiency half of the same gradient. This was written, documented
	   and exported — and never called by anything, so "skilled players finish
	   better" was simply not in the model: the measured correlation between
	   overall rating and true shooting was 0.20, almost all of it coming in
	   through usage rather than skill. The slope is steeper than the pooled
	   lottery-vs-second-round gap (0.00055) because the pooled gap averages
	   over every season a prospect played, and the draft-year gradient is
	   sharper; 0.0009 turns the realistic 55-90 prospect talent span into a
	   3.2-point swing in true shooting, which is what a draft board shows.

	   Centered on the mean DRAFT PROSPECT (talent ~72), not on the middle of the
	   0-100 scale, and applied only to prospects: it describes the draft-tier
	   spread inside a class, so it must redistribute efficiency within the
	   class without moving the class mean off the empirical anchor, and without
	   moving the whole-D-I baseline at all (that comes from the filler
	   composites and from the era's fieldEff shift). */
	/* 0.0009 -> 0.00062. The gradient itself is right and the comment above
	   is the reason to keep it, but it is one of four multiplicative channels
	   through which NBA overall rating reaches a college box score, and
	   together they had put corr(ovr, PPG) at 0.50 against the 0.25-0.35 a
	   real draft class runs (see MINUTES_TILT_ABS in js/stats.js, which
	   carried the larger share of the same correction). At 0.00062 the
	   realistic 55-90 prospect talent span is a 2.2-point swing in true
	   shooting rather than 3.2 — still the direction and most of the size a
	   draft board shows, and no longer stacked on top of three other terms
	   saying the same thing. */
	const PROSPECT_TALENT_MEAN = 72;
	function talentEffAdj(talent) {
		return 0.00062 * (clamp(talent, 0, 100) - PROSPECT_TALENT_MEAN);
	}

	/* Expected 3PA share of FGA given size and shooting talent. Anchored to
	   the height-bucket means, then stretched by how far the player's three
	   rating sits from a typical drafted prospect of that size (tp ~55 for
	   guards down to ~35 for centers in preserved BBGM classes). */
	/* `tpRating` is the shooting level the SHARE is stretched by, which the
	   caller may have adjusted for the class's reference volume; `ownTp` is
	   the player's own three-point rating and is what the cannot-shoot damping
	   below reads. They used to be one argument, and the consequence was that
	   the class-level volume correction (up to about ten rating points, see
	   classRefVolume in js/engine.js) lifted a genuine non-shooter over the
	   damping threshold: a seven-footer with a tp of 25 was treated as a
	   35 and took a sixth of his shots from three. The correction exists to
	   align a class's VOLUME with the level the model was fitted at; it is not
	   a claim that anybody can shoot. */
	function threeShareIn(e, bigness, tpRating, ownTp) {
		const base = byHeightIn(e, "share3", bigness);
		const typicalTp = 58 - 26 * clamp(bigness, 0, 1);
		// The slope decides how far a specialist departs from his size's norm.
		// At 0.0062 a Stretch Big with a 75 three still only got to a third of
		// his attempts from range, so the Stretch Big and Pick-and-Pop
		// archetypes never separated from ordinary bigs.
		let share = base + 0.0085 * (tpRating - typicalTp);
		/* A player who cannot shoot does not shoot. The height table floors a
		   seven-footer at an 8.5% three-point rate, so a Post Scorer with a tp
		   rating in the twenties still launched about two a game and made a
		   quarter of them; real post-only bigs take 0.2 a game. Below a tp of
		   30 the share is scaled down towards zero rather than floored. */
		const gate = ownTp === undefined ? tpRating : ownTp;
		if (gate < 30) share *= Math.max(0, gate) / 30;
		return clamp(share, 0, 0.72);
	}
	function threeShare(bigness, tpRating, ownTp) {
		return threeShareIn(era, bigness, tpRating, ownTp);
	}

	global.Calibration = {
		HEIGHT_TABLE, ALL_SEASONS, ERAS, DEFAULT_ERA, FT_TRIP, fittedEras,
		setEra, currentEra, eraInfo, forEra, chanceShape, impliedPpg,
		byHeight, effShift, threeShare, talentUsageMult, talentEffAdj,
		// Live views of the selected era, for callers that want the numbers.
		get DRAFTED() { return era.draftYear; },
		get DRAFT_YEAR() { return era.draftYear; },
		get ROTATION() { return era.rotation; },
		get TEAM() { return era.team; },
	};
})(typeof window !== "undefined" ? window : self);
