/* Rebuilds player ratings into varied, specialised builds without inflating
   overall rating. Every build is re-solved so that BBGM's own ovr formula
   returns the target ovr exactly. */
(function (global) {
	"use strict";

	const { clamp } = global.BBGMRng;
	const BB = global.BBGM;

	// Rating offsets that define a build. hgt is never touched here: it is tied
	// to the player's listed height, so archetypes are gated on size instead.
	const ARCHETYPES = [
		{ name: "Floor General", min: 0, max: 46, o: { pss: 22, drb: 16, oiq: 14, ft: 6, spd: 6, ins: -14, dnk: -12, reb: -10, stre: -8 } },
		{ name: "Combo Guard", min: 0, max: 50, o: { fg: 14, tp: 12, drb: 12, spd: 8, pss: -4, diq: -8, reb: -10, ins: -10 } },
		{ name: "Sharpshooter", min: 0, max: 62, o: { tp: 24, ft: 18, fg: 10, oiq: 4, ins: -14, dnk: -12, diq: -10, stre: -8, reb: -8 } },
		{ name: "Slasher", min: 0, max: 64, o: { dnk: 20, spd: 16, jmp: 14, drb: 10, tp: -16, ft: -8, fg: -4, reb: -6 } },
		{ name: "Defensive Pest", min: 0, max: 54, o: { diq: 22, spd: 16, endu: 10, stre: 6, ins: -14, dnk: -8, tp: -6, pss: -4 } },
		{ name: "3&D Wing", min: 38, max: 72, o: { tp: 18, diq: 16, ft: 8, ins: -12, pss: -10, drb: -6, dnk: -4 } },
		{ name: "Two-Way Wing", min: 38, max: 74, o: { diq: 12, oiq: 12, spd: 8, drb: 6, tp: 4, ins: -8, reb: -4 } },
		{ name: "Point Forward", min: 42, max: 76, o: { pss: 20, oiq: 14, drb: 14, tp: -6, ins: -6, dnk: -4 } },
		{ name: "Microwave Scorer", min: 0, max: 100, o: { fg: 16, tp: 12, ins: 10, dnk: 8, diq: -16, pss: -12, oiq: -4 } },
		{ name: "Athletic Freak", min: 0, max: 100, o: { spd: 18, jmp: 20, stre: 12, dnk: 14, oiq: -16, ft: -12, tp: -12, pss: -8 } },
		{ name: "Glue Guy", min: 0, max: 100, o: { diq: 12, oiq: 10, pss: 8, endu: 12, ins: -8, dnk: -8, fg: -4, tp: -2 } },
		{ name: "Stretch Big", min: 54, max: 100, o: { tp: 22, ft: 14, reb: 6, oiq: 4, spd: -10, drb: -10, dnk: -6, ins: -8 } },
		{ name: "Post Scorer", min: 56, max: 100, o: { ins: 24, stre: 16, reb: 10, dnk: 8, tp: -18, spd: -12, drb: -10, ft: -6 } },
		{ name: "Rim Protector", min: 58, max: 100, o: { diq: 22, jmp: 14, reb: 14, stre: 8, oiq: -12, tp: -14, pss: -10, drb: -10 } },
		{ name: "Rim Runner", min: 52, max: 100, o: { dnk: 22, jmp: 16, spd: 10, reb: 8, tp: -18, ft: -14, pss: -10, drb: -12, oiq: -8 } },
		{ name: "Motor Big", min: 50, max: 100, o: { reb: 20, stre: 14, endu: 14, diq: 10, ft: -12, tp: -14, pss: -6 } },
		{ name: "Skilled Big", min: 54, max: 100, o: { ins: 14, pss: 16, oiq: 12, ft: 10, reb: 8, spd: -8, jmp: -6 } },
		{ name: "Balanced", min: 0, max: 100, o: {} },
	];

	// How freely each rating may be shifted when solving for the target ovr.
	// Endurance is scarce for teenagers, so it moves less and never collapses.
	const SHIFT_SCALE = {
		hgt: 0, stre: 1, spd: 1, jmp: 1, endu: 0.35, ins: 1, dnk: 1, ft: 1,
		fg: 1, tp: 1, oiq: 1, diq: 1, drb: 1, pss: 1, reb: 1,
	};

	function pickArchetype(rng, hgtRating, cfg) {
		const eligible = ARCHETYPES.filter(
			(a) => hgtRating >= a.min && hgtRating <= a.max,
		);
		const diversity = clamp(cfg.archetypeDiversity, 0, 100) / 100;
		return rng.weighted(eligible, (a) =>
			a.name === "Balanced" ? 1 - diversity + 0.05 : diversity / 4 + 0.02,
		);
	}

	function applyShift(base, k) {
		const out = {};
		for (const key of BB.RATING_KEYS) {
			out[key] = clamp(Math.round(base[key] + k * SHIFT_SCALE[key]), 0, 100);
		}
		return out;
	}

	// Solve for the uniform shift that makes BBGM's ovr equal targetOvr. The
	// shift preserves the gaps between ratings, so a specialist stays a
	// specialist; it just gets better or worse across the board.
	function solveToOvr(base, targetOvr) {
		let lo = -60;
		let hi = 60;
		if (BB.ovr(applyShift(base, lo)) > targetOvr) return applyShift(base, lo);
		if (BB.ovr(applyShift(base, hi)) < targetOvr) return applyShift(base, hi);
		for (let i = 0; i < 48; i++) {
			const mid = (lo + hi) / 2;
			if (BB.ovr(applyShift(base, mid)) < targetOvr) lo = mid;
			else hi = mid;
		}
		const a = applyShift(base, lo);
		const b = applyShift(base, hi);
		return Math.abs(BB.ovr(a) - targetOvr) <= Math.abs(BB.ovr(b) - targetOvr) ? a : b;
	}

	// Target ovr/pot curve for the whole class ("curve" mode).
	function classCurve(rng, n, cfg) {
		const q = cfg.classQuality;
		const top = 43 + q * 2.6;
		const bottom = 18 + q * 2.0;
		const p = Math.exp(cfg.classDepth * 0.28); // >1 = deep, <1 = top heavy
		const out = [];
		for (let i = 0; i < n; i++) {
			const t = n === 1 ? 0 : i / (n - 1);
			let v = top - (top - bottom) * Math.pow(t, p);
			if (i < cfg.eliteCount) v += (cfg.eliteCount - i) * 2.2 + rng.uniform(0, 3);
			out.push(clamp(Math.round(v + rng.normal(0, 1.6)), 0, 100));
		}
		out.sort((a, b) => b - a);
		return out;
	}

	/* Rebuild one player's ratings.
	   orig: the ratings row from the league file
	   targetOvr / targetPot: what the rebuilt player must come out to */
	function rebuild(rng, orig, targetOvr, targetPot, cfg) {
		const arch = pickArchetype(rng, orig.hgt, cfg);
		const spec = clamp(cfg.specialization, 0, 3);
		const noise = Math.max(0, cfg.buildNoise);

		const base = {};
		for (const key of BB.RATING_KEYS) {
			const off = arch.o[key] || 0;
			base[key] = clamp(
				orig[key] + spec * off + rng.normal(0, noise),
				key === "hgt" ? orig[key] : 1,
				key === "hgt" ? orig[key] : 99,
			);
		}

		const solved = solveToOvr(base, targetOvr);
		const finalOvr = BB.ovr(solved);
		const pot = clamp(Math.max(targetPot, finalOvr + 1), finalOvr, 100);

		return {
			ratings: solved,
			ovr: finalOvr,
			pot: Math.round(pot),
			pos: BB.pos(solved),
			skills: BB.skills(Object.assign({ fuzz: orig.fuzz }, solved)),
			archetype: arch.name,
		};
	}

	global.RatingsBuilder = { ARCHETYPES, rebuild, classCurve, pickArchetype, solveToOvr };
})(window);
