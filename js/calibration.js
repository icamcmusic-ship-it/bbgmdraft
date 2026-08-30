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
	   matching the bigness scale used by the stat model. Bucket centres sit at
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
	   players get more of the offence in their draft year, they do not become
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
			   These two put the field back on 2009-2021's own ORtg of 102.6. */
			shift: { ftr: 1, tov: 1.09, inside: 0, mid: 0, three: 0.015, fieldEff: -0.005 },
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
			   which checks every one of them. */
			shift: { ftr: 0.845, tov: 0.96, inside: 0.021, mid: 0.017, three: 0.004, fieldEff: 0.010 },
		},
	};
	/* PPG, DERIVED.

	   It used to be typed in — 16.0 for the modern era, 15.0 for 2009-2021 —
	   with a comment explaining that it was "the figure the other anchors
	   imply". It was not. Run the identity the rest of this file is built on
	   and the modern anchor set implies 14.6, not 16.0:

	     chances   = FGA + 0.44*FTA + TOV                  = 76.8
	     chanceMult= chances / possessions                 = 1.139
	     tovShare  = TOV / chances                         = 0.151
	     PPG       = poss * chanceMult * (MPG/40) * USG%
	                      * (1 - tovShare) * 2 * TS%       = 14.59

	   The gap is the turnover term. A player's usage INCLUDES the possessions
	   he turns over, and those score nothing; the earlier derivation multiplied
	   usage straight into true shooting and so paid him for them. A stated
	   anchor that disagrees with the anchors it claims to follow is a stated
	   anchor that will be defended against the model forever, so it is computed
	   here instead and can only ever move when the numbers it is computed from
	   move.

	   The 2024 draft's college players bear the derived figure out: the
	   twenty-one first- and second-rounders who played a D-I season that year
	   averaged 14.3 points in it, from Edey's 25.2 down to Carter's 7.4.

	   p95 keeps the 1.50 ratio to the mean that the old stated pair carried
	   (24.0 / 16.0): the LEVEL was wrong, the SHAPE of the distribution around
	   it was not what was being disputed. */
	function impliedPpg(dy, team) {
		const chances = team.fga + 0.44 * team.fta + team.tov;
		const chanceMult = chances / team.poss;
		const tovShare = team.tov / chances;
		const mean = team.poss * chanceMult * (dy.mpg.mean / 40) * dy.usg.mean *
			(1 - tovShare) * 2 * dy.ts.mean;
		return { mean, p95: mean * 1.50 };
	}
	for (const key of Object.keys(ERAS)) {
		ERAS[key].draftYear.ppg = impliedPpg(ERAS[key].draftYear, ERAS[key].team);
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
			threeShare,
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
		const chances = t.fga + 0.44 * t.fta + t.tov;
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
	function talentUsageMult(talent) {
		return 1 + 0.0022 * (clamp(talent, 0, 100) - 55);
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

	   Centred on the mean DRAFT PROSPECT (talent ~72), not on the middle of the
	   0-100 scale, and applied only to prospects: it describes the draft-tier
	   spread inside a class, so it must redistribute efficiency within the
	   class without moving the class mean off the empirical anchor, and without
	   moving the whole-D-I baseline at all (that comes from the filler
	   composites and from the era's fieldEff shift). */
	const PROSPECT_TALENT_MEAN = 72;
	function talentEffAdj(talent) {
		return 0.0009 * (clamp(talent, 0, 100) - PROSPECT_TALENT_MEAN);
	}

	/* Expected 3PA share of FGA given size and shooting talent. Anchored to
	   the height-bucket means, then stretched by how far the player's three
	   rating sits from a typical drafted prospect of that size (tp ~55 for
	   guards down to ~35 for centers in preserved BBGM classes). */
	function threeShare(bigness, tpRating) {
		const base = byHeight("share3", bigness);
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
		if (tpRating < 30) share *= Math.max(0, tpRating) / 30;
		return clamp(share, 0, 0.72);
	}

	global.Calibration = {
		HEIGHT_TABLE, ALL_SEASONS, ERAS, DEFAULT_ERA,
		setEra, currentEra, eraInfo, forEra, chanceShape, impliedPpg,
		byHeight, effShift, threeShare, talentUsageMult, talentEffAdj,
		// Live views of the selected era, for callers that want the numbers.
		get DRAFTED() { return era.draftYear; },
		get DRAFT_YEAR() { return era.draftYear; },
		get ROTATION() { return era.rotation; },
		get TEAM() { return era.team; },
	};
})(typeof window !== "undefined" ? window : self);
