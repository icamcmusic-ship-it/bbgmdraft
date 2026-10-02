#!/usr/bin/env node
/* Regression tests. These are the checks that turn README claims into things a
   CI run can fail on.

   Usage: node tools/test.js [--update-golden] [--skip-areas]
   (node tools/test-parallel.js runs the same checks across every core)
   Exit code is non-zero if anything fails. */
"use strict";

/* Unknown archetypes must throw here rather than silently scoring 1.0.
   Set before the engine loads; js/ratings.js reads it once. */
process.env.BBGM_STRICT_ROLES = "1";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const V = require("./validate.js");

V.loadEngine();
const { Rng } = global.BBGMRng;
const BB = global.BBGM;
const RB = global.RatingsBuilder;

const GOLDEN = path.join(__dirname, "golden.json");
const UPDATE = process.argv.includes("--update-golden");
/* --skip-areas: run only the inline sections of this file. The area suites in
   tools/tests/ are run on their own by tools/run-area.js, which is how
   tools/test-parallel.js splits the suite across processes. */
const SKIP_AREAS = process.argv.includes("--skip-areas");

let failures = 0;
let checks = 0;
function ok(name, condition, detail) {
	checks++;
	if (condition) {
		console.log("  ok   " + name);
	} else {
		failures++;
		console.log("  FAIL " + name + (detail ? "\n         " + detail : ""));
	}
}

/* ------------------------------------------------------------------ golden */
/* Fixed seed + fixed config -> a hash of the exported JSON. Any unintended
   change to the output breaks the build; an intended one is re-recorded with
   --update-golden and shows up as a one-line diff in review. */
const GOLDEN_CASES = [
	{ name: "defaults", cfg: {} },
	{ name: "curve-loaded", cfg: { ovrMode: "curve", classQuality: 2, eliteCount: 4 } },
	{ name: "specialists", cfg: { specialization: 1.8, archetypeDiversity: 95, varySize: true } },
];

function goldenHashes() {
	const out = {};
	for (const c of GOLDEN_CASES) {
		const lf = V.syntheticClass(7, 40);
		const cfg = global.Config.make(Object.assign({ seed: "golden" }, c.cfg));
		const res = global.Engine.run(lf, cfg);
		const exported = global.Engine.exportFile(res);
		out[c.name] = crypto.createHash("sha256")
			.update(JSON.stringify(exported)).digest("hex").slice(0, 16);
	}
	return out;
}

console.log("Golden output");
const hashes = goldenHashes();
/* THE GOLDENS AND THE ENGINE REVISION MOVE TOGETHER.

   A golden hash moving means the same seed now produces a different class.
   That is exactly what ENGINE_REV (js/universe.js) exists to announce: an
   imported universe, a shared seed or a daily challenge replays into a
   different world unless the revision says so. It was 1 through sixty-odd
   commits that changed the simulation, because nothing connected the two.
   The golden file now records the revision it was recorded under, and a
   hash that moves under an unchanged revision is a failure — and is not
   recorded, so the guard cannot be passed by running --update-golden. */
const REV = global.Universe.ENGINE_REV;
const previous = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, "utf8")) : null;
const moved = previous
	? Object.keys(hashes).filter((k) => hashes[k] !== previous[k]) : [];
const sameRev = previous && previous._engineRev === REV;
if (UPDATE || !previous) {
	if (previous && moved.length && sameRev) {
		ok("golden/ENGINE_REV moves with the goldens", false,
			moved.join(", ") + " changed but ENGINE_REV is still " + REV +
			". Bump ENGINE_REV in js/universe.js (and say why in its comment), " +
			"then run --update-golden again. Nothing was written.");
	} else {
		fs.writeFileSync(GOLDEN, JSON.stringify(
			Object.assign({}, hashes, { _engineRev: REV }), null, 2) + "\n");
		console.log("  wrote " + path.relative(process.cwd(), GOLDEN) +
			" (ENGINE_REV " + REV + ")");
	}
} else {
	for (const k of Object.keys(hashes)) {
		ok("golden/" + k, hashes[k] === previous[k],
			"expected " + previous[k] + ", got " + hashes[k] +
			(sameRev ? " (ENGINE_REV is still " + REV + ": if this change is intended, " +
				"bump it in js/universe.js, then run: node tools/test.js --update-golden)"
				: " (run: node tools/test.js --update-golden if this change is intended)"));
	}
}

/* ------------------------------------------------------- seed determinism */
console.log("\nDeterminism");
{
	const lf = V.syntheticClass(11, 50);
	const a = global.Engine.run(lf, global.Config.make({ seed: "same" }));
	const b = global.Engine.run(lf, global.Config.make({ seed: "same" }));
	ok("same seed reproduces the class",
		JSON.stringify(global.Engine.exportFile(a)) ===
		JSON.stringify(global.Engine.exportFile(b)));
	const c = global.Engine.run(lf, global.Config.make({ seed: "different" }));
	ok("a different seed produces a different class",
		JSON.stringify(global.Engine.exportFile(a)) !==
		JSON.stringify(global.Engine.exportFile(c)));
}
{
	// Rng.child must not depend on how many children came before it — the whole
	// seed guarantee rests on this, and the old implementation broke it.
	const one = new Rng("x").child("alpha").random();
	const p = new Rng("x");
	p.child("beta");
	p.child("gamma");
	const two = p.child("alpha").random();
	ok("Rng.child is order-independent", one === two, one + " vs " + two);
}

/* ------------------------------------------------------------- round trip */
/* The README claims 420/420 players re-evaluate identically inside BBGM.
   Export, re-read the exported ratings, recompute ovr and pos with the same
   formulas the game uses, and confirm nothing drifts. */
console.log("\nRound trip");
{
	let bad = 0;
	let n = 0;
	for (let s = 0; s < 4; s++) {
		const res = global.Engine.run(
			V.syntheticClass(20 + s, 60), global.Config.make({ seed: "rt" + s }));
		const exported = global.Engine.exportFile(res);
		for (const p of exported.players) {
			const r = p.ratings[p.ratings.length - 1];
			n++;
			if (BB.ovr(r) !== r.ovr || BB.pos(r) !== r.pos) bad++;
		}
	}
	ok("exported ratings recompute to the same ovr/pos (" + (n - bad) + "/" + n + ")", bad === 0);
}
{
	// Export must not invent hgt/weight keys on a file that never had them,
	// unless the user asked for varied size.
	const lf = V.syntheticClass(31, 20);
	for (const p of lf.players) { delete p.hgt; delete p.weight; }
	const kept = global.Engine.exportFile(
		global.Engine.run(lf, global.Config.make({ seed: "sz" })));
	ok("missing hgt/weight are filled in",
		kept.players.every((p) => Number.isFinite(p.hgt) && Number.isFinite(p.weight)));

	const lf2 = V.syntheticClass(31, 20);
	const untouched = global.Engine.exportFile(
		global.Engine.run(lf2, global.Config.make({ seed: "sz" })));
	ok("existing hgt/weight are left alone when Vary size is off",
		untouched.players.every((p, i) => p.hgt === lf2.players[i].hgt &&
			p.weight === lf2.players[i].weight));

	/* `lockHeights: false` is now part of what "Vary size" means: the default
	   pins every imported height, and a drift that cannot move one is not a
	   drift. See the block below for the lock's own coverage. */
	const varied = global.Engine.exportFile(
		global.Engine.run(V.syntheticClass(31, 40),
			global.Config.make({ seed: "sz", varySize: true, lockHeights: false })));
	ok("Vary size actually varies size",
		varied.players.some((p, i) => p.hgt !== V.syntheticClass(31, 40).players[i].hgt));
}

/* --------------------------------------------------------- locked heights */
/* THE IMPORTED HEIGHT RATING IS NOT SOMETHING A REROLL REDRAWS.

   Two draws could move a player's hgt rating — the size drift and the
   "physical outlier" anomaly — and both are keyed off the RNG, so every
   reroll (a new seed, a bumped variation, a per-player reroll counter) handed
   back a class whose men were different heights. Which moves their archetype
   gates, their positions and their rebounding with them: "reroll until I like
   the top five" was not redrawing the same five men.

   The check is run against the settings most likely to move a height — size
   drift on, a full anomaly budget — across several seeds and a variation
   bump, because a lock that holds only at the default settings is not a
   lock. */
console.log("\nLocked heights");
{
	const lf = V.syntheticClass(77, 30);
	const origHgt = lf.players.map((p) => p.ratings[p.ratings.length - 1].hgt);
	const origIn = lf.players.map((p) => p.hgt);
	const moved = [];
	const inchesMoved = [];
	for (const c of [{ seed: "h1" }, { seed: "h2" }, { seed: "h3", variation: 3 },
		{ seed: "h4", varySize: true }, { seed: "h5", varySize: true, surpriseBudget: 10 }]) {
		const res = global.Engine.run(V.syntheticClass(77, 30),
			global.Config.make(Object.assign({ surpriseBudget: 8 }, c)));
		res.players.forEach((p, i) => {
			if (p.newRatings.hgt !== origHgt[i]) moved.push(c.seed + ":" + i);
			if (p.newHgtInches !== origIn[i]) inchesMoved.push(c.seed + ":" + i);
		});
	}
	ok("no draw moves an imported height rating when heights are locked",
		moved.length === 0, moved.slice(0, 6).join(", "));
	ok("no draw moves an imported listed height when heights are locked",
		inchesMoved.length === 0, inchesMoved.slice(0, 6).join(", "));

	/* A per-player reroll is the case the setting exists for: same seed, a
	   bumped reroll counter, and the man has to come back the height he was. */
	{
		const base = global.Engine.run(V.syntheticClass(77, 30),
			global.Config.make({ seed: "hr", varySize: true }));
		const key = base.players[0].key;
		const rolled = global.Engine.run(V.syntheticClass(77, 30), global.Config.make({
			seed: "hr", varySize: true,
			overrides: { [key]: { reroll: 4, reroll_build: 2 } },
		}));
		const a0 = base.players.filter((p) => p.key === key)[0];
		const b0 = rolled.players.filter((p) => p.key === key)[0];
		ok("rerolling one prospect redraws his build and not his height",
			a0.newRatings.hgt === b0.newRatings.hgt &&
			a0.newHgtInches === b0.newHgtInches, a0.newRatings.hgt + " -> " +
				b0.newRatings.hgt);
	}

	/* And the escape hatches both still work: a hand-set height moves the
	   rating with it, and turning the lock off restores the anomaly. */
	{
		const key = V.syntheticClass(77, 30).players[3].pid;
		const res = global.Engine.run(V.syntheticClass(77, 30), global.Config.make({
			seed: "hh", overrides: { [String(key)]: { hgtInches: 84 } },
		}));
		const p = res.players.filter((x) => x.key === String(key))[0];
		ok("a hand-set height still moves the rating with it",
			p.newHgtInches === 84 && p.newRatings.hgt !== origHgt[3],
			p.newHgtInches + " / " + p.newRatings.hgt);
	}
	{
		/* The gate itself, rather than a sample of classes: the kind is
		   eligible for everybody with the lock off and for nobody with it on,
		   and asking the table that directly costs no season simulations. */
		const kind = global.Engine.SURPRISES.filter(
			(k) => k.name === "physical outlier")[0];
		ok("the physical-outlier anomaly is a kind the table still holds", !!kind);
		ok("it is eligible with the lock off",
			!!kind && kind.pick({}, { cfg: global.Config.make({ lockHeights: false }) }));
		ok("and eligible for nobody with the lock on",
			!!kind && !kind.pick({}, { cfg: global.Config.make({}) }));
		/* And it really does reach a class, so the row above is not testing a
		   predicate nothing calls. */
		let drawn = 0;
		for (let i = 0; i < 6; i++) {
			const res = global.Engine.run(V.syntheticClass(77, 30), global.Config.make({
				seed: "ho" + i, surpriseBudget: 10, lockHeights: false,
			}));
			drawn += (res.surprises || []).filter(
				(s) => s.name === "physical outlier").length;
		}
		ok("the anomaly still reaches classes drawn with the lock off", drawn > 0,
			drawn + " in 6 classes");
	}
}

/* --------------------------------------------------------- solver property */
console.log("\nSolver properties");
{
	const rng = new Rng("prop");
	const cfg = global.Config.make({});
	let miss = 0;
	let crash = 0;
	let clampedOk = 0;
	const extremes = [];
	for (let i = 0; i < 400; i++) {
		const orig = {};
		for (const k of BB.RATING_KEYS) orig[k] = Math.round(rng.uniform(1, 99));
		orig.fuzz = 0;
		extremes.push({ orig, target: Math.round(rng.uniform(0, 100)) });
	}
	// Degenerate inputs the UI can produce via a locked ovr.
	for (const flat of [0, 1, 50, 99, 100]) {
		const orig = {};
		for (const k of BB.RATING_KEYS) orig[k] = flat;
		orig.fuzz = 0;
		for (const t of [0, 1, 50, 99, 100]) extremes.push({ orig, target: t });
	}
	for (const { orig, target } of extremes) {
		let built;
		try {
			built = RB.rebuild(rng.child("x" + extremes.indexOf(orig)), orig, target, target + 5, cfg);
		} catch (e) {
			crash++;
			continue;
		}
		const inRange = BB.RATING_KEYS.every((k) =>
			Number.isFinite(built.ratings[k]) && built.ratings[k] >= 0 && built.ratings[k] <= 100);
		if (!inRange) crash++;
		// An unreachable target is allowed to miss — hgt is fixed, so a
		// 7-footer's floor and a guard's ceiling are real limits. What is not
		// allowed is missing a target inside the achievable range.
		if (built.ovr !== target) {
			const r = built.ovrRange;
			if (target < r.min || target > r.max) clampedOk++;
			else miss++;
		}
	}
	ok("solver never crashes or produces out-of-range ratings", crash === 0, crash + " bad builds");
	ok("solver hits every reachable target", miss === 0, miss + " misses");
	console.log("       (" + clampedOk + " unreachable extreme targets clamped, as expected)");
}

/* ---------------------------------------------------------- input guards */
console.log("\nMalformed input");
{
	const cases = [
		["no players", { startingSeason: 2026 }],
		["empty players", { startingSeason: 2026, players: [] }],
		["no season anywhere", {
			players: V.syntheticClass(1, 3).players.map((p) =>
				Object.assign({}, p, { draft: { round: 1, pick: 1 } })),
		}],
		["player with no ratings", {
			startingSeason: 2026,
			players: [{ pid: 0, firstName: "A", lastName: "B", born: { year: 2007 }, ratings: [] }],
		}],
		["player with no born.year", {
			startingSeason: 2026,
			players: [{ pid: 0, firstName: "A", lastName: "B", ratings: [{ hgt: 50 }] }],
		}],
		["not an object", null],
	];
	let handled = 0;
	for (const [name, file] of cases) {
		try {
			global.Engine.run(file, global.Config.make({ seed: "bad" }));
			console.log("  FAIL malformed input accepted: " + name);
			failures++;
			checks++;
		} catch (e) {
			// A message a human can act on, not a raw TypeError.
			const good = e instanceof Error && e.message.length > 12 &&
				!/undefined|is not a function|Cannot read/.test(e.message);
			ok("rejects " + name + " with a readable message", good, e.message);
			if (good) handled++;
		}
	}
	void handled;
}
{
	// A player with no name must not break the run.
	const lf = V.syntheticClass(41, 10);
	delete lf.players[0].firstName;
	delete lf.players[0].lastName;
	delete lf.players[1].draft;
	let threw = null;
	try { global.Engine.run(lf, global.Config.make({ seed: "nm" })); } catch (e) { threw = e; }
	ok("survives a player with no name and no draft block", threw === null,
		threw && threw.message);
}

/* --------------------------------------------------------------- overrides */
console.log("\nPer-player locks");
{
	const lf = V.syntheticClass(51, 40);
	const overrides = { 3: { ovr: 55, pot: 72, college: "Duke", archetype: "Rim Protector" } };
	const seen = [];
	for (const seed of ["one", "two", "three"]) {
		const res = global.Engine.run(lf, global.Config.make({ seed, overrides }));
		const p = res.players.filter((x) => x.pid === 3)[0];
		seen.push([p.newOvr, p.newPot, p.newCollege, p.archetype].join("|"));
	}
	ok("a locked player survives rerolls",
		seen.every((x) => x === "55|72|Duke|Rim Protector"), seen.join(" / "));
}

