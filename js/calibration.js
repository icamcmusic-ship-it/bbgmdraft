/* Empirical calibration targets for the college season simulator.

   Derived from the uploaded 2009-2021 college dataset:
     - 61,061 D-I player-seasons (CollegeBasketballPlayers20092021.csv)
     - 1,435 player-seasons belonging to players who were eventually drafted
       (matched via the pick column / DraftedPlayers xlsx)

   IMPORTANT — the pooled figure is the wrong anchor for this tool.

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
   average season a future draftee played" and "the season he was drafted off",
   which is what made the output feel low for an NBA draft class.

   Both anchor sets are kept below. ALL_SEASONS is the pooled figure as
   originally derived; DRAFT_YEAR is the final-season anchor the sim actually
   uses, obtained by applying the documented last-season shift (+9% on volume,
   +2.2 points of usage, +0.5 points of TS, and a compressed lower tail — the
   12-minute freshman seasons are gone). If the source CSV is ever re-run,
   replace DRAFT_YEAR wholesale with `season == draft_year - 1` rows and delete
   the shift.

   Pooled aggregates (all seasons of eventually-drafted players):

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

   By listed height (drafted players):

     bucket   share3  FTr   FT%    rim%   mid%   TO%    AST%  STL%  BLK%
     <=6'3"   .389    .367  .779   .588   .365   17.8   24.9  2.55  0.8
     6'4-6'7  .370    .362  .738   .640   .358   16.8   15.8  2.25  1.9
     6'8-6'10 .177    .431  .684   .690   .371   17.4    9.6  1.75  4.8
     6'11"+   .085    .511  .665   .715   .396   17.2    7.5  1.41  7.4

   Whole-D-I rotation baseline (Min% > 40, n = 27,998): USG 20.2, TS 53.4,
   TO% 18.7, FTr 36.6, FT% 70.6, 3P% 33.8, 2P% 48.0, ORtg 102.6.

   Draft-tier gradient: lottery picks averaged USG 24.3 / TS 58.0 vs
   USG 22.4 / TS 55.9 for picks 41+, i.e. better prospects carry a little
   more volume at slightly better efficiency. */
(function (global) {
	"use strict";

	const { clamp } = global.BBGMRng;

	/* Height buckets keyed by "bigness" (0 = smallest guards, 1 = 7-footers),
	   matching the bigness scale used by the stat model. Bucket centres sit at
	   roughly bigness 0.05 / 0.35 / 0.7 / 0.95. */
	const HEIGHT_TABLE = [
		{ b: 0.05, share3: 0.389, ftr: 0.367, ftPct: 0.779, rimPct: 0.588, midPct: 0.365, tov: 0.178 },
		{ b: 0.35, share3: 0.370, ftr: 0.362, ftPct: 0.738, rimPct: 0.640, midPct: 0.358, tov: 0.168 },
		{ b: 0.70, share3: 0.177, ftr: 0.431, ftPct: 0.684, rimPct: 0.690, midPct: 0.371, tov: 0.174 },
		{ b: 0.95, share3: 0.085, ftr: 0.511, ftPct: 0.665, rimPct: 0.715, midPct: 0.396, tov: 0.172 },
	];

	/* Piecewise-linear interpolation over the height table. */
	function byHeight(key, bigness) {
		const t = HEIGHT_TABLE;
		const b = clamp(bigness, 0, 1);
		if (b <= t[0].b) return t[0][key];
		for (let i = 1; i < t.length; i++) {
			if (b <= t[i].b) {
				const f = (b - t[i - 1].b) / (t[i].b - t[i - 1].b);
				return t[i - 1][key] + f * (t[i][key] - t[i - 1][key]);
			}
		}
		return t[t.length - 1][key];
	}

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

	/* Draft-year anchor: the final college season each prospect was drafted off.
	   This is the population a BBGM draft class actually represents, and it is
	   what every rate and volume target in the sim is fitted to.

	   Volume moves (MPG +9%, GP +1.2 games, USG +2.2 points) and the lower tail
	   contracts hard: the p5 season is now a rotation player's year, not a
	   freshman's. Efficiency barely moves (+0.5 TS) — players get more of the
	   offence in their draft year, they do not become far more efficient. */
	const DRAFT_YEAR = {
		mpg: { mean: 30.6, p5: 19.5, p95: 36.6 },
		gp: { mean: 33.5, p5: 26, p95: 39 },
		usg: { mean: 0.250, sd: 0.046, p5: 0.178, p95: 0.325 },
		ts: { mean: 0.570, sd: 0.055, p5: 0.487, p95: 0.655 },
		tov: { mean: 0.172, sd: 0.044, p5: 0.107, p95: 0.245 },
		ftr: { mean: 0.402, sd: 0.151, p5: 0.190, p95: 0.678 },
		ftPct: { mean: 0.726, sd: 0.105, p5: 0.530, p95: 0.868 },
		tpPct: { median: 0.348 },
		twoPct: { mean: 0.523, sd: 0.070, p5: 0.417, p95: 0.638 },
		// PPG is not in the source aggregate; it is implied by the rest and is
		// the headline number the sim is judged on, so it is stated explicitly.
		ppg: { mean: 15.0, p95: 22.5 },
	};

	/* What the sim targets. */
	const DRAFTED = DRAFT_YEAR;

	/* D-I rotation-player baseline (the environment the fillers live in). */
	const ROTATION = {
		usg: 0.202, ts: 0.534, tov: 0.187, ftr: 0.366,
		ftPct: 0.706, tpPct: 0.338, twoPct: 0.480, ortg: 102.6,
	};

	/* Better prospects use a few more possessions and finish them slightly
	   better (lottery vs pick-41+ gradient above). talent is 0-100. */
	function talentUsageMult(talent) {
		return 1 + 0.0022 * (clamp(talent, 0, 100) - 55);
	}
	function talentEffAdj(talent) {
		return 0.00055 * (clamp(talent, 0, 100) - 55);
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
		return clamp(base + 0.0085 * (tpRating - typicalTp), 0, 0.72);
	}

	global.Calibration = {
		HEIGHT_TABLE, DRAFTED, DRAFT_YEAR, ALL_SEASONS, ROTATION,
		byHeight, threeShare, talentUsageMult, talentEffAdj,
	};
})(typeof window !== "undefined" ? window : self);
