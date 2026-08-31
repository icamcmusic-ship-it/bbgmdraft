/* Builds the college (and pro) landscape the prospects play inside: program
   strength from BBGM draft frequency + conference, synthetic teammates, a full
   regular season, conference tournaments, and the resulting records. */
(function (global) {
	"use strict";

	const { clamp } = global.BBGMRng;
	const C = global.Colleges;

	// "College talent" scale, 0-100. Distinct from BBGM ovr: an 18-year-old
	// with a 40 NBA ovr is already very good in college — but not automatically
	// the best player on a blue-blood roster. The slope is chosen so an ovr-40
	// second-rounder (~67) is comparable to a top program's returning core
	// (makeFiller mean 0.72*level+6 ≈ 71 at level 90), while an ovr-55+
	// lottery talent (~81) clearly leads any roster. No saturation until the
	// clamp at ovr ~73, so the top of a class stays ordered.
	function prospectTalent(ovr, pot) {
		return clamp(36 + ovr * 0.80 + (pot - ovr) * 0.15, 20, 97);
	}

	/* `confStrength` is this season's strength for the conference, which drifts
	   from year to year (see conferenceDrift) rather than being the constant in
	   the table. The Big East being down and the Mountain West being up is an
	   ordinary year-to-year fact and it moves the whole AP poll, the bracket
	   and the award distribution for free. */
	function programLevel(name, rng, confStrength) {
		const conf = C.CONFERENCES[C.conferenceOf(name)] || C.CONFERENCES.Independent;
		const strength = Number.isFinite(confStrength) ? confStrength : conf.strength;
		const base = 0.45 * C.prestige(name) + 0.4 * strength;
		/* Year-to-year variance. The slope used to be `9 - 0.03 * prestige`,
		   which shrank the noise exactly where you would most want it:
		   Kentucky drew sigma 5.5 around a high base and Wagner sigma 9 around
		   a low one, so the blue bloods were pinned. Measured over 24 rerolls,
		   the AP No. 1 was one of six teams and the national champion one of
		   eleven. A blue blood's floor IS higher — that is what the base is for
		   — but Duke going 17-15 is a thing that happens and the model could
		   not express it. The slope is flat now, and a rare down year (or a
		   breakout) is drawn on top. */
		let level = base + rng.normal(0, PROGRAM_VOL);
		if (rng.random() < DOWN_YEAR_RATE) {
			// It falls apart: transfers out, an injury in November, a freshman
			// class that did not arrive. Bigger for a program with more to lose.
			level -= 6 + 0.14 * C.prestige(name) + rng.uniform(0, 6);
		} else if (rng.random() < BREAKOUT_RATE) {
			// The other direction: a mid-major that keeps everybody.
			level += 5 + 0.10 * (100 - C.prestige(name)) + rng.uniform(0, 5);
		}
		return clamp(level, 12, 95);
	}

	const PROGRAM_VOL = 7.0;
	const DOWN_YEAR_RATE = 0.09;
	const BREAKOUT_RATE = 0.09;

	/* This season's conference strengths. CONFERENCES[x].strength is a constant
	   and a conference's real strength moves several points a year; a static
	   table is why every simulated season had the same eight teams at the top
	   of it. Returns a name -> strength map for one run. */
	function conferenceDrift(rng) {
		const out = {};
		for (const name of Object.keys(C.CONFERENCES)) {
			const base = C.CONFERENCES[name].strength;
			// A strong conference is steadier, because it is strong for
			// structural reasons; a one-bid league swings on two rosters.
			const sd = 2.0 + 0.055 * (95 - base);
			out[name] = clamp(base + rng.child("conf:" + name).normal(0, sd), 30, 96);
		}
		return out;
	}

	/* Returning players are good, but not "NBA draft prospect" good: a top
	   program's supporting cast still sits well below its lottery freshman.

	   The decay is convex, not linear. A linear `- i * 1.6` made a blue blood's
	   ninth man an NBA-adjacent player: at level 90 the whole ten-man group sat
	   between 71 and 57, so a solid first-round prospect (talent ~74) was the
	   fourth-best player on his own team and played 26 minutes. Real
	   blue-blood rosters are top-heavy — two or three future pros, then a
	   clear cliff to role players — so 0-1 stay strong and 5-9 fall away fast.

	   The mean slope is flattened at the same time (0.72*level + 6 ->
	   0.60*level + 12.6) so the top of a good roster no longer out-talents the
	   prospects who are supposed to lead it, while the weighted team rating
	   stays close to what it was (the convex decay removes more from the tail,
	   which the higher intercept puts back at the top). Flattening also closes
	   the tier gap from the other end: measured PPG ran 10.3 at a high major
	   against 17.1 at a low major for the same ovr, when the real gap is 4-7. */
	function makeFiller(rng, level, i) {
		const mean = 0.60 * level + 12.6;
		/* The decay was steepened again (1.9 -> 2.4). At 1.9 a level-90 blue
		   blood's returning core still averaged 66.6 against a prospect at
		   about 76 — so four teammates sat within twelve points of the man who
		   was supposed to lead the team, and usage and minutes were shared four
		   ways. Measured: a high-major prospect played 29.2 minutes and scored
		   13.4 against a low-major's 35.5 and 19.9 at the same overall rating,
		   and where a prospect played predicted his scoring better than how
		   good he was. */
		let talent = clamp(rng.normal(mean, 8.5) - Math.pow(i, 1.35) * 2.4, 6, 95);
		/* The college star who is not a prospect.

		   A returning player's talent was drawn from his programme's level and
		   nothing else, so the best player in the country was, by construction,
		   always somebody in the draft class: the national player of the year
		   came out of the class in 100% of seasons. Real college basketball is
		   full of men who are excellent college players and not NBA prospects —
		   several of the 2024 consensus first-team All-Americans went undrafted
		   — and without them the class has nobody to lose an award to.

		   Rare (about a dozen in the country) and only among the top of a
		   rotation, because that is what the player is. */
		/* Star returner (task 4.6): a returning player who is excellent at the
		   college level and not an NBA prospect. The kind is drawn from a table
		   so "returning conference player of the year" and "senior leader who
		   came back" produce different boosts, and the `starReturner` tag lets
		   the award model recognise who this player is. */
		let starReturner = null;
		if (i <= 2 && rng.random() < STAR_RETURNER_RATE) {
			const kind = rng.weighted(STAR_RETURNER_KINDS);
			talent = clamp(talent + rng.uniform(kind.boostLo, kind.boostHi), 6, 96);
			starReturner = kind.name;
		}
		// Endurance drives how much of a rotation spot a player can actually
		// hold, and it is the one rating that never fed the minutes model.
		// Star returners get a modest endurance bump: they have been through
		// a college season before and their conditioning reflects it.
		const endu = starReturner
			? clamp(rng.normal(0.62 - 0.015 * i, 0.08), 0.30, 0.95)
			: clamp(rng.normal(0.52 - 0.02 * i, 0.10), 0.15, 0.95);
		return {
			filler: true, talent, name: "roster" + i,
			endurance: endu,
			starReturner,
		};
	}

	/* A program that landed a future draft pick usually landed him because it
	   did not already have two of them.

	   Without this, `makeFiller` and `prospectTalent` sit on incompatible
	   scales at the top of the country: a level-85 program's three best
	   returning players synthesise to 63.6 / 61.2 / 57.5, while an ovr-30
	   second-rounder is talent 59.9 — so a drafted NBA player was routinely the
	   fourth option on his own college team, fell to ~25 minutes and printed
	   seven points. Measured, where a prospect played predicted his minutes
	   (-0.76) two and a half times better than how good he was (+0.30), and
	   28% of late second-rounders finished under 10 points a game.

	   So the two best returning players on a roster that carries a prospect are
	   capped just below the best prospect on it. Rosters with no prospect are
	   untouched, and a roster whose prospect is a genuine lottery talent is
	   untouched too, because the cap is not binding there. */
	const FILLER_GAP = 4;
	/* Per top-three rotation slot, so roughly a dozen across 368 programmes.
	   Raised from 0.012 (task 4.6): at the old rate about seven programmes in
	   the country had a star returner, and the uniform talent bump (+10-24)
	   produced the same kind of player every time. The rate is doubled so a
	   class has 14-18 star returners — still rare, but enough that the award
	   model has real competition — and the boost is drawn from a table of
	   KINDS so that a returning first-team all-conference wing and a returning
	   shot-blocking center are two different players rather than "filler + 18". */
	const STAR_RETURNER_RATE = 0.024;
	const STAR_RETURNER_KINDS = [
		{ name: "returning all-conference scorer", w: 2.0, boostLo: 14, boostHi: 22 },
		{ name: "returning defensive anchor", w: 1.5, boostLo: 12, boostHi: 20 },
		{ name: "preseason all-american", w: 0.8, boostLo: 18, boostHi: 26 },
		{ name: "returning conference player of the year", w: 0.6, boostLo: 20, boostHi: 28 },
		{ name: "senior leader who came back", w: 1.4, boostLo: 10, boostHi: 18 },
		{ name: "returning starter with a year of growth", w: 2.0, boostLo: 8, boostHi: 16 },
	];
	function capFillers(fillers, prospects) {
		if (!prospects.length || !fillers.length) return;
		let best = -Infinity;
		for (const p of prospects) best = Math.max(best, p.talent);
		const cap = best - FILLER_GAP;
		// The cap applies to the two best returners as realised, not to the two
		// nominal slots: the draw has sd 8.5, so slot 3 routinely out-rolls
		// slot 0 and capping by slot index would miss the player it is for.
		const order = fillers.slice().sort((a, b) => b.talent - a.talent);
		for (let i = 0; i < Math.min(2, order.length); i++) {
			order[i].talent = Math.min(order[i].talent, cap);
		}
	}

	function rotationWeights(n) {
		const w = [1, 0.96, 0.9, 0.84, 0.76, 0.6, 0.45, 0.3, 0.18, 0.1];
		return w.slice(0, n);
	}

	function teamRating(members) {
		const sorted = members.slice().sort((a, b) => b.talent - a.talent).slice(0, 9);
		const w = rotationWeights(sorted.length);
		let num = 0;
		let den = 0;
		for (let i = 0; i < sorted.length; i++) {
			num += sorted[i].talent * w[i];
			den += w[i];
		}
		return num / den;
	}

	/* How a program plays. Prospects were dropped onto a school that had a
	   strength and nothing else — Villanova guards shoot threes and Gonzaga
	   bigs get lobs, and the tool had no way to express either, so a shooter at
	   a four-out program and a shooter at a pack-line program produced the same
	   line. The numbers are shifts applied to the stat model: `three` moves
	   3PA share, `pace` moves possessions, `rim` moves the rim/mid split and
	   `press` moves the turnovers a defence forces. */
	/* `defScheme` is a defensive-scheme axis: switching = a switch-everything
	   scheme that gives up size to stay in front; zone = a 2-3 or 3-2 zone that
	   protects the paint; packLine = a pack-line/sagging man scheme that walls
	   off the rim; pressing = a full-court press that gambles for turnovers.
	   Each is a multiplier on the stat model's steal/block/turnover channels,
	   so a prospect at a switching programme steals more and blocks less than
	   the same prospect at a zone programme — which is what actually happens. */
	const PROGRAM_STYLES = [
		{ name: "balanced", w: 3.0, three: 0, pace: 0, rim: 0, press: 0, defScheme: "man" },
		{ name: "four-out, three-heavy", w: 2.0, three: 0.09, pace: 1.5, rim: -0.03, press: 0, defScheme: "switching" },
		{ name: "pack-line, grind it out", w: 1.6, three: -0.02, pace: -4.5, rim: 0.02, press: -0.02, defScheme: "packLine" },
		{ name: "run and gun", w: 1.4, three: 0.05, pace: 5.5, rim: 0.03, press: 0.02, defScheme: "man" },
		{ name: "inside-out, post-heavy", w: 1.3, three: -0.08, pace: -1.5, rim: 0.07, press: 0, defScheme: "zone" },
		{ name: "ball-screen heavy", w: 1.6, three: 0.04, pace: 1.0, rim: 0.02, press: 0, defScheme: "switching" },
		{ name: "full-court press", w: 0.9, three: 0.02, pace: 4.5, rim: 0.04, press: 0.06, defScheme: "pressing" },
		{ name: "lob city", w: 1.0, three: -0.04, pace: 1.5, rim: 0.08, press: 0, defScheme: "man" },
		/* --- additional styles (task 4.3 & 4.4) ---
		   The original eight were all offensive identities: a program's defensive
		   philosophy — switching, zone, pack-line, press — affected nothing. Six
		   more fill the gap. Each carries `defScheme` so the stat model's
		   steal/block/turnover channels can read it, and a distinctive offensive
		   shape so the note reads as something a human would write. */
		{ name: "switch-everything perimeter", w: 1.4, three: 0.06, pace: 1.0, rim: -0.02, press: 0.01, defScheme: "switching" },
		{ name: "2-3 zone, protect the paint", w: 1.2, three: -0.03, pace: -2.0, rim: 0.04, press: -0.02, defScheme: "zone" },
		{ name: "matchup zone", w: 1.0, three: 0.02, pace: -1.0, rim: 0.02, press: 0, defScheme: "zone" },
		{ name: "press and trap", w: 0.8, three: 0.03, pace: 5.0, rim: 0.02, press: 0.08, defScheme: "pressing" },
		{ name: "motion offence, pack-line D", w: 1.3, three: 0.04, pace: -2.5, rim: 0, press: -0.02, defScheme: "packLine" },
		{ name: "dribble-drive, deny the wing", w: 1.1, three: -0.02, pace: 2.0, rim: 0.05, press: 0.01, defScheme: "man" },
	];

	/* Coaches.

	   A program had a strength and a playing style drawn independently at
	   random every run, which is the cheapest possible source of program
	   identity left on the table: in reality the style IS the coach, the
	   coach is the same man next season, and "a first-year coach at a blue
	   blood" and "a thirty-year fixture at a mid-major" are two completely
	   different teams at the same rating.

	   The name is synthetic (this tool ships no real coaches, and inventing a
	   real one's results is not something a draft-class generator should do),
	   but everything attached to it is used: `style` replaces the free-floating
	   style roll, `dev` moves how much a young roster improves over the season,
	   and `tenure` and `hot` feed Coach of the Year. Drawn from the program's
	   own RNG child, so a given program gets a stable coach for a given seed. */
	const COACH_FIRST = [
		"Ray", "Dan", "Marcus", "Tom", "Bruce", "Leon", "Chris", "Pat", "Ed",
		"Kevin", "Andre", "Mike", "Steve", "Wes", "Hal", "Dennis", "Craig",
		"Tony", "Grant", "Sam", "Vince", "Nate", "Curtis", "Joel", "Roland",
		"Rodney", "Jerome", "Cliff", "Walt", "Terrence", "Darren", "Phil",
		"Reggie", "Lamont", "Oscar", "Calvin", "Mitch", "Boyd", "Russ", "Dwight",
	];
	const COACH_LAST = [
		"Aldrich", "Beauchamp", "Calloway", "Duvall", "Espinoza", "Fenwick",
		"Garrity", "Hollis", "Ingersoll", "Jessup", "Kowalczyk", "Lindqvist",
		"Marchetti", "Nakamura", "Okafor", "Prendergast", "Quaranta", "Rasmussen",
		"Stallworth", "Thibault", "Underwood", "Vandermeer", "Whitlock", "Yarbrough",
		"Zabala", "Baptiste", "Cifuentes", "Donnelly", "Ferrara", "Gundersen",
		"Hargrove", "Iverson", "Kirby", "Langford", "McBride", "Nwosu",
		"Pettigrew", "Renfroe", "Simmonds", "Tran", "Villarreal", "Worthington",
	];

	/* Coaching philosophy archetypes (task 4.4).

	   A coach had a style, a tenure and a dev number, but every staff
	   developed players the same way. In reality, a "player-development
	   guru" and a "Xs-and-Os tactician" are different staffs with different
	   effects on the same prospect: one raises his ceiling, the other
	   maximises what he already has. `devBias` skews how much a roster
	   improves over the season (form), `usageBias` nudges how much offence
	   a prospect gets (a stars-and-scrubs coach funnels touches; a
	   egalitarian one spreads them), and `defEmphasis` weights the
	   defensive stat channel. */
	const COACH_PHILOSOPHIES = [
		{ name: "player-developer", w: 2.0, devBias: 1.8, usageBias: 0, defEmphasis: 0 },
		{ name: "Xs-and-Os tactician", w: 1.8, devBias: -0.4, usageBias: 0, defEmphasis: 0.5 },
		{ name: "recruiter-first", w: 1.6, devBias: -0.8, usageBias: 0.3, defEmphasis: 0 },
		{ name: "defensive-minded", w: 1.5, devBias: 0.4, usageBias: -0.2, defEmphasis: 1.2 },
		{ name: "uptempo innovator", w: 1.2, devBias: 0.6, usageBias: 0.5, defEmphasis: -0.4 },
		{ name: "old-school disciplinarian", w: 1.3, devBias: 0.2, usageBias: -0.4, defEmphasis: 0.8 },
		{ name: "stars-and-scrubs", w: 1.0, devBias: -0.2, usageBias: 1.2, defEmphasis: 0 },
		{ name: "egalitarian", w: 1.1, devBias: 0.8, usageBias: -0.8, defEmphasis: 0.2 },
		{ name: "analytics-driven", w: 1.0, devBias: 0.5, usageBias: 0.2, defEmphasis: 0.3 },
		{ name: "neutral", w: 3.0, devBias: 0, usageBias: 0, defEmphasis: 0 },
	];

	/* The carousel.

	   A coach had a style, a tenure and a development number, and no
	   SITUATION — so every staff in the country was in the same year of the
	   same job, and the three cheapest and most-felt facts about a college
	   season were missing: the first-year man installing a system nobody knows
	   yet, the lame duck whose players have read the same message boards
	   everyone else has, and the interim who took over in December.

	   Each bends `form` (how much better a team is in March than in November)
	   and `dev`, both of which the model already carries and both of which are
	   exactly what a coaching situation moves. `levelAdj` moves the team's
	   own strength, because a first-year rebuild is not the same team the
	   previous staff left behind. */
	const COACH_SITUATIONS = [
		{
			name: "first year", label: "in his first season here", w: 0,
			form: 1.6, dev: 0.8, levelAdj: -1.8,
		},
		{
			name: "interim", label: "took over in December", w: 0,
			form: -1.4, dev: -1.2, levelAdj: -2.6,
		},
		{
			name: "hot seat", label: "on the hot seat", w: 0,
			form: -1.2, dev: -0.9, levelAdj: -1.0,
		},
		{
			name: "fixture", label: "a fixture here", w: 0,
			form: 0.8, dev: 0.7, levelAdj: 0.8,
		},
		{ name: "settled", label: null, w: 0, form: 0, dev: 0, levelAdj: 0 },
	];
	const SITUATION_BY_NAME = {};
	for (const c of COACH_SITUATIONS) SITUATION_BY_NAME[c.name] = c;

	function makeCoach(rng, level, prestige) {
		// A better program usually has a longer-tenured coach, because a coach
		// who wins keeps his job and a coach who wins is hired by better
		// programs. The tail is what makes a first-year man at a blue blood
		// possible without being ordinary.
		const tenure = Math.max(1, Math.round(
			rng.uniform(0, 3) + Math.abs(rng.normal(0, 2 + prestige * 0.09))));
		/* The situation follows from the tenure and from whether the programme
		   is under-performing its name, which is what actually puts a coach on
		   a hot seat. */
		let situation = "settled";
		const roll = rng.random();
		if (tenure === 1) situation = roll < 0.22 ? "interim" : "first year";
		else if (tenure >= 16 && roll < 0.55) situation = "fixture";
		else if (level < prestige - 12 && roll < 0.40) situation = "hot seat";
		const sit = SITUATION_BY_NAME[situation];
		/* Coaching philosophy (task 4.4): how this staff develops players and
		   distributes usage. A "player-developer" raises ceilings across the
		   roster; a "stars-and-scrubs" coach funnels touches to his best man;
		   a "defensive-minded" coach's prospect blocks more shots and steals
		   more balls. The philosophy is drawn per-coach, not per-season. */
		const philosophy = rng.weighted(COACH_PHILOSOPHIES);
		return {
			name: rng.pick(COACH_FIRST) + " " + rng.pick(COACH_LAST),
			tenure,
			situation,
			situationLabel: sit.label,
			levelAdj: sit.levelAdj,
			style: rng.weighted(PROGRAM_STYLES),
			philosophy: philosophy.name,
			// How much this staff develops a roster across a season. Feeds the
			// team's `form`, which is its March rating against its November one.
			// The philosophy biases this: a player-developer improves a roster
			// more than a recruiter-first coach does.
			dev: rng.normal(0, 2.6) + sit.dev + (philosophy.devBias || 0),
			formAdj: sit.form,
			// Usage and defensive emphasis, read by the stat model downstream.
			usageBias: philosophy.usageBias || 0,
			defEmphasis: philosophy.defEmphasis || 0,
			// Reputation, for Coach of the Year: it is voted on against
			// expectations, and expectations follow the name on the door. A
			// first-year man and an interim carry none of the incumbent's.
			rep: clamp(0.35 * prestige + 0.35 * level + rng.normal(0, 10) +
				(situation === "first year" || situation === "interim" ? -12 : 0), 5, 95),
		};
	}

	/* Conference realignment.

	   Conference STRENGTH drifted from year to year and membership never did,
	   so the map of college basketball was the one constant in a tool built to
	   make every run different — and realignment is the single most
	   consequential thing that happens to that map in real life.

	   A realignment moves two to five programmes from weaker conferences into
	   a stronger one that is raiding. It is bounded by two rules that keep the
	   season schedulable: a conference never falls below MIN_CONF_MEMBERS, and
	   a raider never takes more than it can fit. Returns the per-run mapping
	   plus a list of the moves, so the UI can say what happened. */
	const MIN_CONF_MEMBERS = 7;
	function realign(rng, cfg) {
		const confOf = {};
		for (const name of C.names) confOf[name] = C.conferenceOf(name) || "Independent";
		const rate = clamp(
			cfg && cfg.realignmentRate !== undefined ? cfg.realignmentRate : 0.35, 0, 1);
		const moves = [];
		if (rate <= 0 || rng.random() >= rate) return { confOf, moves };
		const members = {};
		for (const name of C.names) {
			(members[confOf[name]] = members[confOf[name]] || []).push(name);
		}
		const strength = (conf) =>
			(C.CONFERENCES[conf] ? C.CONFERENCES[conf].strength : 50);
		// Who is raiding: a strong conference, weighted by how strong.
		const raiders = Object.keys(members).filter((c) => strength(c) >= 62);
		if (!raiders.length) return { confOf, moves };
		const to = rng.weighted(raiders, (c) => Math.pow(strength(c) - 55, 2));
		const wanted = rng.int(2, 5);
		/* Who gets taken: a good programme from the tier immediately below.
		   Without the lower bound on the raided conference's strength the
		   model produced "LIU, NEC to Big 12", which is not a realignment,
		   it is a rounding error — real raids reach one rung down, not five. */
		const candidates = C.names
			.filter((n) => {
				if (confOf[n] === to) return false;
				const sf = strength(confOf[n]);
				return sf < strength(to) - 4 && sf > strength(to) - 26 &&
					C.prestige(n) >= 60;
			})
			.sort((a, b) => C.prestige(b) - C.prestige(a))
			.slice(0, 30);
		for (const name of rng.shuffle(candidates)) {
			if (moves.length >= wanted) break;
			const from = confOf[name];
			if (members[from].length <= MIN_CONF_MEMBERS) continue;
			members[from].splice(members[from].indexOf(name), 1);
			members[to].push(name);
			confOf[name] = to;
			moves.push({ school: name, from, to });
		}
		return { confOf, moves };
	}

	/* Build every NCAA program for the season. prospectsBySchool maps a college
	   name to the rebuilt draft prospects who play there. */
	function buildPrograms(prospectsBySchool, rng, cfg) {
		const teams = {};
		// Colleges outside the built-in 368 (league files drift across BBGM
		// versions) become independent mid-level programs instead of crashing.
		const extra = Object.keys(prospectsBySchool).filter((n) => !C.COLLEGES[n]);
		const confStrength = conferenceDrift(rng.child("confdrift"));
		/* This season's map. Membership is a per-run fact now; everything
		   downstream reads team.conf, so the schedule, the conference
		   tournaments and the all-conference teams all follow it for free. */
		const map = realign(rng.child("realign"), cfg);
		const confAt = (n) => map.confOf[n] || C.conferenceOf(n) || "Independent";
		teams.__realignment = map.moves;
		for (const name of C.names.concat(extra)) {
			const trng = rng.child("prog:" + name);
			const level = programLevel(name, trng, confStrength[confAt(name)]);
			const prospects = prospectsBySchool[name] || [];
			const members = prospects.map((p) => ({
				filler: false,
				player: p,
				talent: prospectTalent(p.newOvr, p.newPot),
			}));
			const nFill = Math.max(6, 10 - members.length);
			const fillers = [];
			for (let i = 0; i < nFill; i++) fillers.push(makeFiller(trng, level, i));
			capFillers(fillers, members);
			for (const f of fillers) members.push(f);

			const coach = makeCoach(trng.child("coach"), level, C.prestige(name));
			/* A first-year rebuild is not the team the previous staff left
			   behind, and an interim's is less of one still. */
			const coachedLevel = clamp(level + (coach.levelAdj || 0), 5, 99);
			teams[name] = {
				name,
				coach,
				// This season's conference strength, so anything that reads it
				// (selection, the note, the harness) reads the same number the
				// program was built from.
				confStrength: confStrength[confAt(name)],
				// The style IS the coach; it used to be an independent roll.
				style: coach.style,
				conf: confAt(name),
				// Where this programme played last season, when it moved.
				movedFrom: map.confOf[name] && C.conferenceOf(name) !== map.confOf[name]
					? C.conferenceOf(name) : null,
				prestige: C.prestige(name),
				level: coachedLevel,
				members,
				rating: teamRating(members),
				prospects,
				w: 0, l: 0, cw: 0, cl: 0,
				sos: 0, games: 0, quadWins: 0,
				log: [],
				// How much better (or worse) this team is in March than in
				// November. Young rosters improve most.
				// A staff that develops players is a team that is better in
				// March than in November, which is what `form` means.
				form: trng.normal(2.0, 4.5) + coach.dev + (coach.formAdj || 0),
				/* The season's shape, as distinct from its trend.

				   `form` is a straight line from November to March, and a
				   straight line is not what a season looks like. Every game was
				   otherwise an independent draw around the team's rating on
				   that date, so a season had no streaks in it: no five-game run
				   that put a bubble team in the field, no 2-8 stretch after the
				   best player went down, nothing a schedule could be read as a
				   story rather than as a list. Individual STAT LINES already
				   had autocorrelation (see `form` in gameLog); team results,
				   the thing a season is actually remembered by, did not.

				   Games are not simulated in date order — they are drawn with a
				   `when` in [0, 1] and played in whatever order the scheduler
				   pairs them — so a sequential AR walk is not available. A path
				   is precomputed instead: ARC_KNOTS knots of an AR(1) process,
				   interpolated at `when`. Autocorrelation in the calendar is
				   exactly what that gives, and it does not care what order the
				   games are played in. */
				arc: momentumArc(trng, cfg),
			};
		}
		/* Narrative bends, applied after every programme exists because they
		   are statements about the SEASON rather than about any one team:
		   "the year three blue bloods all went down" and "the year the
		   mid-majors won" are the kind of thing a class is remembered for and
		   the archetype-mix flavours could never express. */
		const nrng = rng.child("narrative");
		const down = Math.round(clamp(
			cfg && cfg.bluebloodDownYears !== undefined ? cfg.bluebloodDownYears : 0, 0, 8));
		if (down > 0) {
			const blue = C.names.slice()
				.sort((a, b) => C.prestige(b) - C.prestige(a)).slice(0, 24);
			for (const name of nrng.shuffle(blue).slice(0, down)) {
				const t = teams[name];
				if (!t) continue;
				t.level = clamp(t.level - nrng.uniform(9, 16), 5, 99);
				t.rating = teamRating(t.members);
				t.downYear = true;
			}
		}
		const lift = clamp(
			cfg && cfg.midMajorLift !== undefined ? cfg.midMajorLift : 0, 0, 12);
		if (lift > 0) {
			for (const name of C.names) {
				const t = teams[name];
				if (!t || C.prestige(name) >= 62) continue;
				t.level = clamp(t.level + lift * nrng.uniform(0.4, 1.0), 5, 99);
				t.midMajorSurge = true;
			}
		}
		return teams;
	}

	function winProb(a, b, homeEdge) {
		const diff = a - b + (homeEdge || 0);
		return 1 / (1 + Math.exp(-diff / 7.5));
	}

	/* A team's rating on a given day. Programs are not frozen at build time:
	   freshmen figure it out, veterans wear down, and a team that is 8 points
	   better in March than in November is the most ordinary thing in college
	   basketball. `when` is 0 (first game) to 1 (last). */
	/* A team's momentum path over the season: ARC_KNOTS knots of an AR(1)
	   process, centred on zero so the arc moves a season around without moving
	   its mean. ARC_RHO is the knot-to-knot persistence; at 0.72 over eight
	   knots a hot stretch lasts about a month of a four-month season, which is
	   what a streak is. ARC_SD is in rating points, so a team on a run plays
	   like a team two or three points better — enough to move a bubble, not
	   enough to make a 12-seed a 3. */
	const ARC_KNOTS = 8;
	const ARC_RHO = 0.72;
	const ARC_SD = 2.6;
	function momentumArc(rng, cfg) {
		const strength = clamp(
			cfg && cfg.teamMomentum !== undefined ? cfg.teamMomentum : 1, 0, 3);
		if (strength <= 0) return null;
		const sd = ARC_SD * strength;
		const knots = [];
		let x = rng.normal(0, sd);
		for (let i = 0; i < ARC_KNOTS; i++) {
			knots.push(x);
			x = ARC_RHO * x + Math.sqrt(1 - ARC_RHO * ARC_RHO) * rng.normal(0, sd);
		}
		// Centred, so the arc is a shape and not a second rating adjustment.
		const m = knots.reduce((a, b) => a + b, 0) / knots.length;
		return knots.map((v) => v - m);
	}

	function arcAt(t, w) {
		const arc = t.arc;
		if (!arc || arc.length < 2) return 0;
		const x = clamp(w, 0, 1) * (arc.length - 1);
		const i = Math.min(arc.length - 2, Math.floor(x));
		const f = x - i;
		return arc[i] * (1 - f) + arc[i + 1] * f;
	}

	function ratingOn(t, when) {
		const w = when === undefined ? 0.5 : clamp(when, 0, 1);
		let r = t.rating + (t.form || 0) * (w - 0.5) * 2 + arcAt(t, w);
		/* Whoever is hurt right now is not playing. Before this, an absence was
		   invented after the season had been simulated, so a player who missed
		   fourteen games with a knee had exactly the same effect on his team's
		   record as if he had played every night. */
		for (const o of t.outages || []) {
			if (w >= o.from && w <= o.to) r -= o.drop;
		}
		return r;
	}

	/* Turn the availability drawn on each prospect into a list of dated rating
	   drops on his team. The drop is the difference the roster's own rating
	   makes without him, so losing a lottery pick costs a team far more than
	   losing its fourth-best prospect — and losing either costs nothing at all
	   on a roster deep enough to cover. */
	function applyOutages(teams) {
		for (const name of Object.keys(teams)) {
			const t = teams[name];
			t.outages = [];
			for (const m of t.members) {
				if (m.filler || !m.player) continue;
				const av = m.player.availability;
				if (!av || !av.injury || av.from === null) continue;
				const without = t.members.filter((x) => x !== m);
				const drop = without.length
					? Math.max(0, t.rating - teamRating(without))
					: 0;
				t.outages.push({
					from: av.from, to: av.to, drop, who: m.player.key, kind: av.kind,
				});
			}
		}
	}

	/* Play one game and produce an actual score. The margin is drawn from the
	   rating gap; the total comes from pace, so a grind-it-out league produces
	   58-55 finals and a track meet produces 88-84. Ties go to overtime. */
	/* `postseason` decides whether the "March upsets" slider applies.

	   It used to apply to every game in the season, so a slider labelled
	   "March upsets" silently re-rolled November too — which is also why
	   changing it had to re-simulate the entire regular season rather than only
	   the bracket it names. Regular-season variance is a fixed, realistic
	   amount; the slider moves the postseason, which is what the label says. */
	const REGULAR_NOISE = 1.35;

	function playGameScore(rng, A, B, homeForA, cfg, when, postseason) {
		const noise = postseason
			? 1 + 0.35 * clamp(cfg.upsetFactor, 0, 3)
			: REGULAR_NOISE;
		const home = homeForA === 0 ? 0 : homeForA > 0 ? 3.2 : -3.2;
		const edge = ratingOn(A, when) - ratingOn(B, when) + home;
		// ~0.72 points of margin per rating point, plus real game-to-game noise.
		const margin = edge * 0.72 + rng.normal(0, 9.4 * noise);
		const pace = clamp((cfg.pace || 68) + (cfg.scoringEnv || 0) * 1.6, 58, 82);
		const total = clamp(pace * 2.06 + rng.normal(0, 9), 92, 190);
		let a = Math.round((total + margin) / 2);
		let b = Math.round((total - margin) / 2);
		let ot = 0;
		while (a === b) {
			// Overtime: five more minutes, and somebody has to win them. The
			// old loop bailed after 4OT by adding a single point outside the
			// scoring model, so a 5OT game was decided by fiat. Instead, keep
			// playing extra periods but widen the swing each time, which ends
			// the game inside the model within a couple more periods and still
			// produces a plausible 5OT box score.
			ot++;
			const swing = rng.normal(edge * 0.10, 4.2 + ot * 0.8);
			a += Math.round(6 + swing / 2);
			b += Math.round(6 - swing / 2);
		}
		return { a, b, ot, won: a > b };
	}

	function playGame(rng, A, B, homeForA, cfg, when, postseason) {
		return playGameScore(rng, A, B, homeForA, cfg, when, postseason).won;
	}

	/* Every game a team plays goes through here, regular season and postseason
	   alike. Before this, only simulateRegularSeason called record(): a
	   conference tournament run bumped `ctW` and an NCAA run bumped `ncaaWins`,
	   and neither touched w/l/log. A national champion was displayed as 25-6
	   when it had actually gone 34-6, the note line printed a record that
	   contradicted the postseason result printed beside it, and the prospect's
	   own GP (which counts postseason games) exceeded his team's games played.

	   `stage` is one of "reg" | "conf" | "ncaa" | "nit", so the schedule can be
	   read back by phase and a signature game can name the round it happened
	   in. */
	function record(t, opp, won, conference, score, home, when, stage) {
		if (won) { t.w++; if (conference) t.cw++; } else { t.l++; if (conference) t.cl++; }
		t.sos += opp.rating;
		t.games++;
		// Team ratings run mean ~38, p95 ~61 on this scale, so "quality win"
		// means beating a clearly-above-average opponent, not a near-unicorn.
		if (won && opp.rating > 55) t.quadWins++;
		// Kept so a prospect's best night can name a real opponent and date.
		t.log.push({
			opp: opp.name, won, conference: !!conference,
			pf: score ? score.us : null, pa: score ? score.them : null,
			ot: score ? score.ot : 0,
			home: home === undefined ? 0 : home,
			when: when === undefined ? 0.5 : when,
			quality: opp.rating,
			stage: stage || "reg",
			round: score && score.round ? score.round : null,
		});
	}

	/* A game recorded on both teams at once. `when` is deliberately above 1 for
	   postseason rounds so the chronological sort puts March after February.

	   `homeForA` was hardcoded to 0 for both sides, which is right for a
	   neutral-court bracket and wrong for the professional regular seasons,
	   which route through here too (simulateProLeagues). Every abroad game
	   therefore logged home: 0, and the home-court lift in the game-log
	   generator — `g.home > 0 ? 0.055 : 0` — could never fire for a EuroLeague
	   or G League prospect, so their game logs were flatter than college ones
	   by construction. */
	function recordPostseason(A, B, sc, stage, when, round, homeForA) {
		const h = homeForA || 0;
		record(A, B, sc.won, false,
			{ us: sc.a, them: sc.b, ot: sc.ot, round }, h, when, stage);
		record(B, A, !sc.won, false,
			{ us: sc.b, them: sc.a, ot: sc.ot, round }, -h, when, stage);
	}

	/* Chronological order, once every game has been played.

	   simulateRegularSeason runs the whole conference loop before the whole
	   non-conference loop, so team.log came out conference-first regardless of
	   the `when` stamped on each game. Anything reading the log in order — the
	   signature game, a game log, "which games did he miss" — was reading the
	   season out of sequence, and a player who missed games always missed the
	   last N entries, i.e. always non-conference ones. */
	function finalizeSchedule(teams) {
		for (const name of Object.keys(teams)) {
			const t = teams[name];
			t.log.sort((a, b) => a.when - b.when);
			t.pct = t.games ? t.w / t.games : 0;
			t.sosAvg = t.games ? t.sos / t.games : 50;
		}
	}

	const CONF_GAMES = 18;
	const NON_CONF_GAMES = 13;

	/* Pair teams up so that EVERY team finishes with exactly `target` games.
	   The old version bailed out of its guard loop and left teams up to four
	   games short, so a 27-game team's 20-7 sat in the same table as a 31-game
	   team's 23-8. This one keeps matching the neediest teams until the need
	   vector is empty, which it always can be: the total need is even (each
	   game consumes two), so the only failure mode is a single team left
	   needing games, which the odd-total guard below rules out. */
	function pairUp(rng, pool, target, filterFn, onGame) {
		if (pool.length < 2) return;
		const need = new Map();
		for (const t of pool) need.set(t, target);
		// An odd (teams x target) product cannot be split into pairs; drop one
		// game from a random team so the rest come out exact.
		if ((pool.length * target) % 2 === 1) {
			const victim = pool[Math.floor(rng.random() * pool.length)];
			need.set(victim, target - 1);
		}
		let guard = 0;
		const maxGuard = pool.length * target * 8 + 2000;
		while (guard++ < maxGuard) {
			// Always serve the neediest team first. That keeps the remaining
			// need spread evenly instead of stranding one team at the end.
			const avail = pool.filter((t) => need.get(t) > 0)
				.sort((a, b) => need.get(b) - need.get(a));
			if (avail.length < 2) break;
			const a = avail[0];
			const rest = avail.slice(1);
			let b = null;
			/* Prefer an opponent the filter likes, but never at the cost of
			   leaving the schedule short.

			   The acceptance draw is made HERE and handed to the filter, rather
			   than being taken inside the filter's own predicate. The
			   non-conference filter used to call rng.random() inside itself, up
			   to fourteen times per pairing, which left the schedule sensitive
			   to loop order in a way nothing tested — and which is exactly the
			   hazard the rng.child() comment in js/rng.js exists to warn about.
			   Determinism held; reasoning about it did not. */
			for (let tries = 0; tries < 14 && !b; tries++) {
				const cand = rest[Math.floor(rng.random() * Math.min(rest.length, 24))];
				const roll = rng.random();
				if (cand && (!filterFn || filterFn(a, cand, roll))) b = cand;
			}
			if (!b) b = rest[Math.floor(rng.random() * rest.length)];
			onGame(a, b);
			need.set(a, need.get(a) - 1);
			need.set(b, need.get(b) - 1);
		}
	}

	/* --- the season's mid-season events ---------------------------------

	   The season was one pass: build the programmes, play the games, sort the
	   results. Nothing happened DURING it. A schedule was a list of scores with
	   no top-ten upset in it, no rivalry night, no coach fired in January, no
	   game both prospects in the class played in — which is most of what makes
	   one season memorable and another one a table.

	   Each event is drawn AFTER the games are played and reads the results that
	   were already produced, so none of them invents anything: the upset is a
	   real result in a real game, the coach who gets fired is a coach whose
	   team really did lose, and the game of the year is genuinely the closest
	   high-quality game on the schedule. That is the difference between an
	   event system and a decoration — nothing here can contradict the box
	   scores, because all of it is read off them.

	   The one exception is the postponement, which is a fact about a game
	   nobody would otherwise mention and changes nothing about it. */
	function midSeasonEvents(teams, rng, cfg) {
		const budget = Math.round(clamp(
			cfg && cfg.seasonEvents !== undefined ? cfg.seasonEvents : 7, 0, 20));
		if (!budget) return [];
		const all = Object.keys(teams).map((n) => teams[n]);
		const ranked = all.slice().sort((a, b) => b.rating - a.rating);
		const topRating = ranked.length ? ranked[Math.min(24, ranked.length - 1)].rating : 0;
		const events = [];

		/* Every game, once, from the winner's log. A team's log holds one row
		   per game it played, so reading both sides would double every game. */
		const games = [];
		for (const t of all) {
			for (const g of t.log || []) {
				if (!g.won || !g.opp) continue;
				const opp = teams[g.opp];
				if (!opp) continue;
				games.push({ winner: t, loser: opp, g });
			}
		}
		if (!games.length) return [];

		const add = (kind, text, when, teamsInvolved) => {
			events.push({ kind, text, when, teams: teamsInvolved });
		};

		// A top-ten team losing to somebody it had no business losing to.
		const upsets = games.filter(({ winner, loser }) =>
			loser.rating >= topRating && winner.rating < loser.rating - 14)
			.sort((a, b) => (b.loser.rating - b.winner.rating) -
				(a.loser.rating - a.winner.rating));
		if (upsets.length) {
			const u = rng.pick(upsets.slice(0, 8));
			add("upset", u.winner.name + " beat " + u.loser.name + " " +
				u.g.pf + "-" + u.g.pa + ", the result of the season's first half",
				u.g.when, [u.winner.name, u.loser.name]);
		}

		// The game of the year: the closest game between two good teams.
		const good = games.filter(({ winner, loser, g }) =>
			winner.rating > topRating - 6 && loser.rating > topRating - 6 &&
			Math.abs(g.pf - g.pa) <= 3);
		if (good.length) {
			const gm = rng.pick(good);
			add("game of the year",
				gm.winner.name + " " + gm.g.pf + ", " + gm.loser.name + " " +
				gm.g.pa + (gm.g.ot ? " (" + (gm.g.ot > 1 ? gm.g.ot + "OT" : "OT") + ")" : "") +
				" — the game of the year",
				gm.g.when, [gm.winner.name, gm.loser.name]);
		}

		// A coach fired in-season: a programme with real expectations losing.
		const failing = all.filter((t) =>
			t.games >= 10 && t.w / Math.max(1, t.games) < 0.35 &&
			C.prestige(t.name) >= 55);
		if (failing.length) {
			const t = rng.pick(failing);
			add("coaching change",
				t.name + " fired " + (t.coach && t.coach.name ? t.coach.name : "its head coach") +
				" in " + rng.pick(["January", "February"]) + " at " + t.w + "-" + t.l,
				rng.uniform(0.45, 0.85), [t.name]);
		}

		// A blowout worth naming, because a 40-point game is a fact about a
		// season and not only about one night.
		const blowouts = games.filter(({ g }) => g.pf - g.pa >= 38)
			.sort((a, b) => (b.g.pf - b.g.pa) - (a.g.pf - a.g.pa));
		if (blowouts.length) {
			const b = blowouts[0];
			add("blowout", b.winner.name + " beat " + b.loser.name + " by " +
				(b.g.pf - b.g.pa), b.g.when, [b.winner.name, b.loser.name]);
		}

		// A winning streak that changed a team's season.
		const streaks = all.map((t) => ({ t, n: longestRun(t) }))
			.filter((x) => x.n >= 12).sort((a, b) => b.n - a.n);
		if (streaks.length) {
			const st = rng.pick(streaks.slice(0, 5));
			add("streak", st.t.name + " won " + st.n + " in a row",
				rng.uniform(0.3, 0.8), [st.t.name]);
		}

		/* Colour, which changes nothing and is the point: a season with only
		   consequential events in it reads like a summary. */
		/* Two DIFFERENT programmes. r.pick(all) twice can return the same one,
		   and at 368 teams that is about one flavour event in every 368 — which
		   is often enough to be seen and is "Duke's trip to Duke was postponed
		   by a snowstorm". */
		const twoTeams = (r) => {
			const a = r.pick(all);
			let b = a;
			for (let i = 0; i < 8 && b === a; i++) b = r.pick(all);
			return [a, b];
		};
		const flavour = [
			(r) => {
				const [t, host] = twoTeams(r);
				if (t === host) return null;
				return ["postponement", t.name + "'s trip to " +
					host.name + " was postponed by " +
					r.pick(["a snowstorm", "a frozen floor", "an arena roof leak",
						"a travel failure"]), [t.name, host.name]];
			},
			(r) => {
				const t = r.pick(ranked.slice(0, 60));
				return ["viral", "a " + t.name + " dunk was the most-watched " +
					"clip of the college season", [t.name]];
			},
			(r) => {
				const [a, b] = twoTeams(r);
				if (a === b) return null;
				return ["altercation", a.name + " and " + b.name +
					" cleared the benches with four minutes left", [a.name, b.name]];
			},
			(r) => {
				const t = r.pick(ranked.slice(0, 40));
				return ["storm", t.name + " played three ranked opponents in eight days " +
					"and won " + r.int(1, 3) + " of them", [t.name]];
			},
		];
		const picked = rng.shuffle(flavour).slice(0, Math.max(0, budget - events.length));
		for (const f of picked) {
			const drawn = f(rng);
			// A flavour that could not find two distinct programmes returns
			// null rather than naming one twice.
			if (!drawn) continue;
			const [kind, text, involved] = drawn;
			add(kind, text, rng.random(), involved);
		}
		events.sort((a, b) => (a.when || 0) - (b.when || 0));
		return events.slice(0, budget);
	}

	/* The longest run of consecutive wins in a team's schedule, in calendar
	   order. The log is in the order games were SIMULATED, which is the order
	   the scheduler paired them, so it has to be sorted by date first — a run
	   read off the raw log would be a run of nothing. */
	function longestRun(t) {
		const log = (t.log || []).slice().sort((a, b) => (a.when || 0) - (b.when || 0));
		let best = 0;
		let cur = 0;
		for (const g of log) {
			cur = g.won ? cur + 1 : 0;
			if (cur > best) best = cur;
		}
		return best;
	}

	function simulateRegularSeason(teams, cfg, rng) {
		const names = Object.keys(teams);
		const play = (A, B, aHome, conference) => {
			// Conference play sits later in the calendar than non-conference.
			const when = conference ? rng.uniform(0.35, 1) : rng.uniform(0, 0.55);
			const sc = playGameScore(rng, A, B, aHome, cfg, when);
			record(A, B, sc.won, conference, { us: sc.a, them: sc.b, ot: sc.ot }, aHome, when, "reg");
			record(B, A, !sc.won, conference, { us: sc.b, them: sc.a, ot: sc.ot }, -aHome, when, "reg");
		};

		// Out-of-database colleges land in "Independent", which has no members
		// in byConference — so they used to get no conference slate, no
		// conference tournament and no auto bid. They are grouped into a real
		// (if synthetic) conference instead, so a prospect at an unrecognised
		// school gets the same kind of season as everyone else.
		const confPools = conferencePools(teams);

		for (const conf of Object.keys(confPools)) {
			const pool = confPools[conf];
			pairUp(rng, pool, CONF_GAMES, null, (A, B) => {
				play(A, B, rng.random() < 0.5 ? 1 : -1, true);
			});
		}

		// Non-conference: teams mostly schedule near their own level, and the
		// bigger program usually hosts.
		const all = names.map((n) => teams[n]);
		// A team short of a conference slate (a one-team synthetic conference)
		// makes up the difference in non-conference play, so everyone still
		// finishes on the same number of games.
		const shortfall = new Map();
		for (const t of all) shortfall.set(t, CONF_GAMES + NON_CONF_GAMES - t.games);
		const nonConfTarget = NON_CONF_GAMES;
		pairUp(rng, all, nonConfTarget,
			(a, b, roll) => a.conf !== b.conf &&
				roll < Math.exp(-Math.abs(a.rating - b.rating) / 24) + 0.06,
			(A, B) => {
				play(A, B, A.prestige > B.prestige ? 1 : -1, false);
			});

		// Anyone still short (a lone Independent, or the odd-total victim)
		// tops up against the other short teams.
		let guard = 0;
		const target = CONF_GAMES + NON_CONF_GAMES;
		while (guard++ < all.length * 4) {
			const short = all.filter((t) => t.games < target)
				.sort((a, b) => a.games - b.games);
			if (short.length < 2) break;
			play(short[0], short[1], 0, false);
		}

		for (const name of names) {
			const t = teams[name];
			t.sosAvg = t.games ? t.sos / t.games : 50;
			t.pct = t.games ? t.w / t.games : 0;
			// Frozen here: w/l keep growing through the postseason now, but a
			// selection resume is a regular-season resume.
			t.regW = t.w;
			t.regL = t.l;
			t.regGames = t.games;
			t.regPct = t.pct;
			// Resume score blends record, schedule and raw quality.
			t.resume = 100 * t.pct * 0.55 + (t.sosAvg - 45) * 0.9 + t.rating * 0.45 + t.quadWins * 0.9;
		}
	}

	/* "All-American First Team" (the AAC) would read as a national honour, so
	   the conference gets an abbreviation for label purposes. Shared with
	   awards.js via the export below so both spell it the same way. */
	function label(conf) {
		return conf === "American" ? "AAC" : conf;
	}

	/* Adopt a lone out-of-database program into the weakest real conference, so
	   it plays a conference slate and reaches a conference tournament. */
	function adoptConference(teams, team) {
		let best = null;
		let bestStrength = Infinity;
		for (const conf of Object.keys(C.byConference)) {
			if (C.byConference[conf].filter((n) => teams[n]).length < 4) continue;
			const strength = (C.CONFERENCES[conf] || {}).strength || 60;
			if (strength < bestStrength) { bestStrength = strength; best = conf; }
		}
		if (!best) return null;
		team.conf = best;
		team.adoptedConf = best;
		return best;
	}

	/* Conference -> its teams, the single place that decides where programs
	   outside the built-in 368 play.

	   Two or more of them form a synthetic "Independent" league. Exactly one
	   used to fall through every branch — a conference of one cannot play
	   itself — so that program got no conference slate, no conference
	   tournament and no auto bid, while two got all three. It is adopted into
	   the weakest real conference instead.

	   Every caller (the schedule, the conference tournaments, selection)
	   derives its pools from here, so all three agree on where a team plays. */
	function conferencePools(teams) {
		const pools = {};
		for (const conf of Object.keys(C.byConference)) {
			pools[conf] = C.byConference[conf].map((n) => teams[n]).filter(Boolean);
		}
		const extra = Object.values(teams).filter((t) => !C.COLLEGES[t.name]);
		if (extra.length >= 2) {
			for (const t of extra) t.conf = "Independent";
			pools.Independent = extra;
		} else if (extra.length === 1) {
			const host = extra[0].adoptedConf || adoptConference(teams, extra[0]);
			if (host && pools[host]) pools[host] = pools[host].concat(extra);
		}
		return pools;
	}

	/* Single-elimination conference tournament; returns {champ, runnerUp, seeds} */
	function simulateConferenceTournaments(teams, cfg, rng) {
		const results = {};
		const pools = conferencePools(teams);

		for (const conf of Object.keys(pools)) {
			const seeds = pools[conf]
				.slice()
				.sort((a, b) => b.cw - b.cl - (a.cw - a.cl) || b.rating - a.rating);
			if (!seeds.length) continue;
			let field = seeds.slice(0, Math.min(12, seeds.length));
			// Only teams actually in the bracket play tournament games — the
			// old code credited every program in the country with one, which
			// inflated everybody's games played.
			for (const t of field) t.inConfTourney = true;
			const bracketLog = [];
			let ctRound = 0;
			while (field.length > 1) {
				const next = [];
				const n = field.length;
				const byes = Math.pow(2, Math.ceil(Math.log2(n))) - n;
				for (let i = 0; i < byes; i++) next.push(field[i]);
				const rest = field.slice(byes);
				ctRound++;
				// Just after the regular season, before the NCAA tournament.
				const when = 1.01 + ctRound * 0.004;
				for (let i = 0; i < rest.length / 2; i++) {
					const A = rest[i];
					const B = rest[rest.length - 1 - i];
					const sc = playGameScore(rng, A, B, 0, cfg, 1, true);
					const won = sc.won;
					const wTeam = won ? A : B;
					bracketLog.push({
						a: A.name, b: B.name, winner: wTeam.name,
						score: won ? sc.a + "-" + sc.b : sc.b + "-" + sc.a,
						ot: sc.ot,
					});
					(won ? A : B).ctW = ((won ? A : B).ctW || 0) + 1;
					recordPostseason(A, B, sc, "conf",
						when, label(conf) + " Tournament");
					next.push(wTeam);
				}
				field = next;
			}
			results[conf] = { champ: field[0], seeds, log: bracketLog, regularChamp: seeds[0] };
			field[0].confTourneyChamp = true;
			// Winning the league over 18 games is a real, separate honour from
			// winning three games in March; both are surfaced and both are
			// worth something on an award resume.
			seeds[0].confRegularChamp = true;
		}
		return results;
	}

	global.TeamsSim = {
		buildPrograms, simulateRegularSeason, simulateConferenceTournaments,
		prospectTalent, teamRating, winProb, playGame, playGameScore, ratingOn,
		realign, makeCoach, COACH_SITUATIONS, COACH_PHILOSOPHIES,
		capFillers, FILLER_GAP, conferenceDrift, programLevel, applyOutages, makeFiller,
		PROGRAM_VOL, DOWN_YEAR_RATE, BREAKOUT_RATE, STAR_RETURNER_RATE,
		rotationWeights, pairUp, record, recordPostseason, finalizeSchedule,
		REGULAR_NOISE, momentumArc, arcAt, ARC_KNOTS,
		midSeasonEvents, longestRun,
		label, adoptConference, conferencePools, PROGRAM_STYLES,
		CONF_GAMES, NON_CONF_GAMES,
	};
})(typeof window !== "undefined" ? window : self);