/* ------------------------------------------------------- schedule + stats */
console.log("\nSeason invariants");
{
	const res = global.Engine.run(V.syntheticClass(61, 70), global.Config.make({ seed: "sch" }));
	const games = Object.values(res.teams).map((t) => t.regGames);
	const spread = Math.max.apply(null, games) - Math.min.apply(null, games);
	ok("every program plays the same regular season (±1)", spread <= 1,
		"spread was " + spread);

	/* A team's displayed record has to contain the games it played. record()
	   was only ever called from the regular season, so a national champion
	   showed 25-6 when it had gone 34-6 and the note printed a record that
	   contradicted the postseason result beside it. */
	const bad = Object.values(res.teams).filter((t) => t.w + t.l !== t.games);
	ok("w + l equals games played for every program", bad.length === 0,
		bad.length + " teams mismatched");
	const champ = res.tourney.champion.team;
	ok("the champion's record includes its NCAA run",
		champ.games >= champ.regGames + (champ.ncaaWins || 0),
		champ.name + " " + champ.w + "-" + champ.l + " over " + champ.games +
			" games, regular season " + champ.regGames + ", NCAA wins " + champ.ncaaWins);
	ok("postseason games are tagged by stage",
		champ.log.some((g) => g.stage === "ncaa" && g.round));

	/* simulateRegularSeason runs the whole conference loop before the whole
	   non-conference loop, so the log came out conference-first regardless of
	   when each game was played. Anything reading it in order — the signature
	   game, the game log, which games a player missed — was reading the season
	   out of sequence. */
	let disordered = 0;
	for (const t of Object.values(res.teams)) {
		for (let i = 1; i < t.log.length; i++) {
			if (t.log[i].when < t.log[i - 1].when - 1e-9) disordered++;
		}
	}
	ok("the schedule is in calendar order", disordered === 0,
		disordered + " games out of order");

	/* Missed games are drawn from anywhere in the season. They used to be the
	   last N entries of a conference-first log, so a player who missed games
	   always missed non-conference ones and could never miss a conference game. */
	let missedConference = 0;
	let missedAny = 0;
	for (const p of res.players) {
		if (!p.gameLog || !p.gameLog.injury) continue;
		missedAny++;
		const played = new Set(p.gameLog.games.map((g) => g.i));
		const home = res.teams[p.newCollege];
		if (!home) continue;
		if (home.log.some((g, i) => !played.has(i) && g.conference)) missedConference++;
	}
	ok("a player can miss a conference game", missedAny === 0 || missedConference > 0,
		missedConference + " of " + missedAny + " absences included a conference game");

	const ncaa = res.players.filter((p) => !p.nonNcaa && p.stats);
	/* THE CEILING IS THE PLAYER'S, NOT THE LEAGUE'S.

	   This asserted the team cap (TUNING.MPG_CAP, 37.5) against a model that
	   has not applied it per player since MIN_ENDU_CAP was added: a man's own
	   ceiling is the team cap scaled by his conditioning, bounded by
	   `gameMinutes - 2`. The row passed anyway for as long as the best
	   conditioned player in this one seeded class happened not to lead his
	   rotation — so it was reporting the draw rather than the rule, and any
	   change to the build table could turn it red without anything being
	   wrong. It now asks for the bound the model actually enforces. */
	const mpgCeiling = Math.min(
		global.StatsSim.TUNING.MPG_CAP * (1 + global.StatsSim.TUNING.MIN_ENDU_CAP * 0.5), 38);
	ok("no prospect exceeds the minutes ceiling",
		ncaa.every((p) => p.stats.mpg <= mpgCeiling + 1e-9),
		"ceiling " + mpgCeiling.toFixed(2) + ", highest " +
			Math.max.apply(null, ncaa.map((p) => p.stats.mpg)).toFixed(2));
	ok("usage is stored as a rate, not a share",
		ncaa.every((p) => p.stats.usg > 0.08 && p.stats.usg < 0.40));
	ok("rebounds split into offensive and defensive",
		ncaa.every((p) => Math.abs(p.stats.orpg + p.stats.drpg - p.stats.rpg) < 1e-9));

	const worst = V.reconcileError(ncaa);
	ok("stat lines reconcile with their own shooting splits", worst < 0.01,
		"worst mismatch " + worst.toFixed(4) + " points");

	/* The share ceilings the stat model documents, measured against the team
	   total the way a reader would check them. Applying the cap before the
	   multiplicative noise let a capped player finish at 67% of his team's
	   assists against a documented 62%. */
	let worstAst = 0;
	let worstReb = 0;
	let worstBlk = 0;
	for (const t of Object.values(res.teams)) {
		const tt = t.teamTotals;
		if (!tt) continue;
		for (const p of t.prospects) {
			if (!p.stats) continue;
			/* A line is per game PLAYED and the team total is per team game
			   (see gpWeight in js/stats.js), so a man who missed fifteen of
			   thirty-five nights read as 52% of his team's blocks when he
			   had 30% of them. His share of the season is weighted. */
			const wt = t.games > 0 && Number.isFinite(p.stats.gp)
				? Math.min(1, p.stats.gp / t.games) : 1;
			if (tt.ast > 0) worstAst = Math.max(worstAst, p.stats.apg * wt / tt.ast);
			if (tt.trb > 0) worstReb = Math.max(worstReb, p.stats.rpg * wt / tt.trb);
			if (tt.blk > 0) worstBlk = Math.max(worstBlk, p.stats.bpg * wt / tt.blk);
		}
	}
	const TU = global.StatsSim.TUNING;
	ok("nobody exceeds the documented assist share", worstAst <= TU.AST_CAP + 1e-6,
		worstAst.toFixed(3) + " vs cap " + TU.AST_CAP);
	ok("nobody exceeds the documented rebound share", worstReb <= TU.REB_CAP + 1e-6,
		worstReb.toFixed(3) + " vs cap " + TU.REB_CAP);
	ok("nobody exceeds the documented block share", worstBlk <= TU.BLK_CAP + 1e-6,
		worstBlk.toFixed(3) + " vs cap " + TU.BLK_CAP);

	const dii = res.players.filter((p) => p.nonNcaa);
	ok("non-D-I players never win D-I national awards",
		dii.every((p) => !(p.awards || []).some((a) =>
			/All-American|Naismith|Wooden|Oscar Robertson|Cousy|Erving|Tisdale/.test(a) &&
			!/^Division II/.test(a))));

	/* The conference Defensive Player of the Year used to run through a gate
	   that required scoreProd >= 12 — an offensive box score — so a genuine
	   low-usage stopper (5 points, 3 rebounds, 1.6 steals, production ~11) was
	   disqualified from a DEFENSIVE award by his scoring, while the national
	   DPOY used a minutes-only gate and the two disagreed with each other. */
	const GATES = global.Awards.GATES;
	const stopper = {
		stats: { mpg: 31 }, scoreProd: 11, scoreDef: 22,
	};
	ok("a low-usage stopper is eligible for a defensive award",
		GATES.defensive(stopper) === true);
	ok("the same player is not eligible for an offensive award",
		GATES.offensive(stopper) === false);
	const scorer = { stats: { mpg: 33 }, scoreProd: 26, scoreDef: 3 };
	ok("a non-defender is not eligible for a defensive award",
		GATES.defensive(scorer) === false);
	ok("a bench player is not eligible for a starter's award",
		GATES.offensive({ stats: { mpg: 14 }, scoreProd: 20, scoreDef: 20 }) === false);

	// Nobody should be pinned to a cap: that is a wall, not a distribution.
	const atCap = ncaa.filter((p) => p.stats.usg > 0.3545).length;
	ok("usage is not piled up on the cap", atCap / ncaa.length < 0.12,
		Math.round((100 * atCap) / ncaa.length) + "% at the cap");
}

/* ------------------------------------------------------------- missing pid */
/* A file without pids used to collapse the whole generator in silence: every
   rng.child key became the same string, so all 70 prospects drew the identical
   random sequence and came out with one archetype. */
console.log("\nFiles without pids");
{
	const withPid = V.syntheticClass(71, 70);
	const withoutPid = V.syntheticClass(71, 70);
	for (const p of withoutPid.players) delete p.pid;

	const a = global.Engine.run(withPid, global.Config.make({ seed: "nopid" }));
	const b = global.Engine.run(withoutPid, global.Config.make({ seed: "nopid" }));
	const archA = new Set(a.players.map((p) => p.archetype)).size;
	const archB = new Set(b.players.map((p) => p.archetype)).size;
	ok("a file with no pids still produces varied builds", archB >= archA * 0.6,
		archA + " archetypes with pids, " + archB + " without");
	const ovrB = new Set(b.players.map((p) => p.newOvr)).size;
	ok("a file with no pids produces varied ratings", ovrB > 5, ovrB + " distinct ovr");
	ok("the missing pid is reported rather than swallowed",
		b.warnings.length > 0 && /pid/.test(b.warnings[0]), JSON.stringify(b.warnings));

	// Locks must key off the same fallback the RNG does.
	const locked = global.Engine.run(withoutPid, global.Config.make({
		seed: "nopid2",
		overrides: { idx3: { ovr: 55, pot: 70, college: "Duke", archetype: "Rim Protector" } },
	}));
	const target = locked.players[3];
	ok("locks work on a file with no pids",
		target.newOvr === 55 && target.newCollege === "Duke" &&
		target.archetype === "Rim Protector",
		target.newOvr + "/" + target.newCollege + "/" + target.archetype);
}

/* --------------------------------------------------------- staged pipeline */
/* Each phase declares the settings it reads. Re-running with only a late
   setting changed must (a) produce exactly what a cold run produces, and
   (b) actually skip the earlier phases. */
console.log("\nStaged pipeline");
{
	const lf = V.syntheticClass(81, 60);
	const runner = global.Engine.createRunner(lf);
	const base = global.Config.make({ seed: "stage" });
	runner.run(base);

	const cases = [
		["noteLines", { noteLines: ["team", "record", "stats"] }, ["notes"]],
		["awardStrictness", { awardStrictness: 1.6 }, ["awards", "stock", "notes"]],
		["potBias", { potBias: 2 }, ["pot", "awards", "stock", "notes"]],
		["upsetFactor", { upsetFactor: 1.8 },
			["postseason", "stats", "pot", "awards", "stock", "notes"]],
	];
	for (const [name, override, expected] of cases) {
		const cfg = global.Config.make(Object.assign({ seed: "stage" }, override));
		const warm = runner.run(cfg);
		ok("changing " + name + " re-runs only " + expected.join(" -> "),
			JSON.stringify(warm.phasesRun) === JSON.stringify(expected),
			"ran " + JSON.stringify(warm.phasesRun));
		const cold = global.Engine.run(lf, cfg);
		ok("the staged result for " + name + " matches a cold run",
			JSON.stringify(global.Engine.exportFile(warm)) ===
			JSON.stringify(global.Engine.exportFile(cold)));
		runner.run(base);
	}
}

/* --------------------------------------------------------- reported values */
/* engine.js computed lockUnreachable and ovrRange and the UI never read either,
   so locking a 6'11" prospect at ovr 20 silently produced a different number. */
console.log("\nReported values");
{
	const lf = V.syntheticClass(91, 40);
	// Find the tallest player and ask for something his height cannot reach.
	let tallest = lf.players[0];
	for (const p of lf.players) {
		if (p.ratings[0].hgt > tallest.ratings[0].hgt) tallest = p;
	}
	const res = global.Engine.run(lf, global.Config.make({
		seed: "unreach",
		overrides: { [String(tallest.pid)]: { ovr: 5, pot: 40 } },
	}));
	const p = res.players.filter((x) => x.pid === tallest.pid)[0];
	ok("an impossible lock is reported, not silently approximated",
		p.newOvr === 5 || (p.lockUnreachable && p.lockUnreachable.asked === 5 &&
			Number.isFinite(p.lockUnreachable.range.min)),
		"got " + p.newOvr + ", lockUnreachable " + JSON.stringify(p.lockUnreachable));
	ok("every player carries the ovr range his height allows",
		res.players.every((x) => x.ovrRange && x.ovrRange.min <= x.ovrRange.max));
}

/* --------------------------------------------------- non-NCAA environments */
console.log("\nLeague environments");
{
	const lf = V.syntheticClass(101, 70);
	for (const p of lf.players) p.college = "";
	// One destination at a time: zero every other weight so the split is
	// unambiguous.
	const only = (name) => {
		const w = {};
		for (const k of Object.keys(global.Colleges.NON_NCAA)) w[k] = 0;
		w[name] = 100;
		return w;
	};
	const gl = global.Engine.run(lf, global.Config.make({
		seed: "lg", pDII: 0, leagueWeights: only("NBA G League"),
	}));
	const el = global.Engine.run(lf, global.Config.make({
		seed: "lg", pDII: 0, leagueWeights: only("EuroLeague"),
	}));
	const glPlayers = gl.players.filter((p) => p.newCollege === "NBA G League" && p.stats);
	const elPlayers = el.players.filter((p) => p.newCollege === "EuroLeague" && p.stats);
	ok("every blank college lands in the requested league",
		glPlayers.length > 60 && elPlayers.length > 60,
		glPlayers.length + " G League, " + elPlayers.length + " EuroLeague");
	const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
	// A 48-minute game and a 103-possession pace against a 40-minute game and a
	// 70-possession pace: the G League has to produce visibly bigger per-game
	// numbers. Both used to run on cfg.pace over 40 minutes.
	ok("the G League is a different environment from the EuroLeague",
		mean(glPlayers.map((p) => p.stats.ppg)) > mean(elPlayers.map((p) => p.stats.ppg)) * 1.3,
		"G League " + mean(glPlayers.map((p) => p.stats.ppg)).toFixed(1) + " PPG vs EuroLeague " +
			mean(elPlayers.map((p) => p.stats.ppg)).toFixed(1));
	// Teenagers do not play 30 minutes at Real Madrid.
	const cap = global.StatsSim.leagueEnv("EuroLeague").youthCap;
	// Within the club's own read of it: the cap is drawn per player around
	// the league's number, so nobody sits on 22.0 to the decimal.
	ok("a teenager abroad is held to the league's youth minutes cap",
		elPlayers.every((p) => p.stats.mpg <= cap + 3 + 1e-6),
		"max " + Math.max.apply(null, elPlayers.map((p) => p.stats.mpg)).toFixed(1) +
			" vs cap " + cap);
	// The college pace slider must not touch a professional league.
	const slow = global.Engine.run(lf, global.Config.make({
		seed: "lg", pDII: 0, leagueWeights: only("EuroLeague"), pace: 58,
	}));
	const fast = global.Engine.run(lf, global.Config.make({
		seed: "lg", pDII: 0, leagueWeights: only("EuroLeague"), pace: 80,
	}));
	const ppgOf = (r) => mean(r.players.filter((p) => p.stats).map((p) => p.stats.ppg));
	ok("the college pace slider does not rewrite EuroLeague box scores",
		Math.abs(ppgOf(slow) - ppgOf(fast)) < 0.35,
		ppgOf(slow).toFixed(2) + " at pace 58 vs " + ppgOf(fast).toFixed(2) + " at pace 80");
}

/* ---------------------------------------------------------- program style */
/* A shooter at a four-out program and the same shooter in a pack-line
   offense should not produce the same line. Programs had a strength and
   nothing else. */
console.log("\nProgram style");
{
	const res = global.Engine.run(V.syntheticClass(121, 70), global.Config.make({ seed: "sty" }));
	const styles = {};
	for (const t of Object.values(res.teams)) {
		styles[t.style.name] = (styles[t.style.name] || 0) + 1;
	}
	ok("every program has a playing style",
		Object.values(res.teams).every((t) => t.style && t.style.name));
	ok("styles vary across the country", Object.keys(styles).length >= 6,
		Object.keys(styles).length + " distinct styles");
	const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
	const three = [];
	const pack = [];
	for (const t of Object.values(res.teams)) {
		if (!t.fieldPlayers) continue;
		const share = t.fieldPlayers.filter((f) => f.mpg >= 15)
			.map((f) => (f.line.fga > 0 ? f.line.tpa / f.line.fga : 0));
		if (t.style.name === "four-out, three-heavy") three.push(mean(share));
		if (t.style.name === "inside-out, post-heavy") pack.push(mean(share));
	}
	ok("a four-out program takes more threes than a post-heavy one",
		three.length && pack.length && mean(three) > mean(pack) + 0.08,
		"four-out " + mean(three).toFixed(3) + " vs post-heavy " + mean(pack).toFixed(3));
}

/* ------------------------------------------------------------- game logs */
console.log("\nGame logs");
{
	const res = global.Engine.run(V.syntheticClass(111, 50), global.Config.make({ seed: "gl" }));
	const withLogs = res.players.filter((p) => p.gameLog);
	ok("every player with a stat line gets a game log",
		withLogs.length === res.players.filter((p) => p.stats).length);
	let worst = 0;
	for (const p of withLogs) {
		const g = p.gameLog.games;
		const ppg = g.reduce((a, x) => a + x.pts, 0) / g.length;
		worst = Math.max(worst, Math.abs(ppg - p.stats.ppg));
	}
	ok("the game log averages back to the season line", worst < 0.6,
		"worst drift " + worst.toFixed(3) + " PPG");
	ok("game counts match the stat line",
		withLogs.every((p) => p.gameLog.games.length === Math.min(
			Math.round(p.stats.gp),
			(p.nonNcaa ? p.proTeam : res.teams[p.newCollege]).log.length))); 
	ok("season highs are at least the season average",
		withLogs.every((p) => p.gameLog.highs.pts >= Math.floor(p.stats.ppg)));
	const signature = withLogs.filter((p) => p.signature && p.signature.stage === "ncaa");
	ok("a signature game can come from March", signature.length > 0,
		signature.length + " prospects peaked in the tournament");
}

