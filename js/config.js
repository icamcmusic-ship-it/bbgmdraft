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

		// --- blank colleges ----------------------------------------------
		wEuroLeague: 40,
		wGLeague: 40,
		wNBL: 20,
		pDII: 0.02,            // rare DII NCAA conversion

		// --- class years ---------------------------------------------------
		// BBGM draft classes are nearly all age 19, so class year has to be
		// rolled rather than read off the birthday. This is the share of the
		// class that stayed one year; the rest spread across the other three.
		freshmanShare: 46,

		// Per-archetype rarity overrides, {name: weight}. Empty = use the
		// built-in weights.
		archetypeWeights: null,

		// --- notes -----------------------------------------------------------
		noteLines: ["team", "stats", "shooting", "signature", "awards"],

		// --- college season ----------------------------------------------
		pace: 68,              // team possessions per 40 minutes
		scoringEnv: 0,         // -3 (grind) .. +3 (track meet)
		statNoise: 1.0,        // 0 = deterministic from ratings, 2 = wild

		// --- postseason ---------------------------------------------------
		upsetFactor: 1.0,      // 0 = chalk, 2 = madness
		awardStrictness: 1.0,  // how concentrated national awards are
	};

	const PRESETS = {
		default: {},
		"Loaded class": { classQuality: 2, eliteCount: 4, potBias: 1 },
		"Weak class": { classQuality: -2, eliteCount: 0, potBias: -1, ovrMode: "curve" },
		"Top heavy": { classDepth: -2, eliteCount: 3, ovrMode: "curve" },
		"Deep, no stars": { classDepth: 2, eliteCount: 0, ovrMode: "curve" },
		"Specialist league": { specialization: 1.8, archetypeDiversity: 95, buildNoise: 7 },
		"Vanilla builds": { specialization: 0.2, archetypeDiversity: 20 },
		"One-and-done era": { freshmanShare: 78 },
		"Veteran-heavy class": { freshmanShare: 16 },
		"Chalk March": { upsetFactor: 0.35 },
		"Total madness": { upsetFactor: 1.9 },
	};

	function make(overrides) {
		const cfg = Object.assign({}, DEFAULTS, overrides || {});
		// noteLines is the one array in here; copy it so presets and the URL
		// hash cannot alias the shared default.
		cfg.noteLines = (cfg.noteLines || DEFAULTS.noteLines).slice();
		return cfg;
	}

	global.Config = { DEFAULTS, PRESETS, make };
})(window);
