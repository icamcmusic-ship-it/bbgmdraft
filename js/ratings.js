/* Rebuilds player ratings into varied, specialised builds without inflating
   overall rating. Every build is re-solved so that BBGM's own ovr formula
   returns the target ovr exactly. */
(function (global) {
	"use strict";

	const { clamp } = global.BBGMRng;
	const BB = global.BBGM;

	/* Rating offsets that define a build. hgt is never touched here: it is tied
	   to the player's listed height, so archetypes are gated on size instead.
	   `w` is a rarity weight (1 = common); the offset shapes are loosely
	   patterned on the drafted-player clusters in the 2009-21 college data
	   (high-assist low-3PA guards, 3&D wings, high-FTr low-FT% bigs, etc.). */
	const ARCHETYPES = [
		// --- guards -------------------------------------------------------
		{ name: "Floor General", min: 0, max: 46, o: { pss: 22, drb: 16, oiq: 14, ft: 6, spd: 6, ins: -14, dnk: -12, reb: -10, stre: -8 } },
		{ name: "Combo Guard", min: 0, max: 50, o: { fg: 14, tp: 12, drb: 12, spd: 8, pss: -4, diq: -8, reb: -10, ins: -10 } },
		{ name: "Sharpshooter", min: 0, max: 62, o: { tp: 24, ft: 18, fg: 10, oiq: 4, ins: -14, dnk: -12, diq: -10, stre: -8, reb: -8 } },
		{ name: "Slasher", min: 0, max: 64, o: { dnk: 20, spd: 16, jmp: 14, drb: 10, tp: -16, ft: -8, fg: -4, reb: -6 } },
		{ name: "Defensive Pest", min: 0, max: 54, o: { diq: 22, spd: 16, endu: 10, stre: 6, ins: -14, dnk: -8, tp: -6, pss: -4 } },
		{ name: "Heliocentric Guard", min: 0, max: 44, w: 0.5, o: { pss: 18, drb: 18, oiq: 16, fg: 10, endu: 8, diq: -16, reb: -12, ins: -10, stre: -6 } },
		{ name: "Pick-and-Roll Maestro", min: 0, max: 46, o: { pss: 18, oiq: 16, drb: 12, fg: 8, tp: 4, dnk: -10, reb: -10, diq: -8, stre: -6 } },
		{ name: "Movement Shooter", min: 0, max: 56, o: { tp: 20, ft: 14, endu: 12, spd: 8, drb: -10, pss: -8, ins: -12, stre: -8 } },
		{ name: "Pull-Up Artist", min: 0, max: 52, o: { fg: 20, tp: 12, drb: 14, oiq: 6, diq: -12, reb: -10, ins: -8, dnk: -6 } },
		{ name: "Downhill Attacker", min: 0, max: 52, o: { spd: 16, dnk: 14, drb: 12, ft: 8, stre: 6, tp: -14, fg: -8, diq: -6, reb: -6 } },
		{ name: "Crafty Finisher", min: 0, max: 48, o: { ins: 14, drb: 14, oiq: 10, ft: 8, fg: 6, tp: -10, jmp: -6, diq: -8, reb: -8 } },
		{ name: "Pass-First Sparkplug", min: 0, max: 42, w: 0.6, o: { pss: 24, spd: 12, oiq: 10, drb: 8, tp: -8, ins: -14, dnk: -10, reb: -10 } },
		{ name: "Ball Hawk", min: 0, max: 50, o: { diq: 20, spd: 14, jmp: 8, oiq: -6, ins: -12, ft: -6, tp: -4, reb: -6 } },
		{ name: "Pesky On-Ball Stopper", min: 0, max: 48, o: { diq: 18, stre: 10, endu: 12, spd: 8, tp: -8, ins: -10, dnk: -8, pss: -6 } },
		{ name: "Score-First Point", min: 0, max: 44, o: { fg: 14, ins: 10, tp: 10, drb: 10, spd: 6, pss: -10, diq: -10, reb: -8 } },
		{ name: "Sixth-Man Gunner", min: 0, max: 54, w: 0.8, o: { tp: 16, fg: 14, endu: 8, oiq: -6, pss: -8, diq: -10, reb: -8 } },
		{ name: "Streaky Volume Scorer", min: 0, max: 56, w: 0.7, o: { fg: 18, tp: 14, dnk: 8, ft: 6, oiq: -10, diq: -12, pss: -8, reb: -6 } },
		{ name: "Change-of-Pace Guard", min: 0, max: 46, w: 0.6, o: { spd: 18, drb: 14, pss: 10, endu: 8, tp: -8, ins: -10, reb: -10, stre: -8 } },
		{ name: "Post-Up Guard", min: 24, max: 46, w: 0.35, o: { stre: 16, ins: 14, ft: 8, oiq: 8, spd: -10, tp: -10, drb: -6, jmp: -6 } },
		{ name: "Free-Throw Merchant", min: 0, max: 54, w: 0.5, o: { ft: 18, drb: 12, oiq: 10, spd: 6, ins: 6, tp: -10, diq: -12, reb: -8 } },
		// --- wings --------------------------------------------------------
		{ name: "3&D Wing", min: 34, max: 64, o: { tp: 18, diq: 16, ft: 8, ins: -12, pss: -10, drb: -6, dnk: -4 } },
		{ name: "Two-Way Wing", min: 34, max: 66, o: { diq: 12, oiq: 12, spd: 8, drb: 6, tp: 4, ins: -8, reb: -4 } },
		{ name: "Point Forward", min: 40, max: 70, o: { pss: 20, oiq: 14, drb: 14, tp: -6, ins: -6, dnk: -4 } },
		{ name: "Wing Sniper", min: 36, max: 64, o: { tp: 22, ft: 14, oiq: 6, drb: -8, ins: -12, dnk: -8, stre: -6, pss: -6 } },
		{ name: "Shot-Creating Wing", min: 36, max: 66, o: { fg: 16, drb: 12, tp: 8, oiq: 8, diq: -10, reb: -8, ins: -6, pss: -4 } },
		{ name: "Transition Wing", min: 34, max: 64, o: { spd: 16, dnk: 14, endu: 10, jmp: 8, tp: -10, fg: -8, ft: -6, ins: -6 } },
		{ name: "Cutter / Finisher", min: 36, max: 66, o: { dnk: 18, jmp: 12, oiq: 10, endu: 6, tp: -12, drb: -10, pss: -8, fg: -4 } },
		{ name: "Wing Stopper", min: 36, max: 62, o: { diq: 22, stre: 6, endu: 10, spd: 8, fg: -10, tp: -8, pss: -8, ins: -8 } },
		{ name: "Rebounding Wing", min: 40, max: 62, w: 0.8, o: { reb: 14, jmp: 10, stre: 8, endu: 8, tp: -10, pss: -8, drb: -8, ft: -6 } },
		{ name: "Corner Specialist", min: 34, max: 62, w: 0.8, o: { tp: 18, diq: 8, oiq: 8, drb: -12, pss: -10, ins: -10, fg: -4 } },
		{ name: "Midrange Operator", min: 36, max: 66, w: 0.7, o: { fg: 22, ft: 10, oiq: 8, tp: -12, dnk: -8, reb: -6, pss: -6 } },
		{ name: "Jumbo Playmaker", min: 42, max: 68, w: 0.5, o: { pss: 18, drb: 16, oiq: 12, fg: 6, diq: -10, reb: -8, ins: -8, jmp: -6 } },
		{ name: "Energy Wing", min: 34, max: 64, o: { endu: 14, spd: 10, jmp: 10, reb: 8, diq: 6, tp: -10, fg: -10, pss: -8, ft: -6 } },
		{ name: "Do-It-All Forward", min: 40, max: 70, w: 0.8, o: { oiq: 10, pss: 8, reb: 8, diq: 8, fg: 4, tp: -6, dnk: -6, ins: -6 } },
		{ name: "Bully Slasher", min: 38, max: 66, w: 0.7, o: { stre: 16, dnk: 14, ins: 10, ft: 6, tp: -14, fg: -8, pss: -8, drb: -4 } },
		{ name: "Glide Athlete", min: 36, max: 66, w: 0.7, o: { jmp: 20, spd: 14, dnk: 12, tp: -10, ft: -10, oiq: -10, pss: -8, ins: -4 } },
		// --- everyone -----------------------------------------------------
		{ name: "Microwave Scorer", min: 0, max: 80, w: 0.7, o: { fg: 16, tp: 12, ins: 10, dnk: 8, diq: -16, pss: -12, oiq: -4 } },
		{ name: "Athletic Freak", min: 0, max: 100, w: 0.7, o: { spd: 18, jmp: 20, stre: 12, dnk: 14, oiq: -16, ft: -12, tp: -12, pss: -8 } },
		{ name: "Glue Guy", min: 0, max: 100, w: 0.8, o: { diq: 12, oiq: 10, pss: 8, endu: 12, ins: -8, dnk: -8, fg: -4, tp: -2 } },
		{ name: "High-IQ Connector", min: 0, max: 100, w: 0.7, o: { oiq: 16, pss: 12, diq: 8, tp: 4, dnk: -10, jmp: -8, ins: -8, fg: -4 } },
		{ name: "Raw Project", min: 0, max: 100, w: 0.5, o: { jmp: 14, spd: 10, stre: 10, endu: 6, oiq: -14, diq: -10, ft: -10, tp: -8, fg: -6 } },
		{ name: "Iron Man", min: 0, max: 100, w: 0.5, o: { endu: 20, stre: 8, diq: 6, oiq: 6, dnk: -8, tp: -6, ins: -8, jmp: -6 } },
		// --- bigs ---------------------------------------------------------
		{ name: "Stretch Big", min: 54, max: 100, o: { tp: 22, ft: 14, reb: 6, oiq: 4, spd: -10, drb: -10, dnk: -6, ins: -8 } },
		{ name: "Post Scorer", min: 56, max: 100, o: { ins: 24, stre: 16, reb: 10, dnk: 8, tp: -18, spd: -12, drb: -10, ft: -6 } },
		{ name: "Rim Protector", min: 58, max: 100, o: { diq: 22, jmp: 14, reb: 14, stre: 8, oiq: -12, tp: -14, pss: -10, drb: -10 } },
		{ name: "Rim Runner", min: 52, max: 100, o: { dnk: 22, jmp: 16, spd: 10, reb: 8, tp: -18, ft: -14, pss: -10, drb: -12, oiq: -8 } },
		{ name: "Motor Big", min: 50, max: 100, o: { reb: 20, stre: 14, endu: 14, diq: 10, ft: -12, tp: -14, pss: -6 } },
		{ name: "Skilled Big", min: 54, max: 100, o: { ins: 14, pss: 16, oiq: 12, ft: 10, reb: 8, spd: -8, jmp: -6 } },
		{ name: "Point Center", min: 60, max: 100, w: 0.35, o: { pss: 22, oiq: 16, drb: 10, ft: 6, dnk: -10, jmp: -8, diq: -8, tp: -6 } },
		{ name: "Offensive Rebounding Menace", min: 54, max: 100, o: { reb: 22, stre: 12, jmp: 10, endu: 8, ft: -14, tp: -12, pss: -10, drb: -6 } },
		{ name: "Switchable Big", min: 54, max: 100, w: 0.8, o: { spd: 14, diq: 14, endu: 8, jmp: 6, ins: -10, ft: -8, pss: -8, tp: -6 } },
		{ name: "Mobile Shot-Swatter", min: 56, max: 100, o: { jmp: 18, diq: 16, spd: 8, reb: 6, oiq: -12, ins: -10, ft: -10, tp: -8 } },
		{ name: "Face-Up Four", min: 50, max: 78, o: { fg: 16, tp: 10, drb: 8, oiq: 8, ins: -8, stre: -8, reb: -8, pss: -6 } },
		{ name: "Low-Post Bruiser", min: 56, max: 100, w: 0.8, o: { stre: 20, ins: 16, reb: 10, dnk: 6, spd: -14, tp: -14, ft: -10, drb: -8 } },
		{ name: "Pick-and-Pop Big", min: 52, max: 100, o: { tp: 18, ft: 12, oiq: 8, fg: 8, drb: -10, spd: -8, reb: -8, ins: -6 } },
		{ name: "Lob Threat", min: 56, max: 100, o: { dnk: 20, jmp: 18, endu: 6, tp: -16, ft: -12, drb: -10, pss: -8, fg: -6 } },
		{ name: "Old-School Center", min: 60, max: 100, w: 0.7, o: { ins: 18, stre: 14, reb: 12, oiq: 6, spd: -14, tp: -16, drb: -10, ft: -8 } },
		{ name: "Undersized Rebounder", min: 46, max: 64, w: 0.5, o: { reb: 20, stre: 14, endu: 10, diq: 6, tp: -10, fg: -8, drb: -8, pss: -6 } },
		{ name: "Foul-Prone Enforcer", min: 54, max: 100, w: 0.35, o: { stre: 18, diq: 10, ins: 8, reb: 8, oiq: -14, ft: -10, spd: -8, tp: -8 } },
		{ name: "Balanced", min: 0, max: 100, o: {} },
	];

	// How freely each rating may be shifted when solving for the target ovr.
	// Endurance is scarce for teenagers, so it moves less and never collapses.
	const SHIFT_SCALE = {
		hgt: 0, stre: 1, spd: 1, jmp: 1, endu: 0.35, ins: 1, dnk: 1, ft: 1,
		fg: 1, tp: 1, oiq: 1, diq: 1, drb: 1, pss: 1, reb: 1,
	};

	// Linear ovr weight of each rating (from BBGM's ovr formula). Used to make
	// every archetype's offset vector ovr-neutral by construction: without
	// this, a build loading on diq (.159) forces the solver to gut everything
	// else, while one loading on ins (.0126) barely specialises at all — the
	// specialisation slider would mean something different per archetype.
	const OVR_W = {
		hgt: 0.159, stre: 0.0777, spd: 0.123, jmp: 0.051, endu: 0.0632,
		ins: 0.0126, dnk: 0.0286, ft: 0.0202, fg: 0.01, tp: 0.0726,
		oiq: 0.133, diq: 0.159, drb: 0.059, pss: 0.062, reb: 0.01,
	};
	(function normalizeArchetypes() {
		let shiftW = 0;
		for (const k of BB.RATING_KEYS) shiftW += OVR_W[k] * SHIFT_SCALE[k];
		for (const a of ARCHETYPES) {
			let push = 0;
			for (const k of Object.keys(a.o)) push += OVR_W[k] * a.o[k];
			const u = push / shiftW;
			if (Math.abs(u) < 0.05) continue;
			const o = {};
			for (const k of BB.RATING_KEYS) {
				if (k === "hgt") continue;
				const v = (a.o[k] || 0) - u * SHIFT_SCALE[k];
				if (Math.abs(v) >= 0.25) o[k] = Math.round(v * 4) / 4;
			}
			a.o = o;
		}
	})();

	function pickArchetype(rng, hgtRating, cfg) {
		const eligible = ARCHETYPES.filter(
			(a) => hgtRating >= a.min && hgtRating <= a.max,
		);
		const diversity = clamp(cfg.archetypeDiversity, 0, 100) / 100;
		// Balanced keeps ~(1 - diversity) of the probability mass however many
		// specialist builds are eligible; the rest is split by rarity weight.
		const specialists = eligible.filter((a) => a.name !== "Balanced");
		const wSum = specialists.reduce((s, a) => s + (a.w || 1), 0) || 1;
		return rng.weighted(eligible, (a) =>
			a.name === "Balanced"
				? 1 - diversity + 0.05
				: ((diversity + 0.02) * (a.w || 1)) / wSum,
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