/* -------------------------------------------------- eras and calibration */
console.log("\nEras");
{
	const CAL = global.Calibration;
	ok("more than one era is defined", Object.keys(CAL.ERAS).length >= 2);
	ok("the default era exists", !!CAL.ERAS[CAL.DEFAULT_ERA]);
	ok("the config default and the calibration default agree",
		global.Config.DEFAULTS.era === CAL.DEFAULT_ERA);

	/* Every era's team block has to satisfy the possession identity it is used
	   to derive. An anchor set that does not close is an anchor set that will
	   quietly pull the model somewhere it was never measured. */
	for (const name of Object.keys(CAL.ERAS)) {
		const t = CAL.ERAS[name].team;
		// possessions = FGA - ORB + TOV + 0.44*FTA, and ORB is 29% of the
		// rebounds available off missed shots.
		const misses = t.fga * (1 - t.fgp) * 1.07;
		const implied = t.fga - 0.29 * misses + t.tov + 0.44 * t.fta;
		ok("era " + name + ": the possession identity closes",
			Math.abs(implied - t.poss) < 2.0,
			"implied " + implied.toFixed(1) + " against a stated " + t.poss);
		const ortg = (100 * t.pts) / t.poss;
		ok("era " + name + ": points and offensive rating agree",
			Math.abs(ortg - CAL.ERAS[name].rotation.ortg) < 2.5,
			"implied " + ortg.toFixed(1) + " against a stated " + CAL.ERAS[name].rotation.ortg);
	}

	/* THE ERA-BOUND SURFACE HAS TO BE ERA-BOUND, ALL OF IT.

	   `forEra(name)` exists so a caller outside a run can ask a named era a
	   question without touching the module-level `era` that setEra() moves.
	   It bound byHeight, effShift and chanceShape and passed threeShare
	   through unbound — and threeShare calls byHeight, so the one method on
	   the object that most looks like a pure function answered for whichever
	   era ran last. It was inert only because no era defines a `share3`
	   shift; the first one that does would have made it silently wrong.

	   Tested by giving an era a share3 shift for the length of this block,
	   which is the condition under which the hole is observable at all. */
	{
		const era2009 = CAL.ERAS["2009-2021"];
		const saved = era2009.shift.share3;
		era2009.shift.share3 = 0.5;
		try {
			CAL.setEra("modern");
			const bound = CAL.forEra("2009-2021").threeShare(0.3, 55, 55);
			CAL.setEra("2009-2021");
			const direct = CAL.threeShare(0.3, 55, 55);
			ok("forEra().threeShare answers for the era it names",
				Math.abs(bound - direct) < 1e-9,
				bound.toFixed(4) + " vs " + direct.toFixed(4));
			CAL.setEra("modern");
			ok("...and the module-level threeShare still answers for the current era",
				Math.abs(CAL.threeShare(0.3, 55, 55) -
					CAL.forEra("modern").threeShare(0.3, 55, 55)) < 1e-9);
			ok("...and the two eras genuinely differ under that shift",
				Math.abs(CAL.forEra("modern").threeShare(0.3, 55, 55) - bound) > 1e-6);
		} finally {
			if (saved === undefined) delete era2009.shift.share3;
			else era2009.shift.share3 = saved;
		}
	}

	/* THE PROSPECT PREMIUM TERM EXISTS AND IS WIRED UP.

	   `prospectEff` is the mirror of `fieldEff`: the only two handles in the
	   model that reach one population without the other. It ships at 0 (see
	   the fitted sweep recorded beside it in js/calibration.js — every value
	   that closes any real part of the premium gap breaks a row that the
	   prior-season model has to move for first), and a term sitting at zero
	   is precisely the kind of thing that gets deleted as dead code by
	   somebody who does not read the comment. So the wiring is asserted
	   rather than the value: give the era a premium for the length of this
	   block and the class's efficiency has to move while the field's does
	   not. */
	{
		const era = CAL.ERAS.modern;
		const saved = era.shift.prospectEff;
		const measure = () => {
			const res = global.Engine.run(V.realisticClass(2, 60),
				global.Config.make({ seed: "premium", era: "modern" }));
			const cls = res.players.filter((p) => p.stats && !p.nonNcaa);
			const field = [];
			for (const t of Object.values(res.teams)) {
				for (const l of t.lines || []) if (l.filler) field.push(l);
			}
			const mean = (xs, f) => xs.reduce((a, x) => a + f(x), 0) / Math.max(1, xs.length);
			return { cls: mean(cls, (p) => p.stats.ts), field: mean(field, (l) => l.ts) };
		};
		try {
			era.shift.prospectEff = 0;
			const off = measure();
			era.shift.prospectEff = 0.02;
			const on = measure();
			ok("prospectEff lifts the draft class's true shooting",
				on.cls - off.cls > 0.005,
				((on.cls - off.cls) * 100).toFixed(2) + " points");
			ok("...and leaves the synthesized field exactly alone",
				Math.abs(on.field - off.field) < 1e-9,
				((on.field - off.field) * 100).toFixed(4) + " points");
			ok("every era declares a prospectEff, even at zero",
				Object.keys(CAL.ERAS).every((k) =>
					Number.isFinite(CAL.ERAS[k].shift.prospectEff)));
		} finally {
			era.shift.prospectEff = saved;
		}
	}

	CAL.setEra("modern");
	const modern = global.Engine.run(V.syntheticClass(7, 60), global.Config.make({
		seed: "era", era: "modern",
	}));
	const old2009 = global.Engine.run(V.syntheticClass(7, 60), global.Config.make({
		seed: "era", era: "2009-2021",
	}));
	const teamPts = (res) => {
		const t = Object.values(res.teams).filter((x) => x.teamTotals);
		return t.reduce((a, x) => a + x.teamTotals.pts, 0) / t.length;
	};
	ok("the era setting moves the whole scoring environment",
		teamPts(modern) - teamPts(old2009) > 2,
		teamPts(modern).toFixed(1) + " against " + teamPts(old2009).toFixed(1));
	// The era is set inside the stats phase, so a run must not depend on what
	// the previous run happened to leave behind.
	const again = global.Engine.run(V.syntheticClass(7, 60), global.Config.make({
		seed: "era", era: "modern",
	}));
	ok("a run sets its own era rather than inheriting the last one",
		Math.abs(teamPts(again) - teamPts(modern)) < 1e-9);
}

/* ---------------------------------------------------- the possession chain */
console.log("\nPossession accounting");
{
	const res = global.Engine.run(V.syntheticClass(21, 60), global.Config.make({ seed: "poss" }));
	const teams = Object.values(res.teams).filter((t) => t.teamTotals);
	const mean = (f) => teams.reduce((a, t) => a + f(t.teamTotals), 0) / teams.length;
	// The identity the header of js/stats.js states.
	let worst = 0;
	for (const t of teams) {
		const tt = t.teamTotals;
		const implied = tt.fga - tt.orb + tt.tov + 0.44 * tt.fta;
		worst = Math.max(worst, Math.abs(implied - tt.poss));
	}
	ok("possessions reconcile with the box score", worst < 1e-6,
		"worst drift " + worst.toExponential(2));

	/* Turnovers are denominated in possessions, not in scoring chances. The
	   two differ by the offensive rebounds — about 15% — which is exactly how
	   far the team turnover rate used to run high. */
	const tovRate = mean((tt) => tt.tov) / mean((tt) => tt.poss);
	ok("the team turnover rate is per possession", tovRate > 0.155 && tovRate < 0.19,
		(100 * tovRate).toFixed(2) + "% of possessions");

	/* Offensive rebounds come off missed field goals. They used to come off
	   every chance — turnovers and free-throw trips included — which made
	   every rebound total in the sim a third too big. */
	const orbPerMiss = mean((tt) => tt.orb) / (mean((tt) => tt.fga) * 0.53);
	ok("offensive rebounds are a share of missed shots",
		orbPerMiss > 0.22 && orbPerMiss < 0.38,
		(100 * orbPerMiss).toFixed(1) + "% of the misses");

	/* Fouls and free throws are the same event seen from two sides, and they
	   were produced by two independent code paths with nothing reconciling
	   them: the sim committed fewer fouls than real D-I while awarding more
	   free throws than real D-I. */
	ok("team fouls are reconciled to the model's own target",
		Math.abs(mean((tt) => tt.pf) - global.StatsSim.TUNING.TEAM_PF) < 1.5,
		mean((tt) => tt.pf).toFixed(2) + " against a target of " +
			global.StatsSim.TUNING.TEAM_PF);
	const ftaPerPf = mean((tt) => tt.fta) / mean((tt) => tt.pf);
	ok("free throws and fouls are consistent with each other",
		ftaPerPf > 0.88 && ftaPerPf < 1.28,
		ftaPerPf.toFixed(3) + " free-throw attempts per foul");

	/* The defensive glass answers to who a team played. It used to be the
	   constant 25.2, so a team that played a schedule of bad shooters rebounded
	   exactly as much as one that played a schedule of great shooters. Held
	   directly against the pool, because in a full season the two are
	   confounded — a good team both rebounds well and plays good opponents. */
	const t0 = Object.values(res.teams)[0];
	const comps = t0.members.slice(0, 9).map(() => ({
		rebounding: 0.45, passing: 0.44, stealing: 0.46, blocking: 0.45, fouling: 0.45,
	}));
	const mins = comps.map(() => 22);
	const poolAt = (oppMissShare) => global.StatsSim.teamPools(
		comps, mins, 68, 1.14, 40, { missShare: 0.53, oppMissShare }).drbPool;
	const vsBricks = poolAt(0.58);
	const vsShooters = poolAt(0.48);
	ok("defensive rebounds respond to how well the schedule shot",
		vsBricks > vsShooters * 1.1,
		vsBricks.toFixed(2) + " against a bad-shooting schedule, " +
			vsShooters.toFixed(2) + " against a good one");
}

/* ----------------------------------------------- opponent pressure, bounded */
console.log("\nOpponent pressure");
{
	/* PROGRAM_STYLES gives a full-court press team press: 0.06, and it was
	   added straight onto a turnover rate — so a conference stacked with
	   pressing teams could add six percentage points, larger than the entire
	   height gradient in the calibration table (17.2% to 17.8%). Nothing
	   covered it. */
	const styles = global.TeamsSim.PROGRAM_STYLES;
	const maxPress = Math.max.apply(null, styles.map((x) => x.press));
	const comps = {
		usage: 0.47, passing: 0.44, turnovers: 0.467, shootingAtRim: 0.5,
		shootingLowPost: 0.45, shootingMidRange: 0.45, shootingThreePointer: 0.5,
		rebounding: 0.45, stealing: 0.46, blocking: 0.45, drawingFouls: 0.47,
		defense: 0.48, fouling: 0.45, defenseInterior: 0.46, defensePerimeter: 0.46,
		endurance: 0.5, athleticism: 0.48,
	};
	const teamCtx = {
		games: 31, pace: 68, chanceMult: 1.14, support: 55,
		env: global.StatsSim.NCAA_ENV, style: { three: 0, rim: 0, press: 0, pace: 0 },
		orbPool: 9.5, drbPool: 24, astPool: 13.5, stlPool: 6.3, blkPool: 3.5, pfPool: 16.6,
		rebDen: 1, orbDen: 1, astDen: 1, stlDen: 1, blkDen: 1, pfDen: 1,
	};
	const cfg = global.Config.make({ statNoise: 0 });
	const ratings = { hgt: 45, ft: 55, tp: 50, pss: 50 };
	const lineAt = (press) => global.StatsSim.statLine(
		new Rng("press" + press), ratings, comps, 30, 0.2,
		{ oppStrength: 52, oppDefense: { rim: 0, perimeter: 0, overall: 0 }, oppPress: press },
		cfg, teamCtx, { talent: 72, filler: false });
	const flat = lineAt(0);
	const pressed = lineAt(maxPress);
	const lift = pressed.topg / flat.topg - 1;
	ok("a pressing schedule forces more turnovers", lift > 0.05,
		(100 * lift).toFixed(1) + "% more against the heaviest press in the table");
	/* Half of a press's effect is a live-ball turnover; the rest is a rushed
	   shot, which the efficiency terms already carry. A whole conference of
	   pressing teams must not double a prospect's turnovers. */
	ok("a pressing schedule does not swamp the height gradient", lift < 0.28,
		(100 * lift).toFixed(1) + "% lift");
}

/* -------------------------------------------------------- schedule making */
console.log("\nSchedule");
{
	/* pairUp drew its acceptance value inside the caller's filter predicate,
	   up to fourteen times per pairing, which left the schedule sensitive to
	   loop order in a way nothing tested. The draw is made by pairUp and
	   handed in. */
	const rng = new Rng("sched");
	const pool = [];
	for (let i = 0; i < 40; i++) {
		pool.push({ name: "t" + i, games: 0, conf: "c" + (i % 5), rating: 30 + i });
	}
	let sawRoll = 0;
	global.TeamsSim.pairUp(rng, pool, 12, (a, b, roll) => {
		if (Number.isFinite(roll)) sawRoll++;
		return a.conf !== b.conf && roll < 0.9;
	}, (A, B) => { A.games++; B.games++; });
	ok("pairUp hands the acceptance draw to the filter", sawRoll > 0,
		sawRoll + " candidates offered a roll");
	const counts = pool.map((t) => t.games);
	ok("every team finishes on the target number of games",
		Math.max.apply(null, counts) === 12 && Math.min.apply(null, counts) === 12,
		Math.min.apply(null, counts) + "-" + Math.max.apply(null, counts));
	// And it is still deterministic from the seed.
	const rerun = () => {
		const r = new Rng("sched");
		const p2 = [];
		for (let i = 0; i < 40; i++) {
			p2.push({ name: "t" + i, games: 0, conf: "c" + (i % 5), rating: 30 + i });
		}
		const log = [];
		global.TeamsSim.pairUp(r, p2, 12,
			(a, b, roll) => a.conf !== b.conf && roll < 0.9,
			(A, B) => log.push(A.name + "-" + B.name));
		return log.join(",");
	};
	ok("the schedule is reproducible from the seed", rerun() === rerun());
}

/* ---------------------------------------------- distributions that matter */
console.log("\nDistributions");
{
	const res = global.Engine.run(V.syntheticClass(31, 70), global.Config.make({ seed: "dist" }));
	const ncaa = res.players.filter((p) => !p.nonNcaa && p.stats);
	const apg = ncaa.map((p) => p.stats.apg).sort((a, b) => a - b);
	/* A man playing 25 minutes a night does not finish a season with 0.15
	   assists a game, which is what an assist exponent of 4.1 produced. */
	ok("nobody with real minutes has an impossible assist line",
		ncaa.filter((p) => p.stats.mpg >= 22).every((p) => p.stats.apg >= 0.25),
		"lowest " + apg[0].toFixed(2));
	ok("the class's best passer is a plausible one",
		apg[apg.length - 1] < 11, "highest " + apg[apg.length - 1].toFixed(2));

	// A big out-rebounds a guard by 4-5x on the defensive glass, not 2.4x.
	const guards = ncaa.filter((p) => p.newRatings.hgt < 32);
	const bigs = ncaa.filter((p) => p.newRatings.hgt >= 73);
	if (guards.length >= 3 && bigs.length >= 3) {
		const avg = (l, f) => l.reduce((a, p) => a + f(p), 0) / l.length;
		const ratio = avg(bigs, (p) => p.stats.drpg) / avg(guards, (p) => p.stats.drpg);
		ok("bigs out-rebound guards by a realistic margin", ratio > 2.4,
			ratio.toFixed(2) + "x on the defensive glass");
	}

	/* A player who cannot shoot does not shoot. The height table floors a
	   seven-footer's three-point share at 8.5%, so a Post Scorer with a tp
	   rating in the twenties still launched about two a game. */
	const nonShooters = ncaa.filter((p) => p.newRatings.tp <= 25 && p.stats.mpg >= 20);
	if (nonShooters.length) {
		/* Checked as a SHARE of his own attempts, which is what the model
		   actually floors and what the claim actually means. A raw count is a
		   count of minutes as much as of shot selection: the same player at 37
		   minutes takes more of everything than at 30, and a threshold on the
		   count fails when the minutes model is corrected without shot
		   selection having changed at all. */
		/* Scoped to the population the claim is about. A guard who cannot
		   shoot still takes a fifth of his shots from three — that is what bad
		   shooting guards do — and it is the seven-footer floored at 8.5% who
		   was launching two a game that this exists to catch. */
		const bigNonShooters = nonShooters.filter((p) => p.newRatings.hgt >= 65);
		const share = (l) => Math.max.apply(null,
			l.map((p) => (p.stats.fga > 0 ? p.stats.tpa / p.stats.fga : 0)).concat([0]));
		if (bigNonShooters.length) {
			ok("a non-shooting big does not launch threes", share(bigNonShooters) < 0.13,
				"largest 3PA share by a tall tp<=25 player: " +
					share(bigNonShooters).toFixed(3));
		}
		ok("no non-shooter is a volume three-point shooter", share(nonShooters) < 0.26,
			"largest 3PA share by any tp<=25 player: " + share(nonShooters).toFixed(3));
	}
}

/* ------------------------------------------------------- per-player reroll */
console.log("\nPer-player reroll");
{
	const cfg = () => global.Config.make({ seed: "reroll" });
	const before = global.Engine.run(V.syntheticClass(9, 40), cfg());
	const target = before.players[5].key;
	const c = cfg();
	c.overrides = {};
	c.overrides[target] = { reroll: 1 };
	const after = global.Engine.run(V.syntheticClass(9, 40), c);
	const byKey = (res) => {
		const m = {};
		for (const p of res.players) m[p.key] = p;
		return m;
	};
	const a = byKey(before);
	const b = byKey(after);
	// Same identity as the assertion below: the whole rating vector, so a
	// reroll that happens to land on the same build still counts as moved.
	const vec = (p) => BB.RATING_KEYS.map((k) => p.newRatings[k]).join(",");
	const moved = Object.keys(a).filter((k) =>
		vec(a[k]) !== vec(b[k]) || a[k].newCollege !== b[k].newCollege);
	/* Compared on his whole rating vector, not only on archetype and school.
	   A class is drawn from a pool of about fourteen builds, so a reroll
	   landing on the same build and the same school is an ordinary outcome
	   (one in fourteen, not one in sixty) — and it is still a different
	   player, because every rating under it was redrawn. Asserting on the
	   labels made this a probabilistic test of the pool size. */
	ok("rerolling one prospect changes that prospect",
		vec(a[target]) !== vec(b[target]) ||
		a[target].newCollege !== b[target].newCollege,
		a[target].archetype + "/" + a[target].newCollege + " -> " +
			b[target].archetype + "/" + b[target].newCollege);
	ok("rerolling one prospect leaves the rest of the class alone",
		moved.length === 1 && moved[0] === target,
		moved.length + " prospects moved");
}

/* --------------------------------------------------------- league loading */
console.log("\nLeague file season");
{
	const base = V.syntheticClass(4, 5);
	const strip = (extra) => {
		const f = { players: JSON.parse(JSON.stringify(base.players)) };
		return Object.assign(f, extra || {});
	};
	const cases = [
		["gameAttributes object", strip({ gameAttributes: { season: 2031 } }), 2031],
		["gameAttributes rows", strip({ gameAttributes: [{ key: "season", value: 2032 }] }), 2032],
		["a bare season", strip({ season: 2033 }), 2033],
		["the players' draft year", strip({}), 2026],
	];
	for (const [what, file, want] of cases) {
		let got = null;
		let mutated = false;
		try {
			got = global.Engine.validateLeagueFile(file).season;
			// A validator checks; it does not edit what it was handed.
			mutated = Object.prototype.hasOwnProperty.call(file, "startingSeason");
		} catch (e) { got = "threw: " + e.message; }
		ok("the season is found in " + what, got === want, String(got));
		ok("validating " + what + " leaves the file alone", !mutated);
	}
	// A full league export is a warning with a way out, not a locked tab.
	{
		const big = { startingSeason: 2026, players: [] };
		for (let i = 0; i < 400; i++) {
			const src = base.players[i % base.players.length];
			const p = JSON.parse(JSON.stringify(src));
			p.pid = i;
			p.draft = { year: i < 70 ? 2026 : 2029, round: 1, pick: 1 };
			big.players.push(p);
		}
		const v = global.Engine.validateLeagueFile(big);
		ok("a league-sized file warns", v.oversized === true &&
			v.warnings.some((w) => /full league export/.test(w)));
		ok("and offers the draft class inside it", v.classPids !== null &&
			v.classPids.length === 70, String(v.classCount));
		const small = global.Engine.validateLeagueFile(V.syntheticClass(5, 70));
		ok("a normal class does not warn", small.oversized === false &&
			small.classPids === null);
		/* A pid-less row is named by its position in the WHOLE file, which
		   is how the caller filters; an index into the class subset kept
		   the first sixty rows of the league instead of the class. */
		const noPid = JSON.parse(JSON.stringify(big));
		for (const p of noPid.players) delete p.pid;
		noPid.players.reverse(); // the class is now rows 330-399
		const v2 = global.Engine.validateLeagueFile(noPid);
		const keep = new Set(v2.classPids || []);
		const kept = noPid.players.filter((p, i) => keep.has(-1 - i));
		ok("a pid-less league file offers the class rows themselves",
			kept.length === 70 && kept.every((p) => p.draft.year === 2026),
			kept.length + " kept, " + kept.filter((p) => p.draft.year === 2026).length + " in class");
	}
}

