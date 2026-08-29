/* Season stat lines for every prospect, derived from BBGM composite ratings,
   the strength of their conference, and the teammates they share possessions
   with (better teammates => fewer shots, better efficiency, more assists).

   Rate targets (turnovers, free-throw rate, shot mix, shooting percentages)
   are calibrated against the 2009-2021 drafted-player dataset via
   js/calibration.js; see the tables there for the empirical anchors.

   Possession accounting follows the standard identity

       Possessions = FGA - ORB + TOV + 0.44*FTA
   =>  FGA + 0.44*FTA + TOV = Possessions + ORB

   so the scoring *chances* a team gets exceed its possession count by its
   offensive rebounds. D-I ORB% runs ~29%, which puts the ratio near 1.15.
   Conflating the two (the pre-2026 model did) deflated every counting stat by
   about 14%. */
(function (global) {
	"use strict";

	const { clamp } = global.BBGMRng;
	const BB = global.BBGM;
	const C = global.Colleges;
	const CAL = global.Calibration;

	/* Tuning constants for the volume model. Exported so tools/validate.js and
	   any future calibration sweep can read the same numbers the sim uses. */
	const TUNING = {
		MPG_CAP: 37.5,      // D-I minutes leaders run 36-38, not a flat 35.5
		USG_CAP: 0.355,      // share of team possessions while on the floor
		USG_FLOOR: 0.145,   // a drafted player never vanishes from the offence
		USG_EXP: 2.35,       // steepness of the usage composite -> volume curve
		AST_EXP: 2.9,       // elite college PGs take 40-60% of team assists
		REB_EXP: 1.9,
		STL_EXP: 2.1,
		BLK_EXP: 2.6,
		PF_EXP: 1.2,
		ORB_RATE: 0.29,     // D-I offensive rebound rate
		TEAM_PF: 16.8,      // team personal fouls per game
	};

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
		// Soft ceiling. A hard clamp piled a third of all prospects on exactly
		// the cap — eight straight rows of "35.5 MPG" is a wall, not a
		// distribution. Saturate smoothly instead, and find the one scale
		// factor that makes the softened minutes sum to exactly 200, so the
		// workhorse still out-minutes the second option and nobody is pinned.
		const room = TUNING.MPG_CAP - lo;
		const soft = (m) => (m <= lo ? lo : lo + room * (1 - Math.exp(-(m - lo) / room)));
		const totalAt = (k) => mins.reduce((a, m) => a + soft(m * k), 0);
		let klo = 0.05;
		let khi = 40;
		for (let i = 0; i < 60; i++) {
			const mid = (klo + khi) / 2;
			if (totalAt(mid) < 200) klo = mid;
			else khi = mid;
		}
		return mins.map((m) => soft(m * ((klo + khi) / 2)));
	}

	/* ctx: { oppStrength, pace, scoringEnv, pro } */
	function statLine(rng, ratings, comps, minutes, usgShare, ctx, cfg, teamCtx) {
		const noise = clamp(cfg.statNoise, 0, 3);
		// Nobody plays every game. Tweaks, illness, a suspension, a coach's
		// doghouse: the drafted-player GP mean is 32.3 against a ~35-game team
		// schedule, and a sim where everyone is available all year runs high.
		const missed = rng.random() < 0.42
			? 0
			: Math.min(14, Math.round(Math.abs(rng.normal(0, 3.4)) + 1));
		const games = Math.max(5, teamCtx.games - missed);
		const minShare = minutes / 40;

		// Team possessions per game.
		const pace = clamp(cfg.pace + cfg.scoringEnv * 1.6 + teamCtx.paceAdj, 58, 82);

		// Scoring chances this player finishes, per game. usgShare already folds
		// in playing time and sums to 1 across the rotation; chanceMult converts
		// possessions into chances (see the header identity).
		const poss = pace * teamCtx.chanceMult * usgShare;
		// USG% proper: share of team chances used while actually on the floor.
		const usgRate = minutes > 0 ? (usgShare * 40) / minutes : 0;

		// Competition: harder leagues shave efficiency, not volume.
		const compAdj = -0.0022 * (ctx.oppStrength - 52);
		// Teammate spacing/passing helps everyone score more efficiently.
		const synergy = 0.0015 * (teamCtx.support - 50);
		// Volume tax: a low-usage role player picks his shots, a 33%-usage hub
		// takes what the defence gives him. Keeps pass-first guards from being
		// the least efficient scorers on the floor.
		const loadAdj = -0.30 * (usgRate - 0.225);

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

		// Volume jitter is applied to the *inputs*, so that points, FG% and TS%
		// stay reconcilable with the attempts printed beside them.
		const jv = (x, sd) => Math.max(0, x * (1 + rng.normal(0, sd * noise)));
		const fga = jv((poss * (1 - tovRate)) / (1 + 0.44 * ftRate), 0.045);
		const fta = jv(fga * ftRate, 0.06);
		const tov = jv(poss * tovRate, 0.10);

		// Shot mix: 3PA share anchored to the height buckets (.39 for guards
		// down to .085 for 6'11"+), stretched by shooting talent.
		let share3 = CAL.threeShare(bigness, ratings.tp) + rng.normal(0, 0.045 * noise);
		share3 = clamp(share3, 0.0, 0.75);

		const tpa = fga * share3;
		const twoA = fga - tpa;

		// A shared "touch" term so a player's 3P% and FT% move together — the
		// old model drew them independently and produced 46%/58% shooters.
		const touch = rng.normal(0, 1);
		const mix = (t, e) => 0.707 * t + 0.707 * e;

		// Percentages. 3P% centres near the drafted median of .346 for a real
		// shooter; the .14 floor lets non-shooters brick their token attempts.
		// The ceiling opens up for low-volume shooters — real D-I has 47-50%
		// guys, just never on ten attempts a night.
		const tpCeil = clamp(0.46 + 0.09 * Math.max(0, 1 - tpa / 3.5), 0.46, 0.55);
		const tpp = clamp(
			0.335 + 0.28 * (comps.shootingThreePointer - (0.50 - 0.20 * bigness)) +
				compAdj + synergy + loadAdj * 0.6 +
				mix(touch, rng.normal(0, 1)) * 0.028 * noise,
			0.14, tpCeil,
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
			rimMix * insideEff + (1 - rimMix) * midEff + compAdj + synergy + loadAdj +
				rng.normal(0, 0.026 * noise),
			0.34, 0.68,
		);
		// FT%: drafted mean .723 with a real size gradient (.78 guards, .67
		// centers) beyond what the ft rating alone carries.
		const ftp = clamp(
			0.545 + 0.40 * (ratings.ft / 100) - 0.035 * bigness +
				mix(touch, rng.normal(0, 1)) * 0.035 * noise,
			0.35, 0.94,
		);

		const fgm = twoA * twoP + tpa * tpp;
		const fgp = fga > 0 ? fgm / fga : 0;
		const pts = twoA * twoP * 2 + tpa * tpp * 3 + fta * ftp;

		// Counting stats scale off team totals and the player's share. The team
		// totals themselves respond to the roster (see teamPools), so a real
		// shot-blocker raises his team's block count instead of only taking
		// share from his teammates.
		const sh = (comp, exp) => Math.pow(comp, exp) * minShare;
		// Offensive rebounds lean a little more on size and effort than the
		// defensive glass, where everyone boxes out.
		const orbW = Math.pow(comps.rebounding, TUNING.REB_EXP + 0.3) * minShare;
		const drbW = sh(comps.rebounding, TUNING.REB_EXP);
		// No single player takes an unbounded share of a team total: the record
		// books top out near 60% of team assists and blocks, so saturate the
		// share smoothly rather than letting one dominant composite run away
		// with the whole pool.
		// Linear until the knee, then asymptotic to `lim` — so ordinary lines
		// are untouched and only the runaway tail is bent back. Nobody has ever
		// taken 70% of his team's assists or rebounds for a season.
		const saturate = (x, lim, knee) => {
			const t = lim * knee;
			if (x <= t || lim <= 0) return x;
			return t + (lim - t) * (1 - Math.exp(-(x - t) / (lim - t)));
		};
		const shareCap = (x, pool, cap) => saturate(x, pool * cap, 0.62);
		const rebLim = (teamCtx.orbPool + teamCtx.drbPool) * 0.40;
		const rebRaw = (teamCtx.orbPool * orbW) / teamCtx.orbDen +
			(teamCtx.drbPool * drbW) / teamCtx.rebDen;
		const rebScale = rebRaw > 0 ? saturate(rebRaw, rebLim, 0.62) / rebRaw : 1;
		const orb = jv(((teamCtx.orbPool * orbW) / teamCtx.orbDen) * rebScale, 0.14);
		const drb = jv(((teamCtx.drbPool * drbW) / teamCtx.rebDen) * rebScale, 0.09);
		const ast = jv(shareCap(
			(teamCtx.astPool * sh(comps.passing, TUNING.AST_EXP)) / teamCtx.astDen,
			teamCtx.astPool, 0.62), 0.10);
		const stl = jv((teamCtx.stlPool * sh(comps.stealing, TUNING.STL_EXP)) / teamCtx.stlDen, 0.13);
		const blk = jv(shareCap(
			(teamCtx.blkPool * sh(comps.blocking, TUNING.BLK_EXP)) / teamCtx.blkDen,
			teamCtx.blkPool, 0.50), 0.16);
		// Personal fouls: BBGM's fouling composite finally does something, so
		// the Foul-Prone Enforcer archetype has an on-court identity.
		// Starters foul less per minute than the bench does (they are better,
		// and they are the ones a coach protects), so fouls scale with minutes
		// sub-linearly rather than one-for-one.
		const pfW = Math.pow(comps.fouling, TUNING.PF_EXP) * Math.pow(minShare, 0.82);
		// Five fouls ends a night, so a season average saturates well below it.
		const pfRaw = (teamCtx.pfPool * pfW) / teamCtx.pfDen;
		const pf = clamp(jv(saturate(pfRaw, 4.2, 0.60), 0.12), 0, 4.6);

		return {
			gp: games,
			mpg: minutes,
			ppg: pts,
			rpg: orb + drb,
			orpg: orb,
			drpg: drb,
			apg: ast,
			spg: stl,
			bpg: blk,
			topg: tov,
			pfpg: pf,
			fgp, tpp, ftp,
			fga, tpa, fta,
			usg: usgRate,        // USG%: share of chances used while on the floor
			usgShare,            // share of all team chances (sums to 1)
			ts: fga + 0.44 * fta > 0 ? pts / (2 * (fga + 0.44 * fta)) : 0,
		};
	}

	/* Team stat pools. Each responds to the rotation that actually plays: a
	   front line of shot-blockers blocks more shots than a team of guards,
	   rather than the same fixed 4.8 redistributed. `agg` is the
	   minute-weighted mean composite of the five men on the floor. */
	function teamPools(comps, mins, pace, chanceMult) {
		// Two views of the roster: the minute-weighted average of the five men
		// on the floor, and the best specialist on it. Team block totals track
		// the shot-blocker far more than the average (Walker Kessler took 4.6
		// of Auburn's 6.6), so pools blend the two rather than using the mean,
		// which one player can barely move.
		const agg = (key, topWeight) => {
			let a = 0;
			let top = 0;
			for (let i = 0; i < comps.length; i++) {
				a += comps[i][key] * (mins[i] / 40);
				top = Math.max(top, comps[i][key] * clamp(mins[i] / 30, 0, 1));
			}
			const meanOnFloor = a / 5;
			const w = topWeight === undefined ? 0 : topWeight;
			return meanOnFloor * (1 - w) + top * w;
		};
		const scale = (a, base, exp, lo, hi) =>
			clamp(Math.pow(Math.max(0.05, a) / base, exp), lo, hi);

		// Offensive rebound rate moves with the roster's glass work, which in
		// turn sets how many extra scoring chances the team creates.
		const orbRate = clamp(
			TUNING.ORB_RATE * scale(agg("rebounding", 0.25), 0.48, 0.55, 0.7, 1.35), 0.18, 0.42,
		);
		const chances = pace * chanceMult;
		// Team rebounds: their own misses (orbRate of them) plus the
		// opponent's, which arrive at roughly the league-average miss rate.
		const missShare = 0.44;
		const orbPool = chances * missShare * orbRate;
		const drbPool = (24.0 + (pace - 68) * 0.20) *
			scale(agg("rebounding", 0.25), 0.48, 0.35, 0.8, 1.25);

		return {
			orbRate,
			orbPool,
			drbPool,
			// Assists track made field goals, so they ride the chance multiplier.
			astPool: pace * chanceMult * 0.46 * 0.48 *
				scale(agg("passing", 0.22), 0.47, 0.75, 0.75, 1.38),
			stlPool: 6.8 * scale(agg("stealing", 0.30), 0.50, 1.00, 0.70, 1.45),
			blkPool: 5.3 * scale(agg("blocking", 0.70), 0.50, 1.70, 0.55, 2.30),
			pfPool: TUNING.TEAM_PF * scale(agg("fouling", 0.20), 0.48, 0.60, 0.80, 1.25),
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
			// The separator keeps "X1"+i=1 from colliding with "X"+i=11.
			const cr = rng.child("f|" + team.name + "|" + i);
			const f = (base, spread) => clamp(base * (0.55 + 0.9 * r) + cr.normal(0, spread), 0.05, 0.95);
			return {
				usage: f(0.48, 0.07), passing: f(0.45, 0.09), turnovers: f(0.47, 0.07),
				shootingAtRim: f(0.50, 0.09), shootingLowPost: f(0.44, 0.09),
				shootingMidRange: f(0.44, 0.08), shootingThreePointer: f(0.43, 0.10),
				rebounding: f(0.47, 0.10), stealing: f(0.48, 0.07), blocking: f(0.45, 0.10),
				drawingFouls: f(0.47, 0.08), defense: f(0.48, 0.08), fouling: f(0.47, 0.08),
			};
		});

		// Usage: high-usage players on weak teams shoot a lot more. Better
		// prospects also carry a bit more volume (lottery picks averaged
		// USG 24.3 vs 22.4 for picks 41+ in the 2009-21 data). The exponent is
		// steep because BBGM's usage composite only spans ~0.22-0.52 in a real
		// class — a shallow curve leaves the clamp doing all the separating.
		const rawUsg = members.map((m, i) =>
			Math.pow(comps[i].usage, TUNING.USG_EXP) * Math.pow(0.35 + 1.3 * (m.talent / 100), 1.6) *
				CAL.talentUsageMult(m.talent),
		);
		let denom = 0;
		for (let i = 0; i < members.length; i++) denom += rawUsg[i] * mins[i];
		let usgShare = members.map((m, i) => (rawUsg[i] * mins[i]) / denom);

		// Physical envelope: while on the floor nobody uses more than USG_CAP of
		// team chances (Trae Young ran ~34%, Cam Thomas ~34%), and no DRAFTED
		// player disappears from the offence — the drafted p5 is USG 15.6, so
		// prospects floor near 14.5% where fillers may fade to 10%. usgShare is a
		// share of *all* team chances, so the bounds scale with minutes.
		// Same soft saturation as minutes: 15% of prospects used to sit on
		// exactly USG 33.0, which erases the difference between a primary
		// option and a genuine offensive fulcrum. Again solved for the single
		// scale factor that makes the shares sum back to 1.
		// The ceiling is the player's, not the league's. A universal cap made
		// every good prospect converge on the same number: the drafted p95 is
		// USG 30.4, but a shared 35% asymptote put the top 5% all at ~34.
		// A genuine offensive hub can run 35%; a rim-running big cannot, however
		// short-handed his team is.
		const bounds = members.map((m, i) => {
			const ms = mins[i] / 40;
			const floor = (m.filler ? 0.10 : TUNING.USG_FLOOR) * ms;
			const personal = clamp(
				0.252 + 0.50 * (comps[i].usage - 0.42) + 0.075 * ((m.talent - 55) / 45),
				0.185, TUNING.USG_CAP,
			);
			return { floor, room: Math.max(1e-6, personal * ms - floor) };
		});
		const softUsg = (v, i) => {
			const b = bounds[i];
			if (v <= b.floor) return b.floor;
			return b.floor + b.room * (1 - Math.exp(-(v - b.floor) / b.room));
		};
		const usgTotalAt = (k) => usgShare.reduce((a, s, i) => a + softUsg(s * k, i), 0);
		let ulo = 0.05;
		let uhi = 60;
		for (let i = 0; i < 60; i++) {
			const mid = (ulo + uhi) / 2;
			if (usgTotalAt(mid) < 1) ulo = mid;
			else uhi = mid;
		}
		const uk = (ulo + uhi) / 2;
		usgShare = usgShare.map((s, i) => softUsg(s * uk, i));

		// Team support = quality of the other four guys on the floor.
		const teamTalent = members.reduce((a, m, i) => a + m.talent * mins[i], 0) / 200;

		const pace = clamp(cfg.pace + cfg.scoringEnv * 1.6, 58, 82);
		// Chances exceed possessions by the team's offensive rebounds; solve
		// chances = poss + orbRate * missShare * chances for the multiplier.
		// One pass on a nominal ORB rate, then refine with the roster's own.
		const missShare = 0.44;
		let chanceMult = 1 / (1 - TUNING.ORB_RATE * missShare);
		let pools = teamPools(comps, mins, pace, chanceMult);
		chanceMult = clamp(1 / (1 - pools.orbRate * missShare), 1.06, 1.28);
		pools = teamPools(comps, mins, pace, chanceMult);

		const teamCtx = Object.assign({
			games: ctx.games,
			paceAdj: rng.normal(0, 2.0),
			support: teamTalent,
			chanceMult,
			rebDen: 0, orbDen: 0, astDen: 0, stlDen: 0, blkDen: 0, pfDen: 0,
		}, pools);
		for (let i = 0; i < members.length; i++) {
			const ms = mins[i] / 40;
			teamCtx.rebDen += Math.pow(comps[i].rebounding, TUNING.REB_EXP) * ms;
			teamCtx.orbDen += Math.pow(comps[i].rebounding, TUNING.REB_EXP + 0.3) * ms;
			teamCtx.astDen += Math.pow(comps[i].passing, TUNING.AST_EXP) * ms;
			teamCtx.stlDen += Math.pow(comps[i].stealing, TUNING.STL_EXP) * ms;
			teamCtx.blkDen += Math.pow(comps[i].blocking, TUNING.BLK_EXP) * ms;
			teamCtx.pfDen += Math.pow(comps[i].fouling, TUNING.PF_EXP) * Math.pow(ms, 0.82);
		}

		const out = [];
		const totals = { pts: 0, fga: 0, fta: 0, tov: 0, orb: 0, trb: 0, ast: 0, poss: 0 };
		for (let i = 0; i < members.length; i++) {
			const m = members[i];
			// Fillers get a line too — not to show anyone, but so the team
			// totals (points, FGA, possessions) are real numbers the calibration
			// harness can check. Per-player rate bands cannot catch a broken
			// possession model; team points per game can.
			const seed = m.filler
				? "fillerstat|" + team.name + "|" + i
				: "stat:" + m.player.pid;
			// statLine only reads hgt, ft and tp off the ratings row (everything
			// else comes from the composites), so a filler needs just those
			// three. Height is backed out of his blocking composite, which is
			// mostly height by construction.
			const ratings = m.filler
				? { hgt: clamp(30 + 55 * comps[i].blocking * 0.8, 5, 95), ft: 50, tp: 45 }
				: m.player.newRatings;
			const line = statLine(
				rng.child(seed), ratings, comps[i], mins[i], usgShare[i], ctx, cfg, teamCtx,
			);
			totals.pts += line.ppg;
			totals.fga += line.fga;
			totals.fta += line.fta;
			totals.tov += line.topg;
			totals.orb += line.orpg;
			totals.trb += line.rpg;
			totals.ast += line.apg;
			if (m.filler) continue;
			m.player.stats = line;
			out.push({ player: m.player, line });
		}
		totals.poss = totals.fga - totals.orb + totals.tov + 0.44 * totals.fta;
		team.teamTotals = totals;
		return out;
	}

	global.StatsSim = { simulateTeamStats, allocateMinutes, statLine, teamPools, TUNING };
})(window);
