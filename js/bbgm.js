/* Exact reimplementations of the Basketball GM rating formulas, so anything
   this tool generates evaluates identically inside the game.

   Verified against the five uploaded 2289-2293 draft classes: 420/420 players
   match on both ovr and pos. Sources:
     src/worker/core/player/ovr.basketball.ts
     src/worker/core/player/pos.basketball.ts
     src/worker/core/player/compositeRating.ts
     src/common/constants.basketball.ts (COMPOSITE_WEIGHTS)
*/
(function (global) {
	"use strict";

	const RATING_KEYS = [
		"hgt", "stre", "spd", "jmp", "endu", "ins", "dnk", "ft",
		"fg", "tp", "oiq", "diq", "drb", "pss", "reb",
	];

	/* The linear half of BBGM's overall rating, before the piecewise fudge and
	   before rounding.

	   Split out because it is the only exact view of the rating WEIGHTS, and
	   those weights are transcribed a second time in js/ratings.js (as OVR_W)
	   to make every archetype's offset vector ovr-neutral. tools/test.js
	   derives OVR_W from this by finite differences and asserts the two agree,
	   which is impossible against ovr() itself: the fudge is piecewise and the
	   result is rounded to an integer, so a single rating's contribution
	   disappears into the quantisation. Keeping one copy of the weights in this
	   file means the check compares ratings.js against BBGM, and not against
	   a stale second copy of BBGM. */
	function ovrRaw(r) {
		return (
			0.159 * (r.hgt - 47.5) +
			0.0777 * (r.stre - 50.2) +
			0.123 * (r.spd - 50.8) +
			0.051 * (r.jmp - 48.7) +
			0.0632 * (r.endu - 39.9) +
			0.0126 * (r.ins - 42.4) +
			0.0286 * (r.dnk - 49.5) +
			0.0202 * (r.ft - 47.0) +
			0.0726 * (r.tp - 47.1) +
			0.133 * (r.oiq - 46.8) +
			0.159 * (r.diq - 46.7) +
			0.059 * (r.drb - 54.8) +
			0.062 * (r.pss - 51.3) +
			0.01 * (r.fg - 47.0) +
			0.01 * (r.reb - 51.4) +
			48.5
		);
	}

	function ovr(r) {
		const x = ovrRaw(r);

		// Fudge factor, kept in sync with the game.
		let f;
		if (x >= 68) f = 8;
		else if (x >= 50) f = 4 + (x - 50) * (4 / 18);
		else if (x >= 42) f = -5 + (x - 42) * (9 / 8);
		else if (x >= 31) f = -5 - (42 - x) * (5 / 11);
		else f = -10;

		const val = Math.round(x + f);
		return val > 100 ? 100 : val < 0 ? 0 : val;
	}

	const POS_VALUES = {
		PG: 0, SG: 1, SF: 2, PF: 3, C: 4,
		G: 0.5, F: 2.5, FC: 3.5, GF: 1.5,
	};

	function pos(r) {
		const value =
			-0.922949 +
			0.073339 * r.hgt +
			0.009744 * r.stre +
			-0.002215 * r.spd +
			-0.005438 * r.jmp +
			0.003006 * r.endu +
			-0.003516 * r.ins +
			-0.008239 * r.dnk +
			0.001647 * r.ft +
			-0.001404 * r.fg +
			-0.004599 * r.tp +
			0.001407 * r.diq +
			0.002433 * r.oiq +
			-0.000753 * r.drb +
			-0.021888 * r.pss +
			0.016867 * r.reb;

		let minDiff = Infinity;
		let minDiffPos = "F";
		for (const key of Object.keys(POS_VALUES)) {
			const diff = Math.abs(value - POS_VALUES[key]);
			if (diff < minDiff) {
				minDiff = diff;
				minDiffPos = key;
			}
		}
		return minDiffPos;
	}

	const COMPOSITE_WEIGHTS = {
		pace: { ratings: ["spd", "jmp", "dnk", "tp", "drb", "pss"] },
		usage: {
			ratings: ["ins", "dnk", "fg", "tp", "spd", "hgt", "drb", "oiq"],
			weights: [1.5, 1, 1, 1, 0.5, 0.5, 0.5, 0.5],
			skill: { label: "V", cutoff: 0.61 },
		},
		dribbling: {
			ratings: ["drb", "spd"], weights: [1, 1],
			skill: { label: "B", cutoff: 0.68 },
		},
		passing: {
			ratings: ["drb", "pss", "oiq"], weights: [0.4, 1, 0.5],
			skill: { label: "Ps", cutoff: 0.63 },
		},
		turnovers: { ratings: [50, "ins", "pss", "oiq"], weights: [0.5, 1, 1, -1] },
		shootingAtRim: { ratings: ["hgt", "stre", "dnk", "oiq"], weights: [2, 0.3, 0.3, 0.2] },
		shootingLowPost: {
			ratings: ["hgt", "stre", "spd", "ins", "oiq"], weights: [1, 0.6, 0.2, 1, 0.4],
			skill: { label: "Po", cutoff: 0.61 },
		},
		shootingMidRange: { ratings: ["oiq", "fg", "stre"], weights: [-0.5, 1, 0.2] },
		shootingThreePointer: {
			ratings: ["oiq", "tp"], weights: [0.1, 1],
			skill: { label: "3", cutoff: 0.59 },
		},
		shootingFT: { ratings: ["ft"] },
		rebounding: {
			ratings: ["hgt", "stre", "jmp", "reb", "oiq", "diq"],
			weights: [2, 0.1, 0.1, 2, 0.5, 0.5],
			skill: { label: "R", cutoff: 0.61 },
		},
		stealing: { ratings: [50, "spd", "diq"], weights: [1, 1, 2] },
		blocking: { ratings: ["hgt", "jmp", "diq"], weights: [2.5, 1.5, 0.5] },
		fouling: { ratings: [50, "hgt", "diq", "spd"], weights: [3, 1, -1, -1] },
		drawingFouls: { ratings: ["hgt", "spd", "drb", "dnk", "oiq"], weights: [1, 1, 1, 1, 1] },
		defense: { ratings: ["hgt", "stre", "spd", "jmp", "diq"], weights: [1, 1, 1, 0.5, 2] },
		defenseInterior: {
			ratings: ["hgt", "stre", "spd", "jmp", "diq"], weights: [2.5, 1, 0.5, 0.5, 2],
			skill: { label: "Di", cutoff: 0.57 },
		},
		defensePerimeter: {
			ratings: ["hgt", "stre", "spd", "jmp", "diq"], weights: [0.5, 0.5, 2, 0.5, 1],
			skill: { label: "Dp", cutoff: 0.61 },
		},
		endurance: { ratings: [50, "endu"], weights: [1, 1] },
		athleticism: {
			ratings: ["stre", "spd", "jmp", "hgt"], weights: [1, 1, 1, 0.75],
			skill: { label: "A", cutoff: 0.63 },
		},
		jumpBall: { ratings: ["hgt", "jmp"], weights: [1, 0.25] },
	};

	function fuzzRating(rating, fuzz) {
		if (fuzz === undefined || fuzz === null) return rating;
		return Math.round(Math.max(0, Math.min(100, rating + fuzz)));
	}

	function compositeRating(ratings, components, weights, fuzz) {
		const w = weights || new Array(components.length).fill(1);
		let numerator = 0;
		let denominator = 0;
		for (let i = 0; i < components.length; i++) {
			const c = components[i];
			let factor;
			if (typeof c === "number") {
				factor = c;
			} else {
				const v = ratings[c];
				factor = fuzz && c !== "hgt" ? fuzzRating(v, ratings.fuzz) : v;
			}
			numerator += factor * w[i];
			denominator += 100 * w[i];
		}
		const val = numerator / denominator;
		return val < 0 ? 0 : val > 1 ? 1 : val;
	}

	// All composites for one player, unfuzzed (we want true talent, not scouting).
	function composites(ratings) {
		const out = {};
		for (const key of Object.keys(COMPOSITE_WEIGHTS)) {
			const c = COMPOSITE_WEIGHTS[key];
			out[key] = compositeRating(ratings, c.ratings, c.weights, false);
		}
		return out;
	}

	function skills(ratings) {
		const sk = [];
		for (const key of Object.keys(COMPOSITE_WEIGHTS)) {
			const c = COMPOSITE_WEIGHTS[key];
			if (!c.skill) continue;
			if (compositeRating(ratings, c.ratings, c.weights, true) > c.skill.cutoff) {
				sk.push(c.skill.label);
			}
		}
		sk.sort();
		return sk;
	}

	global.BBGM = {
		RATING_KEYS, ovr, ovrRaw, pos, skills, composites, compositeRating,
		COMPOSITE_WEIGHTS, fuzzRating,
	};
})(typeof window !== "undefined" ? window : self);