/* --------------------------------------------------- every setting re-runs */
console.log("\nStaged pipeline coverage");
{
	/* A setting that no phase declares is a setting that changes nothing: the
	   runner compares phase keys, finds them identical and returns the cached
	   result, so the slider moves and the class does not. Nothing caught that,
	   and three settings added in one sitting all had it. */
	const declared = new Set();
	for (const p of global.Engine.PHASES) for (const d of p.deps) declared.add(d);
	// Settings that genuinely feed no phase, with the reason each is exempt.
	const EXEMPT = {
		seed: "declared by build",
		era: "declared by stats",
		/* Chain-level settings, read by runUniverse in js/app.js rather than
		   by the engine: they decide how many seasons are extrapolated past
		   the last class file and whether the unplayed years inside a chain
		   are filled in. The engine simulates one season and has no opinion
		   about either, so declaring them on a phase would be declaring a
		   dependency that does not exist. */
		extrapolateYears: "read by the universe chain, not by a phase",
		extrapolateGaps: "read by the universe chain, not by a phase",
	};
	const missing = Object.keys(global.Config.DEFAULTS)
		.filter((k) => !declared.has(k) && !EXEMPT[k]);
	ok("every setting is declared by some phase", missing.length === 0,
		missing.join(", "));

	/* And the stronger claim: moving each one actually changes the output. */
	const lf = V.syntheticClass(6, 40);
	const probes = {
		archetypePool: 4, surpriseBudget: 6, injuryRate: 0,
		classFlavor: 0, specialization: 2.4, pace: 78, statNoise: 2,
	};
	const runner = global.Engine.createRunner(lf);
	/* The fingerprint has to cover everything a setting can move, not only the
	   numbers. surpriseBudget draws more anomalies, and most anomalies are
	   biography — a decommitment, a hometown story — which changes the class
	   without changing anyone's ovr, build or scoring. The old fingerprint read
	   those three fields only, so whether this probe passed depended on which
	   anomalies the draw happened to produce: it passed while the pool was
	   mostly mechanical and started failing the moment more biographical ones
	   were added, which is a test measuring the wrong thing rather than a
	   regression. */
	const fingerprint = (res) => res.players.map((p) =>
		p.newOvr + "/" + p.archetype + "/" + (p.stats ? p.stats.ppg.toFixed(2) : "-") +
		"/" + (p.surprise ? p.surprise.name : "") + "/" + (p.backstory || "") +
		"/" + (p.classYear || "") + "/" + (p.newCollege || "")).join("|");
	const baseline = fingerprint(runner.run(global.Config.make({ seed: "deps" })));
	for (const key of Object.keys(probes)) {
		const cfg = global.Config.make({ seed: "deps" });
		cfg[key] = probes[key];
		ok("moving " + key + " changes the class",
			fingerprint(runner.run(cfg)) !== baseline);
	}
}

/* ------------------------------------------------------- ovr weight drift */
console.log("\nOVR weights against BBGM's own formula");
{
	/* OVR_W is a hand-transcribed copy of the linear weights inside BB.ovr(),
	   and it is what makes every archetype's offset vector ovr-neutral. If BBGM
	   ever re-fits those weights, BB.ovr() keeps passing every test it has —
	   it is the source of truth — while every archetype silently stops being
	   ovr-neutral and the specialization slider starts meaning something
	   different per build. Nothing could see that.

	   So derive the weights numerically by finite differences and check them
	   against the table. This runs against BB.ovrRaw — the linear half, before
	   the piecewise fudge and the rounding — because against ovr() itself a
	   single rating's contribution disappears into the quantization: endu moves
	   the result by 1.3 points over the whole difference and the rounding is
	   half a point. ovrRaw is what ovr() is built from, so there is still only
	   one copy of these weights inside BBGM to drift away from. */
	const RB = global.RatingsBuilder;
	const base = {};
	for (const k of BB.RATING_KEYS) base[k] = 50;
	base.fuzz = 0;
	const h = 10;
	let worst = 0;
	let worstKey = "";
	for (const k of BB.RATING_KEYS) {
		const up = Object.assign({}, base, { [k]: 50 + h });
		const dn = Object.assign({}, base, { [k]: 50 - h });
		const d = Math.abs((BB.ovrRaw(up) - BB.ovrRaw(dn)) / (2 * h) - RB.OVR_W[k]);
		if (d > worst) { worst = d; worstKey = k; }
	}
	ok("OVR_W matches BBGM's own ovr formula", worst < 1e-6,
		"worst " + worstKey + " off by " + worst.toFixed(8));
}

/* ------------------------------------------------- small-field tournament */
console.log("\nSmall custom college sets");
{
	/* The bracket assumed at least 68 eligible programs and four teams in each
	   play-in pool: splice(-4, 4) on a two-team pool takes both of them, and
	   the hardcoded seed-line offsets then sliced past the end of the array. */
	const names = global.Colleges.names.slice(0, 14);
	const lf = V.syntheticClass(12, 24);
	lf.players.forEach((p, i) => { p.college = names[i % names.length]; });
	const savedNames = global.Colleges.names;
	const savedByConf = global.Colleges.byConference;
	try {
		global.Colleges.names = names;
		const keep = {};
		for (const conf of Object.keys(savedByConf)) {
			const members = savedByConf[conf].filter((n) => names.indexOf(n) !== -1);
			if (members.length) keep[conf] = members;
		}
		global.Colleges.byConference = keep;
		const res = global.Engine.run(lf, global.Config.make({ seed: "tiny" }));
		ok("a 14-program season still produces a champion",
			!!(res.tourney && res.tourney.champion && res.tourney.champion.team));
		ok("every prospect still gets a stat line",
			res.players.filter((p) => !p.nonNcaa).every((p) => p.stats));
	} catch (err) {
		ok("a 14-program season still produces a champion", false, err.message);
		ok("every prospect still gets a stat line", false, err.message);
	} finally {
		global.Colleges.names = savedNames;
		global.Colleges.byConference = savedByConf;
	}
}

/* ---------------------------------------------------------- batch mode */
console.log("\nBatch mode");
{
	const B = global.BatchStats;
	/* Every class in a batch drew Math.random(), so a batch could not be
	   re-run, an anomaly in it could not be bisected, and a batch result could
	   not be shared. */
	const runBatch = () => {
		const runner = global.Engine.createRunner(V.syntheticClass(5, 40));
		const rows = [];
		for (let i = 0; i < 3; i++) {
			const c = global.Config.make({});
			c.seed = "fixedbatch#" + i;
			rows.push(B.summarize(runner.run(c)));
		}
		return rows;
	};
	const a = runBatch();
	const b = runBatch();
	ok("a batch is reproducible from its seed",
		JSON.stringify(a) === JSON.stringify(b));
	ok("a batch seed derives from the run's own seed when it has one",
		B.batchSeed({ seed: "abc" }, null) === "abc" &&
		B.batchSeed({ seed: "" }, "given") === "given");
	/* The per-player rows used to be averaged over everybody with a stat line
	   — a EuroLeague teenager on a 22-minute cap included — while ovr and pot
	   were averaged over the class, so the panel read a point below the
	   Prospects tab with nothing on screen to explain it. */
	const res = global.Engine.run(V.syntheticClass(5, 70), global.Config.make({ seed: "bd" }));
	const row = B.summarize(res);
	const ncaa = res.players.filter((p) => p.stats && !p.nonNcaa);
	const want = ncaa.reduce((x, p) => x + p.stats.ppg, 0) / ncaa.length;
	ok("batch PPG is the NCAA population the Prospects tab shows",
		Math.abs(row.ppg - want) < 1e-9,
		row.ppg.toFixed(3) + " against " + want.toFixed(3));
	ok("the batch reports how many players each population holds",
		row.nNcaa === ncaa.length && row.nNcaa + row.nAbroad ===
			res.players.filter((p) => p.stats).length);
	ok("percentiles are available for the batch panel",
		B.pct([1, 2, 3, 4, 5], 0.5) === 3 && B.pct([1, 2, 3, 4, 5], 0) === 1);
}

/* ------------------------------------------------------------ home courts */
console.log("\nHome and away");
{
	/* recordPostseason hardcoded home: 0 for both sides, and the professional
	   regular seasons route through it, so every game abroad logged home: 0
	   and the home-court lift in the game log could never fire for a EuroLeague
	   or G League prospect. */
	const res = global.Engine.run(V.syntheticClass(6, 70), global.Config.make({
		seed: "home",
		leagueWeights: { "EuroLeague": 60, "NBA G League": 40 },
	}));
	const abroad = res.players.filter((p) => p.nonNcaa && p.proTeam);
	if (abroad.length) {
		const log = abroad[0].proTeam.log;
		const homes = log.filter((g) => g.home > 0).length;
		const aways = log.filter((g) => g.home < 0).length;
		ok("a professional league plays home and away games",
			homes > 0 && aways > 0, homes + " home, " + aways + " away");
	} else {
		ok("a professional league plays home and away games", true, "no prospects abroad");
	}
}

/* ------------------------------------------------- the bugs, kept dead */
console.log("\nSeason story");
{
	/* Conference membership never changed, so the map of college basketball
	   was the one constant in a tool built to make every run different. */
	let withMoves = 0;
	let bad = 0;
	for (let i = 0; i < 14; i++) {
		const res = global.Engine.run(V.syntheticClass(300 + i, 60),
			global.Config.make({ seed: "re" + i }));
		const moves = res.realignment || [];
		if (moves.length) withMoves++;
		for (const m of moves) {
			// The program must actually be playing where the move says.
			if (!res.teams[m.school] || res.teams[m.school].conf !== m.to) bad++;
			// And a raid reaches one rung down, not five.
			const sf = global.Colleges.CONFERENCES[m.from];
			const st2 = global.Colleges.CONFERENCES[m.to];
			if (sf && st2 && st2.strength - sf.strength > 26) bad++;
		}
		// Every conference must still be able to play a season.
		const size = {};
		for (const t of Object.values(res.teams)) size[t.conf] = (size[t.conf] || 0) + 1;
		for (const k of Object.keys(size)) if (size[k] < 4) bad++;
	}
	ok("conferences realign some years and not others",
		withMoves >= 2 && withMoves <= 12, withMoves + " of 14 classes");
	ok("a realignment leaves a schedulable, consistent map", bad === 0, bad + " problems");
	ok("turning realignment off leaves the map alone",
		(global.Engine.run(V.syntheticClass(301, 60),
			global.Config.make({ seed: "re-off", realignmentRate: 0 })).realignment || [])
			.length === 0);

	/* Coaches had a style, a tenure and a development number, and no
	   situation — so every staff in the country was in the same year of the
	   same job. */
	const res = global.Engine.run(V.syntheticClass(310, 60),
		global.Config.make({ seed: "coach" }));
	const sits = {};
	for (const t of Object.values(res.teams)) {
		sits[t.coach.situation] = (sits[t.coach.situation] || 0) + 1;
	}
	ok("coaches are in different years of different jobs",
		Object.keys(sits).length >= 4 &&
			(sits["first year"] || 0) > 0 && (sits.interim || 0) > 0,
		JSON.stringify(sits));
	ok("a first-year coach has a first-year tenure",
		Object.values(res.teams).every((t) =>
			t.coach.situation !== "first year" || t.coach.tenure === 1));

	/* The narrative flavors bend settings that later phases own, and those
	   phases used to read the unbent config. */
	const down = global.Engine.run(V.syntheticClass(311, 60),
		global.Config.make({ seed: "down", bluebloodDownYears: 3 }));
	ok("a blue-blood down year actually reaches the programs",
		Object.values(down.teams).filter((t) => t.downYear).length === 3,
		Object.values(down.teams).filter((t) => t.downYear).length + " programs");
}

console.log("\nEarlier seasons");
{
	/* They used to be a backward-scaled copy of the draft year. They are
	   simulated now, which is only worth doing if the progression it produces
	   is a progression. */
	/* Three classes, because a single one holds only a couple of dozen
	   sophomore seasons and the comparison below is between two means. */
	const runs = [4, 5, 6].map((i) => global.Engine.run(V.realisticClass(i, 70),
		global.Config.make({ seed: "prior" + i })));
	const res = runs[0];
	const everyone = runs.reduce((a, r) => a.concat(r.players), []);
	const by = { Freshman: [], Sophomore: [], Junior: [], Senior: [] };
	let simulated = 0;
	let reconstructed = 0;
	for (const p of everyone) {
		for (const r of p.priorSeasons || []) {
			if (r.redshirt) continue;
			if (r.simulated) simulated++; else reconstructed++;
			if (by[r.classYear]) by[r.classYear].push(r);
		}
	}
	ok("earlier seasons are simulated for D-I prospects", simulated > reconstructed,
		simulated + " simulated, " + reconstructed + " reconstructed");
	const mean = (a, f) => (a.length ? a.reduce((x, y) => x + f(y), 0) / a.length : 0);
	const fr = mean(by.Freshman, (r) => r.mpg);
	const so = mean(by.Sophomore, (r) => r.mpg);
	ok("a freshman year is a freshman year", by.Freshman.length > 30 && fr < so - 1,
		"freshman " + fr.toFixed(1) + " MPG against sophomore " + so.toFixed(1));
	/* The failure this replaced: with nobody in front of him on a synthetic
	   roster, a prospect's freshman year came out BETTER than his draft year. */
	let inverted = 0;
	let checked = 0;
	for (const p of everyone) {
		const first = (p.priorSeasons || []).filter((r) => !r.redshirt)[0];
		if (!first || !first.simulated || !p.stats) continue;
		checked++;
		if (first.ppg > p.stats.ppg + 4) inverted++;
	}
	ok("almost nobody's first year outscores his draft year",
		checked > 10 && inverted <= Math.ceil(checked * 0.12),
		inverted + " of " + checked);
	ok("turning simulation off restores the reconstruction",
		global.Engine.run(V.realisticClass(4, 70), global.Config.make({
			seed: "prior", priorSeasons: "reconstruct",
		})).players.some((p) => (p.priorSeasons || []).some((r) => !r.redshirt)) &&
		!global.Engine.run(V.realisticClass(4, 70), global.Config.make({
			seed: "prior", priorSeasons: "reconstruct",
		})).players.some((p) => (p.priorSeasons || []).some((r) => r.simulated)));
}

console.log("\nRegressions");
{
	/* An archetype with no role-usage entry used to score a silent 1.0, which
	   made Injury-Prone Talent the highest-scoring build in the class at 24.3
	   points a game with nothing anywhere to say so. */
	let threw = false;
	try { RB.roleUsage("No Such Archetype"); } catch (e) { threw = true; }
	ok("an unknown archetype throws rather than scoring a silent 1.0", threw);
	ok("every archetype has a role usage",
		RB.ARCHETYPES.every((a) => Number.isFinite(RB.ROLE_USAGE[a.name])));
	/* Twelve of the old table's 72 constants sat on the fit boundary, which is
	   a fit that failed and was clipped. The soft bound cannot be reached. */
	const vals = RB.ARCHETYPES.map((a) => RB.ROLE_USAGE[a.name]);
	ok("no build sits on a role-usage bound",
		vals.every((v) => v > RB.ROLE_FIT.lo + 1e-6 && v < RB.ROLE_FIT.hi - 1e-6),
		"min " + Math.min.apply(null, vals).toFixed(3) +
			" max " + Math.max.apply(null, vals).toFixed(3));

	/* The solvable ovr range was computed on the POST-NOISE base, so it moved
	   under the user on every reroll while nothing about the player changed. */
	const orig = {};
	const r0 = new Rng("range");
	for (const k of BB.RATING_KEYS) orig[k] = Math.round(r0.uniform(25, 70));
	orig.fuzz = 0;
	const cfgNoisy = global.Config.make({ buildNoise: 9, specialization: 1 });
	const ranges = [];
	for (let i = 0; i < 12; i++) {
		ranges.push(RB.rebuild(new Rng("roll" + i), orig, 45, 55, cfgNoisy,
			"Combo Guard").ovrRange);
	}
	ok("the solvable ovr range does not move between rolls",
		ranges.every((x) => x.min === ranges[0].min && x.max === ranges[0].max),
		JSON.stringify(ranges.slice(0, 3)));
	/* And it stays a promise: a target the range calls reachable is reached. */
	let missed = 0;
	for (let i = 0; i < 60; i++) {
		const t = Math.round(new Rng("t" + i).uniform(ranges[0].min, ranges[0].max));
		const b = RB.rebuild(new Rng("b" + i), orig, t, t + 8, cfgNoisy, "Combo Guard");
		if (b.ovr !== t) missed++;
	}
	ok("every ovr the range calls reachable is reached", missed === 0, missed + " missed");

	/* Class year reached exactly one thing in the stat model, and it was not
	   usage, minutes, efficiency or turnovers. */
	const S = global.StatsSim;
	ok("class year is parsed, redshirts included",
		S.classYearIndex("Freshman") === 0 && S.classYearIndex("Senior") === 3 &&
			S.classYearIndex("Graduate") === 4 &&
			S.classYearIndex("Redshirt Junior") > S.classYearIndex("Junior"),
		[S.classYearIndex("Freshman"), S.classYearIndex("Redshirt Junior"),
			S.classYearIndex("Graduate")].join("/"));
	ok("an upperclassman is given more of the offense than a freshman",
		S.experienceUsage("Senior") > S.experienceUsage("Junior") &&
			S.experienceUsage("Junior") > S.experienceUsage("Sophomore") &&
			S.experienceUsage("Sophomore") > S.experienceUsage("Freshman"));

	/* PPG was typed into the era table and disagreed with the anchors it
	   claimed to follow. It is derived now (with a ppgBoost for the composite
	   ref system), so the two cannot drift apart. */
	const CAL = global.Calibration;
	let derivedOk = true;
	for (const name of Object.keys(CAL.ERAS)) {
		const e = CAL.ERAS[name];
		const d = CAL.impliedPpg(e.draftYear, e.team);
		const boost = e.shift.ppgBoost || 0;
		const expected = d.mean * (1 + boost);
		if (Math.abs(expected - e.draftYear.ppg.mean) > 1e-9) derivedOk = false;
	}
	ok("the PPG anchor is derived from the era's own numbers", derivedOk);
}

