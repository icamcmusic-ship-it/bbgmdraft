/* Default configuration + presets for the draft class generator. */
(function (global) {
	"use strict";

	const DEFAULTS = {
		seed: "",

		// --- class shape -------------------------------------------------
		ovrMode: "preserve",   // "preserve" = never inflate, "curve" = rebuild the class curve
		classQuality: 0,       // -3 (historically bad) .. +3 (loaded)
		classDepth: 0,         // -3 (top heavy) .. +3 (deep)
		eliteCount: 2,         // prospects given a genuine star ceiling
		potBias: 0,            // -3 .. +3 shift on potential
		potSpread: 6,          // sd of the ovr -> pot gap

		// --- builds ------------------------------------------------------
		specialization: 1.0,   // 0 = keep BBGM's samey builds, 2 = extreme specialists
		archetypeDiversity: 85,// 0-100, how often a non-balanced archetype is used
		buildNoise: 5,         // per-rating random jitter (rating points)
		varySize: false,       // let hgt/weight drift with the archetype
		// How strongly each class picks up a flavour of its own (guard-heavy,
		// big-heavy, defensive, shooting-rich, …). 0 = every class has the same
		// archetype mix, 2 = a class is unmistakably one thing.
		classFlavor: 1.0,
		/* How many specialist builds one class may contain, before height
		   coverage tops the pool up. 0 turns the pool off, which restores the
		   pre-2026 behaviour of one of everything in every class. */
		archetypePool: 14,
		/* How many forced anomalies a class gets: a five-star bust, an
		   unranked recruit who turns into a lottery pick, a 24-year-old JUCO,
		   a 7'4" project, the coach's son, the man whose season ended in
		   February. Cheap, memorable, and the reason to reroll. 0 turns them
		   off.

		   Raised from 3 when the pool went from seven kinds to twenty-three:
		   drawing three from seven meant two consecutive classes shared an
		   anomaly about four times in five, so the one feature most worth
		   rerolling for was the one that went stale fastest. */
		surpriseBudget: 4,
		/* How injury-prone this season is. Drawn before a game is played, so it
		   moves records and resumes and not only the note text. */
		injuryRate: 1,

		// --- the season's own story ----------------------------------------
		/* How often the map of college basketball changes. Conference STRENGTH
		   already drifted from year to year; membership never did, so the one
		   constant in a tool built to make every run different was the single
		   most consequential thing that happens to college basketball in real
		   life. A realignment moves two to five of the best programmes in
		   weaker leagues into a conference that is raiding. 0 turns it off. */
		realignmentRate: 0.35,
		/* How many blue bloods have a down year, beyond the ordinary
		   programme-strength roll. "The year three blue bloods all went down"
		   is a season nobody forgets and nothing could ask for it. */
		bluebloodDownYears: 0,
		/* How far the mid-majors are lifted, in programme-strength points. */
		midMajorLift: 0,

		// --- blank colleges ----------------------------------------------
		// Legacy headline sliders. They still work (and old shareable links
		// still decode) but they are folded into leagueWeights below, which is
		// the single source of truth now that there are twenty-four destinations
		// rather than three.
		wEuroLeague: null,
		wGLeague: null,
		wNBL: null,
		pDII: 0.02,            // rare DII NCAA conversion
		// Destination weights for players whose college is blank. Each is
		// further scaled by where the player was born (see Colleges.regions).
		leagueWeights: null,   // null = each league's built-in default weight

		// --- class years and how a prospect got here ------------------------
		// BBGM draft classes are nearly all age 19, so class year has to be
		// rolled rather than read off the birthday. This is the share of the
		// class that stayed one year; the rest spread across the other three.
		freshmanShare: 46,
		// Modern college basketball is a transfer league. This is the share of
		// upperclassmen who arrived from somewhere else — a mid-major jump, a
		// JUCO year, a fifth-year transfer.
		transferShare: 34,
		// Share of the class that took a redshirt year, and the share that
		// reclassified up (or down) a year out of high school.
		redshirtShare: 8,
		reclassShare: 7,

		// Per-archetype rarity overrides, {name: weight}. Empty = use the
		// built-in weights.
		archetypeWeights: null,

		// --- notes -----------------------------------------------------------
		noteLines: ["team", "stats", "shooting", "signature", "awards"],

		// --- college season ----------------------------------------------
		// Which era's empirical anchors the stat model targets. See the header
		// of js/calibration.js: the tool was originally fitted to a 2009-2021
		// dataset that contains the lowest-scoring season since 1952, and
		// reproduced it faithfully, which is why every line read low for a
		// class meant to represent this year.
		era: "modern",
		pace: 68,              // team possessions per 40 minutes
		scoringEnv: 0,         // -3 (grind) .. +3 (track meet)
		// Efficiency, as distinct from possessions. pace and scoringEnv are
		// both possession dials — moving scoringEnv from -3 to +3 changed team
		// points 66 -> 75 and left true shooting at 0.572 in every single
		// configuration — so there was no way at all to ask for a class that
		// scores its points more (or less) efficiently.
		efficiencyEnv: 0,      // -3 (bricks) .. +3 (everything falls)
		statNoise: 1.0,        // 0 = deterministic from ratings, 2 = wild

		// --- postseason ---------------------------------------------------
		upsetFactor: 1.0,      // 0 = chalk, 2 = madness
		// How far into the national field the honours reach. Kept separate
		// from the two things it used to silently also control.
		awardStrictness: 1.0,
		// Conference honours are their own dial: 32 conferences hand out far
		// more hardware than the national voters do, and wanting a realistic
		// number of one is not wanting fewer of the other.
		confAwardStrictness: 1.0,
		// The bar a prospect abroad has to clear for a pro-league honour.
		proAwardStrictness: 1.0,
	};

	const PRESETS = {
		default: {},
		"Loaded class": { classQuality: 2, eliteCount: 4, potBias: 1 },
		"Weak class": { classQuality: -2, eliteCount: 0, potBias: -1, ovrMode: "curve" },
		"Top heavy": { classDepth: -2, eliteCount: 3, ovrMode: "curve" },
		"Deep, no stars": { classDepth: 2, eliteCount: 0, ovrMode: "curve" },
		"Specialist league": { specialization: 1.8, archetypeDiversity: 95, buildNoise: 7, classFlavor: 1.6 },
		"Guard-heavy class": { classFlavor: 2, archetypeDiversity: 92 },
		"Transfer-portal era": { transferShare: 62, freshmanShare: 32 },
		"International class": {
			leagueWeights: {
				"EuroLeague": 40, "Liga ACB": 22, "EuroCup": 20,
				"Adriatic League": 18, "LNB Pro A": 18,
				"Basketball Bundesliga": 16, "Chinese CBA": 10,
				"NBA G League": 8, "NBL": 14, "NBL1": 4,
				"Overtime Elite": 3, "NBA Academy": 8,
			},
		},
		"Vanilla builds": { specialization: 0.2, archetypeDiversity: 20 },
		"One-and-done era": { freshmanShare: 78 },
		"Veteran-heavy class": { freshmanShare: 16 },
		"2015 scoring drought": { era: "2009-2021", pace: 64, efficiencyEnv: -1 },
		"Chalk March": { upsetFactor: 0.35 },
		"Total madness": { upsetFactor: 1.9 },
	};

	/* Built-in destination weights, read from the league table so there is one
	   place to change them. */
	function defaultLeagueWeights() {
		const out = {};
		const NN = (global.Colleges && global.Colleges.NON_NCAA) || {};
		for (const name of Object.keys(NN)) {
			if (name === "DII NCAA") continue;   // has its own probability dial
			out[name] = NN[name].w;
		}
		return out;
	}

	function make(overrides) {
		const cfg = Object.assign({}, DEFAULTS, overrides || {});
		/* Copy every container the UI can write into, so a preset or a URL
		   payload can never be mutated in place by the editor that displays it.

		   noteLines was copied and archetypeWeights was not, even though the
		   archetype-frequency editor writes straight into
		   state.cfg.archetypeWeights: editing a weight after loading a preset
		   (or a shared link) rewrote the preset itself, silently and
		   permanently. leagueWeights is rebuilt below, but from an object the
		   caller still owns. */
		cfg.noteLines = (cfg.noteLines || DEFAULTS.noteLines).slice();
		cfg.archetypeWeights = Object.assign({}, cfg.archetypeWeights || {});
		// Destination weights: start from the built-ins, apply anything the
		// caller set, then fold in the three legacy sliders so old presets and
		// old shareable links still mean what they meant.
		const lw = Object.assign(defaultLeagueWeights(), cfg.leagueWeights || {});
		const legacy = {
			wEuroLeague: "EuroLeague", wGLeague: "NBA G League", wNBL: "NBL",
		};
		for (const key of Object.keys(legacy)) {
			if (Number.isFinite(cfg[key])) lw[legacy[key]] = cfg[key];
		}
		cfg.leagueWeights = lw;
		return cfg;
	}

	global.Config = { DEFAULTS, PRESETS, make, defaultLeagueWeights };
})(typeof window !== "undefined" ? window : self);
