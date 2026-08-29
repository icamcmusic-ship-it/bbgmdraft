/* Season stat lines for every prospect, derived from BBGM composite ratings,
   the strength of their conference, and the teammates they share possessions
   with (better teammates => fewer shots, better efficiency, more assists).

   Rate targets (turnovers, free-throw rate, shot mix, shooting percentages)
   are calibrated against the 2009-2021 drafted-player dataset via
   js/calibration.js; see the tables there for the empirical anchors. */
(function (global) {
	"use strict";

	const { clamp } = global.BBGMRng;
	const BB = global.BBGM;
	const C = global.Colleges;
	const CAL = global.Calibration;

	function shareFromWeights(vals, exp) {
		const p = vals.map((v) => Math.pow(Math.max(0.001, v), exp));
		const s = p.reduce((a, b) => a + b, 0);
		return p.map((v) => v / s);
	}

	/* Allocate minutes across a rotation by talent, then clamp to something a
	   real rotation looks like and renormalise back to 200 team minutes. */
	function allocateMinutes(members, rng) {
		const talentShares = shareFromWeights(
			members.map((m) => m.talent * (1 + rng.normal(0, 0.05))), 1.6,
		);
		// Real rotations are flatter than raw talent: fouls, matchups, blowouts
		// and coaching spread minutes around. Drafted players averaged 28 MPG
		// (p95 36), not a universal 35+ — even a clear best player sits some.
		const uniform = 1 / members.length;
		const shares = talentShares.map((s) => 0.68 * s + 0.32 * uniform);
		let mins = shares.map((s) => 200 * s);
		// Clamp-and-renormalise until stable, ending on a renormalise so team
		// minutes always sum to 200 (the final values drift past the clamp by
		// well under a minute).
		// Adaptive floor: a normal 9-10 man rotation bottoms out at 6 MPG, but
		// an oversized group (many prospects on one school) must still fit in
		// 200 team minutes.
		const lo = Math.min(6, (200 / members.length) * 0.6);
		for (let pass = 0; pass < 10; pass++) {
			mins = mins.map((m) => clamp(m, lo, 35.5));
			const total = mins.reduce((a, b) => a + b, 0);
			mins = mins.map((m) => (m * 200) / total);
		}
		return mins;
	}

	/* ctx: { oppStrength, pace, scoringEnv, pro } */
	function statLine(rng, ratings, comps, minutes, usgShare, ctx, cfg, teamCtx) {
		const noise = clamp(cfg.statNoise, 0, 3);
		const games = teamCtx.games;
		const minShare = minutes / 40;

		// Team possessions per game.
		const pace = clamp(cfg.pace + cfg.scoringEnv * 1.6 + teamCtx.paceAdj, 58, 82);

		// Possessions this player finishes, per game. usgShare already folds in
		// playing time, and sums to 1 across the rotation.
		const poss = pace * usgShare;

		// Competition: harder leagues shave efficiency, not volume.
		const compAdj = -0.0022 * (ctx.oppStrength - 52);
		// Teammate spacing/passing helps everyone score more efficiently.
		const synergy = 0.0015 * (teamCtx.support - 50);

		const bigness = clamp((ratings.hgt - 30) / 55, 0, 1);

		// Turnovers: drafted mean 17.2% of possessions (p5 10.7, p95 24.5),
		// essentially flat across sizes.
		// Skill composites are centred at what a typical prospect of this size
		// actually scores on them (~45 base ratings, hgt = 30+55*bigness), so
		// only above/below-typical skill moves the rate off its empirical anchor.
		const tovRate = clamp(
			CAL.byHeight("tov", bigness) - 0.10 * (comps.turnovers - 0.467) +
				rng.normal(0, 0.014 * noise),
			0.08, 0.27,
		);
		// Free-throw rate climbs steeply with size (FTr .37 guards -> .51
		// seven-footers); foul-drawing skill moves it around that anchor.
		const ftRate = clamp(
			CAL.byHeight("ftr", bigness) + 0.32 * (comps.drawingFouls - (0.42 + 0.11 * bigness)) +
				rng.normal(0, 0.045 * noise),
			0.10, 0.75,
		);

		const fga = (poss * (1 - tovRate)) / (1 + 0.44 * ftRate);
		const fta = fga * ftRate;
		const tov = poss * tovRate;

		// Shot mix: 3PA share anchored to the height buckets (.39 for guards
		// down to .085 for 6'11"+), stretched by shooting talent.
		let share3 = CAL.threeShare(bigness, ratings.tp) + rng.normal(0, 0.045 * noise);
		share3 = clamp(share3, 0.0, 0.75);

		const tpa = fga * share3;
		const twoA = fga - tpa;

		// Percentages. 3P% centres near the drafted median of .346 for a real
		// shooter; the .14 floor lets non-shooters brick their token attempts.
		const tpp = clamp(
			0.335 + 0.28 * (comps.shootingThreePointer - (0.50 - 0.20 * bigness)) +
				compAdj + synergy + rng.normal(0, 0.028 * noise),
			0.14, 0.46,
		);
		// Rim/mid split and finishing: rim FG% runs .59 (guards) to .72 (bigs).
		// The calibration table already carries the height effect, so the skill
		// composites (which lean heavily on hgt) are centred at what a player of
		// this size typically scores on them, to avoid double-counting height.
		// Rim attempts are ~50% of 2PA for guards and ~55% for centers in the
		// data — nearly flat; the size effect lives in rim FG%, not shot mix.
		const rimMix = clamp(0.49 + 0.06 * bigness + 0.10 * (comps.shootingAtRim - comps.shootingMidRange), 0.30, 0.75);
		const insideEff = CAL.byHeight("rimPct", bigness) +
			0.26 * (comps.shootingAtRim - (0.32 + 0.44 * bigness)) +
			0.16 * (comps.shootingLowPost - (0.40 + 0.17 * bigness));
		const midEff = CAL.byHeight("midPct", bigness) + 0.26 * (comps.shootingMidRange - 0.45);
		const twoP = clamp(
			rimMix * insideEff + (1 - rimMix) * midEff + compAdj + synergy +
				rng.normal(0, 0.026 * noise),
			0.34, 0.68,
		);
		// FT%: drafted mean .723 with a real size gradient (.78 guards, .67
		// centers) beyond what the ft rating alone carries.
		const ftp = clamp(
			0.545 + 0.40 * (ratings.ft / 100) - 0.035 * bigness +
				rng.normal(0, 0.035 * noise),
			0.35, 0.94,
		);

		const fgm = twoA * twoP + tpa * tpp;
		const fgp = fga > 0 ? fgm / fga : 0;
		const pts = twoA * twoP * 2 + tpa * tpp * 3 + fta * ftp;

		// Counting stats scale off team totals and the player's share.
		const sh = (comp, exp) => Math.pow(comp, exp) * minShare;
		const trb = (teamCtx.rebPool * sh(comps.rebounding, 1.8)) / teamCtx.rebDen;
		const ast = (teamCtx.astPool * sh(comps.passing, 2.0)) / teamCtx.astDen;
		const stl = (teamCtx.stlPool * sh(comps.stealing, 2.0)) / teamCtx.stlDen;
		const blk = (teamCtx.blkPool * sh(comps.blocking, 2.2)) / teamCtx.blkDen;

		const j = (x, sd) => Math.max(0, x * (1 + rng.normal(0, sd * noise)));

		return {
			gp: games,
			mpg: minutes,
			ppg: j(pts, 0.05),
			rpg: j(trb, 0.08),
			apg: j(ast, 0.10),
			spg: j(stl, 0.13),
			bpg: j(blk, 0.16),
			topg: j(tov, 0.10),
			fgp, tpp, ftp,
			fga, tpa, fta,
			usg: usgShare,
			ts: fga + 0.44 * fta > 0 ? pts / (2 * (fga + 0.44 * fta)) : 0,
		};
	}

	/* Compute the stat lines for one team's whole rotation. Returns entries for
	   the prospects only, but the maths uses everybody. */
	function simulateTeamStats(team, ctx, cfg, rng) {
		// Rotation: draft prospects always crack it (they got drafted — even
		// the drafted p5 played ~13 MPG, not DNPs), plus the best fillers.
		const sorted = team.members.slice().sort((a, b) => b.talent - a.talent);
		const prospects = sorted.filter((m) => !m.filler);
		const fillers = sorted.filter((m) => m.filler);
		const size = Math.max(9, prospects.length);
		const members = prospects
			.concat(fillers.slice(0, Math.max(0, size - prospects.length)))
			.sort((a, b) => b.talent - a.talent);

		const mins = allocateMinutes(members, rng);

		// Composites: real ones for prospects, synthesised for filler teammates.
		// Filler bases sit ~12% above the old values so returning players score
		// composites on the same scale real BBGM rating vectors produce —
		// otherwise prospects out-composite everyone on top of out-talenting them.
		const comps = members.map((m, i) => {
			if (!m.filler) return BB.composites(m.player.newRatings);
			const r = m.talent / 100;
			const cr = rng.child("f" + team.name + i);
			const f = (base, spread) => clamp(base * (0.55 + 0.9 * r) + cr.normal(0, spread), 0.05, 0.95);
			return {
				usage: f(0.48, 0.07), passing: f(0.45, 0.09), turnovers: f(0.47, 0.07),
				shootingAtRim: f(0.50, 0.09), shootingLowPost: f(0.44, 0.09),
				shootingMidRange: f(0.44, 0.08), shootingThreePointer: f(0.43, 0.10),
				rebounding: f(0.47, 0.10), stealing: f(0.48, 0.07), blocking: f(0.45, 0.10),
				drawingFouls: f(0.47, 0.08), defense: f(0.48, 0.08),
			};
		});

		// Usage: high-usage players on weak teams shoot a lot more. Better
		// prospects also carry a bit more volume (lottery picks averaged
		// USG 24.3 vs 22.4 for picks 41+ in the 2009-21 data).
		const rawUsg = members.map((m, i) =>
			Math.pow(comps[i].usage, 2.2) * Math.pow(0.35 + 1.3 * (m.talent / 100), 1.6) *
				CAL.talentUsageMult(m.talent),
		);
		let denom = 0;
		for (let i = 0; i < members.length; i++) denom += rawUsg[i] * mins[i];
		let usgShare = members.map((m, i) => (rawUsg[i] * mins[i]) / denom);

		// Hard physical envelope: while on the floor nobody uses more than 33%
		// of team possessions (the drafted p95 is USG 30.4), and no DRAFTED
		// player disappears from the offence — the drafted p5 is USG 15.6, so
		// prospects floor at 15% where fillers may fade to 10%. usgShare is a
		// share of *all* team possessions, so the bounds scale with minutes.
		for (let pass = 0; pass < 6; pass++) {
			usgShare = usgShare.map((s, i) =>
				clamp(s, (members[i].filler ? 0.10 : 0.15) * (mins[i] / 40), 0.33 * (mins[i] / 40)),
			);
			const tot = usgShare.reduce((a, b) => a + b, 0);
			usgShare = usgShare.map((s) => s / tot);
		}

		// Team support = quality of the other four guys on the floor.
		const teamTalent = members.reduce((a, m, i) => a + m.talent * mins[i], 0) / 200;

		const pace = clamp(cfg.pace + cfg.scoringEnv * 1.6, 58, 82);
		const teamCtx = {
			games: ctx.games,
			paceAdj: rng.normal(0, 2.0),
			support: teamTalent,
			rebPool: 34 + (pace - 68) * 0.28,  // total team rebounds per game
			astPool: pace * 0.46 * 0.48,       // team assists per game
			stlPool: 6.8,
			blkPool: 4.8,
			rebDen: 0, astDen: 0, stlDen: 0, blkDen: 0,
		};
		for (let i = 0; i < members.length; i++) {
			const ms = mins[i] / 40;
			teamCtx.rebDen += Math.pow(comps[i].rebounding, 1.8) * ms;
			teamCtx.astDen += Math.pow(comps[i].passing, 2.0) * ms;
			teamCtx.stlDen += Math.pow(comps[i].stealing, 2.0) * ms;
			teamCtx.blkDen += Math.pow(comps[i].blocking, 2.2) * ms;
		}

		const out = [];
		for (let i = 0; i < members.length; i++) {
			const m = members[i];
			if (m.filler) continue;
			const line = statLine(
				rng.child("stat:" + m.player.pid),
				m.player.newRatings, comps[i], mins[i], usgShare[i], ctx, cfg, teamCtx,
			);
			m.player.stats = line;
			out.push({ player: m.player, line });
		}
		return out;
	}

	global.StatsSim = { simulateTeamStats, allocateMinutes, statLine };
})(window);