/* ------------------------------------------------- archetype rarity ordering */
console.log("\nArchetype rarity ordering");
{
	/* This block verifies:
	     1. The RARITY_COMPRESS parameter is what the code documents (0.42).
	        It no longer compresses the authored weight — WEIGHT_CAL replaced
	        that — and applies to the flavor multiplier alone, where
	        compressing a per-class tilt is still the right idea. Pinned so the
	        two uses cannot be conflated again.
	     2. Rare archetypes (low w) appear less often than common ones (high w).
	     3. Realized frequency is PROPORTIONAL to the authored w, which is the
	        contract WEIGHT_CAL exists to deliver. See the long note below. */
	ok("RARITY_COMPRESS is the documented value", RB.RARITY_COMPRESS === 0.42,
		"got " + RB.RARITY_COMPRESS);

	/* Draw a large sample using the archetype weight mechanism directly, at a
	   mid-range height so most builds are eligible. No pool filtering, no
	   diversity slider — pure weight draws, which is what the rarity exponent
	   governs. */
	const rng = new Rng("rarity");
	const testHgt = 50;
	const eligible = RB.ARCHETYPES.filter(
		(a) => testHgt >= a.min && testHgt <= a.max && a.name !== "Balanced");
	const cfg = global.Config.make({ archetypeDiversity: 100 });
	const counts = {};
	for (const a of eligible) counts[a.name] = 0;
	const N = 10000;
	for (let i = 0; i < N; i++) {
		const pick = rng.weighted(eligible, (a) => RB.archetypeWeight(a, cfg, null));
		counts[pick.name] = (counts[pick.name] || 0) + 1;
	}

	/* Sort archetypes by their authored weight (w). The top quartile by w
	   should appear more often than the bottom quartile in the sample. */
	const sorted = eligible.slice().sort((a, b) => b.w - a.w);
	const topQ = sorted.slice(0, Math.ceil(sorted.length / 4));
	const botQ = sorted.slice(-Math.ceil(sorted.length / 4));
	const topCount = topQ.reduce((s, a) => s + (counts[a.name] || 0), 0);
	const botCount = botQ.reduce((s, a) => s + (counts[a.name] || 0), 0);
	ok("common archetypes (high w) appear more often than rare ones (low w)",
		topCount > botCount,
		"top quartile " + topCount + " draws vs bottom quartile " + botCount);

	/* `w` MEANS A SHARE OF THE CLASS, AND THIS IS THE ROW THAT HOLDS IT TO IT.

	   This used to assert the old model directly: that the archetypeWeight
	   spread landed near (w / exposure) ^ RARITY_COMPRESS. That model is gone,
	   and it deserved to go — dividing by exposure and then compressing gave
	   the height gate more leverage over how often a build appeared than the
	   field labelled "rarity" had. Measured across 42,000 players,
	   corr(log w, log realized share) was 0.43: how wide a band an author drew
	   mattered more than the weight they typed, which is the worst possible
	   property for the one field that is supposed to say "how common is this".

	   WEIGHT_CAL replaced it by solving the height geometry instead of
	   approximating it, so the contract is now the simple one a reader would
	   assume: realized share is proportional to authored w. That is what this
	   tests, and it is a stronger check than the one it replaces — it reads the
	   property users care about rather than the formula that happens to deliver
	   it, so a future rewrite of the weighting is free to change the mechanism
	   and still has to keep the promise.

	   It is measured ACROSS THE HEIGHT DISTRIBUTION, which is the only place
	   that promise is made. WEIGHT_CAL solves its fixed point by integrating
	   over a normal height curve, so proportionality holds for a CLASS, not at
	   any one height: at a single height the builds whose gates barely reach it
	   are deliberately not equalized. Standing at hgt 50 reads a scatter of
	   0.417 off a model whose realized scatter over a class is 0.177 — the
	   first version of this row made exactly that mistake, and the reading it
	   produced looked like a real regression rather than a bad probe. */
	const hrng = new Rng("rarity:hgt");
	const specialists = RB.ARCHETYPES.filter((a) => a.name !== "Balanced");
	const drawCounts = {};
	for (const a of specialists) drawCounts[a.name] = 0;
	const M = 60000;
	for (let i = 0; i < M; i++) {
		const h = Math.max(0, Math.min(100, Math.round(hrng.normal(48, 17))));
		const el = specialists.filter((a) => h >= a.min && h <= a.max);
		if (!el.length) continue;
		drawCounts[hrng.weighted(el, (a) => RB.archetypeWeight(a, cfg, null)).name]++;
	}
	const nominalSum = specialists.reduce((s, a) => s + (a.w === undefined ? 1 : a.w), 0);
	const ratios = specialists.map((a) => ({
		name: a.name,
		r: (drawCounts[a.name] / M) / ((a.w === undefined ? 1 : a.w) / nominalSum),
	}));
	/* Sampling noise dominates the tail: a build whose nominal share is 0.1%
	   draws ~60 of 60,000, so its ratio carries a seventh of its own value as
	   error. The band is on the builds with enough draws to mean anything, and
	   the scatter figure below covers the rest. */
	const solid = ratios.filter((x) => drawCounts[x.name] >= 60);
	const offNominal = solid.filter((x) => Math.abs(x.r - 1) >= 0.4);
	ok("realized frequency tracks the authored weight",
		offNominal.length <= Math.ceil(solid.length * 0.05),
		offNominal.length + " of " + solid.length + " builds off nominal by 40%+" +
			(offNominal.length
				? ": " + offNominal.slice(0, 5).map(
					(x) => x.name + " " + x.r.toFixed(2) + "x").join(", ")
				: ""));

	/* And the scatter, which is what the old row's quartile check was really
	   reaching for.

	   Band 0.38 against a measured 0.310. Note this probe reads HIGHER than
	   the 0.177 measured over full classes, and should: it draws straight off
	   archetypeWeight, with no pool, no diversity slider and no per-class draw
	   penalty, all three of which pull realized frequency back toward nominal.
	   What is banded here is therefore the weighting alone, which is the part
	   WEIGHT_CAL is responsible for — a guard against the height gate silently
	   taking the wheel again, not a calibration target. */
	const logs = solid.map((x) => Math.log(x.r));
	const lm = logs.reduce((s, v) => s + v, 0) / logs.length;
	const lsd = Math.sqrt(logs.reduce((s, v) => s + (v - lm) * (v - lm), 0) / logs.length);
	ok("weight-to-frequency scatter stays tight",
		lsd < 0.38, "sd(log realized/nominal) = " + lsd.toFixed(3));


	/* No eligible build should be entirely absent in 10000 draws. */
	const absent = eligible.filter((a) => !counts[a.name]);
	ok("every eligible archetype appears in a large sample",
		absent.length === 0,
		absent.length + " builds never drawn: " +
			absent.map((a) => a.name).join(", "));
}

/* ------------------------------------------------------- the bug-fix pass */
console.log("\nBounds, shapes and guards");
{
	/* Rng.int: the guard that folds hi + 1 back onto hi is unreachable, so the
	   distribution is flat rather than double-weighted at the top. Both claims
	   are measured, because the argument for them is a floating-point one. */
	let ones = 0;
	let twos = 0;
	let outOfRange = 0;
	for (let s = 0; s < 200; s++) {
		const r = new Rng("intbias" + s);
		for (let i = 0; i < 3000; i++) {
			const v = r.int(1, 2);
			if (v < 1 || v > 2) outOfRange++;
			else if (v === 2) twos++;
			else ones++;
		}
	}
	const share = twos / (ones + twos);
	ok("rng.int never leaves its range", outOfRange === 0,
		outOfRange + " draws outside [1, 2]");
	ok("rng.int(1, 2) is flat, not 2:1 toward the top",
		Math.abs(share - 0.5) < 0.005,
		"share of 2s was " + share.toFixed(5));

	/* The raw formula, without the clamp: if the clamp were load-bearing this
	   would produce 3s, and the measured share above would be 2/3. */
	let raw = 0;
	for (let s = 0; s < 200; s++) {
		const r = new Rng("intraw" + s);
		for (let i = 0; i < 3000; i++) if (Math.floor(1 + 2 * r.random()) > 2) raw++;
	}
	ok("rng.int's upper clamp is a guard, not a correction", raw === 0,
		raw + " unclamped draws overflowed");

	// Wider spans, and a reversed range, which used to return lo - 1 or worse.
	let bad = 0;
	const r3 = new Rng("intspan");
	for (let i = 0; i < 200000; i++) {
		const v = r3.int(0, 320);
		if (v < 0 || v > 320) bad++;
	}
	ok("rng.int is in range for a wide span", bad === 0);
	ok("rng.int handles a reversed range", new Rng("rev").int(5, 2) === 5);
}

{
	/* softBound's two composition orders agree to well under the smallest gap
	   between two builds' role usage, so applying the lower bound first is not
	   a double squeeze of the bottom of the range. */
	const { lo, hi, band } = RB.ROLE_FIT;
	let worst = 0;
	let worstAt = 0;
	for (let x = lo - band; x <= hi + band; x += 0.001) {
		const e = RB.softBoundOrderError(x, lo, hi, band);
		if (e > worst) { worst = e; worstAt = x; }
	}
	ok("softBound does not depend on which bound is applied first",
		worst < 1e-5,
		"worst order disagreement " + worst.toExponential(2) + " at x = " +
			worstAt.toFixed(3));

	// Monotone, and strictly inside both bounds everywhere.
	let monotone = true;
	let inside = true;
	let prev = -Infinity;
	for (let x = -2; x <= 6; x += 0.005) {
		const v = RB.softBound(x, lo, hi, band);
		if (v <= prev) monotone = false;
		if (v <= lo - band * 1.0001 || v >= hi) inside = false;
		prev = v;
	}
	ok("softBound is monotone", monotone);
	ok("softBound never reaches its upper bound", inside);
}

{
	// findSeason: the gameAttributes history-row forms, including the ones
	// that used to fall through to the player scan.
	const fs2 = global.Engine.findSeason;
	ok("findSeason reads the newest gameAttributes history row",
		fs2({ gameAttributes: { season: [{ start: 2024, value: 2024 },
			{ start: 2026, value: 2026 }] } }) === 2026);
	ok("findSeason skips a malformed newest history row",
		fs2({ gameAttributes: { season: [{ start: 2024, value: 2024 },
			{ start: 2026 }] } }) === 2024);
	ok("an empty gameAttributes history falls through rather than throwing",
		fs2({ gameAttributes: { season: [] } }) === null);
	ok("an empty history still finds the season on the players",
		fs2({ gameAttributes: { season: [] },
			players: [{ draft: { year: 2031 } }] }) === 2031);
	ok("findSeason reads the array-of-rows gameAttributes form",
		fs2({ gameAttributes: [{ key: "startingSeason", value: 2027 }] }) === 2027);
}

{
	/* Team rebounds are re-floored after the two halves are rescaled onto the
	   combined pool. Feed reconcileTeamTotals a line the rescale would push
	   negative if the floor were missing. */
	const S = global.StatsSim;
	const fit = S.fitToPool([1, -3, 2], 12, 0.6);
	ok("fitToPool never emits a negative share",
		fit.every((v) => v >= 0), JSON.stringify(fit));
	const lines = [
		{ orpg: 2, drpg: 5, apg: 3, spg: 1, bpg: 1, pfpg: 2, rpg: 7 },
		{ orpg: 0.02, drpg: 0.01, apg: 1, spg: 0, bpg: 0, pfpg: 1, rpg: 0.03 },
		{ orpg: 4, drpg: 9, apg: 2, spg: 1, bpg: 2, pfpg: 3, rpg: 13 },
	];
	S.reconcileTeamTotals(lines, {
		astPool: 13, stlPool: 6, blkPool: 3, pfPool: 17,
		orbPool: 9, drbPool: 24,
	});
	ok("no reconciled rebound line is negative",
		lines.every((l) => l.orpg >= 0 && l.drpg >= 0 && l.rpg >= 0),
		JSON.stringify(lines.map((l) => [l.orpg, l.drpg])));
	ok("reconciled rebound halves still sum to the total",
		lines.every((l) => Math.abs(l.rpg - (l.orpg + l.drpg)) < 1e-9));
}

{
	/* exportFile writes hgt/weight only for a size override, and the list of
	   keys that count as one is declared rather than inferred. */
	const keys = global.Engine.SIZE_OVERRIDE_KEYS;
	ok("the size-override key list is declared",
		Array.isArray(keys) && keys.indexOf("hgtInches") !== -1 &&
			keys.indexOf("weight") !== -1 && keys.length === 2,
		JSON.stringify(keys));

	const withSize = (ov) => {
		const lf = V.syntheticClass(11, 12);
		for (const p of lf.players) { p.hgt = 78; p.weight = 220; }
		const cfg = global.Config.make({ seed: "sizeguard" });
		const res = global.Engine.run(lf, cfg);
		if (ov) res.players[0].override = ov;
		return global.Engine.exportFile(res).players[0];
	};
	ok("a non-size lock does not rewrite hgt/weight",
		withSize({ ovr: 55, archetype: "Balanced", name: "A B" }).hgt === 78);
	ok("a size lock does rewrite hgt", withSize({ hgtInches: 84 }).hgt !== undefined);
}

console.log("\nGenerated text");
{
	/* js/text.js: the one a/an rule every template now shares. */
	const T = global.Text;
	ok("article(): a Duke dunk, an Arizona State dunk",
		T.article("Duke") === "a" && T.article("Arizona State") === "an" &&
		T.article("Ole Miss") === "an" && T.article("Iowa") === "an");
	ok("article(): initialisms and vowel-letter consonant sounds",
		T.article("NBA") === "an" && T.article("UCLA") === "a" &&
		T.article("Utah") === "a" && T.article("European") === "a" &&
		T.article("one-and-done") === "a" && T.article("hour") === "an");
	ok("textFaults() sees the classes it exists for",
		T.textFaults("a Ohio State dunk").length === 1 &&
		T.textFaults("scored undefined points").length === 1 &&
		T.textFaults("won  twice").length === 1 &&
		T.textFaults("an Arizona State dunk, a Duke dunk, a European year").length === 0);

	/* THE SWEEP. Every string the engine writes for a reader — notes, news
	   articles, season events, draft-day events, anomaly stories — read for
	   the faults no reader should see. News and Universe were not loaded by
	   the harness at all before this, so "a Arizona State dunk" shipped in
	   the one feed nothing in CI ever read. */
	const faults = [];
	const seen = { notes: 0, articles: 0, events: 0 };
	const report = (where, text) => {
		const f = T.textFaults(text);
		if (f.length) faults.push(where + " [" + f.join(", ") + "]: " + String(text).slice(0, 110));
	};
	const NOTE_ALL = global.Engine.NOTE_LINES.map((l) => l[0]);
	for (let s = 0; s < 14; s++) {
		const res = global.Engine.run(V.realisticClass(s % 7, 70),
			global.Config.make({ seed: "text" + s, seasonEvents: 14, noteLines: NOTE_ALL,
				surpriseBudget: 6 }));
		for (const p of res.players) {
			if (p.note) { seen.notes++; report("note", p.note); }
			if (p.backstory) report("backstory", p.backstory);
		}
		for (const e of res.seasonEvents || []) { seen.events++; report("event " + e.kind, e.text); }
		for (const e of res.draftEvents || []) report("draft event", e.text + " " + (e.detail || ""));
		for (const sp of res.surprises || []) report("anomaly", sp.label);
		for (const a of global.News.build(res)) {
			seen.articles++;
			/* The paragraphs the voice system adds under the lede — a stat
			   block, a context note, a quote — are article text and are swept
			   like article text. They were the largest body of generated
			   prose in the tool that nothing read. */
			report("news " + a.kind, T.segsToText(a.headline) + " | " +
				T.segsToText(a.body) + " | " +
				(a.paras || []).map((x) => T.segsToText(x)).join(" | "));
		}
	}
	ok("the sweep actually read something",
		seen.notes > 500 && seen.articles > 300 && seen.events > 50,
		JSON.stringify(seen));
	ok("no generated note, article or event carries a text fault",
		faults.length === 0, faults.slice(0, 6).join("\n         "));
}

