/* Season stat lines for every prospect, derived from BBGM composite ratings,
   the strength of their conference, and the teammates they share possessions
   with (better teammates => fewer shots, better efficiency, more assists). */
(function (global) {
	"use strict";

	const { clamp } = global.BBGMRng;
	const BB = global.BBGM;
	const C = global.Colleges;

	function shareFromWeights(vals, exp) {
		const p = vals.map((v) => Math.pow(Math.max(0.001, v), exp));
		const s = p.reduce((a, b) => a + b, 0);
		return p.map((v) => v / s);
	}

	/* Allocate minutes across a rotation by talent, then clamp to something a
	   real rotation looks like and renormalise back to 200 team minutes. */
	function allocateMinutes(members, rng) {
		const shares = shareFromWeights(
			members.map((m) => m.talent * (1 + rng.normal(0, 0.05))), 1.9,
		);
		let mins = shares.map((s) => 200 * s);
		for (let pass = 0; pass < 6; pass++) {
			mins = mins.map((m) => clamp(m, 7, 35.5));
			const total = mins.reduce((a, b) => a + b, 0);
			mins = mins.map((m) => (m * 200) / total);
		}
		return mins.map((m) => clamp(m, 5, 36));
	}

	function opponentStrength(ctx) {
		return ctx.oppStrength;
	}

	/* ctx: { oppStrength, pace, scoringEnv, pro } */
	function statLine(rng, ratings, comps, minutes, usgShare, ctx, cfg, teamCtx) {
		const noise = clamp(cfg.statNoise, 0, 3);
		const games = ctx.pro ? teamCtx.games : teamCtx.games;
		const minShare = minutes / 40;

		// Team possessions per game.
		const pace = clamp(cfg.pace + cfg.scoringEnv * 1.6 + teamCtx.paceAdj, 58, 82);

		// Possessions this player finishes, per game. usgShare already folds in
		// playing time, and sums to 1 across the rotation.
		const poss = pace * usgShare;

		// Competition: harder leagues shave efficiency, not volume.
		const compAdj = -0.0022 * (opponentStrength(ctx) - 52);
		// Teammate spacing/passing helps everyone score more efficiently.
		const synergy = 0.0015 * (teamCtx.support - 50);

		const tovRate = clamp(0.155 - 0.10 * comps.turnovers + rng.normal(0, 0.012 * noise), 0.04, 0.25);
		const ftRate = clamp(0.16 + 0.42 * comps.drawingFouls + rng.normal(0, 0.03 * noise), 0.05, 0.62);

		const fga = (poss * (1 - tovRate)) / (1 + 0.44 * ftRate);
		const fta = fga * ftRate;
		const tov = poss * tovRate;

		// Shot mix.
		const bigness = clamp((ratings.hgt - 30) / 55, 0, 1);
		let share3 = clamp(
			(ratings.tp - 22) / 78 - 0.30 * bigness + 0.10,
			0.01, 0.78,
		) + rng.normal(0, 0.04 * noise);
		share3 = clamp(share3, 0.0, 0.80);

		const tpa = fga * share3;
		const twoA = fga - tpa;

		// Percentages.
		const tpp = clamp(
			0.310 + 0.30 * (comps.shootingThreePointer - 0.30) + compAdj + synergy +
				rng.normal(0, 0.028 * noise),
			0.14, 0.50,
		);
		const rimMix = clamp(0.30 + 0.55 * bigness, 0.2, 0.85);
		const insideEff = 0.560 + 0.32 * (comps.shootingAtRim - 0.45) + 0.20 * (comps.shootingLowPost - 0.45);
		const midEff = 0.425 + 0.30 * (comps.shootingMidRange - 0.40);
		const twoP = clamp(
			rimMix * insideEff + (1 - rimMix) * midEff + compAdj + synergy +
				rng.normal(0, 0.024 * noise),
			0.28, 0.68,
		);
		const ftp = clamp(0.56 + 0.40 * (ratings.ft / 100) + rng.normal(0, 0.03 * noise), 0.30, 0.96);

		const fgm = twoA * twoP + tpa * tpp;
		const fgp = fga > 0 ? fgm / fga : 0;
		const pts = twoA * twoP * 2 + tpa * tpp * 3 + fta * ftp;

		// Counting stats scale off team totals and the player's share.
		const teamMiss = pace * 0.52;
		const sh = (comp, exp) => Math.pow(comp, exp) * minShare;
		const trb = (teamCtx.rebPool * sh(comps.rebounding, 2.0)) / teamCtx.rebDen;
		const ast = (teamCtx.astPool * sh(comps.passing, 2.2)) / teamCtx.astDen;
		const stl = (teamCtx.stlPool * sh(comps.stealing, 2.0)) / teamCtx.stlDen;
		const blk = (teamCtx.blkPool * sh(comps.blocking, 3.0)) / teamCtx.blkDen;

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
			teamMiss,
		};
	}

	/* Compute the stat lines for one team's whole rotation. Returns entries for
	   the prospects only, but the maths uses everybody. */
	function simulateTeamStats(team, ctx, cfg, rng) {
		const members = team.members
			.slice()
			.sort((a, b) => b.talent - a.talent)
			.slice(0, 9);

		const mins = allocateMinutes(members, rng);

		// Composites: real ones for prospects, synthesised for filler teammates.
		const comps = members.map((m, i) => {
			if (!m.filler) return BB.composites(m.player.newRatings);
			const r = m.talent / 100;
			const cr = rng.child("f" + team.name + i);
			const f = (base, spread) => clamp(base * (0.55 + 0.9 * r) + cr.normal(0, spread), 0.05, 0.95);
			return {
				usage: f(0.45, 0.07), passing: f(0.42, 0.09), turnovers: f(0.45, 0.07),
				shootingAtRim: f(0.45, 0.09), shootingLowPost: f(0.40, 0.09),
				shootingMidRange: f(0.40, 0.08), shootingThreePointer: f(0.40, 0.10),
				rebounding: f(0.42, 0.10), stealing: f(0.45, 0.07), blocking: f(0.38, 0.10),
				drawingFouls: f(0.42, 0.08), defense: f(0.45, 0.08),
			};
		});

		// Usage: high-usage players on weak teams shoot a lot more.
		const rawUsg = members.map((m, i) =>
			Math.pow(comps[i].usage, 2.2) * Math.pow(0.35 + 1.3 * (m.talent / 100), 1.6),
		);
		let denom = 0;
		for (let i = 0; i < members.length; i++) denom += rawUsg[i] * mins[i];
		const usgShare = members.map((m, i) => (rawUsg[i] * mins[i]) / denom);

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
			teamCtx.rebDen += Math.pow(comps[i].rebounding, 2.0) * ms;
			teamCtx.astDen += Math.pow(comps[i].passing, 2.2) * ms;
			teamCtx.stlDen += Math.pow(comps[i].stealing, 2.0) * ms;
			teamCtx.blkDen += Math.pow(comps[i].blocking, 3.0) * ms;
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
		// Bench prospects who did not crack the top 9.
		for (const m of team.members) {
			if (m.filler || m.player.stats) continue;
			const line = statLine(
				rng.child("stat:" + m.player.pid),
				m.player.newRatings, BB.composites(m.player.newRatings),
				rng.uniform(6, 12), 0.13, ctx, cfg, teamCtx,
			);
			m.player.stats = line;
			out.push({ player: m.player, line });
		}
		return out;
	}

	global.StatsSim = { simulateTeamStats, allocateMinutes, statLine };
})(window);
