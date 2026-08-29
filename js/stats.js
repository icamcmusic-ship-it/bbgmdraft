/* Season stat lines for every prospect, derived from BBGM composite ratings,
   the strength and *defensive shape* of the teams they face, and the teammates
   they share possessions with (better teammates => fewer shots, better
   efficiency, more assists).

   Rate targets (turnovers, free-throw rate, shot mix, shooting percentages)
   are calibrated against the 2009-2021 college dataset via js/calibration.js —
   specifically against the DRAFT_YEAR anchor there (a prospect's final,
   highest-usage college season), not the pooled all-seasons anchor. See the
   header of that file for why the pooled figure deflated every volume stat by
   roughly 9%.

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
	const CAL = global.Calibration;

	/* Tuning constants for the volume model. Exported so tools/validate.js and
	   any future calibration sweep can read the same numbers the sim uses. */
	const TUNING = {
		MPG_CAP: 37.5,      // D-I minutes leaders run 36-38, not a flat 35.5
		USG_CAP: 0.365,     // share of team possessions while on the floor
		USG_FLOOR: 0.155,   // a drafted player never vanishes from the offence
		USG_EXP: 2.35,      // steepness of the usage composite -> volume curve
		AST_EXP: 4.1,       // elite college PGs take 40-60% of team assists
		REB_EXP: 1.25,
		STL_EXP: 2.1,
		BLK_EXP: 2.6,
		PF_EXP: 1.2,
		ORB_RATE: 0.29,     // D-I offensive rebound rate
		TEAM_PF: 16.8,      // team personal fouls per game
		// Share of made field goals that are assisted. D-I runs ~53%; the old
		// model multiplied raw chances by 0.46*0.48, which implied ~36 made
		// field goals on a team that makes ~26, and put team assists 24% high.
		ASSISTED_SHARE: 0.53,
		// Nominal rates used only to turn chances into an assist pool. They are
		// the same anchors the per-player model draws around.
		NOMINAL_TOV: 0.172,
		NOMINAL_FTR: 0.402,
		NOMINAL_FGP: 0.465,
		// Documented per-player ceilings, now actually enforced (see capNoisy).
		AST_CAP: 0.62,
		REB_CAP: 0.40,
		// Walker Kessler took 4.6 of Auburn's 6.6 blocks — 70%. The old 0.50
		// cap forbade by construction the exact season the comment cited.
		BLK_CAP: 0.68,
		STL_CAP: 0.42,
		// Minutes are flatter than talent, but not as flat as they were: 32% of
		// minutes handed out uniformly made an NBA prospect the fourth option
		// on his own blue-blood roster.
		MINUTES_UNIFORM: 0.22,
	};

	/* Per-league environment. Everything outside D-I used to run on cfg.pace —
	   the slider labelled "College season -> Pace" — so dragging it rewrote
	   EuroLeague box scores, and every league was scored over a 40-minute game
	   even though the G League plays 48, which made G League per-game numbers
	   ~17% low by construction.

	   pace is possessions per *game*, gameMinutes is the length of that game,
	   and youthCap is the minutes ceiling a 19-year-old actually gets: the
	   single most characteristic fact about a teenager at Real Madrid is that
	   he does not play 30 minutes. */
	const LEAGUE_ENV = {
		"EuroLeague":            { pace: 70, gameMinutes: 40, youthCap: 22, mpgCap: 32 },
		"NBA G League":          { pace: 103, gameMinutes: 48, youthCap: 30, mpgCap: 38 },
		"Liga ACB":              { pace: 72, gameMinutes: 40, youthCap: 20, mpgCap: 32 },
		"NBL":                   { pace: 76, gameMinutes: 40, youthCap: 24, mpgCap: 34 },
		"Chinese CBA":           { pace: 82, gameMinutes: 48, youthCap: 26, mpgCap: 38 },
		"LNB Pro A":             { pace: 74, gameMinutes: 40, youthCap: 24, mpgCap: 33 },
		"EuroCup":               { pace: 72, gameMinutes: 40, youthCap: 24, mpgCap: 33 },
		"Basketball Bundesliga": { pace: 76, gameMinutes: 40, youthCap: 24, mpgCap: 33 },
		"Adriatic League":       { pace: 74, gameMinutes: 40, youthCap: 26, mpgCap: 34 },
		"NBL1":                  { pace: 82, gameMinutes: 40, youthCap: 30, mpgCap: 36 },
		// Youth leagues: everybody is a teenager, so there is nothing to cap.
		"Overtime Elite":        { pace: 84, gameMinutes: 40, youthCap: null, mpgCap: 34 },
		"NBA Academy":           { pace: 76, gameMinutes: 40, youthCap: null, mpgCap: 34 },
		"DII NCAA":              { pace: null, gameMinutes: 40, youthCap: null, mpgCap: 37.5 },
	};
	// Everything else (D-I, and any league without an entry) takes cfg.pace and
	// a 40-minute game.
	const NCAA_ENV = { pace: null, gameMinutes: 40, youthCap: null, mpgCap: TUNING.MPG_CAP };

	function leagueEnv(name) {
		return LEAGUE_ENV[name] || NCAA_ENV;
	}

	function shareFromWeights(vals, exp) {
		const p = vals.map((v) => Math.pow(Math.max(0.001, v), exp));
		const s = p.reduce((a, b) => a + b, 0);
		return p.map((v) => v / s);
	}

	/* Allocate minutes across a rotation by talent, then clamp to something a
	   real rotation looks like and renormalise back to the team's minutes. */
	function allocateMinutes(members, rng, comps, env) {
		const e = env || NCAA_ENV;
		const gameMinutes = e.gameMinutes || 40;
		const teamMinutes = 5 * gameMinutes;
		const cap = Math.min(e.mpgCap || TUNING.MPG_CAP, gameMinutes - 2);
		// Endurance finally does something. A 90-endurance iron man and a
		// 30-endurance big used to draw identical minutes; the rating moved ovr
		// and nothing else. Ball-handling size gets a small nudge too: guards
		// are harder to sub than bigs, which is why college guards out-minute
		// college bigs at equal quality.
		const stamina = members.map((m, i) => {
			const c = comps && comps[i];
			const endu = c ? c.endurance : (m.endurance === undefined ? 0.5 : m.endurance);
			const bigness = c ? clamp((c.blocking - 0.18) / 0.55, 0, 1) : 0.45;
			return (0.80 + 0.40 * clamp(endu, 0, 1)) * (1 + 0.10 * (0.45 - bigness));
		});
		const talentShares = shareFromWeights(
			members.map((m, i) => m.talent * stamina[i] * (1 + rng.normal(0, 0.05))), 1.6,
		);
		// Real rotations are flatter than raw talent: fouls, matchups, blowouts
		// and coaching spread minutes around. But not as flat as they were.
		const uniform = 1 / members.length;
		const u = TUNING.MINUTES_UNIFORM;
		const shares = talentShares.map((s) => (1 - u) * s + u * uniform);
		let mins = shares.map((s) => teamMinutes * s);
		// Clamp-and-renormalise, ending on a renormalise so team minutes always
		// sum to the team total.
		// Adaptive floor: a normal 9-10 man rotation bottoms out at 6 MPG, but
		// an oversized group (many prospects on one school) must still fit.
		const lo = Math.min(6, (teamMinutes / members.length) * 0.6);
		// Soft ceiling. A hard clamp piled a third of all prospects on exactly
		// the cap — eight straight rows of "35.5 MPG" is a wall, not a
		// distribution. Saturate smoothly instead, and find the one scale
		// factor that makes the softened minutes sum to exactly the team total.
		const room = cap - lo;
		const soft = (m) => (m <= lo ? lo : lo + room * (1 - Math.exp(-(m - lo) / room)));
		const totalAt = (k) => mins.reduce((a, m) => a + soft(m * k), 0);
		let klo = 0.05;
		let khi = 40;
		for (let i = 0; i < 60; i++) {
			const mid = (klo + khi) / 2;
			if (totalAt(mid) < teamMinutes) klo = mid;
			else khi = mid;
		}
		return mins.map((m) => soft(m * ((klo + khi) / 2)));
	}

	/* A team's defensive shape, from the rotation that actually plays it.

	   BBGM gives defenseInterior and defensePerimeter composites and the stat
	   model used neither: team defensive quality had exactly one channel into
	   an opponent's box score, a flat efficiency shave off oppStrength, so a
	   front line of rim protectors did not actually reduce anyone's rim FG%.
	   This is the profile that does it. Values are centred at ~0 for an average
	   D-I rotation and read in points of percentage. */
	function defenseProfile(comps, mins, teamMinutes) {
		const tm = teamMinutes || 200;
		let rim = 0;
		let per = 0;
		let ovr = 0;
		let force = 0;
		for (let i = 0; i < comps.length; i++) {
			const w = (mins[i] * 5) / tm;
			rim += comps[i].defenseInterior * w;
			per += comps[i].defensePerimeter * w;
			ovr += comps[i].defense * w;
			force += comps[i].stealing * w;
		}
		const n = 5;
		return {
			rim: rim / n - 0.46,
			perimeter: per / n - 0.46,
			overall: ovr / n - 0.47,
			force: force / n - 0.49,
		};
	}

	/* The same profile, computed cheaply from a roster before any stat line
	   exists, so the engine can work out what each team's OPPONENTS looked like
	   defensively and feed that back in. Fillers are approximated from talent
	   the same way simulateTeamStats does. */
	function rosterDefenseProfile(team) {
		const sorted = team.members.slice().sort((a, b) => b.talent - a.talent).slice(0, 8);
		let rim = 0;
		let per = 0;
		let ovr = 0;
		let w = 0;
		for (let i = 0; i < sorted.length; i++) {
			const m = sorted[i];
			const weight = [1, 0.96, 0.9, 0.84, 0.76, 0.6, 0.45, 0.3][i] || 0.2;
			let di;
			let dp;
			let d;
			if (m.filler) {
				const r = m.talent / 100;
				di = clamp(0.46 * (0.55 + 0.9 * r), 0.05, 0.95);
				dp = clamp(0.46 * (0.55 + 0.9 * r), 0.05, 0.95);
				d = clamp(0.48 * (0.55 + 0.9 * r), 0.05, 0.95);
			} else {
				const c = BB.composites(m.player.newRatings);
				di = c.defenseInterior;
				dp = c.defensePerimeter;
				d = c.defense;
			}
			rim += di * weight;
			per += dp * weight;
			ovr += d * weight;
			w += weight;
		}
		if (!w) return { rim: 0, perimeter: 0, overall: 0, force: 0 };
		return {
			rim: rim / w - 0.46,
			perimeter: per / w - 0.46,
			overall: ovr / w - 0.47,
			force: 0,
		};
	}

	/* ctx: { oppStrength, oppDefense, games, league, pro } */
	function statLine(rng, ratings, comps, minutes, usgShare, ctx, cfg, teamCtx) {
		const noise = clamp(cfg.statNoise, 0, 3);
		const env = teamCtx.env || NCAA_ENV;
		const gameMinutes = env.gameMinutes || 40;
		// Nobody plays every game. Tweaks, illness, a suspension, a coach's
		// doghouse: the draft-year GP mean is 33.5 against a ~35-game team
		// schedule, and a sim where everyone is available all year runs high.
		const missed = rng.random() < 0.46
			? 0
			: Math.min(14, Math.round(Math.abs(rng.normal(0, 3.1)) + 1));
		const games = Math.max(5, teamCtx.games - missed);
		const minShare = minutes / gameMinutes;

		// Team possessions per game.
		const pace = teamCtx.pace;

		// Scoring chances this player finishes, per game. usgShare already folds
		// in playing time and sums to 1 across the rotation; chanceMult converts
		// possessions into chances (see the header identity).
		const poss = pace * teamCtx.chanceMult * usgShare;
		// USG% proper: share of team chances used while actually on the floor.
		const usgRate = minutes > 0 ? (usgShare * gameMinutes) / minutes : 0;

		// Competition: harder leagues shave efficiency, not volume.
		const compAdj = -0.0022 * (ctx.oppStrength - 52);
		// The defences actually faced. `oppDefense` is the minute-weighted
		// average defensive profile of this team's schedule, so a prospect in a
		// conference full of shot-blockers finishes worse at the rim than the
		// same player in a conference of guards.
		const od = ctx.oppDefense || { rim: 0, perimeter: 0, overall: 0 };
		// Teammate spacing/passing helps everyone score more efficiently.
		const synergy = 0.0015 * (teamCtx.support - 50);
		// Volume tax: a low-usage role player picks his shots, a 33%-usage hub
		// takes what the defence gives him. Keeps pass-first guards from being
		// the least efficient scorers on the floor.
		const loadAdj = -0.30 * (usgRate - 0.245);

		const bigness = clamp((ratings.hgt - 30) / 55, 0, 1);

		// Turnovers: draft-year mean 17.2% of possessions (p5 10.7, p95 24.5),
		// essentially flat across sizes. A ball-pressure defence forces more.
		// Skill composites are centred at what a typical prospect of this size
		// actually scores on them (~45 base ratings, hgt = 30+55*bigness), so
		// only above/below-typical skill moves the rate off its empirical anchor.
		const tovRate = clamp(
			CAL.byHeight("tov", bigness) - 0.10 * (comps.turnovers - 0.467) +
				0.13 * od.perimeter + rng.normal(0, 0.014 * noise),
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

		// Percentages. 3P% centres near the draft-year median of .348 for a
		// real shooter; the floor lets non-shooters brick their token attempts.
		// The slope on the shooting composite is steep on purpose: the measured
		// spread used to run 34.8% for guards to 31.1% for centres with almost
		// nothing between an elite shooting big and a non-shooting guard, when
		// the real range is 27% to 40% *within* every size band.
		const tpCeil = clamp(0.465 + 0.09 * Math.max(0, 1 - tpa / 3.5), 0.465, 0.56);
		const tpp = clamp(
			0.339 + 0.46 * (comps.shootingThreePointer - (0.50 - 0.20 * bigness)) +
				compAdj + synergy + loadAdj * 0.6 - 0.055 * od.perimeter +
				mix(touch, rng.normal(0, 1)) * 0.030 * noise,
			0.15, tpCeil,
		);
		// Rim/mid split and finishing: rim FG% runs .59 (guards) to .72 (bigs).
		// The calibration table already carries the height effect, so the skill
		// composites (which lean heavily on hgt) are centred at what a player of
		// this size typically scores on them, to avoid double-counting height.
		// Rim attempts are ~50% of 2PA for guards and ~55% for centers in the
		// data — nearly flat; the size effect lives in rim FG%, not shot mix.
		const rimMix = clamp(0.49 + 0.06 * bigness + 0.10 * (comps.shootingAtRim - comps.shootingMidRange), 0.30, 0.75);
		// Interior defence bites hardest exactly where it should: at the rim.
		const insideEff = CAL.byHeight("rimPct", bigness) +
			0.26 * (comps.shootingAtRim - (0.32 + 0.44 * bigness)) +
			0.16 * (comps.shootingLowPost - (0.40 + 0.17 * bigness)) -
			0.16 * od.rim;
		const midEff = CAL.byHeight("midPct", bigness) + 0.26 * (comps.shootingMidRange - 0.45) -
			0.05 * od.perimeter;
		const twoP = clamp(
			rimMix * insideEff + (1 - rimMix) * midEff + compAdj + synergy + loadAdj +
				rng.normal(0, 0.026 * noise),
			0.34, 0.68,
		);
		// FT%: draft-year mean .726 with a real size gradient (.78 guards, .67
		// centers) beyond what the ft rating alone carries.
		const ftp = clamp(
			0.548 + 0.40 * (ratings.ft / 100) - 0.035 * bigness +
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
		const orbW = Math.pow(comps.rebounding, TUNING.REB_EXP + 0.35) * minShare;
		const drbW = sh(comps.rebounding, TUNING.REB_EXP);
		// No single player takes an unbounded share of a team total: the record
		// books top out near 60-70% of team assists and blocks, so saturate the
		// share smoothly rather than letting one dominant composite run away
		// with the whole pool.
		// Linear until the knee, then asymptotic to `lim` — so ordinary lines
		// are untouched and only the runaway tail is bent back.
		const saturate = (x, lim, knee) => {
			const t = lim * knee;
			if (x <= t || lim <= 0) return x;
			return t + (lim - t) * (1 - Math.exp(-(x - t) / (lim - t)));
		};
		/* The documented cap has to survive the noise. Applying jv() AFTER the
		   saturation let ±10-16% multiplicative jitter push a capped share back
		   over the ceiling — measured maxima were 0.672 of team assists against
		   a documented 0.62, and 0.429 of team rebounds against 0.40. Noise
		   first, cap second, and the ceiling means what the comment says. */
		const capNoisy = (raw, sd, pool, cap) =>
			saturate(jv(raw, sd), pool * cap, 0.62);

		const rebLim = (teamCtx.orbPool + teamCtx.drbPool) * TUNING.REB_CAP;
		const orbRaw = jv((teamCtx.orbPool * orbW) / teamCtx.orbDen, 0.14);
		const drbRaw = jv((teamCtx.drbPool * drbW) / teamCtx.rebDen, 0.09);
		const rebRaw = orbRaw + drbRaw;
		const rebScale = rebRaw > 0 ? saturate(rebRaw, rebLim, 0.62) / rebRaw : 1;
		const orb = orbRaw * rebScale;
		const drb = drbRaw * rebScale;
		const ast = capNoisy(
			(teamCtx.astPool * sh(comps.passing, TUNING.AST_EXP)) / teamCtx.astDen,
			0.10, teamCtx.astPool, TUNING.AST_CAP);
		const stl = capNoisy(
			(teamCtx.stlPool * sh(comps.stealing, TUNING.STL_EXP)) / teamCtx.stlDen,
			0.13, teamCtx.stlPool, TUNING.STL_CAP);
		const blk = capNoisy(
			(teamCtx.blkPool * sh(comps.blocking, TUNING.BLK_EXP)) / teamCtx.blkDen,
			0.16, teamCtx.blkPool, TUNING.BLK_CAP);
		// Personal fouls: BBGM's fouling composite finally does something, so
		// the Foul-Prone Enforcer archetype has an on-court identity.
		// Starters foul less per minute than the bench does (they are better,
		// and they are the ones a coach protects), so fouls scale with minutes
		// sub-linearly rather than one-for-one.
		const pfW = Math.pow(comps.fouling, TUNING.PF_EXP) * Math.pow(minShare, 0.82);
		// Five fouls ends a night, so a season average saturates well below it.
		const pfRaw = (teamCtx.pfPool * pfW) / teamCtx.pfDen;
		const pf = clamp(jv(saturate(pfRaw, 4.2, 0.60), 0.12), 0, 4.6);

		/* --- the defensive box score --------------------------------------
		   Steals and blocks were the whole of a player's defensive record,
		   which is why defensive honours had almost nothing to rank on. These
		   are the plays that decide the other two-thirds of it. All three are
		   real, tracked college statistics. */
		const contested = jv(
			(4.2 + 7.6 * comps.defenseInterior + 3.4 * comps.defensePerimeter) * minShare, 0.13);
		const deflections = jv(
			(0.5 + 4.6 * comps.defensePerimeter + 1.4 * comps.stealing) * minShare, 0.16);
		const charges = jv((0.9 * comps.defense + 0.5 * comps.defenseInterior) * minShare, 0.30);
		// Defensive rating: points allowed per 100 possessions with him on the
		// floor. Anchored at the league average and moved by what he actually
		// does — events, the composites, and the fouls he gives away.
		const drtg = clamp(
			104 - 22 * (comps.defense - 0.47) - 9 * (comps.defenseInterior - 0.46) -
				7 * (comps.defensePerimeter - 0.46) - 1.9 * blk - 2.4 * stl -
				0.35 * drb + 0.9 * pf + rng.normal(0, 1.6 * noise),
			84, 122,
		);

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
			cspg: contested,     // contested shots per game
			deflpg: deflections,
			chgpg: charges,
			drtg,
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
	function teamPools(comps, mins, pace, chanceMult, gameMinutes) {
		const gm = gameMinutes || 40;
		// Two views of the roster: the minute-weighted average of the five men
		// on the floor, and the best specialist on it. Team block totals track
		// the shot-blocker far more than the average (Walker Kessler took 4.6
		// of Auburn's 6.6), so pools blend the two rather than using the mean,
		// which one player can barely move.
		const agg = (key, topWeight) => {
			let a = 0;
			let top = 0;
			for (let i = 0; i < comps.length; i++) {
				a += comps[i][key] * (mins[i] / gm);
				top = Math.max(top, comps[i][key] * clamp(mins[i] / (gm * 0.75), 0, 1));
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
		const drbPool = (25.2 + (pace - 68) * 0.20) *
			scale(agg("rebounding", 0.25), 0.48, 0.35, 0.8, 1.25);

		/* Assists track MADE FIELD GOALS, and the old pool did not: it took
		   `pace * chanceMult` — the team's scoring *chances*, ~78 — and
		   multiplied by 0.46 * 0.48, implying ~36 made field goals on a team
		   that makes about 26. Chances are already net of the chance
		   multiplier, of turnovers and of the free-throw split, so applying
		   them again double-counted and put team assists 24% high (16.8 against
		   a real 13.5, AST/FGM 0.66 against a real 0.53).

		   The correct base is team FGA x FG% x assisted share. The passing
		   term leans on the best passer on the floor (topWeight 0.35), so a
		   roster with a true point guard assists more of its own baskets than
		   a team of wings does. */
		const teamFga = (chances * (1 - TUNING.NOMINAL_TOV)) /
			(1 + 0.44 * TUNING.NOMINAL_FTR);
		const assistedShare = TUNING.ASSISTED_SHARE *
			scale(agg("passing", 0.35), 0.47, 0.55, 0.80, 1.22);

		return {
			orbRate,
			orbPool,
			drbPool,
			astPool: teamFga * TUNING.NOMINAL_FGP * assistedShare,
			stlPool: 6.8 * scale(agg("stealing", 0.30), 0.50, 1.00, 0.70, 1.45),
			blkPool: 5.3 * scale(agg("blocking", 0.70), 0.50, 1.70, 0.55, 2.80),
			pfPool: TUNING.TEAM_PF * scale(agg("fouling", 0.20), 0.48, 0.60, 0.80, 1.25),
		};
	}

	/* Compute the stat lines for one team's whole rotation. Returns entries for
	   the prospects only, but the maths uses everybody. */
	function simulateTeamStats(team, ctx, cfg, rng) {
		const env = ctx.league || (ctx.pro ? leagueEnv(team.conf) : NCAA_ENV);
		const gameMinutes = env.gameMinutes || 40;
		// Rotation: draft prospects always crack it (they got drafted — even
		// the draft-year p5 played ~19 MPG, not DNPs), plus the best fillers.
		const sorted = team.members.slice().sort((a, b) => b.talent - a.talent);
		const prospects = sorted.filter((m) => !m.filler);
		const fillers = sorted.filter((m) => m.filler);
		const size = Math.max(9, prospects.length);
		const members = prospects
			.concat(fillers.slice(0, Math.max(0, size - prospects.length)))
			.sort((a, b) => b.talent - a.talent);

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
			/* Bases are set so that the WHOLE simulated field lands on the
			   D-I rotation-player anchor in js/calibration.js (USG 20.2,
			   TS 53.4, 3P 33.8, FT 70.6, ORtg 102.6) rather than only the
			   prospects landing on the drafted anchor. Now that every program
			   is simulated, that whole-field figure is measurable, and it was
			   off: 3P 30.3 against 33.8 and FT 73.7 against 70.6, which by
			   itself put the average program 2.3 points of offensive
			   efficiency light. */
			return {
				usage: f(0.485, 0.07), passing: f(0.45, 0.09), turnovers: f(0.47, 0.07),
				shootingAtRim: f(0.515, 0.09), shootingLowPost: f(0.45, 0.09),
				shootingMidRange: f(0.455, 0.08), shootingThreePointer: f(0.505, 0.10),
				rebounding: f(0.47, 0.10), stealing: f(0.48, 0.07), blocking: f(0.45, 0.10),
				drawingFouls: f(0.47, 0.08), defense: f(0.48, 0.08), fouling: f(0.47, 0.08),
				defenseInterior: f(0.46, 0.09), defensePerimeter: f(0.46, 0.09),
				endurance: f(0.50, 0.09),
			};
		});

		const mins = allocateMinutes(members, rng, comps, env);
		/* A 19-year-old at Real Madrid does not play 30 minutes, whatever his
		   talent says. Cap the prospects, hand the freed minutes back to the
		   senior professionals around them. */
		if (env.youthCap) {
			let freed = 0;
			for (let i = 0; i < members.length; i++) {
				if (members[i].filler) continue;
				const cap = env.youthCap;
				if (mins[i] > cap) { freed += mins[i] - cap; mins[i] = cap; }
			}
			if (freed > 0) {
				const takers = [];
				for (let i = 0; i < members.length; i++) if (members[i].filler) takers.push(i);
				const room = takers.reduce(
					(a, i) => a + Math.max(0, (env.mpgCap || 36) - mins[i]), 0);
				if (room > 0) {
					for (const i of takers) {
						mins[i] += freed * (Math.max(0, (env.mpgCap || 36) - mins[i]) / room);
					}
				}
			}
		}

		// Usage: high-usage players on weak teams shoot a lot more. Better
		// prospects also carry a bit more volume (lottery picks averaged
		// USG 24.3 vs 22.4 for picks 41+ in the 2009-21 data). The exponent is
		// steep because BBGM's usage composite only spans ~0.22-0.52 in a real
		// class — a shallow curve leaves the clamp doing all the separating.
		/* The size tilt is explicit and deliberate. BBGM's usage composite
		   weights `ins` at 1.5 and `hgt` at 0.5, so in a specialised class the
		   bigs win it outright and the sim produced centres scoring 13.6 a game
		   against guards' 10.9 — backwards for a draft class, where guards are
		   the volume scorers. This puts the ordering back without touching the
		   composite the rest of the model depends on. */
		const bignessOf = (i) => clamp((comps[i].blocking - 0.18) / 0.55, 0, 1);
		const rawUsg = members.map((m, i) =>
			Math.pow(comps[i].usage, TUNING.USG_EXP) * Math.pow(0.35 + 1.3 * (m.talent / 100), 1.6) *
				(1 + 0.50 * (0.42 - bignessOf(i))) *
				CAL.talentUsageMult(m.talent),
		);
		let denom = 0;
		for (let i = 0; i < members.length; i++) denom += rawUsg[i] * mins[i];
		let usgShare = members.map((m, i) => (rawUsg[i] * mins[i]) / denom);

		// Physical envelope: while on the floor nobody uses more than USG_CAP of
		// team chances (Trae Young ran ~34%, Cam Thomas ~34%), and no DRAFTED
		// player disappears from the offence — the draft-year p5 is USG 17.8,
		// so prospects floor near 15.5% where fillers may fade to 10%. usgShare
		// is a share of *all* team chances, so the bounds scale with minutes.
		// Same soft saturation as minutes: 15% of prospects used to sit on
		// exactly USG 33.0, which erases the difference between a primary
		// option and a genuine offensive fulcrum. Again solved for the single
		// scale factor that makes the shares sum back to 1.
		// The ceiling is the player's, not the league's. A universal cap made
		// every good prospect converge on the same number.
		const bounds = members.map((m, i) => {
			const ms = mins[i] / gameMinutes;
			const floor = (m.filler ? 0.10 : TUNING.USG_FLOOR) * ms;
			const personal = clamp(
				0.268 + 0.50 * (comps[i].usage - 0.42) + 0.075 * ((m.talent - 55) / 45) +
					0.055 * (0.42 - bignessOf(i)),
				0.195, TUNING.USG_CAP,
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
		const teamMinutes = 5 * gameMinutes;
		const teamTalent = members.reduce((a, m, i) => a + m.talent * mins[i], 0) / teamMinutes;

		// Pace: D-I takes the slider, every other league takes its own. The
		// slider is labelled "College season", and it used to silently rewrite
		// EuroLeague and G League box scores.
		const pace = env.pace !== null && env.pace !== undefined
			? clamp(env.pace + (cfg.scoringEnv || 0) * 1.2, 50, 115)
			: clamp(cfg.pace + cfg.scoringEnv * 1.6, 58, 82);
		// Chances exceed possessions by the team's offensive rebounds; solve
		// chances = poss + orbRate * missShare * chances for the multiplier.
		// One pass on a nominal ORB rate, then refine with the roster's own.
		const missShare = 0.44;
		let chanceMult = 1 / (1 - TUNING.ORB_RATE * missShare);
		let pools = teamPools(comps, mins, pace, chanceMult, gameMinutes);
		chanceMult = clamp(1 / (1 - pools.orbRate * missShare), 1.06, 1.28);
		pools = teamPools(comps, mins, pace, chanceMult, gameMinutes);

		/* Team-level variance lives on the pool, not on the individual draws.
		   The per-player jitter used to be the only source of it, which meant
		   the reconciliation below would have flattened it away. */
		const teamNoise = clamp(cfg.statNoise, 0, 3);
		for (const key of ["astPool", "stlPool", "blkPool", "orbPool", "drbPool", "pfPool"]) {
			pools[key] = Math.max(0, pools[key] * (1 + rng.normal(0, 0.05 * teamNoise)));
		}

		const teamCtx = Object.assign({
			games: ctx.games,
			paceAdj: rng.normal(0, 2.0),
			support: teamTalent,
			chanceMult,
			env,
			rebDen: 0, orbDen: 0, astDen: 0, stlDen: 0, blkDen: 0, pfDen: 0,
		}, pools);
		// The pace this team actually plays at, jitter included, so statLine and
		// teamPools agree on one number.
		teamCtx.pace = env.pace !== null && env.pace !== undefined
			? clamp(pace + teamCtx.paceAdj, 50, 118)
			: clamp(pace + teamCtx.paceAdj, 58, 82);
		for (let i = 0; i < members.length; i++) {
			const ms = mins[i] / gameMinutes;
			teamCtx.rebDen += Math.pow(comps[i].rebounding, TUNING.REB_EXP) * ms;
			teamCtx.orbDen += Math.pow(comps[i].rebounding, TUNING.REB_EXP + 0.35) * ms;
			teamCtx.astDen += Math.pow(comps[i].passing, TUNING.AST_EXP) * ms;
			teamCtx.stlDen += Math.pow(comps[i].stealing, TUNING.STL_EXP) * ms;
			teamCtx.blkDen += Math.pow(comps[i].blocking, TUNING.BLK_EXP) * ms;
			teamCtx.pfDen += Math.pow(comps[i].fouling, TUNING.PF_EXP) * Math.pow(ms, 0.82);
		}

		const out = [];
		const field = [];
		const lines = [];
		const totals = {
			pts: 0, fga: 0, fta: 0, tov: 0, orb: 0, trb: 0, ast: 0, poss: 0,
			stl: 0, blk: 0, pf: 0, cs: 0, defl: 0,
		};
		for (let i = 0; i < members.length; i++) {
			const m = members[i];
			// Fillers get a line too — not to show anyone, but so the team
			// totals (points, FGA, possessions) are real numbers the calibration
			// harness can check. Per-player rate bands cannot catch a broken
			// possession model; team points per game can.
			const seed = m.filler
				? "fillerstat|" + team.name + "|" + i
				: "stat:" + m.player.key;
			// statLine only reads hgt, ft and tp off the ratings row (everything
			// else comes from the composites), so a filler needs just those
			// three. Height is backed out of his blocking composite, which is
			// mostly height by construction.
			const ratings = m.filler
				? { hgt: clamp(30 + 55 * comps[i].blocking * 0.8, 5, 95), ft: 43, tp: 45 }
				: m.player.newRatings;
			const line = statLine(
				rng.child(seed), ratings, comps[i], mins[i], usgShare[i], ctx, cfg, teamCtx,
			);
			lines.push(line);
			totals.pts += line.ppg;
			totals.fga += line.fga;
			totals.fta += line.fta;
			totals.tov += line.topg;
			totals.orb += line.orpg;
			totals.trb += line.rpg;
			totals.ast += line.apg;
			totals.stl += line.spg;
			totals.blk += line.bpg;
			totals.pf += line.pfpg;
			totals.cs += line.cspg;
			totals.defl += line.deflpg;
			if (m.filler) {
				/* Filler lines were computed and discarded. They are the whole
				   of Division I outside this draft class, and keeping them
				   means the award model can rank prospects against real
				   simulated seasons instead of against a linear regression on
				   talent — which is what it used to do, and which badly
				   understated a weak team's best player (extrapolating the
				   prospects-only fit down to talent 30 predicted a scoring
				   line of roughly zero for a low-major's leading scorer). */
				field.push({ talent: m.talent, rotationIndex: i, mpg: mins[i], line });
				continue;
			}
			m.player.stats = line;
			// Where he sits in his own rotation, which is what makes a Sixth
			// Man of the Year candidate a reserve rather than a starter.
			m.player.minutesRank = mins
				.filter((v, j) => v > mins[i] || (v === mins[i] && j < i)).length;
			m.player.teamShare = {
				ast: line.apg, reb: line.rpg, blk: line.bpg, stl: line.spg,
			};
			out.push({ player: m.player, line });
		}
		/* Enforce the documented caps against the TEAM TOTAL, which is what the
		   comment has always claimed and what anybody reading the output would
		   check.

		   Saturating each player's raw share against the pool was not enough:
		   the per-player noise means the realised team total is not the pool,
		   so a player capped at 62% of the pool could still finish with 67% of
		   what his team actually recorded — measured 0.672 of team assists
		   against a documented 0.62, and 0.429 of team rebounds against 0.40.

		   One pass here renormalises each category to its pool (so the team
		   total IS the pool) and then clips the tail at the cap, handing the
		   clipped surplus to the players with room. Below the cap nothing
		   moves, so the distribution keeps the shape statLine gave it. */
		reconcileTeamTotals(lines, pools);
		totals.ast = 0; totals.stl = 0; totals.blk = 0;
		totals.orb = 0; totals.trb = 0;
		for (const line of lines) {
			totals.ast += line.apg;
			totals.stl += line.spg;
			totals.blk += line.bpg;
			totals.orb += line.orpg;
			totals.trb += line.rpg;
		}
		totals.poss = totals.fga - totals.orb + totals.tov + 0.44 * totals.fta;
		team.teamTotals = totals;
		team.fieldPlayers = field;
		team.defense = defenseProfile(comps, mins, teamMinutes);
		// Team defensive efficiency: points allowed per 100 possessions, read
		// off the scores the team actually gave up.
		const paAvg = team.log && team.log.length
			? team.log.reduce((a, g) => a + (g.pa || 0), 0) / team.log.length
			: null;
		team.oppPpg = paAvg;
		team.defRtg = paAvg !== null && totals.poss > 0
			? (100 * paAvg) / totals.poss
			: null;
		team.offRtg = totals.poss > 0 ? (100 * totals.pts) / totals.poss : null;
		// Each prospect's share of the team totals, for the award model and the
		// share-cap regression checks.
		for (const o of out) {
			o.player.shareOf = {
				ast: totals.ast > 0 ? o.line.apg / totals.ast : 0,
				reb: totals.trb > 0 ? o.line.rpg / totals.trb : 0,
				blk: totals.blk > 0 ? o.line.bpg / totals.blk : 0,
				stl: totals.stl > 0 ? o.line.spg / totals.stl : 0,
				pts: totals.pts > 0 ? o.line.ppg / totals.pts : 0,
			};
		}
		return out;
	}

	/* Renormalise one category to its pool, then clip the tail at `cap` of the
	   team total and redistribute the surplus to everyone with room. */
	function fitToPool(values, pool, cap) {
		let sum = 0;
		for (const v of values) sum += v;
		if (sum <= 1e-9 || pool <= 0) return values;
		const out = values.map((v) => (v * pool) / sum);
		const lim = pool * cap;
		for (let iter = 0; iter < 6; iter++) {
			let excess = 0;
			for (let i = 0; i < out.length; i++) {
				if (out[i] > lim) { excess += out[i] - lim; out[i] = lim; }
			}
			if (excess < 1e-9) break;
			let room = 0;
			for (const v of out) room += Math.max(0, lim - v);
			if (room < 1e-9) break;
			for (let i = 0; i < out.length; i++) {
				out[i] += (excess * Math.max(0, lim - out[i])) / room;
			}
		}
		return out;
	}

	function reconcileTeamTotals(lines, pools) {
		const set = (key, pool, cap) => {
			const fitted = fitToPool(lines.map((l) => l[key]), pool, cap);
			lines.forEach((l, i) => { l[key] = fitted[i]; });
		};
		set("apg", pools.astPool, TUNING.AST_CAP);
		set("spg", pools.stlPool, TUNING.STL_CAP);
		set("bpg", pools.blkPool, TUNING.BLK_CAP);
		// Rebounds are capped on the total, so the two halves are fitted to
		// their own pools first and then the combined line is clipped.
		set("orpg", pools.orbPool, 0.75);
		set("drpg", pools.drbPool, 0.60);
		const rebPool = pools.orbPool + pools.drbPool;
		const totalReb = lines.map((l) => l.orpg + l.drpg);
		const fitted = fitToPool(totalReb, rebPool, TUNING.REB_CAP);
		lines.forEach((l, i) => {
			const before = totalReb[i];
			const k = before > 1e-9 ? fitted[i] / before : 1;
			l.orpg *= k;
			l.drpg *= k;
			l.rpg = l.orpg + l.drpg;
		});
	}

	/* -------------------------------------------------------------- game log */

	/* One line per game, for a player who already has a season average.

	   signatureGame already fabricated a game log — it drew rng.normal(ppg, sd)
	   once per game and threw the array away, keeping only the maximum. Keeping
	   it costs nothing and buys real season highs in every category, a "20-point
	   games: 14" line, genuine hot and cold streaks, and a game log tab.

	   The draws are rescaled so their mean is exactly the season average, so
	   the log and the stat line can never disagree — everything else in the
	   model reconciles and this has to as well. */
	function gameLog(p, team, rng) {
		const s = p.stats;
		if (!s || !team || !team.log || !team.log.length) return null;
		const schedule = team.log;
		const gp = Math.max(1, Math.min(schedule.length, Math.round(s.gp)));
		const missedCount = schedule.length - gp;

		/* Which games he missed. The old code took the FIRST gp entries of a
		   conference-first log, so a player who missed games always missed the
		   last N — which were always non-conference. Missed games are drawn as
		   an injury (one contiguous block) or as scattered absences. */
		const missed = new Set();
		let injury = null;
		if (missedCount > 0) {
			if (missedCount >= 3 && rng.random() < 0.62) {
				const start = rng.int(0, Math.max(0, schedule.length - missedCount));
				for (let i = 0; i < missedCount; i++) missed.add(start + i);
				injury = {
					from: start, to: start + missedCount - 1, games: missedCount,
					kind: rng.pick([
						"a sprained ankle", "a hand injury", "a knee sprain",
						"a stress reaction in his foot", "concussion protocol",
						"a back strain", "a shoulder injury",
					]),
				};
			} else {
				let guard = 0;
				while (missed.size < missedCount && guard++ < 500) {
					missed.add(rng.int(0, schedule.length - 1));
				}
				injury = {
					from: null, to: null, games: missedCount,
					kind: rng.pick([
						"illness", "a coach's decision", "a minor knock",
						"a one-game suspension", "load management",
					]),
				};
			}
		}

		// A slow-moving form term gives real hot and cold stretches instead of
		// independent coin flips around the mean.
		let form = rng.normal(0, 1);
		const games = [];
		for (let i = 0; i < schedule.length; i++) {
			if (missed.has(i)) continue;
			form = 0.62 * form + 0.78 * rng.normal(0, 1);
			const g = schedule[i];
			// A little more upside against a good opponent playing at home.
			const lift = (g.home > 0 ? 0.055 : 0) + (g.quality > 55 ? 0.04 : 0);
			const draw = (avg, rel, floorAt) => {
				const sd = rel * avg + floorAt;
				return Math.max(0, avg * (1 + lift) + sd * (0.55 * form + 0.83 * rng.normal(0, 1)));
			};
			games.push({
				i,
				opp: g.opp, won: g.won, pf: g.pf, pa: g.pa, ot: g.ot, home: g.home,
				stage: g.stage, round: g.round, quality: g.quality, when: g.when,
				conference: !!g.conference,
				pts: draw(s.ppg, 0.34, 2.6),
				reb: draw(s.rpg, 0.42, 1.1),
				ast: draw(s.apg, 0.48, 0.9),
				stl: draw(s.spg, 0.70, 0.5),
				blk: draw(s.bpg, 0.75, 0.4),
				tov: draw(s.topg, 0.55, 0.7),
			});
		}
		if (!games.length) return null;

		// Rescale so the log's mean is the season average exactly, then round.
		for (const key of ["pts", "reb", "ast", "stl", "blk", "tov"]) {
			const target = { pts: s.ppg, reb: s.rpg, ast: s.apg, stl: s.spg, blk: s.bpg, tov: s.topg }[key];
			const got = games.reduce((a, g) => a + g[key], 0) / games.length;
			const k = got > 1e-9 ? target / got : 0;
			for (const g of games) g[key] = Math.max(0, Math.round(g[key] * k));
		}

		const best = games.slice().sort((a, b) =>
			b.pts - a.pts || (b.reb + b.ast) - (a.reb + a.ast))[0];
		const highs = {};
		for (const key of ["pts", "reb", "ast", "stl", "blk"]) {
			highs[key] = Math.max.apply(null, games.map((g) => g[key]));
		}
		// Longest run of games at or above the season scoring average + 20%.
		let streak = 0;
		let bestStreak = 0;
		let bestStreakPts = 0;
		let runPts = 0;
		const bar = s.ppg * 1.2;
		for (const g of games) {
			if (g.pts >= bar) {
				streak++;
				runPts += g.pts;
				if (streak > bestStreak) { bestStreak = streak; bestStreakPts = runPts; }
			} else { streak = 0; runPts = 0; }
		}
		return {
			games,
			best,
			highs,
			injury,
			doubleDoubles: games.filter((g) =>
				[g.pts, g.reb, g.ast, g.stl, g.blk].filter((v) => v >= 10).length >= 2).length,
			tripleDoubles: games.filter((g) =>
				[g.pts, g.reb, g.ast, g.stl, g.blk].filter((v) => v >= 10).length >= 3).length,
			twentyPointGames: games.filter((g) => g.pts >= 20).length,
			hotStreak: bestStreak >= 3
				? { games: bestStreak, ppg: bestStreakPts / bestStreak }
				: null,
			// Split by phase, so "he was a different player after Christmas" is
			// something the note can actually say.
			splits: phaseSplits(games),
			postseason: postseasonSplit(games),
		};
	}

	function meanOf(games, key) {
		if (!games.length) return 0;
		return games.reduce((a, g) => a + g[key], 0) / games.length;
	}

	function phaseSplits(games) {
		const reg = games.filter((g) => (g.stage || "reg") === "reg");
		const early = reg.filter((g) => g.when < 0.5);
		const late = reg.filter((g) => g.when >= 0.5);
		const mk = (l) => (l.length
			? { gp: l.length, ppg: meanOf(l, "pts"), rpg: meanOf(l, "reb"), apg: meanOf(l, "ast") }
			: null);
		return {
			nonConference: mk(reg.filter((g) => !g.conference && g.when < 0.5)),
			early: mk(early),
			late: mk(late),
		};
	}

	function postseasonSplit(games) {
		const post = games.filter((g) => g.stage && g.stage !== "reg");
		if (!post.length) return null;
		return {
			gp: post.length,
			ppg: meanOf(post, "pts"),
			rpg: meanOf(post, "reb"),
			apg: meanOf(post, "ast"),
			ncaa: games.filter((g) => g.stage === "ncaa").length,
		};
	}

	global.StatsSim = {
		simulateTeamStats, allocateMinutes, statLine, teamPools, gameLog,
		fitToPool, reconcileTeamTotals,
		defenseProfile, rosterDefenseProfile, leagueEnv, LEAGUE_ENV, NCAA_ENV,
		TUNING,
	};
})(typeof window !== "undefined" ? window : self);