console.log("\nThe trait layer");
{
	const TR = global.Traits;
	const res = global.Engine.run(V.realisticClass(5, 70),
		global.Config.make({ seed: "traits" }));
	const ncaa = res.players.filter((p) => !p.nonNcaa);

	ok("every prospect carries traits",
		res.players.every((p) => Array.isArray(p.traits) && p.traits.length >= 1),
		String(res.players.filter((p) => !p.traits || !p.traits.length).length) + " without");

	/* One trait per group. A player with three different opinions about his
	   wingspan is not a scouting report. */
	{
		let dup = 0;
		for (const p of res.players) {
			const groups = (p.traits || []).map((t) => t.group);
			if (new Set(groups).size !== groups.length) dup++;
		}
		ok("no player draws two traits from one group", dup === 0, String(dup));
	}

	/* PREREQUISITES. The gates are what make the draw read as a report rather
	   than as a shuffle, so every one of them is checked against every player
	   who drew the trait, rather than trusting the drawer. */
	{
		const bad = [];
		for (const p of res.players) {
			for (const t of p.traits || []) {
				if (!TR.matches(t, p)) bad.push(p.name + " / " + t.name);
			}
		}
		ok("every trait's prerequisites hold for the player who drew it",
			bad.length === 0, bad.slice(0, 4).join("; "));
		/* And the gates actually bite: the specific ones the table exists for. */
		const tall = res.players.filter((p) => p.newRatings.hgt >= 70);
		ok("a seven-footer is never 'explosive first step'",
			tall.every((p) => (p.traitNames || []).indexOf("explosive first step") === -1));
		const fresh = res.players.filter((p) => /Freshman/.test(String(p.classYear)));
		ok("a freshman is never a natural leader or has never missed a game",
			fresh.every((p) => (p.traitNames || []).indexOf("natural leader") === -1 &&
				(p.traitNames || []).indexOf("has not missed a game") === -1));
		const small = res.players.filter((p) => p.newRatings.hgt < 60);
		ok("a guard never has a broken free-throw stroke",
			small.every((p) => (p.traitNames || []).indexOf("broken free-throw stroke") === -1));
	}

	/* THE FOUR SURFACES. A trait that reaches nothing is a label. */
	ok("every trait carries a note clause",
		TR.TRAITS.every((t) => typeof t.note === "string" && t.note.length > 12),
		TR.TRAITS.filter((t) => !t.note).map((t) => t.name).join("; "));
	ok("every trait carries a news adjective",
		TR.TRAITS.every((t) => typeof t.adj === "string" && t.adj.length > 2),
		TR.TRAITS.filter((t) => !t.adj).map((t) => t.name).join("; "));
	ok("the table is big enough to be a vocabulary",
		TR.TRAITS.length >= 55 && TR.GROUPS.length >= 10,
		TR.TRAITS.length + " traits in " + TR.GROUPS.length + " groups");
	ok("every trait's group is a declared group",
		TR.TRAITS.every((t) => TR.GROUPS.indexOf(t.group) !== -1));
	{
		const notes = res.players.filter(
			(p) => String(p.note || "").indexOf("Scouts note ") !== -1);
		ok("the default note carries the trait line",
			notes.length > res.players.length * 0.8,
			notes.length + " of " + res.players.length);
	}
	{
		const f = global.Engine.exportFile(res, {});
		const mood = f.players.filter((p) => p.moodTraits && p.moodTraits.length);
		ok("mood traits reach the exported file", mood.length > 10,
			mood.length + " of " + f.players.length);
		const letters = new Set();
		for (const p of mood) for (const m of p.moodTraits) letters.add(m);
		ok("and are BBGM's own four letters",
			[...letters].every((m) => "FL$W".indexOf(m) !== -1), [...letters].join(""));
		const off = global.Engine.run(V.realisticClass(5, 70),
			global.Config.make({ seed: "traits", traitCount: 0 }));
		const fOff = global.Engine.exportFile(off, {});
		ok("traitCount 0 writes no mood traits and no trait line",
			fOff.players.every((p) => !p.moodTraits) &&
			off.players.every((p) => String(p.note || "").indexOf("Scouts note") === -1));
	}

	/* THE NUMERIC EFFECTS. */
	{
		ok("volatility is drawn per player and lands in a sane band",
			res.players.every((p) => p.volatility >= 0.7 && p.volatility <= 1.6),
			String(Math.min.apply(null, res.players.map((p) => p.volatility))));
		const vols = res.players.map((p) => p.volatility);
		ok("and it actually varies between players",
			Math.max.apply(null, vols) - Math.min.apply(null, vols) > 0.2,
			(Math.max.apply(null, vols) - Math.min.apply(null, vols)).toFixed(2));
		/* The point of it: two players with the same average produce
		   different-looking logs. Measured as the game-log SD of the top and
		   bottom volatility quartiles among comparable scorers. */
		const scorers = ncaa.filter((p) => p.stats && p.stats.ppg >= 12 &&
			p.gameLog && p.gameLog.games.length > 20);
		if (scorers.length >= 12) {
			const sd = (p) => {
				const g = p.gameLog.games.map((x) => x.pts);
				const m = g.reduce((a, b) => a + b, 0) / g.length;
				return Math.sqrt(g.reduce((a, x) => a + (x - m) * (x - m), 0) / g.length) /
					p.stats.ppg;
			};
			const byVol = scorers.slice().sort((a, b) => a.volatility - b.volatility);
			const k = Math.max(3, Math.floor(byVol.length / 4));
			const lowV = byVol.slice(0, k).map(sd);
			const hiV = byVol.slice(-k).map(sd);
			const mn = (a) => a.reduce((x, y) => x + y, 0) / a.length;
			ok("a volatile scorer's game log is genuinely wider",
				mn(hiV) > mn(lowV), mn(lowV).toFixed(3) + " -> " + mn(hiV).toFixed(3));
		}
		ok("the offensive-glass bias stays inside its band",
			res.players.every((p) => Math.abs(p.orbBias) <= 0.12));
		ok("the medical file moves the injury roll",
			res.players.every((p) => p.traitInjuryMult >= 0.5 &&
				p.traitInjuryMult <= 2.0));
	}

	/* DETERMINISM. A trait has to survive a re-run, like every other
	   per-player fact. */
	{
		const again = global.Engine.run(V.realisticClass(5, 70),
			global.Config.make({ seed: "traits" }));
		let same = 0;
		for (let i = 0; i < res.players.length; i++) {
			if ((res.players[i].traitNames || []).join("|") ===
				(again.players[i].traitNames || []).join("|")) same++;
		}
		ok("the same seed draws the same traits", same === res.players.length,
			same + " of " + res.players.length);
	}

	/* THE TRAIT LAYER MULTIPLIES. The whole argument for it is that traits are
	   orthogonal to builds, so the same build produces different prospects. */
	{
		const byBuild = {};
		for (let s = 0; s < 4; s++) {
			const r = global.Engine.run(V.realisticClass(s, 70),
				global.Config.make({ seed: "orth" + s }));
			for (const p of r.players) {
				(byBuild[p.archetype] = byBuild[p.archetype] || [])
					.push((p.traitNames || []).slice().sort().join("|"));
			}
		}
		const repeated = Object.keys(byBuild).filter((k) => byBuild[k].length >= 4);
		let identical = 0;
		for (const k of repeated) {
			if (new Set(byBuild[k]).size === 1) identical++;
		}
		ok("two players of the same build are not the same prospect",
			identical === 0, identical + " builds with one trait set across " +
				repeated.length + " repeated builds");
	}
}

console.log("\nUniverse");
{
	/* js/universe.js was never loaded by a harness either. Two seasons run
	   as one world: the carry-over reaches the next season, the summary row
	   is populated, and the export replays. */
	const U = global.Universe;
	/* Narratives off throughout this block. "A chaotic sideline" bends
	   coachTurnover to 175 and "the map moved" bends the realignment rate, and
	   both of those are things the checks below measure — a band on the
	   carousel's calibrated rate has to be measured on an ordinary season, the
	   way tools/validate.js measures every other calibrated rate. */
	const a = global.Engine.run(V.realisticClass(1, 70),
		global.Config.make({ seed: "u1", narrative: false }));
	const carry = U.harvest(a);
	ok("harvest carries every program forward",
		Object.keys(carry.levels).length >= 360 && Object.keys(carry.coaches).length >= 360);
	const b = global.Engine.run(V.realisticClass(2, 70),
		global.Config.make({ seed: "u2", carryOver: carry, narrative: false }));
	/* Retention, not permanence. The carousel (js/teams.js) turns over 40-60
	   of 368 jobs a year at coachTurnover 100, which is what Division I does,
	   so 85-93% of programs keep the same man.

	   Measured over THREE handoffs rather than one. The rate has a spread of
	   about two points from season to season — a season in which more
	   programs had losing records fires more coaches, which is the model
	   working — so a single pair against a band eight points wide fails on
	   the draw about as often as it fails on a defect, and a harness that
	   does that teaches a developer to ignore it. */
	let same = 0;
	let total = 0;
	for (let i = 0; i < 3; i++) {
		const prev = i === 0 ? a : global.Engine.run(V.realisticClass(i, 70),
			global.Config.make({ seed: "u1" + i, narrative: false }));
		const carried = i === 0 ? carry : U.harvest(prev);
		const next = i === 0 ? b : global.Engine.run(V.realisticClass(i + 1, 70),
			global.Config.make({ seed: "u2" + i, carryOver: carried, narrative: false }));
		for (const name of Object.keys(next.teams)) {
			const t = next.teams[name];
			if (!t || !t.coach || !carried.coaches[name]) continue;
			total++;
			if (t.coach.name === carried.coaches[name].coach.name) same++;
		}
	}
	/* AND THE BAND AGREES WITH THE CLAIM ABOVE IT.

	   The paragraph says the carousel turns over 40-60 of 368 jobs a year,
	   which is a retention of 83.7% to 89.1%, and the band then asked for
	   85-94% — tighter than the model it describes at one end and looser at
	   the other. A measured 84.98%, which is 55 jobs and squarely inside the
	   stated range, failed it. The band is the claim's own arithmetic now,
	   with a point of slack on each side for the season-to-season spread the
	   comment above describes. */
	ok("a carried coach is the same man next season",
		total > 900 && same / total > 0.827 && same / total < 0.90,
		same + " of " + total + " (" + (100 * same / total).toFixed(1) + "%, " +
			Math.round(total - same) + " jobs turned over)");
	/* The other half of the same fact: a coach who did NOT come back was
	   named by the carousel, rather than simply being redrawn. */
	{
		const vacated = new Set((a.coachingCarousel || []).map((c) => c.school));
		let unexplained = 0;
		for (const name of Object.keys(b.teams)) {
			const t = b.teams[name];
			if (!t || !t.coach || !carry.coaches[name]) continue;
			if (t.coach.name !== carry.coaches[name].coach.name && !vacated.has(name)) {
				unexplained++;
			}
		}
		ok("every coaching change has a reason on the carousel",
			unexplained === 0, unexplained + " unexplained");
	}
	{
		const n = (a.coachingCarousel || []).length;
		ok("the carousel turns over a realistic number of jobs",
			n >= 28 && n <= 66, n + " of " + Object.keys(a.teams).length);
		const reasons = {};
		for (const c of a.coachingCarousel || []) reasons[c.reason] = 1;
		ok("the carousel distinguishes fired from retired from hired away",
			Object.keys(reasons).length >= 2, Object.keys(reasons).join(", "));
		const frozen = global.Engine.run(V.realisticClass(1, 70),
			global.Config.make({ seed: "u1", coachTurnover: 0, narrative: false }));
		ok("coachTurnover 0 freezes every sideline",
			(frozen.coachingCarousel || []).length === 0);
		const chaos = global.Engine.run(V.realisticClass(1, 70),
			global.Config.make({ seed: "u1", coachTurnover: 200, narrative: false }));
		ok("coachTurnover 200 roughly doubles it",
			(chaos.coachingCarousel || []).length > n * 1.4);
		ok("every coach carries an age",
			Object.values(a.teams).every((t) => !t.coach ||
				(Number.isFinite(t.coach.age) && t.coach.age >= 28 && t.coach.age <= 78)));
		let older = 0;
		let carried = 0;
		for (const name of Object.keys(b.teams)) {
			const kept = carry.coaches[name];
			const t = b.teams[name];
			if (!t || !t.coach || !kept || !kept.coach) continue;
			if (t.coach.name !== kept.coach.name) continue;
			carried++;
			if (t.coach.age === kept.coach.age + 1) older++;
		}
		ok("a carried coach is exactly one year older",
			carried > 250 && older === carried, older + " of " + carried);
	}
	const rows = [U.summarize(a, "u1", "a.json"), U.summarize(b, "u2", "b.json")];
	ok("a timeline row names a champion, a POY and a No. 1 pick",
		rows.every((r) => r.champion && r.champSeed && r.no1 && r.apOne));
	ok("threads() runs on a two-season timeline", Array.isArray(U.threads(rows)));
	const ex = U.exportUniverse({ name: "t", baseSeed: "x", rows: rows.map((r) => ({
		season: r.season, fileName: r.fileName, seed: r.seed, fingerprint: "f" })) });
	ok("the universe export stores seeds, not output",
		ex.seasons.length === 2 && ex.seasons.every((s) => s.seed && !s.champion));
	const diag = U.validate([{ name: "a.json", data: V.realisticClass(1, 70) },
		{ name: "bad.json", data: { players: [] } }]);
	ok("validate() rejects a bad file by name and keeps the rest",
		diag[0].ok && !diag[1].ok && diag[1].errors.length > 0);
}

console.log("\nExport: the round trip, ages, award scope and notes");
{
	const V2 = V;
	const base = V2.realisticClass(11, 70);
	const cfg = () => global.Config.make({ seed: "export-rt" });
	const countAwards = (f) => f.players.reduce(
		(a, p) => a + ((p.awards || []).length), 0);
	/* What a run produced: the draft year's honors plus the earlier
	   seasons' (see priorHonors in js/awards.js), both of which the export
	   writes at their own seasons. */
	const ownAwards = (res) => res.players.reduce(
		(a, p) => a + ((p.awards || []).length) + ((p.priorAwards || []).length), 0);

	/* THE ROUND TRIP.

	   Export, re-import, export again. `awards` is one of the two fields
	   BBGM's draft-class import keeps, so the file coming back in already
	   carries the rows exportFile is about to write, and the old code
	   concatenated: 181 rows became 368 on the second pass and 736 on the
	   third. A dedupe on {season, type} is NOT enough and this test is why —
	   a re-import re-simulates the season, so the second run mints different
	   honors for the same year and the file converges on the union of every
	   simulation anybody ever ran. The invariant is stronger: after any number
	   of round trips the file holds exactly what the last run produced. */
	{
		let file = base;
		const rows = [];
		for (let i = 0; i < 4; i++) {
			const res = global.Engine.run(file, cfg());
			const own = ownAwards(res);
			file = global.Engine.exportFile(res, { awards: true });
			rows.push([own, countAwards(file)]);
		}
		ok("a re-exported file holds exactly the honors the run produced",
			rows.every(([own, inFile]) => own === inFile),
			rows.map((r) => r.join("/")).join(" "));
		ok("and four round trips do not accumulate",
			countAwards(file) < rows[0][0] * 1.6,
			rows.map((r) => r[1]).join(" -> "));
		/* The specific residue a {season, type} dedupe leaves: a player who
		   won something last run and nothing this run. The old guard was on
		   p.awards.length, so the replacement never ran for him. */
		const res = global.Engine.run(file, cfg());
		const out = global.Engine.exportFile(res, { awards: true });
		let stale = 0;
		for (let i = 0; i < out.players.length; i++) {
			if ((res.players[i].awards || []).length === 0 &&
				(res.players[i].priorAwards || []).length === 0 &&
				(out.players[i].awards || []).length > 0) stale++;
		}
		ok("a player who won nothing this run keeps nothing", stale === 0, stale + " stale");
		/* Honors at another season are not ours and are left alone. */
		const withHistory = JSON.parse(JSON.stringify(base));
		withHistory.players[0].awards = [{ season: 1999, type: "Some Old Trophy" }];
		const r2 = global.Engine.run(withHistory, cfg());
		const f2 = global.Engine.exportFile(r2, { awards: true });
		ok("an honor from another season survives the rewrite",
			(f2.players[0].awards || []).some((a) => a.season === 1999));
	}

	/* AGES. Every player in a BBGM draft class shares a birth year. */
	{
		const res = global.Engine.run(base, cfg());
		const on = global.Engine.exportFile(res, {});
		const off = global.Engine.exportFile(res, { ages: false });
		const years = (f) => new Set(f.players.map((p) => p.born.year));
		ok("ages:true spreads born.year across the class years",
			years(on).size >= 4, years(on).size + " distinct birth years");
		ok("ages:false leaves the file's own birth years alone",
			years(off).size === years(base).size);
		/* A graduate is 23 and a freshman is 19, and the map is the biography
		   read back rather than a draw. */
		const bad = [];
		for (let i = 0; i < res.players.length; i++) {
			const p = res.players[i];
			const age = res.season - on.players[i].born.year;
			const cy = String(p.classYear || "");
			const want = /Graduate/.test(cy) ? 23
				: /Senior/.test(cy) ? 22 : /Junior/.test(cy) ? 21
				: /Sophomore/.test(cy) ? 20 : 19;
			const rs = /^Redshirt /.test(cy) ? 1 : 0;
			const juco = p.transfer && p.transfer.kind === "JUCO transfer" ? 1 : 0;
			if (age !== Math.min(24, want + rs + juco)) {
				bad.push(p.name + " " + cy + " -> " + age);
			}
		}
		ok("every age matches the class year it was drawn for",
			bad.length === 0, bad.slice(0, 4).join("; "));
	}

	/* AWARD SCOPE. */
	{
		const res = global.Engine.run(base, cfg());
		const all = global.Engine.exportFile(res, { awards: true });
		const major = global.Engine.exportFile(res, { awards: true, awardsScope: "major" });
		const power = global.Engine.exportFile(res, {
			awards: true, awardsScope: "major",
			majorConferences: ["ACC", "Big Ten", "Big 12", "Big East", "SEC"],
		});
		ok("awardsScope major cuts the honor rows substantially",
			countAwards(major) < countAwards(all) * 0.7 && countAwards(major) > 0,
			countAwards(all) + " -> " + countAwards(major));
		ok("a narrower conference list cuts further",
			countAwards(power) <= countAwards(major),
			countAwards(major) + " -> " + countAwards(power));
		const types = new Set();
		for (const p of major.players) for (const a of (p.awards || [])) types.add(a.type);
		ok("no finalist, watch list or all-region row survives major scope",
			![...types].some((t) => /finalist|watch list|honorable mention|All-Region|Late Season/i.test(t)),
			[...types].filter((t) => /finalist|watch list/i.test(t)).slice(0, 3).join("; "));
		ok("no conference all-freshman or all-newcomer row survives",
			![...types].some((t) => /(Freshman|Newcomer|Second) Team$/.test(t)),
			[...types].filter((t) => /(Freshman|Newcomer|Second) Team$/.test(t)).slice(0, 3).join("; "));
		ok("the national trophies do survive",
			[...types].some((t) => /Naismith|Wooden|Consensus|All-American|Award$/.test(t)) ||
				countAwards(major) < 5,
			[...types].slice(0, 6).join("; "));
		/* The note's Honors: line follows the same scope, because on the
		   Import players route the note is the only place honors survive. */
		const noted = major.players.filter(
			(p) => String(p.note || "").indexOf("Honors:") !== -1)[0];
		if (noted) {
			const line = String(noted.note).split("\n")
				.filter((l) => l.indexOf("Honors:") === 0)[0].slice(8);
			ok("the note's Honors: line follows the same scope",
				line.split("; ").every((t) => global.Awards.isMajorAward(t.trim())), line);
		}
		/* The earlier seasons' line follows the scope too: it used to keep
		   the template's unscoped list beside a scoped awards array. */
		ok("the note's Earlier honors: line follows the same scope",
			major.players.every((p) => {
				const line = String(p.note || "").split("\n")
					.filter((l) => l.indexOf("Earlier honors:") === 0)[0];
				if (!line) return true;
				return line.slice(16).replace(/ \(\+\d+ more\)$/, "").split("; ")
					.every((t) => global.Awards.isMajorAward(t.trim().replace(/^\d{4} /, "")));
			}));
		ok("only one Honors: line, however many times a file is exported",
			major.players.every((p) => String(p.note || "").split("\n")
				.filter((l) => l.indexOf("Honors:") === 0).length <= 1));
	}

	/* JERSEY NUMBERS AND INJURY HISTORY. Two fields BBGM reads that the tool
	   never wrote. */
	{
		const res = global.Engine.run(base, cfg());
		const f = global.Engine.exportFile(res, {});
		const nums = f.players.map((p) => Number(p.jerseyNumber));
		ok("every exported player has a jersey number",
			nums.every((n) => Number.isFinite(n) && n >= 0 && n <= 99));
		ok("and no two of them share one",
			new Set(nums).size === nums.length,
			new Set(nums).size + " of " + nums.length);
		/* The convention has to be visible or it is a random number. */
		const mn = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
		const guards = nums.filter((n, i) => res.players[i].newRatings.hgt < 37);
		const bigs = nums.filter((n, i) => res.players[i].newRatings.hgt > 53);
		ok("guards wear low numbers and bigs high ones",
			guards.length >= 8 && bigs.length >= 8 && mn(bigs) > mn(guards) + 12,
			mn(guards).toFixed(1) + " vs " + mn(bigs).toFixed(1));
		ok("a number in the source file is left alone", (function () {
			const src2 = JSON.parse(JSON.stringify(base));
			src2.players[0].jerseyNumber = "77";
			const r2 = global.Engine.run(src2, cfg());
			return global.Engine.exportFile(r2, {}).players[0].jerseyNumber === "77";
		})());
		ok("jerseys:false writes none",
			global.Engine.exportFile(res, { jerseys: false })
				.players.every((p) => p.jerseyNumber === undefined));

		const inj = global.Engine.exportFile(res, { injuries: true });
		const rows = inj.players.filter((p) => p.injuries && p.injuries.length);
		ok("the season's injuries reach BBGM's injuries[]",
			rows.length >= 5, rows.length + " of " + inj.players.length);
		ok("each row is {season, games, type}",
			rows.every((p) => p.injuries.every((r) => Number.isFinite(r.season) &&
				Number.isFinite(r.games) && r.games > 0 && typeof r.type === "string" &&
				/^[A-Z]/.test(r.type))),
			JSON.stringify(rows[0] && rows[0].injuries));
		/* Same rule as the awards: the class season's rows are replaced, so a
		   round trip does not accumulate them. */
		const r3 = global.Engine.run(inj, cfg());
		const inj2 = global.Engine.exportFile(r3, { injuries: true });
		const count = (x) => x.players.reduce((a, p) => a + ((p.injuries || []).length), 0);
		ok("and a round trip does not accumulate them",
			count(inj2) === count(inj), count(inj) + " -> " + count(inj2));
		ok("injuries off by default",
			global.Engine.exportFile(res, {}).players.every((p) => !p.injuries));
	}

	/* NOTES. */
	{
		const src = JSON.parse(JSON.stringify(base));
		src.players[0].note = "My own scouting note.";
		const res = global.Engine.run(src, cfg());
		const replaced = global.Engine.exportFile(res, {});
		const appended = global.Engine.exportFile(res, { noteAppend: true });
		ok("by default the generated note replaces the file's own",
			replaced.players[0].note.indexOf("My own scouting note.") === -1);
		ok("noteAppend keeps it and puts the generated note underneath",
			appended.players[0].note.indexOf("My own scouting note.") === 0 &&
			appended.players[0].note.length > "My own scouting note.".length + 20);
	}
}

