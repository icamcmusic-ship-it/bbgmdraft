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
		/* A drafted player never vanishes from the offence. The draft-year 5th
		   percentile is USG 17.8, so this is where a prospect's usage settles,
		   not where it stops: `softUsg` approaches it from below rather than
		   clamping onto it. The hard clamp piled 3.7% of the whole class on
		   exactly 15.5% usage — a wall, which is the artefact the soft CEILING
		   was introduced to remove, left in place at the other end. */
		USG_FLOOR: 0.175,
		USG_FLOOR_FILLER: 0.10,
		// How far below the floor the softened curve may reach, as a fraction
		// of it. The floor becomes an asymptote instead of a clamp.
		USG_FLOOR_BAND: 0.22,
		USG_EXP: 2.35,      // steepness of the usage composite -> volume curve
		/* Assists. At 4.1 the exponent produced a physically impossible floor:
		   a centre's 10th-percentile line was 0.15 assists per game and the Rim
		   Protector archetype averaged 0.42, which is not what a man playing 25
		   minutes a night finishes a season with (the real floor for a
		   non-passing D-I big is 0.6-0.8). It also made the distribution
		   bimodal rather than smoothly right-skewed, and pushed the class's
		   best passer to 8.6 a game when a draft class's best passer is usually
		   6.5-7.5. AST_FLOOR is a floor on the passing composite used only for
		   sharing out the pool: everybody on a basketball court makes the
		   occasional dump-off, and a weight of zero is what produces impossible
		   lines. AST_PSS is how much of the share is read off the raw passing
		   rating rather than the composite, which is 0.4*drb + 1.0*pss +
		   0.5*oiq and therefore rewards every guard build for handling the
		   ball — which is why a Sharpshooter finished within 1.7 assists of a
		   dedicated Floor General. */
		AST_EXP: 3.0,
		AST_FLOOR: 0.30,
		/* Rebounds. At 1.25 a centre out-rebounded a guard by 2.4x; the real
		   defensive-rebound-rate ratio between those two is 4-5x. */
		REB_EXP: 1.55,
		REB_FLOOR: 0.30,
		AST_PSS: 0.45,
		STL_EXP: 2.1,
		BLK_EXP: 2.6,
		PF_EXP: 1.2,
		ORB_RATE: 0.29,     // D-I offensive rebound rate
		/* Missed free throws come off the rim too, so the rebounds available on
		   a possession exceed the missed field goals by a few percent. */
		ORB_FT: 1.07,
		/* Team personal fouls. The model computed this, and reconcileTeamTotals
		   then fitted assists, steals, blocks and rebounds to their pools and
		   left fouls alone — so team fouls were unconstrained and drifted to
		   15.2 against this very target, with no validate.js band to catch it.
		   Fouls are now fitted like everything else. */
		TEAM_PF: 16.6,
		/* Share of MADE field goals that are assisted, measured straight off the
		   league totals (13.5 assists on 25.9 made field goals in the modern
		   game, 12.6 on 24.1 in 2009-2021 — the same 0.52 in both eras). The
		   old 0.53 sat on top of a stale 0.465 field-goal percentage that no
		   longer matched what the sim shot, so the two errors part-cancelled
		   and team assists came out 7% light anyway. Everything else the pool
		   needs — how much of a chance is a shot, how often it misses — now
		   comes from the era's own team averages via CAL.chanceShape(). */
		ASSISTED_SHARE: 0.52,
		// Documented per-player ceilings, now actually enforced (see capNoisy).
		AST_CAP: 0.62,
		REB_CAP: 0.40,
		// Walker Kessler took 4.6 of Auburn's 6.6 blocks — 70%. The old 0.50
		// cap forbade by construction the exact season the comment cited.
		BLK_CAP: 0.68,
		STL_CAP: 0.42,
		PF_CAP: 0.28,
		/* Minutes are flatter than talent, but not as flat as they were: 32% of
		   minutes handed out uniformly made an NBA prospect the fourth option
		   on his own blue-blood roster, and 22% still had him fourth. At 22%,
		   high-major prospects averaged 29.2 MPG against the 30-33 a drafted
		   player actually plays, and the measured correlation between where a
		   prospect played and how much he scored (-0.50) was stronger than the
		   correlation between how good he was and how much he scored (+0.42).
		   Where you play should not predict your scoring better than how good
		   you are. */
		MINUTES_UNIFORM: 0.08,
		/* Rotation priority for a drafted player, as a slot floor that depends
		   on how good he is: a lottery talent starts anywhere, a late
		   second-rounder is at worst his team's fifth man. `SLOT_ANCHOR` is the
		   college-talent level that always starts and `SLOT_STEP` how much
		   talent one rotation slot is worth. */
		PROSPECT_SLOT_ANCHOR: 76,
		PROSPECT_SLOT_STEP: 7,
		PROSPECT_SLOT_MAX: 2,
		/* How far talent tilts a player off the canonical rotation shape.
		   Two terms, because they answer two different questions. The ABS term
		   is how good he is on the college-talent scale, which is what makes a
		   lottery pick out-minute a late second-rounder wherever either of them
		   plays. The REL term is how much better he is than his own teammates,
		   which is real (a coach rides the one man who can play) but is also
		   the entire channel by which a program's strength used to decide a
		   prospect's minutes, so it carries much the smaller weight. */
		/* A drafted player's rotation priority over a returning player in the
		   same slot. Coaches play the future pro. */
		PROSPECT_PREMIUM: 1.12,
		/* How often a drafted player spends his draft year as a reserve. */
		RESERVE_RATE: 0.12,
		MINUTES_TILT_ABS: 0.55,
		MINUTES_TILT_REL: 0.22,
		MINUTES_TILT_ANCHOR: 62,
		MINUTES_TILT_REF: 14,
		/* How much of the class's scoring gradient is allowed to come from
		   playing at a weak programme rather than from being good. */
		STL_ATH: 0.60,
	};

	/* The shape of a college rotation's minutes, by slot. Measured off D-I
	   box scores: a starter plays 30-34, the sixth man low twenties, and the
	   ninth man single figures — and that shape barely moves between a blue
	   blood and a low major. It is renormalised to the team total below, so
	   only the ratios here matter. */
	const ROTATION_SHAPE = [1.00, 0.95, 0.89, 0.83, 0.75, 0.61, 0.47, 0.33, 0.21, 0.13];

	/* The composite an average D-I rotation actually scores on each pool key,
	   measured off the filler synthesis in simulateTeamStats and blended the
	   same way teamPools blends it. Change a filler base and these move too. */
	const POOL_BASE = {
		rebounding: 0.443, passing: 0.435, stealing: 0.462,
		blocking: 0.500, fouling: 0.412,
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
		/* Minutes come off a canonical rotation SHAPE, not off raw talent ratios.

		   The old model shared minutes out as `talent^1.6 / sum`, which makes a
		   rotation's minute spread a function of its talent DISPERSION rather
		   than of anybody's quality. At a level-23 program the best player was
		   talent 76 against teammates at 19 and 17 — a 4x ratio, so 9x the
		   weight, so 37.5 minutes on the cap. At a level-89 program the same
		   rotation ran 82/79/69, a 1.2x ratio, so its best player drew 27.5.
		   Measured, that made where a prospect played predict his minutes
		   (-0.78) two and a half times better than how good he was (+0.29), and
		   28% of late second-rounders finished under 10 points a game.

		   A coach does not do that. He plays his best man about 33 minutes
		   whether the rest of the roster is good or bad; the SHAPE of a rotation
		   is close to fixed and talent decides who occupies which slot. So the
		   weight is the canonical shape at a player's slot, tilted by how far
		   his talent sits from his own rotation's mean — a bounded tilt, so a
		   flat roster and a top-heavy one still differ, but not by 10 minutes. */
		const val = members.map((m, i) => m.talent * stamina[i] * (1 + rng.normal(0, 0.05)));
		const order = members.map((m, i) => i).sort((a, b) => val[b] - val[a]);
		/* Rotation priority, which is not a talent bonus.

		   A coach's rotation is not a pure talent ranking: a future NBA player
		   plays, because he is the reason the season is interesting and because
		   he is leaving in April. A program that landed a draft pick did not
		   already have three better players. So the r-th best prospect on a
		   roster is promoted to no worse than slot r + PROSPECT_SLOT, which at a
		   weak program is never binding (he already leads the team) and at a
		   blue blood stops him being the fifth option on his own team. His
		   talent is untouched: usage, team rating and the ovr solver see exactly
		   what they saw before. */
		let seen = 0;
		for (let r = 0; r < order.length; r++) {
			if (members[order[r]].filler) continue;
			const target = seen + clamp(Math.round(
				(TUNING.PROSPECT_SLOT_ANCHOR - members[order[r]].talent) /
					TUNING.PROSPECT_SLOT_STEP), 0, TUNING.PROSPECT_SLOT_MAX);
			seen++;
			if (r <= target) continue;
			const idx = order.splice(r, 1)[0];
			order.splice(Math.min(target, order.length), 0, idx);
		}
		const slotOf = new Array(members.length);
		order.forEach((idx, slot) => { slotOf[idx] = slot; });
		let meanTalent = 0;
		for (const m of members) meanTalent += m.talent;
		meanTalent /= members.length || 1;
		const shapeAt = (slot) => (slot < ROTATION_SHAPE.length
			? ROTATION_SHAPE[slot]
			: ROTATION_SHAPE[ROTATION_SHAPE.length - 1] *
				Math.pow(0.7, slot - ROTATION_SHAPE.length + 1));
		/* The tilt is applied to the DRAFT PROSPECTS only; a returning player
		   sits on the shape his slot gives him.

		   This is the difference between a minutes model and a talent-ratio
		   model. If the tilt were applied to everybody, a filler's weight would
		   track his program's level (his talent is drawn from it), so a
		   prospect's share — his weight over the roster's total — would fall as
		   his program got stronger, for no reason but arithmetic. That is the
		   whole of the residual -0.52 correlation between where a man played
		   and how long he played. There is also nothing to say with a
		   synthetic teammate: the roster shape already carries everything the
		   model knows about him. */
		/* The RELATIVE tilt applies to everybody: a coach rides the one man on
		   his roster who can play, and that is as true of a low major's senior
		   as of a lottery pick. Without it every team's best player drew the
		   same 32 minutes, which flattened the field a draft class is judged
		   against and handed the prospects a third more national awards than
		   they should win.

		   The ABSOLUTE tilt and the prospect premium apply only to the draft
		   prospects. A returning player's talent is drawn FROM his program's
		   level, so tilting him on it would make every rotation at a strong
		   program flatter than every rotation at a weak one for no reason but
		   arithmetic — which is the whole of the location bias this rework
		   exists to remove. */
		const relTilt = (talent) => 1 +
			TUNING.MINUTES_TILT_REL * clamp((talent - meanTalent) / 12, -1.5, 1.5);
		const absTilt = (m) => (m.filler ? 0 : TUNING.PROSPECT_PREMIUM - 1 +
			TUNING.MINUTES_TILT_ABS *
				clamp((m.talent - TUNING.MINUTES_TILT_ANCHOR) / TUNING.MINUTES_TILT_REF, -1.5, 1.5));
		/* The reserve year. Talent and slot alone give every drafted player a
		   starter's minutes, and real draft classes do not look like that: the
		   draft-year 5th percentile is about 19 minutes a game, because some of
		   a class is freshmen who came off the bench behind a senior, players
		   who lost half a season to a knee, and eighteen-year-olds a coach
		   brought along slowly. None of that is predictable from a rating, so
		   it is drawn — independently of where he plays, so it widens the
		   distribution without putting the location bias back. Freshmen draw it
		   most often; a senior who is still a reserve has usually transferred. */
		const roleOf = (m) => {
			if (m.filler) return 1;
			const year = m.player && m.player.classYear;
			const rate = TUNING.RESERVE_RATE *
				(year === "Freshman" ? 1.6 : year === "Sophomore" ? 1.0
					: year === "Junior" ? 0.6 : 0.45);
			if (rng.random() < rate) return rng.uniform(0.42, 0.70);
			return Math.exp(rng.normal(0, 0.11));
		};
		const talentShares = shareFromWeights(members.map((m, i) => shapeAt(slotOf[i]) *
			stamina[i] * roleOf(m) * Math.max(0.05, relTilt(m.talent) + absTilt(m))), 1);
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

	/* The weights that share out a team's assist and steal pools. They live
	   here rather than inline because statLine and the denominator loop in
	   simulateTeamStats have to agree on them exactly, and did not have to
	   before: every extra factor added to one had to be remembered in the
	   other. */
	function passSkill(comps, ratings) {
		const raw = ratings && Number.isFinite(ratings.pss) ? ratings.pss / 100 : comps.passing;
		return clamp((1 - TUNING.AST_PSS) * comps.passing + TUNING.AST_PSS * raw, 0.02, 1);
	}
	function astWeight(comps, ratings, minShare) {
		return Math.pow(Math.max(TUNING.AST_FLOOR, passSkill(comps, ratings)),
			TUNING.AST_EXP) * minShare;
	}
	function stlWeight(comps, minShare) {
		return Math.pow(comps.stealing, TUNING.STL_EXP) *
			(1 + TUNING.STL_ATH * (comps.athleticism - 0.50)) * minShare;
	}
	function rebWeight(comps, minShare, offensive) {
		return Math.pow(Math.max(TUNING.REB_FLOOR, comps.rebounding),
			TUNING.REB_EXP + (offensive ? 0.35 : 0)) * minShare;
	}

	/* How well a roster shoots, before a single stat line exists, so the engine
	   can work out how often each team's OPPONENTS missed — which is what a
	   defensive rebound total should respond to and previously could not: the
	   pool was the literal constant 25.2 regardless of who the team played.
	   Returns an expected field-goal percentage on the era's own anchors. */
	function rosterShooting(team) {
		const sorted = team.members.slice().sort((a, b) => b.talent - a.talent).slice(0, 8);
		let two = 0;
		let three = 0;
		let share3 = 0;
		let w = 0;
		for (let i = 0; i < sorted.length; i++) {
			const m = sorted[i];
			const weight = [1, 0.96, 0.9, 0.84, 0.76, 0.6, 0.45, 0.3][i] || 0.2;
			let inside;
			let outside;
			let bigness;
			let tp;
			if (m.filler) {
				const r = m.talent / 100;
				inside = clamp(0.50 * (0.55 + 0.9 * r), 0.05, 0.95) + CAL.effShift("fieldEff");
				outside = clamp(0.505 * (0.55 + 0.9 * r), 0.05, 0.95) + CAL.effShift("fieldEff");
				bigness = 0.45;
				tp = 45;
			} else {
				const c = BB.composites(m.player.newRatings);
				inside = (c.shootingAtRim + c.shootingMidRange) / 2;
				outside = c.shootingThreePointer;
				bigness = clamp((m.player.newRatings.hgt - 30) / 55, 0, 1);
				tp = m.player.newRatings.tp;
			}
			const b = clamp(bigness, 0, 1);
			two += weight * (0.5 * CAL.byHeight("rimPct", b) + 0.5 * CAL.byHeight("midPct", b) +
				0.5 * CAL.effShift("inside") + 0.5 * CAL.effShift("mid") +
				0.26 * (inside - (0.40 + 0.22 * b)));
			three += weight * (0.339 + CAL.effShift("three") + 0.40 * (outside - (0.50 - 0.20 * b)));
			share3 += weight * CAL.threeShare(b, tp);
			w += weight;
		}
		if (!w) return CAL.ROTATION.twoPct;
		const s3 = share3 / w;
		return clamp((1 - s3) * (two / w) + s3 * (three / w), 0.34, 0.60);
	}

	/* ctx:  { oppStrength, oppDefense, games, league, pro }
	   who:  { talent, filler } — the player himself. Needed because two rate
	         anchors differ between a drafted prospect and the returning
	         rotation player beside him, and the model used the DRAFTED anchor
	         for everybody: the drafted-player free-throw-rate table (.367 for
	         guards up to .511 for seven-footers) was applied to all of Division
	         I, when the whole-field rotation baseline is .366 flat. That alone
	         put team free-throw attempts 12% high. */
	function statLine(rng, ratings, comps, minutes, usgShare, ctx, cfg, teamCtx, who) {
		const me = who || { talent: 55, filler: false };
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
		/* Turnovers are denominated in POSSESSIONS, not chances. TO% in the
		   source data (and in every public college box-score derivation) is
		   turnovers over possessions, and the model was applying it to chances
		   — which exceed possessions by the team's offensive rebounds, a factor
		   of about 1.147. That is the whole of the 15% turnover excess: the
		   measured team rate was 19.6% of possessions against a real 17.2%, and
		   19.6 / 1.147 = 17.1. An offensive rebound restarts a chance inside a
		   possession that has already survived its turnover risk. */
		const tovPoss = poss / teamCtx.chanceMult;
		// USG% proper: share of team chances used while actually on the floor.
		const usgRate = minutes > 0 ? (usgShare * gameMinutes) / minutes : 0;

		// Competition: harder leagues shave efficiency, not volume.
		const compAdj = -0.0022 * (ctx.oppStrength - 52);
		/* Talent -> efficiency. js/calibration.js has always documented and
		   exported this gradient ("better prospects carry a little more volume
		   at slightly better efficiency") and nothing ever called it, so the
		   volume half was in the model and the efficiency half was not. The
		   measured correlation between overall rating and true shooting was
		   0.20 — almost all of it arriving through usage. */
		const talentAdj = me.filler ? 0 : CAL.talentEffAdj(me.talent);
		/* The efficiency dial, which did not exist: pace and scoringEnv are
		   both possession dials, and moving either left true shooting at 0.572
		   in every configuration. */
		const envEff = 0.010 * clamp(cfg.efficiencyEnv || 0, -3, 3) +
			(me.filler ? CAL.effShift("fieldEff") : 0);
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
		/* Returning rotation players give the ball away a little more often than
		   future draft picks do; the drafted table is the prospect's anchor. */
		const tovAnchor = CAL.byHeight("tov", bigness) * (me.filler ? 1.06 : 1);
		const tovRate = clamp(
			tovAnchor - 0.10 * (comps.turnovers - 0.467) +
				/* Opponent ball pressure. PROGRAM_STYLES gives a full-court
				   press team press: 0.06, and it was added straight onto a rate
				   — so a conference stacked with pressing teams could add six
				   percentage points of turnover rate, larger than the entire
				   height gradient in the calibration table (17.2% to 17.8%).
				   Half of a press's effect shows up as a live-ball turnover;
				   the rest is a rushed shot, which the efficiency terms already
				   carry. */
				0.13 * od.perimeter + 0.5 * (ctx.oppPress || 0) +
				rng.normal(0, 0.014 * noise),
			0.08, 0.27,
		);
		// Free-throw rate climbs steeply with size (FTr .37 guards -> .51
		// seven-footers); foul-drawing skill moves it around that anchor.
		/* Fillers are the whole of Division I outside this class, so they take
		   the flat whole-field rotation baseline rather than the drafted-player
		   height table, which runs 9% richer and slopes hard with size. */
		const ftrAnchor = me.filler
			? CAL.ROTATION.ftr * (0.90 + 0.24 * bigness)
			: CAL.byHeight("ftr", bigness);
		const ftRate = clamp(
			ftrAnchor + 0.32 * (comps.drawingFouls - (0.42 + 0.11 * bigness)) +
				rng.normal(0, 0.045 * noise),
			0.10, 0.75,
		);

		// Volume jitter is applied to the *inputs*, so that points, FG% and TS%
		// stay reconcilable with the attempts printed beside them.
		const jv = (x, sd) => Math.max(0, x * (1 + rng.normal(0, sd * noise)));
		const tov = jv(tovPoss * tovRate, 0.10);
		const fga = jv((poss - tov) / (1 + 0.44 * ftRate), 0.045);
		const fta = jv(fga * ftRate, 0.06);

		// Shot mix: 3PA share anchored to the height buckets (.39 for guards
		// down to .085 for 6'11"+), stretched by shooting talent.
		// The system he plays in. A shooter at a four-out programme and the same
		// shooter in a pack-line offence do not take the same shots.
		const style = teamCtx.style || { three: 0, rim: 0, press: 0 };
		let share3 = CAL.threeShare(bigness, ratings.tp) + style.three +
			rng.normal(0, 0.045 * noise);
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
		/* The ceiling used to allow 56% from three on token volume, which is
		   not a number, it is a joke line; 50% on low volume is already
		   generous. The slope was steepened once on purpose (see above) and
		   over-shot: the Sharpshooter archetype came out at 43.7% from three on
		   28.4% usage as a COHORT AVERAGE, when the real ceiling for a whole
		   cohort of shooting specialists is 38-40%. */
		const tpCeil = clamp(0.435 + 0.08 * Math.max(0, 1 - tpa / 3.5), 0.435, 0.50);
		const tpp = clamp(
			0.339 + CAL.effShift("three") + envEff +
				0.40 * (comps.shootingThreePointer - (0.50 - 0.20 * bigness)) +
				compAdj + synergy + talentAdj + loadAdj * 0.6 - 0.055 * od.perimeter +
				mix(touch, rng.normal(0, 1)) * 0.030 * noise,
			0.15, tpCeil,
		);
		// Rim/mid split and finishing: rim FG% runs .59 (guards) to .72 (bigs).
		// The calibration table already carries the height effect, so the skill
		// composites (which lean heavily on hgt) are centred at what a player of
		// this size typically scores on them, to avoid double-counting height.
		// Rim attempts are ~50% of 2PA for guards and ~55% for centers in the
		// data — nearly flat; the size effect lives in rim FG%, not shot mix.
		const rimMix = clamp(0.49 + 0.06 * bigness + style.rim +
			0.10 * (comps.shootingAtRim - comps.shootingMidRange), 0.30, 0.75);
		// Interior defence bites hardest exactly where it should: at the rim.
		const insideEff = CAL.byHeight("rimPct", bigness) + CAL.effShift("inside") + envEff +
			0.26 * (comps.shootingAtRim - (0.32 + 0.44 * bigness)) +
			0.16 * (comps.shootingLowPost - (0.40 + 0.17 * bigness)) -
			0.16 * od.rim;
		const midEff = CAL.byHeight("midPct", bigness) + CAL.effShift("mid") + envEff +
			0.26 * (comps.shootingMidRange - 0.45) - 0.05 * od.perimeter;
		const twoP = clamp(
			rimMix * insideEff + (1 - rimMix) * midEff + compAdj + synergy + talentAdj + loadAdj +
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
		const orbW = rebWeight(comps, minShare, true);
		const drbW = rebWeight(comps, minShare, false);
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
			(teamCtx.astPool * astWeight(comps, ratings, minShare)) / teamCtx.astDen,
			0.10, teamCtx.astPool, TUNING.AST_CAP);
		/* Athleticism finally reaches the steal column. BBGM's stealing
		   composite is (50 + spd + 2*diq) / 400: defensive IQ outweighs speed
		   two to one and strength and leaping do not appear at all, so the
		   athletic freaks swatted shots (athleticism vs blocks correlated 0.54)
		   and never got into a passing lane (athleticism vs steals, 0.16).
		   The composite is left alone — half the model reads it — and the share
		   is tilted here instead. */
		const stl = capNoisy(
			(teamCtx.stlPool * stlWeight(comps, minShare)) / teamCtx.stlDen,
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
	function teamPools(comps, mins, pace, chanceMult, gameMinutes, env) {
		const gm = gameMinutes || 40;
		const e = env || {};
		/* The share of a team's own shots that come back as rebounds. This was
		   the literal constant 0.44, written twice in two files, while the
		   sim's own team field-goal percentage was .472 — a true miss share of
		   .528, a 20% internal inconsistency in the middle of the offensive
		   rebound chain. It is read off the model's own shooting now.

		   `oppMissShare` is the same number for the schedule this team faced,
		   which is what its DEFENSIVE rebound total should respond to: a team
		   that plays a diet of bad shooters gets more defensive rebounds than
		   one that plays great shooters, and the old hardcoded 25.2 could not
		   express that at all. */
		const missShare = clamp(
			e.missShare === undefined ? CAL.chanceShape().missShare : e.missShare, 0.42, 0.64);
		const oppMissShare = clamp(
			e.oppMissShare === undefined ? missShare : e.oppMissShare, 0.42, 0.64);
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
		/* The `base` in each scale() below is meant to be the composite an
		   AVERAGE D-I rotation scores, so an average roster gets a factor of
		   exactly 1 and the pool constant beside it means what it says. They
		   were hand-set and drifted away from the filler bases they mirror: a
		   returning player's passing composite synthesises to about 0.43 while
		   the scale was centred on 0.47, so every team in the country was
		   multiplied by 0.95 and team assists came out 5% light while the pool
		   constant itself looked correct. See POOL_BASE. */

		// Offensive rebound rate moves with the roster's glass work, which in
		// turn sets how many extra scoring chances the team creates.
		const orbRate = clamp(
			TUNING.ORB_RATE * scale(agg("rebounding", 0.25), POOL_BASE.rebounding, 0.55, 0.7, 1.35), 0.18, 0.42,
		);
		const chances = pace * chanceMult;
		const shape = CAL.chanceShape();
		/* Rebounds come off MISSED SHOTS, not off scoring chances. The pool was
		   `chances * missShare * orbRate`, and chances exceed field-goal
		   attempts by the turnovers and the free-throw split — about 34% — so
		   every offensive rebound total in the sim was a third too big, which
		   in turn inflated the chance multiplier that produced them. Team
		   rebounds measured 36.0 a game against a real 33.3 and the whole
		   possession chain was carrying the error. */
		const teamFga = chances * shape.fgaShare;
		const orbPool = teamFga * missShare * TUNING.ORB_FT * orbRate;
		/* The defensive glass is the mirror image: the opponent's missed shots,
		   minus the ones he rebounds himself. It was the constant 25.2, so a
		   team that played a schedule of bad shooters rebounded exactly as much
		   as one that played a schedule of great shooters. */
		const drbPool = teamFga * oppMissShare * TUNING.ORB_FT * (1 - TUNING.ORB_RATE) *
			scale(agg("rebounding", 0.25), POOL_BASE.rebounding, 0.35, 0.8, 1.25);

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
		const assistedShare = TUNING.ASSISTED_SHARE *
			scale(agg("passing", 0.35), POOL_BASE.passing, 0.55, 0.80, 1.22);

		return {
			orbRate,
			orbPool,
			drbPool,
			astPool: teamFga * (1 - missShare) * assistedShare,
			stlPool: 6.8 * scale(agg("stealing", 0.30), POOL_BASE.stealing, 1.00, 0.70, 1.45),
			/* Team blocks measured 4.57 a game against a real D-I 3.5, 31%
			   high: a 5.3 base and a 2.80x ceiling on top of a 1.70 exponent
			   compounded into a shot-blocking league. The shape is right (the
			   best rim protector on the floor should move his team's total,
			   which is what the 0.70 top-player weight buys); the level and the
			   ceiling were not. */
			blkPool: 4.0 * scale(agg("blocking", 0.70), POOL_BASE.blocking, 1.70, 0.55, 2.20),
			pfPool: TUNING.TEAM_PF * scale(agg("fouling", 0.20), POOL_BASE.fouling, 0.60, 0.80, 1.25),
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
				// Athleticism reaches the steal share now, so a filler needs it
				// too — without it every returning player's steal weight came
				// out NaN and took the whole team steal pool with it.
				athleticism: f(0.48, 0.09),
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
		/* The tilt was strengthened (0.50 -> 0.85). It corrected the ORDERING of
		   raw usage and then the soft ceiling and the renormalisation absorbed
		   most of it back: at equal overall rating a seven-footer and a guard
		   finished on the same 26% usage, so the big won the scoring title on
		   efficiency alone (58.7% from the floor against 45.2%) and outscored
		   the guard by 1.7 a game. Efficiency by size is right — real D-I
		   centres do shoot in the high fifties — so the fix is on the volume
		   side, where a draft class's guards really do carry more of the
		   offence than its centres. At 1.05 an overall-matched guard, wing and
		   centre score within half a point of one another, with the guard
		   ahead — which is the ordering a draft board shows. */
		/* Role usage. BBGM's usage composite reads shot-making, not the role a
		   coach hands a player, so the archetype says what the composite
		   cannot — see ROLE_USAGE in js/ratings.js. Fillers have no archetype
		   and take 1. */
		const RB = global.RatingsBuilder;
		const rawUsg = members.map((m, i) =>
			Math.pow(comps[i].usage, TUNING.USG_EXP) * Math.pow(0.35 + 1.3 * (m.talent / 100), 1.6) *
				(1 + 1.05 * (0.42 - bignessOf(i))) *
				CAL.talentUsageMult(m.talent) *
				(m.filler || !RB ? 1 : RB.roleUsage(m.player.archetype)),
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
			const floor = (m.filler ? TUNING.USG_FLOOR_FILLER : TUNING.USG_FLOOR) * ms;
			/* The ceiling is the player's, not the league's. A universal cap made
			   every good prospect converge on the same number.

			   The intercept came down (0.268 -> 0.253) because the cap was only
			   ever binding for one population: a prospect at a weak programme,
			   where nobody else can take a shot. High-major prospects average
			   25% usage and never reach it; mid-major ones sat on it, which is
			   most of why the same overall rating produced 16.7 points a game
			   in one conference and 21.2 in another. */
			const personal = clamp(
				0.253 + 0.50 * (comps[i].usage - 0.42) + 0.075 * ((m.talent - 55) / 45) +
					0.105 * (0.42 - bignessOf(i)),
				0.195, TUNING.USG_CAP,
			);
			return {
				floor,
				band: Math.max(1e-9, floor * TUNING.USG_FLOOR_BAND),
				room: Math.max(1e-6, personal * ms - floor),
			};
		});
		/* Saturating at BOTH ends. Above the floor the curve bends towards the
		   player's personal ceiling; below it, it bends towards floor - band
		   instead of clamping flat onto the floor. Both branches have slope 1
		   at the floor, so the map stays continuous, monotone and smooth and
		   the bisection below is still valid — and a genuine 12%-usage role
		   player is still ordered below a 15% one instead of both printing the
		   same number. */
		const softUsg = (v, i) => {
			const b = bounds[i];
			if (v <= b.floor) return b.floor - b.band * (1 - Math.exp(-(b.floor - v) / b.band));
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
		const stylePace = (team.style && team.style.pace) || 0;
		const pace = env.pace !== null && env.pace !== undefined
			? clamp(env.pace + (cfg.scoringEnv || 0) * 1.2 + stylePace, 50, 115)
			: clamp(cfg.pace + cfg.scoringEnv * 1.6 + stylePace, 58, 82);
		// Chances exceed possessions by the team's offensive rebounds; solve
		// chances = poss + orbRate * missShare * chances for the multiplier.
		// One pass on a nominal ORB rate, then refine with the roster's own.
		/* The share of shots that miss, for this team and for the schedule it
		   faced. Both were the hardcoded 0.44 while the sim shot .472 from the
		   floor. `oppFg` is the field-goal percentage of the opponents this
		   team actually played, which the engine works out from their rosters. */
		const missShare = clamp(1 - (ctx.teamFg || CAL.chanceShape().fgp), 0.42, 0.64);
		const oppMissShare = clamp(1 - (ctx.oppFg || (1 - missShare)), 0.42, 0.64);
		const poolEnv = { missShare, oppMissShare };
		/* chances = poss + ORB, and an offensive rebound comes off a MISSED FIELD
		   GOAL, so ORB = orbRate * ORB_FT * missShare * FGA and FGA is the
		   era's field-goal share of a chance:

		       chanceMult = 1 / (1 - orbRate * fgaShare * missShare * ORB_FT)

		   The old form took offensive rebounds off every chance rather than off
		   missed shots — turnovers and free-throw trips included — which put
		   the multiplier at 1.18 where the real ratio is 1.14, and inflated
		   every rebound total in the sim by a third. */
		const shape = CAL.chanceShape();
		const mult = (orbRate) =>
			clamp(1 / (1 - orbRate * shape.fgaShare * missShare * TUNING.ORB_FT), 1.05, 1.24);
		let chanceMult = mult(TUNING.ORB_RATE);
		let pools = teamPools(comps, mins, pace, chanceMult, gameMinutes, poolEnv);
		chanceMult = mult(pools.orbRate);
		pools = teamPools(comps, mins, pace, chanceMult, gameMinutes, poolEnv);

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
			style: team.style || { three: 0, rim: 0, press: 0, pace: 0 },
			rebDen: 0, orbDen: 0, astDen: 0, stlDen: 0, blkDen: 0, pfDen: 0,
		}, pools);
		// The pace this team actually plays at, jitter included, so statLine and
		// teamPools agree on one number.
		teamCtx.pace = env.pace !== null && env.pace !== undefined
			? clamp(pace + teamCtx.paceAdj, 50, 118)
			: clamp(pace + teamCtx.paceAdj, 58, 82);
		/* The rating rows the stat model reads, built once. statLine only needs
		   hgt, ft, tp and pss off a ratings row (everything else comes from the
		   composites), so a filler needs just those four — but they have to
		   exist BEFORE the denominator loop, because the assist share is read
		   partly off the raw passing rating and the numerator and denominator
		   have to agree. Height is backed out of the blocking composite, which
		   is mostly height by construction. */
		const ratingRows = members.map((m, i) => (m.filler
			? {
				hgt: clamp(30 + 55 * comps[i].blocking * 0.8, 5, 95),
				ft: 43, tp: 45, pss: clamp(comps[i].passing * 100, 5, 95),
			}
			: m.player.newRatings));

		for (let i = 0; i < members.length; i++) {
			const ms = mins[i] / gameMinutes;
			teamCtx.rebDen += rebWeight(comps[i], ms, false);
			teamCtx.orbDen += rebWeight(comps[i], ms, true);
			teamCtx.astDen += astWeight(comps[i], ratingRows[i], ms);
			teamCtx.stlDen += stlWeight(comps[i], ms);
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
			const line = statLine(
				rng.child(seed), ratingRows[i], comps[i], mins[i], usgShare[i], ctx, cfg,
				teamCtx, { talent: m.talent, filler: !!m.filler },
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
		totals.ast = 0; totals.stl = 0; totals.blk = 0; totals.pf = 0;
		totals.orb = 0; totals.trb = 0;
		for (const line of lines) {
			totals.ast += line.apg;
			totals.stl += line.spg;
			totals.blk += line.bpg;
			totals.pf += line.pfpg;
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
		/* Personal fouls. statLine computed them, totals summed them and this
		   function fitted everything except them, so team fouls answered to
		   nothing: measured 15.2 against the model's own 16.6 target. */
		set("pfpg", pools.pfPool, TUNING.PF_CAP);
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
		defenseProfile, rosterDefenseProfile, rosterShooting,
		astWeight, stlWeight, rebWeight, passSkill,
		leagueEnv, LEAGUE_ENV, NCAA_ENV,
		TUNING, ROTATION_SHAPE,
	};
})(typeof window !== "undefined" ? window : self);