/* isMajorAward, directly. The predicate is a regex list over strings that
   several different functions mint, so it is worth checking by example
   rather than only through an export. */
{
	const A = global.Awards;
	const cases = [
		["Naismith Trophy", true], ["Naismith Trophy finalist", false],
		["John R. Wooden Award", true], ["Wooden Award Late Season Top 20", false],
		["Consensus First Team All-American", true],
		["Associated Press honorable mention", false],
		["Third Team All-American", true],
		["All-ACC First Team", true], ["All-ACC Second Team", false],
		["All-ACC Tournament Team", false], ["All-ACC Freshman Team", false],
		["ACC Player of the Year", true], ["Ohio Valley Player of the Year", false],
		["Big Ten Tournament MVP", true], ["MAC Tournament MVP", false],
		["Final Four Most Outstanding Player", true],
		["NCAA All-Tournament Team", true], ["NCAA Midwest All-Region Team", false],
		["Academic All-American", false], ["MEAC Sixth Man of the Year", false],
		["EuroLeague Rising Star", true], ["All-EuroLeague First Team", true],
		["B.League MVP", true], ["ABA Cup Final MVP", false],
		["G League Rookie of the Year", true],
		["Bob Cousy Award", true], ["Bob Cousy Award finalist", false],
	];
	const wrong = cases.filter(([a, want]) => A.isMajorAward(a) !== want);
	ok("isMajorAward agrees with the specification on 26 examples",
		wrong.length === 0, wrong.map((w) => w[0]).join("; "));
	ok("scopeAwards(\"all\") is the identity",
		A.scopeAwards(["x", "y"], "all").join() === "x,y");
	ok("an unknown conference can be opted into",
		A.isMajorAward("Big Sky Player of the Year", ["Big Sky"]) &&
		!A.isMajorAward("Big Sky Player of the Year"));
}

console.log("\nUniverse: the same men across two classes");
{
	/* Two files, one world: the later file's underclassmen play the earlier
	   season on real rosters, can win its honors, and never reach its board
	   or its export. The build-phase preview the chain relies on has to
	   agree with the full run, or the man on the 2025 roster is not the man
	   in the 2027 file. */
	const E = global.Engine;
	const lfA = V.realisticClass(1, 70);
	lfA.startingSeason = 2026;
	const lfB = V.realisticClass(2, 70);
	lfB.startingSeason = 2027;
	const prev = E.previewClass(lfB, global.Config.make({ seed: "u#2027" }));
	const full = E.run(lfB, global.Config.make({ seed: "u#2027" }));
	ok("the build-phase preview agrees with the full run on every player",
		prev.season === 2027 && prev.players.length === full.players.length &&
		prev.players.every((p, i) => p.newCollege === full.players[i].newCollege &&
			p.classYear === full.players[i].classYear &&
			p.archetype === full.players[i].archetype && p.key === full.players[i].key));
	const roster = E.futureRosterFor(prev, 2026, 1);
	ok("a later class's upperclassmen were on campus the season before",
		roster.length >= 15 && roster.every((f) => f.team && global.Colleges.COLLEGES[f.team] &&
			f.classYear && f.ratings && Number.isFinite(f.ovr)) &&
		roster.every((f) => {
			const p = prev.players.filter((x) => x.key === f.key)[0];
			return p && p.classYear !== "Freshman" && f.ovr <= p.newOvr;
		}));
	ok("a freshman in the later class was not on campus yet",
		!roster.some((f) => prev.players.filter((x) => x.key === f.key)[0].classYear === "Freshman"));
	ok("and nobody is on a roster two seasons before a sophomore year",
		E.futureRosterFor(prev, 2025, 1).every((f) =>
			prev.players.filter((x) => x.key === f.key)[0].classYear !== "Sophomore"));
	const resA = E.run(lfA, global.Config.make({ seed: "u#2026", universeRoster: roster }));
	const fp = resA.futurePlayers || [];
	ok("every one of them played the earlier season: a line and a game log",
		fp.length === roster.length && fp.every((p) => p.stats && p.gameLog && p.future));
	ok("they sit on the roster of the school the later file says",
		fp.every((p) => resA.teams[p.newCollege] &&
			(resA.teams[p.newCollege].futureMembers || []).indexOf(p) !== -1 &&
			resA.teams[p.newCollege].members.some((m) => m.player === p) &&
			resA.teams[p.newCollege].prospects.indexOf(p) === -1));
	ok("they never reach the draft board, the class or the export",
		!resA.board.some((p) => p.future) && !resA.players.some((p) => p.future) &&
		E.exportFile(resA).players.length === lfA.players.length);
	ok("one of them can take an honor off the field, and it is recorded as a later class's",
		fp.some((p) => p.awards && p.awards.length) &&
		resA.fieldHonors.some((h) => h.futureClass === 2027 && h.key && h.homeKey));
	ok("the same seed without the roster is a different season for those programs",
		JSON.stringify(E.run(lfA, global.Config.make({ seed: "u#2026" })).futurePlayers) === "[]");
	ok("a class run alone is unchanged: universeRoster defaults to nothing",
		E.run(lfA, global.Config.make({ seed: "u#2026", universeRoster: [] })).futurePlayers.length === 0);
	/* News can say it. */
	const arts = global.News.build(resA);
	ok("the paper can report an award won by a later class's underclassman",
		global.News.TEMPLATES.some((t) => t.kind === "underclassman award") &&
		(arts.some((a) => a.kind === "underclassman award") ||
			!resA.fieldHonors.some((h) => h.futureClass)));
}

console.log("\nEarlier seasons: nights, highs and honors; statlines abroad; the college table");
{
	/* A prior season used to be an average with no nights in it. Now it
	   carries a drawn schedule, a game log reconciled to the line, season
	   highs and a best game — and honors, measured against the bars this
	   season's field set. */
	const res = global.Engine.run(V.realisticClass(3, 70), global.Config.make({ seed: "prior-nights" }));
	const rows = [];
	for (const p of res.players) {
		if (p.nonNcaa) continue;
		for (const r of p.priorSeasons || []) if (r.simulated) rows.push({ p, r });
	}
	ok("every simulated earlier season carries a game log and season highs",
		rows.length >= 30 && rows.every(({ r }) => r.gameLog && r.gameLog.games.length >= 25 &&
			r.highs && Number.isFinite(r.highs.pts) && r.best && r.best.opp && r.record));
	ok("an earlier season's high is a night out of that season, not this one",
		rows.every(({ r }) => r.highs.pts >= Math.floor(r.ppg) &&
			r.highs.pts <= 4 + 1.55 * r.mpg + 30 &&
			Math.abs(r.gameLog.games.reduce((a, g) => a + g.pts, 0) / r.gameLog.games.length - r.ppg) < 0.6));
	ok("the drawn schedule names real opponents and a record that adds up",
		rows.every(({ r }) => r.record.w + r.record.l === r.gameLog.games.length ||
			r.record.w + r.record.l >= r.gameLog.games.length) &&
		rows.every(({ r }) => r.gameLog.games.every((g) => global.Colleges.COLLEGES[g.opp])));
	const honored = res.players.filter((p) => p.priorAwards && p.priorAwards.length);
	const older = res.players.filter((p) => !p.nonNcaa && p.classYear !== "Freshman");
	ok("some upperclassmen hold honors from earlier seasons, and no freshman does",
		honored.length >= 3 && honored.length <= older.length &&
		honored.every((p) => p.classYear !== "Freshman") &&
		honored.every((p) => p.priorAwards.every((a) => a.season < res.season && a.award)));
	ok("an earlier honor is also on the season row it belongs to",
		honored.every((p) => p.priorAwards.every((a) =>
			(p.priorSeasons || []).some((r) => r.season === a.season &&
				(r.awards || []).indexOf(a.award) !== -1))));
	ok("the draft year's own list is untouched by them",
		res.players.every((p) => !(p.awards || []).some((a) => /^\d{4} /.test(a))));
	/* The export: earlier honors at their own seasons, never accumulating,
	   and the earlier rows carry highs off their own nights. */
	{
		const ex = global.Engine.exportFile(res, { stats: true, prior: true, highs: true, awards: true });
		const withPrior = honored[0];
		const idx = res.players.indexOf(withPrior);
		const row = ex.players[idx];
		ok("earlier honors are exported as {season, type} at their own season",
			withPrior.priorAwards.every((a) =>
				row.awards.some((x) => x.season === a.season && x.type === a.award)));
		const again = global.Engine.exportFile({ leagueFile: { players: ex.players }, players: res.players,
			teams: res.teams, proLeagues: res.proLeagues, season: res.season, seed: res.seed,
			cfg: res.cfg, ageIsInformative: res.ageIsInformative },
			{ stats: true, prior: true, highs: true, awards: true });
		ok("and a second export does not double them",
			again.players[idx].awards.length === row.awards.length);
		const priorRows = row.stats.filter((r) => r.season < res.season);
		ok("an earlier season's exported row carries highs from its own nights",
			priorRows.length > 0 && priorRows.every((r) => Array.isArray(r.ptsMax) &&
				r.ptsMax[0] <= r.pts && r.ptsMax[0] > 0));
		ok("the note says what the earlier seasons' highs were",
			/\d{4} highs \d+p/.test(global.Engine.buildNote(withPrior, res.teams, res.season,
				{ noteLines: ["highs"] })));
	}
	/* Statlines for the prospects abroad. */
	{
		const pro = res.players.filter((p) => p.nonNcaa && p.stats && p.gameLog)[0];
		const ex = global.Engine.exportFile(res, { stats: true, highs: true });
		const row = ex.players[res.players.indexOf(pro)];
		const BS = global.BBGMStats;
		ok("a prospect abroad gets a complete stats row too",
			pro && Array.isArray(row.stats) && row.stats.length >= 1 &&
			row.stats[row.stats.length - 1].gp === pro.stats.gp &&
			JSON.stringify(Object.keys(row.stats[row.stats.length - 1])) === JSON.stringify(BS.KEYS) &&
			row.stats[row.stats.length - 1].pts > 0 &&
			Array.isArray(row.stats[row.stats.length - 1].ptsMax));
		const gl = res.players.filter((p) => p.newCollege === "NBA G League" && p.gameLog)[0];
		ok("a G League night is forty-eight minutes long, not forty",
			!gl || gl.gameLog.games.every((g) => g.avail >= 48 && g.min <= g.avail));
	}
	/* The college table. */
	{
		const C = global.Colleges;
		ok("UC San Diego is a Division I program",
			C.COLLEGES["UC San Diego"] && C.conferenceOf("UC San Diego") === "Big West");
		ok("Hartford and St. Francis Brooklyn are no longer in the table",
			!C.COLLEGES["Hartford"] && !C.COLLEGES["St. Francis (BKN)"]);
		ok("no program is in the table twice under two names",
			!C.COLLEGES["Nebraska-Omaha"] && !C.COLLEGES["Arkansas-Little Rock"] &&
			!C.COLLEGES["Texas Rio Grande Valley"] &&
			C.canonical("Nebraska-Omaha") === "Omaha" &&
			C.canonical("Arkansas-Little Rock") === "Little Rock" &&
			C.canonical("Texas Rio Grande Valley") === "UT Rio Grande Valley");
		ok("every alias resolves to a program in the table",
			Object.keys(C.ALIASES).every((k) => C.COLLEGES[C.ALIASES[k]]));
		ok("the table is the 364 programs of Division I", C.names.length === 364);
		/* THE SAME CHECK FOR THE BUILD TABLE.

		   js/config.js argues at length that the build pool must stay near
		   13% of the archetype table, because holding the pool fixed while the
		   table grows is how per-class coverage quietly halved once already.
		   The prose then went stale in exactly that way — "the table is 355
		   builds now" against a table of 361 — inside the comment written to
		   prevent it. The program count was asserted against the table and the
		   build count was not, so this is the missing half. */
		{
			const RBt = global.RatingsBuilder;
			const src = require("fs").readFileSync(
				require("path").join(__dirname, "..", "js", "config.js"), "utf8");
			const m = /the table is (\d+) builds today/.exec(src);
			ok("js/config.js states the build table's size",
				!!m && Number(m[1]) === RBt.ARCHETYPES.length,
				(m ? m[1] : "no claim") + " claimed against " +
					RBt.ARCHETYPES.length + " builds");
			const share = global.Config.DEFAULTS.archetypePool / RBt.ARCHETYPES.length;
			ok("the default build pool is still about 13% of the table",
				share >= 0.11 && share <= 0.15,
				(share * 100).toFixed(1) + "% of " + RBt.ARCHETYPES.length);
		}
		ok("the Tim Duncan Award replaced the Karl Malone Award",
			global.Awards.POSITION_AWARDS.some((a) => a.name === "Tim Duncan Award") &&
			!global.Awards.POSITION_AWARDS.some((a) => /Malone/.test(a.name)) &&
			global.Awards.isMajorAward("Tim Duncan Award"));
	}
}

console.log("\nAudit regressions (the second September 2026 pass)");
{
	const C = global.Colleges;
	const T = global.TeamsSim;
	const RB = global.RatingsBuilder;
	/* Realignment used to be half-wired: a moved program kept its old
	   league's schedule, tournament and auto bid while every label said the
	   new one. */
	{
		const res = global.Engine.run(V.realisticClass(2, 70),
			global.Config.make({ seed: "s2", realignmentRate: 1 }));
		const moved = res.realignment || [];
		ok("a realignment moved somebody in this seed", moved.length > 0);
		let confGamesInNewLeague = 0;
		let total = 0;
		for (const m of moved) {
			const t = res.teams[m.school];
			for (const g of t.log) {
				if (!g.conference) continue;
				total++;
				if (res.teams[g.opp].conf === t.conf) confGamesInNewLeague++;
			}
		}
		ok("a moved program plays its conference games in its NEW league",
			total > 0 && confGamesInNewLeague === total);
		const champsByConf = {};
		for (const t of Object.values(res.teams)) {
			if (t && t.confTourneyChamp) champsByConf[t.conf] = (champsByConf[t.conf] || 0) + 1;
		}
		ok("no conference has two tournament champions",
			Object.values(champsByConf).every((n) => n === 1));
		const pools = T.conferencePools(res.teams);
		ok("conferencePools groups by the team's own conference",
			Object.keys(pools).every((c) => pools[c].every((t) => t.conf === c)));
		/* Conference slates scale with the league: a six-team league no
		   longer meets every rival four times. */
		const ivy = pools.Ivy || [];
		ok("an eight-team league plays fourteen conference games",
			ivy.length && ivy.every((t) => t.log.filter((g) => g.conference && g.stage === "reg").length === 14));
		ok("and every team still plays 31",
			Object.values(res.teams).every((t) => !t || !t.log || t.regGames === 31));
		ok("no first-round bracket game pairs two teams from one conference",
			Object.keys(res.tourney.regions).every((r) =>
				res.tourney.regions[r].rounds[0].every((g) => g.a.team.conf !== g.b.team.conf)));
		/* Every conference tournament has an MVP, and he is on the champion. */
		let champs = 0;
		let mvps = 0;
		for (const t of Object.values(res.teams)) {
			if (!t || !t.confTourneyChamp) continue;
			champs++;
			const lb = T.label(t.conf);
			const onClass = res.players.find((p) => (p.awards || []).indexOf(lb + " Tournament MVP") !== -1);
			const onField = res.fieldHonors.find((h) => h.award === lb + " Tournament MVP");
			if ((onClass && onClass.newCollege === t.name) || (onField && onField.school === t.name)) mvps++;
		}
		ok("every conference tournament MVP is on the team that won it", champs > 0 && mvps === champs);
		ok("nobody wins both the Cousy and the West",
			res.players.every((p) => !((p.awards || []).indexOf("Bob Cousy Award") !== -1 &&
				(p.awards || []).indexOf("Jerry West Award") !== -1)));
		ok("the sideline has a Coach of the Year, nationally and in every league",
			res.coachHonors.some((h) => h.award === "AP Coach of the Year") &&
			Object.keys(pools).every((c) => res.coachHonors.some((h) => h.award === T.label(c) + " Coach of the Year")));
		const names = Object.values(res.teams).filter((t) => t && t.coach).map((t) => t.coach.name);
		ok("no two programs share a head coach", new Set(names).size === names.length);
		const ages = Object.values(res.teams).filter((t) => t && t.coach).map((t) => t.coach.age).sort((a, b) => a - b);
		ok("the median head coach is in his late forties or fifties",
			ages[ages.length >> 1] >= 46 && ages[ages.length >> 1] <= 56, String(ages[ages.length >> 1]));
		ok("the G League plays at its own pace, not the college slider's",
			(function () {
				const p = res.players.find((x) => x.newCollege === "NBA G League" && x.proTeam && x.proTeam.log.length);
				if (!p) return true;
				const l = p.proTeam.log;
				const avg = l.reduce((a, g) => a + g.teamPts, 0) / l.length;
				return avg > 95 && l.every((g, i) => !i || l[i - 1].when <= g.when);
			})());
		ok("a prospect abroad carries no fabricated college seasons",
			res.players.filter((p) => p.nonNcaa && !(p.transfer && p.transfer.from && C.COLLEGES[p.transfer.from]))
				.every((p) => !p.priorSeasons));
	}
	/* Three of the twelve storylines wrote `pace: -4` and it was applied
	   as an absolute, so half of all default seasons played at the floor. */
	{
		const D = global.Config.DEFAULTS;
		let floor = 0;
		let n = 0;
		for (let s = 0; s < 12; s++) {
			const res = global.Engine.run(V.realisticClass(s, 40), global.Config.make({ seed: "n" + s }));
			n++;
			if (res.effectiveCfg.pace <= D.pace - 8 || res.effectiveCfg.pace <= 58) floor++;
		}
		ok("a storyline bends pace by a few possessions, never to the floor", floor === 0, floor + "/" + n);
	}
	/* Ratings: the solver lands, the streams hold, the biography gates. */
	{
		const lf = V.realisticClass(4, 70);
		const res = global.Engine.run(lf, global.Config.make({ seed: "b4", buildNoise: 0, ovrMode: "curve" }));
		let misses = 0;
		let tried = 0;
		{
			const cfg0 = Object.assign({}, res.cfg, { buildNoise: 0 });
			const r0 = new Rng("solver");
			for (let i = 0; i < res.players.length; i++) {
				const p = res.players[i];
				const target = 25 + r0.int(0, 40);
				const built = RB.rebuild(r0.child("p" + i), p.origRatings, target, target + 8, cfg0,
					"Balanced", res.flavor, null, res.archetypePool, i);
				if (target < built.ovrRange.min || target > built.ovrRange.max) continue;
				tried++;
				if (built.ovr !== target) misses++;
			}
		}
		ok("the solver hits the target overall at buildNoise 0 on an integer base",
			tried > 30 && misses === 0, misses + "/" + tried);
		ok("a fifth-year senior build is drawn only for seniors",
			res.players.filter((p) => p.archetype === "Fifth-Year Senior")
				.every((p) => /Senior|Graduate/.test(p.classYear)));
		ok("no rating sits on 0 or 100 after a rebuild",
			res.players.every((p) => global.BBGM.RATING_KEYS.every((k) =>
				k === "hgt" || (p.newRatings[k] >= 1 && p.newRatings[k] <= 99))));
		/* Forcing the build a player already has, or pinning one rating,
		   leaves the other ratings exactly where they were. */
		const p0 = res.players[3];
		const rng = () => new Rng("stream");
		const a = RB.rebuild(rng(), p0.origRatings, 45, 55, res.cfg, null, res.flavor, null, res.archetypePool, 3);
		const b = RB.rebuild(rng(), p0.origRatings, 45, 55, res.cfg, a.archetype, res.flavor, null, res.archetypePool, 3);
		ok("forcing the build a player drew changes nothing else",
			global.BBGM.RATING_KEYS.every((k) => a.base[k] === b.base[k]));
		const cfgN = Object.assign({}, res.cfg, { buildNoise: 5 });
		const c = RB.rebuild(rng(), p0.origRatings, 45, 55, cfgN, a.archetype, res.flavor, null, res.archetypePool, 3);
		const d = RB.rebuild(rng(), p0.origRatings, 45, 55, cfgN, a.archetype, res.flavor, { tp: 70 }, res.archetypePool, 3);
		ok("pinning one rating does not re-jitter the others",
			global.BBGM.RATING_KEYS.every((k) => k === "tp" || c.base[k] === d.base[k]));
		ok("the potential gap falls with class year for a file whose ages carry no information",
			(function () {
				const gap = (cy) => {
					const rows = res.players.filter((p) => !p.nonNcaa && p.classYear === cy);
					return rows.length ? rows.reduce((s, p) => s + (p.newPot - p.newOvr), 0) / rows.length : null;
				};
				const f = gap("Freshman");
				const s = gap("Senior");
				return f === null || s === null || f > s + 2;
			})());
		ok("no trait contradicts its build's own offsets",
			res.players.every((p) => (p.traits || []).every((t) => global.Traits.matches
				? global.Traits.matches(t, p) : true)));
		ok("the money mood letter can be earned",
			global.Traits.TRAITS.some((t) => t.mood === "$"));
	}
	/* The 2027-28 map. The table used to be authored half to 2026-27 and half
	   to the season before it, which is how UC Davis sat in the Big West while
	   UTEP and Grand Canyon had already moved; one target season, checked. */
	{
		ok("the Mountain West has its 2027 members", C.byConference["Mountain West"].length === 10 &&
			C.conferenceOf("Grand Canyon") === "Mountain West" && C.conferenceOf("UTEP") === "Mountain West" &&
			C.conferenceOf("UC Davis") === "Mountain West");
		ok("Louisiana Tech is in the Sun Belt, New Haven in the NEC",
			C.conferenceOf("Louisiana Tech") === "Sun Belt" &&
			C.conferenceOf("New Haven") === "NEC" &&
			C.conferenceOf("St. Francis (PA)") === null);
		ok("Seattle is in the WCC, Delaware in Conference USA, UMass in the MAC",
			C.conferenceOf("Seattle") === "WCC" && C.conferenceOf("Delaware") === "Conference USA" &&
			C.conferenceOf("Massachusetts") === "MAC");
		/* The July 1, 2026 moves the 2027-28 table had missed. */
		ok("Hawaii is Mountain West, Northern Illinois Horizon, Sacramento State Big West",
			C.conferenceOf("Hawaii") === "Mountain West" &&
			C.conferenceOf("Northern Illinois") === "Horizon" &&
			C.conferenceOf("Sacramento State") === "Big West");
		ok("the WAC is the UAC, with its 2026 membership",
			!C.CONFERENCES.WAC && !!C.CONFERENCES.UAC && !C.byConference.WAC &&
			C.canonicalConference("WAC") === "UAC" &&
			["Abilene Christian", "Tarleton State", "Texas-Arlington", "Austin Peay",
				"Eastern Kentucky", "North Alabama", "West Georgia", "Central Arkansas"]
				.every((n) => C.conferenceOf(n) === "UAC") &&
			C.byConference.UAC.length === 8 &&
			C.conferenceOf("California Baptist") === "Big West" &&
			C.conferenceOf("Utah Valley") === "Big West" &&
			C.conferenceOf("Southern Utah") === "Big Sky" &&
			C.conferenceOf("Utah Tech") === "Big Sky" &&
			C.byConference.ASUN.length === 7);
		ok("the schools' own spellings resolve",
			C.canonical("Saint Peter's") === "St. Peter's" &&
			C.canonical("Detroit") === "Detroit Mercy" &&
			C.canonical("Miami (Ohio)") === "Miami (OH)" &&
			C.canonical("Miami (OH)") === "Miami (OH)" &&
			C.canonical("Hawai'i") === "Hawaii");
		ok("every conference is schedulable", Object.keys(C.byConference)
			.filter((c) => c !== "Independent").every((c) => C.byConference[c].length >= 7));
		ok("Houston Baptist resolves to its current name", C.canonical("Houston Baptist") === "Houston Christian");
		ok("no club is in two continental competitions", (function () {
			const seen = {};
			for (const lg of ["EuroLeague", "EuroCup", "Basketball Champions League"]) {
				for (const [name] of C.PRO_CLUBS[lg] || []) {
					if (seen[name]) return false;
					seen[name] = lg;
				}
			}
			return true;
		})());
	}
}

console.log("\nExport: stats rows, the class's own year, the envelope and the merge");
{
	const S = global.Sample;
	const opts = { stats: true, prior: true, awards: true, injuries: true, highs: true };
	/* Stats rows used to concatenate on every round trip: 2, 4, 6 per
	   player on three exports, while the awards block beside them was
	   guarded. Same invariant as the awards: the file holds what the last
	   run produced. */
	{
		let lf = S.makeClass(3, 30, 2027);
		const counts = [];
		let jerseys = true;
		for (let i = 0; i < 3; i++) {
			lf.startingSeason = global.Engine.validateLeagueFile(lf).season;
			const res = global.Engine.run(lf, global.Config.make({ seed: "rt" }));
			const out = global.Engine.exportFile(res, opts);
			counts.push(Math.max.apply(null, out.players.map((p) => (p.stats || []).length)));
			for (const p of out.players) {
				for (const r of p.stats || []) {
					if (String(r.jerseyNumber) !== String(p.jerseyNumber)) jerseys = false;
				}
			}
			lf = JSON.parse(JSON.stringify(out));
		}
		ok("three round trips do not accumulate stats rows",
			counts[0] === counts[1] && counts[1] === counts[2], counts.join(" -> "));
		ok("a stats row carries the player's own jersey number", jerseys);
		ok("the sample class is shaped like a BBGM export",
			lf.players.every((p) => p.tid === -2 && p.draft.round === 0 &&
				Number.isFinite(p.ratings[0].season)));
	}
	/* A class BBGM exported while the league sat a year earlier. */
	{
		const lf = S.makeClass(5, 30, 2027);
		lf.startingSeason = 2026;
		const chk = global.Engine.validateLeagueFile(lf);
		ok("a file whose players disagree with its startingSeason is warned about",
			chk.season === 2026 && chk.warnings.some((w) => /draft year/.test(w)), String(chk.season));
	}
	/* A class pulled out of a league export goes back out as a class. */
	{
		const lf = S.makeClass(6, 20, 2027);
		lf.teams = [{ tid: 0 }];
		lf.gameAttributes = { season: 2027 };
		lf.startingSeason = global.Engine.validateLeagueFile(lf).season;
		const res = global.Engine.run(lf, global.Config.make({ seed: "z" }));
		const out = global.Engine.exportFile(res, opts);
		ok("the class export drops a league envelope",
			out.teams === undefined && out.gameAttributes === undefined &&
			out.players.length === 20);
		/* The merge: a pid match with a different name is a different man,
		   the league's own honors outside the tool's window survive, and an
		   appended prospect is an undrafted one. */
		const league = {
			startingSeason: 2027, gameAttributes: { season: 2027 },
			players: [
				{ pid: 0, tid: -2, firstName: "Somebody", lastName: "Else",
					draft: { year: 2027 }, ratings: [{}] },
				Object.assign(JSON.parse(JSON.stringify(lf.players[1])), {
					awards: [{ season: 2019, type: "HS All-American" }] }),
			],
		};
		const m = global.Engine.mergeIntoLeague(res, league, opts);
		const kept = m.file.players.find((p) => p.lastName === lf.players[1].lastName &&
			p.firstName === lf.players[1].firstName);
		ok("a pid shared with a different name is not an identity", m.replaced === 1 && m.added === 19);
		ok("the league's own earlier honors survive the overlay",
			kept && kept.awards.some((a) => a.type === "HS All-American"));
		ok("an appended prospect is an undrafted one",
			m.file.players.filter((p) => p.tid === -2)
				.every((p) => p.draft.round === 0 && p.draft.tid === -1));
		ok("no warning when the league is on the class's year", !m.warnings.length);
		/* Two class rows on one pid (which validateLeagueFile tolerates)
		   both matched the same league prospect, and the second replacement
		   overwrote the first: one player gone, past a guard that only
		   counted the league's side. */
		const dup = JSON.parse(JSON.stringify(lf));
		dup.players[2].pid = dup.players[1].pid;
		const resDup = global.Engine.run(dup, global.Config.make({ seed: "z" }));
		const leagueDup = {
			startingSeason: 2027, gameAttributes: { season: 2027 },
			players: dup.players.map((p) => Object.assign(JSON.parse(JSON.stringify(p)), { tid: -2 })),
		};
		const md = global.Engine.mergeIntoLeague(resDup, leagueDup, opts);
		ok("a class with two rows on one pid loses neither in the merge",
			md.file.players.length === 20 && md.replaced === 19 && md.added === 1,
			md.file.players.length + " players, " + md.replaced + " replaced, " + md.added + " added");
		const late = Object.assign({}, league, { gameAttributes: { season: 2030 }, startingSeason: 2030 });
		ok("a league past the class's draft is warned about",
			global.Engine.mergeIntoLeague(res, late, opts).warnings.length === 1);
	}
	{
		const bad = S.makeClass(1, 5, 2027);
		bad.players[0].born.year = 2031;
		let threw = false;
		try { global.Engine.validateLeagueFile(bad); } catch (e) { threw = true; }
		ok("a birth year after the season is refused", threw);
		const old = S.makeClass(1, 5, 2027);
		for (const p of old.players) p.born.year = 1990;
		ok("an implausible age is warned about",
			global.Engine.validateLeagueFile(old).warnings.some((w) => /older than 30/.test(w)));
		/* AND A LEAGUE'S ROSTERED VETERANS ARE NOT.

		   The warning says "at their own draft year", and the reference year
		   only WAS the player's own draft year when that year was later than
		   the file's season — so everybody already drafted was measured
		   against the league's current season instead, and a thirty-four-year-
		   old who was nineteen at his draft came back as an implausible age.
		   A real league export opened on a warning about a couple of hundred
		   perfectly ordinary rows. */
		const league = S.makeClass(2, 8, 2027);
		league.teams = [{ tid: 0, region: "R", name: "N" }];
		league.players.forEach((p, i) => {
			// Eight to fifteen years into a career, so measured against the
			// league's season every one of them is past thirty, and measured
			// against his own draft — which is what the warning claims — every
			// one of them is a perfectly ordinary twenty.
			const yearsIn = i + 8;
			p.tid = 0;
			p.draft.year = 2027 - yearsIn;
			p.born.year = p.draft.year - 20;
		});
		const lv = global.Engine.validateLeagueFile(league);
		ok("a league's rostered veterans are aged from their own draft year",
			!lv.warnings.some((w) => /older than 30/.test(w)),
			lv.warnings.filter((w) => /older than 30/.test(w)).join(" "));
	}
}

/* ------------------------------------------------------- the area suites */
/* One file per area, each exporting `(ok, V)`. This file had grown past four
   thousand lines and every audit pass added to the same end of it, which is
   also how two passes writing at once conflict on a file neither of them is
   really editing. A new area's checks go in tools/tests/<area>.js and are
   picked up here by being on disk. */
if (!SKIP_AREAS) {
	const dir = path.join(__dirname, "tests");
	const files = fs.existsSync(dir)
		? fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort()
		: [];
	for (const f of files) {
		console.log("\n" + f.replace(/\.js$/, "") + " (tools/tests/" + f + ")");
		try {
			require(path.join(dir, f))(ok, V);
		} catch (e) {
			ok("tools/tests/" + f + " runs", false, e && e.stack ? e.stack : String(e));
		}
	}
}

console.log("\n" + (failures ? failures + " of " + checks + " checks failed"
	: "all " + checks + " checks passed"));
process.exit(failures ? 1 : 0);
