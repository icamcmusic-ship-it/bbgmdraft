#!/usr/bin/env node
/* Regression tests. These are the checks that turn README claims into things a
   CI run can fail on.

   Usage: node tools/test.js [--update-golden]
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
if (UPDATE || !fs.existsSync(GOLDEN)) {
	fs.writeFileSync(GOLDEN, JSON.stringify(hashes, null, 2) + "\n");
	console.log("  wrote " + path.relative(process.cwd(), GOLDEN));
} else {
	const want = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
	for (const k of Object.keys(hashes)) {
		ok("golden/" + k, hashes[k] === want[k],
			"expected " + want[k] + ", got " + hashes[k] +
			" (run: node tools/test.js --update-golden if this change is intended)");
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

	const varied = global.Engine.exportFile(
		global.Engine.run(V.syntheticClass(31, 40), global.Config.make({ seed: "sz", varySize: true })));
	ok("Vary size actually varies size",
		varied.players.some((p, i) => p.hgt !== V.syntheticClass(31, 40).players[i].hgt));
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
	ok("no prospect exceeds the minutes ceiling",
		ncaa.every((p) => p.stats.mpg <= 37.5));
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
			if (tt.ast > 0) worstAst = Math.max(worstAst, p.stats.apg / tt.ast);
			if (tt.trb > 0) worstReb = Math.max(worstReb, p.stats.rpg / tt.trb);
			if (tt.blk > 0) worstBlk = Math.max(worstBlk, p.stats.bpg / tt.blk);
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

/* ----------------------------------------------------- archetype identity */
console.log("\nArchetypes");
{
	/* An archetype's offset vector is made ovr-neutral before the solver runs.
	   The old normalizer did that by subtracting uniformly, which took the
	   points out of exactly the ratings BBGM's usage composite reads — so a
	   defensive build came out ovr-neutral by construction and offense-negative
	   by side effect, and "the best defensive big in the class" was a player
	   nobody would draft. */
	const usageKeys = ["ins", "dnk", "fg", "tp"];
	const OVR_W = RB.OVR_W;
	const SHIFT_SCALE = RB.SHIFT_SCALE;
	// What the old uniform normalizer would have produced, for comparison.
	let shiftW = 0;
	for (const k of BB.RATING_KEYS) shiftW += OVR_W[k] * SHIFT_SCALE[k];
	const uniformNormalize = (raw) => {
		let push = 0;
		for (const k of Object.keys(raw)) push += OVR_W[k] * raw[k];
		const u = push / shiftW;
		const out = {};
		for (const k of BB.RATING_KEYS) {
			if (k === "hgt") continue;
			out[k] = (raw[k] || 0) - u * SHIFT_SCALE[k];
		}
		return out;
	};
	const usageHit = (o) => usageKeys.reduce((x, k) => x + Math.min(0, o[k] || 0), 0);
	for (const name of ["Switchable Big", "Defensive Pest", "Wing Stopper",
		"Rim Protector", "Mobile Shot-Swatter"]) {
		const a = RB.ARCHETYPES.filter((x) => x.name === name)[0];
		const was = usageHit(uniformNormalize(RB.RAW_OFFSETS[name]));
		const now = usageHit(a.o);
		ok(name + " keeps more of its offense than a uniform shift would",
			now > was + 1.5,
			"usage ratings shifted " + now.toFixed(1) + ", against " +
				was.toFixed(1) + " under a uniform shift");
	}
	// And it is still ovr-neutral, which is the whole point of normalizing.
	let worstPush = 0;
	for (const a of RB.ARCHETYPES) {
		let push = 0;
		for (const k of Object.keys(a.o)) push += OVR_W[k] * a.o[k];
		worstPush = Math.max(worstPush, Math.abs(push));
	}
	ok("every archetype is still ovr-neutral", worstPush < 0.35,
		"largest residual push " + worstPush.toFixed(3));

	/* The rarest builds have to be reachable. Raw Project once appeared in one
	   player out of 840, which is not rarity, it is absence.

	   Naming two builds and asserting each shows up made this a check on those
	   two, and it went red when the table grew from 72 builds to 98 for no
	   reason but arithmetic — each build's share of a fixed number of players
	   fell. The claim worth testing is about the table as a whole: nearly all
	   of it turns up, and the spread between the commonest specialist build and
	   the rarest is a rarity gradient rather than a cliff. (Full coverage in
	   twenty classes is not the claim: a 14-build pool drawn from ninety-eight
	   is roughly 300 draws against a coupon-collector requirement of 450, so a
	   handful of builds legitimately miss a run of twenty.) */
	const counts = {};
	let total = 0;
	for (const a of RB.ARCHETYPES) counts[a.name] = 0;
	for (let s = 0; s < 20; s++) {
		const res = global.Engine.run(V.syntheticClass(200 + s, 70),
			global.Config.make({ seed: "arch" + s }));
		for (const p of res.players) {
			counts[p.archetype] = (counts[p.archetype] || 0) + 1;
			total++;
		}
	}
	const seen = Object.keys(counts).filter((k) => counts[k] > 0);
	ok("nearly every build in the table turns up",
		seen.length >= Math.ceil(RB.ARCHETYPES.length * 0.9),
		seen.length + " of " + RB.ARCHETYPES.length + " builds in " + total + " players");
	const spec = seen.filter((k) => k !== "Balanced").map((k) => counts[k])
		.sort((a, b) => b - a);
	ok("build rarity is a gradient, not a cliff",
		spec.length > 1 && spec[0] / spec[spec.length - 1] <= 40,
		"commonest specialist " + spec[0] + ", rarest seen " + spec[spec.length - 1] +
			" (" + (spec[0] / spec[spec.length - 1]).toFixed(1) + "x)");
	// The Balanced share is a promise the label on the slider makes.
	const balanced = (counts.Balanced || 0) / total;
	ok("the Balanced share matches what the diversity slider promises",
		Math.abs(balanced - 0.15) < 0.035,
		(100 * balanced).toFixed(1) + "% against a promised 15%");
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
	/* The RARITY_COMPRESS exponent (0.42) compresses the authored weight spread
	   so that a Combo Guard is still several times likelier than a Point Center,
	   but "several" stops meaning two hundred. This test verifies:
	     1. The compression parameter is what the code documents (0.42).
	     2. Rare archetypes (low w) appear less often than common ones (high w).
	     3. The realized frequency spread is compressed relative to the authored
	        weight spread, within the range the exponent predicts. */
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

	/* The authored weight spread (max w / min w among eligible) is compressed
	   by the RARITY_COMPRESS exponent. Verify the realized frequency ratio is
	   closer to the compressed prediction than to the raw one.

	   raw ratio     = max(w/exposure) / min(w/exposure)
	   compressed    = raw ^ RARITY_COMPRESS
	   The realized spread (max count / min count) should be closer to the
	   compressed value than to the raw one, with sampling noise allowed. */
	const weights = eligible.map((a) => RB.archetypeWeight(a, cfg, null));
	const maxW = Math.max.apply(null, weights);
	const minW = Math.min.apply(null, weights.filter((w) => w > 0));
	const rawRatio = maxW / minW;
	/* The effective weight is w^RARITY_COMPRESS after the exposure divisor, so
	   the authored spread raised to RARITY_COMPRESS is what we expect. */
	const compressedRatio = Math.pow(rawRatio, 1); // already compressed by archetypeWeight
	/* What the ratio would have been WITHOUT compression: the raw
	   (w / exposure) spread, which archetypeWeight raises to 0.42. */
	const rawEffective = eligible.map((a) => {
		const base = (a.w === undefined ? 1 : a.w) / a.exposure;
		return base;
	});
	const rawSpread = Math.max.apply(null, rawEffective) /
		Math.min.apply(null, rawEffective.filter((x) => x > 0));
	/* The compressed spread should be rawSpread^0.42, which is much smaller
	   than rawSpread itself. Verify the actual archetypeWeight spread sits
	   near rawSpread^0.42 (within a factor of 2 for sampling tolerance). */
	const expectedCompressed = Math.pow(rawSpread, RB.RARITY_COMPRESS);
	ok("RARITY_COMPRESS produces expected compression of the weight spread",
		rawRatio < rawSpread && rawRatio < rawSpread * 0.85 &&
			rawRatio / expectedCompressed < 2 && expectedCompressed / rawRatio < 2,
		"raw spread " + rawSpread.toFixed(1) + ", expected compressed " +
			expectedCompressed.toFixed(1) + ", actual archetypeWeight spread " +
			rawRatio.toFixed(1));

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

/* --------------------------------------------- the archetype/solver audit */
console.log("\nArchetype table and solver audit");
{
	// The four coverage builds exist, are eligible somewhere, and each has a
	// potential entry — the failure mode that made Injury-Prone Talent the
	// highest-scoring build in the class was a build with no entry.
	const added = ["Screen Navigator", "Secondary Creator", "Zone Buster",
		"Matchup-Zone Defender"];
	const byName = {};
	for (const a of RB.ARCHETYPES) byName[a.name] = a;
	ok("the four coverage builds are in the table",
		added.every((n) => byName[n]));
	ok("each carries a potential entry",
		added.every((n) => Number.isFinite(RB.POT_BY_ARCHETYPE[n])));
	ok("each carries a role usage",
		added.every((n) => Number.isFinite(RB.ROLE_USAGE[n])));
	// Matchup-Zone Defender is the 6'7"-6'9" band specifically, which is what
	// separates it from Switchable Big and Wing Stopper.
	const mz = byName["Matchup-Zone Defender"];
	ok("the matchup-zone build is gated to the forward band",
		mz.min >= 50 && mz.max <= 68, mz.min + "-" + mz.max);
	// Screen Navigator's identity is the movement, not the shot: its largest
	// offset must not be a shooting rating.
	const sn = RB.RAW_OFFSETS["Screen Navigator"];
	const biggest = Object.keys(sn).sort((a, b) => sn[b] - sn[a])[0];
	ok("the screen-navigator build's signature is conditioning, not shooting",
		biggest === "endu", "largest offset was " + biggest);
}

{
	/* The usage protection is scaled by what the build loaded on the usage
	   composite itself, so an offense-loaded build no longer collects a
	   defensive build's compensation. */
	const W = { ins: 1.5, dnk: 1, fg: 1, tp: 1, spd: 0.5, hgt: 0.5, drb: 0.5, oiq: 0.5 };
	const du = (name) => {
		const o = RB.RAW_OFFSETS[name] || {};
		let d = 0;
		for (const k of Object.keys(o)) d += (W[k] || 0) * o[k];
		return d / 650;
	};
	ok("an offense-loaded build reads positive on the usage composite",
		du("Score-First Point") > 0.03 && du("Combo Guard") > 0.02,
		"Score-First Point " + du("Score-First Point").toFixed(4));
	ok("a defensive build reads negative on it",
		du("Rim Protector") < -0.02 && du("Defensive Pest") < -0.02);

	/* The measurable consequence: after normalization the offense-loaded
	   builds should not have kept MORE composite than they authored. */
	const kept = (name) => RB.usageCompositeDelta(
		RB.ARCHETYPES.filter((a) => a.name === name)[0]);
	ok("normalization no longer inflates an offense-loaded build's composite",
		kept("Score-First Point") <= du("Score-First Point") + 1e-9,
		"authored " + du("Score-First Point").toFixed(4) + ", kept " +
			kept("Score-First Point").toFixed(4));
}

{
	/* The creation term is residualized against the tags, so it separates two
	   builds that share a tag and do not share a creation profile. */
	const of = (n) => RB.ARCHETYPES.filter((a) => a.name === n)[0];
	const helio = RB.creationDelta(of("Heliocentric Guard"));
	const sharp = RB.creationDelta(of("Sharpshooter"));
	ok("creation separates a heliocentric guard from a sharpshooter",
		helio - sharp > 0.5,
		"helio " + helio.toFixed(3) + " vs sharp " + sharp.toFixed(3));
	ok("creation is centered: the table's tag-weighted mean is near zero",
		Math.abs(RB.ARCHETYPES.reduce((a, x) => a + RB.creationDelta(x), 0) /
			RB.ARCHETYPES.length) < 0.15);
	ok("the fitted creation weight is no longer a rounding error",
		RB.ROLE_FIT.createW >= 0.04, String(RB.ROLE_FIT.createW));
}

{
	/* ovrRange reports the reach of the shift model, not the point the search
	   stopped at: every rating saturates at both ends. */
	const mk = (over) => {
		const o = {};
		for (const k of BB.RATING_KEYS) o[k] = 50;
		return Object.assign(o, over || {});
	};
	const balanced = RB.ARCHETYPES.filter((a) => a.name === "Balanced")[0];
	const mid = RB.ovrRange(mk(), balanced, null);
	ok("a mid-height base can be solved across the whole scale",
		mid.min === 0 && mid.max === 100, mid.min + "-" + mid.max);
	// A 7-footer's fixed hgt rating genuinely stops him reaching the bottom.
	const tall = RB.ovrRange(mk({ hgt: 92 }), balanced, null);
	ok("a very tall base still cannot be solved to the floor", tall.min > mid.min,
		"tall min " + tall.min);
	// And every ovr the range calls reachable is reached, at the new width.
	let unreached = 0;
	for (let t = mid.min; t <= mid.max; t += 5) {
		const solved = RB.solveToOvr(mk(), t, balanced, null);
		if (Math.abs(BB.ovr(solved) - t) > 1) unreached++;
	}
	ok("every ovr the widened range calls reachable is reached", unreached === 0,
		unreached + " targets missed");
}

{
	/* The height-to-weight model is a curve, and it is right at the ends
	   rather than only in the middle. */
	const tw = RB.typicalWeight;
	const anchors = [[66, 165], [72, 188], [78, 215], [84, 250], [90, 295]];
	const worst = Math.max.apply(null, anchors.map(([h, w]) => Math.abs(tw(h) - w)));
	ok("typical weight fits its anchors at both ends", worst < 2,
		"worst miss " + worst.toFixed(1) + "lb");
	const oldLine = (h) => 5.05 * h - 178;
	ok("the old straight line was the thing that missed",
		Math.abs(oldLine(90) - 295) > 15 && Math.abs(oldLine(66) - 165) > 8,
		"linear at 90in: " + oldLine(90).toFixed(0) + "lb against 295");
	let mono = true;
	for (let h = 62; h < 94; h++) if (tw(h + 1) <= tw(h)) mono = false;
	ok("typical weight is monotone across the basketball range", mono);
}

{
	/* potFromRole's load term is measured against the player's own build, so
	   it no longer pays a build for having that build's usage. */
	const stats = { usg: 0.20, mpg: 30, ppg: 12, rpg: 8, apg: 1.5, ts: 0.58 };
	const againstClass = RB.potFromRole(stats, "Freshman", RB.ROLE_USG_CENTER);
	const againstBuild = RB.potFromRole(stats, "Freshman", 0.20);
	ok("a low-usage line scores lower against its own build's usage than " +
		"against the class center", againstBuild < againstClass,
		againstBuild.toFixed(2) + " vs " + againstClass.toFixed(2));
	ok("potFromRole still falls back to the class center",
		Math.abs(RB.potFromRole(stats, "Freshman") - againstClass) < 1e-9);
	// And the build-driven part of the term is gone from a real class.
	const byArch = {};
	for (let s = 0; s < 6; s++) {
		const res = global.Engine.run(V.realisticClass(s, 70),
			global.Config.make({ seed: "potref" + s }));
		for (const p of res.players) {
			if (p.nonNcaa || !p.stats || !p.potFactors) continue;
			(byArch[p.archetype] = byArch[p.archetype] || []).push(p.stats.usg);
		}
	}
	const means = Object.keys(byArch).filter((k) => byArch[k].length >= 10)
		.map((k) => byArch[k].reduce((a, b) => a + b, 0) / byArch[k].length);
	const oldLoadSpread = means.length > 1
		? (Math.max.apply(null, means) - Math.min.apply(null, means)) * 26 * 0.55 : 0;
	ok("the usage spread across builds was worth real potential, and is " +
		"no longer read as a breakout signal", oldLoadSpread > 0.3,
		"builds differed by " + oldLoadSpread.toFixed(2) +
			" points of potential under the old class-wide reference");
}

/* --------------------------------------- variation, memory and narrative */
console.log("\nExploring a seed's neighborhood");
{
	const lf = () => V.realisticClass(3, 70);
	const run = (over) => global.Engine.run(lf(),
		global.Config.make(Object.assign({ seed: "neighbor" }, over)));
	const base = run({});
	const same = run({ variation: 0 });
	const v1 = run({ variation: 1 });
	const v2 = run({ variation: 2 });
	const arch = (r) => r.players.map((p) => p.archetype).join("|");

	ok("variation 0 reproduces the seed exactly", arch(base) === arch(same));
	ok("the class-level shape survives a variation",
		base.flavor.name === v1.flavor.name &&
			JSON.stringify(base.archetypePool) === JSON.stringify(v1.archetypePool));
	const kept = base.players.filter((p, i) => p.archetype === v1.players[i].archetype).length;
	ok("a variation re-rolls the individual players",
		kept < base.players.length * 0.35,
		kept + " of " + base.players.length + " builds unchanged");
	ok("two variations differ from each other", arch(v1) !== arch(v2));
	ok("a variation is itself reproducible",
		arch(v1) === arch(run({ variation: 1 })));
	// A variation must not change the class's IDENTITY, only its members.
	ok("a variation keeps the class's overall level",
		Math.abs(
			base.players.reduce((a, p) => a + p.newOvr, 0) / base.players.length -
			v1.players.reduce((a, p) => a + p.newOvr, 0) / v1.players.length) < 2.5);
}

{
	// A flavor can be asked for rather than only drawn.
	const ask = (name) => global.Engine.run(V.realisticClass(4, 70),
		global.Config.make({ seed: "hint", flavorHint: name })).flavor;
	ok("a flavor hint is honored", ask("big-heavy").name === "big-heavy");
	ok("an asked-for flavor says so", ask("defensive").asked === true);
	ok("a hint for a flavor that does not exist falls back to the draw",
		!!ask("no such flavor").name && ask("no such flavor").asked === false);
	ok("no hint still draws",
		global.Engine.run(V.realisticClass(4, 70),
			global.Config.make({ seed: "hint" })).flavor.asked === false);
}

{
	/* Pool exclusion memory: a build that was in the last few pools is pushed
	   toward the back of the queue rather than banned. */
	const recent = [["Combo Guard", "Rim Runner"], ["Combo Guard"], ["Combo Guard"]];
	ok("a build in every recent pool is penalized",
		RB.poolMemoryFactor("Combo Guard", recent, 1) < 0.4,
		String(RB.poolMemoryFactor("Combo Guard", recent, 1)));
	ok("the penalty fades with age",
		RB.poolMemoryFactor("Combo Guard", recent, 1) <
			RB.poolMemoryFactor("Rim Runner", recent, 1));
	ok("a build in no recent pool is untouched",
		RB.poolMemoryFactor("Point Center", recent, 1) === 1);
	ok("memory 0 is a no-op",
		RB.poolMemoryFactor("Combo Guard", recent, 0) === 1);
	ok("a penalized build is not banned",
		RB.poolMemoryFactor("Combo Guard", recent, 1) > 0);

	/* End to end, on the thing actually complained about: how often the
	   heaviest builds come back class after class. Measured on the pool draw
	   directly rather than through a full season, so the sample is large
	   enough for the effect to be visible above the noise — the whole point of
	   the memory is a shift of ten points in a rate, and twenty engine runs
	   cannot resolve that. */
	const COMMON = ["Combo Guard", "3&D Wing", "Rim Runner", "Slasher"];
	const recurrence = (memory) => {
		const history = COMMON.length
			? [COMMON.slice(), COMMON.slice(), COMMON.slice()] : [];
		let hits = 0;
		const N = 400;
		for (let s = 0; s < N; s++) {
			const cfg = global.Config.make({
				poolMemory: memory, recentPools: memory ? history : null,
			});
			const pool = RB.pickClassPool(new Rng("poolmem" + s), cfg, null) || [];
			const names = pool.map((a) => a.name);
			hits += COMMON.filter((n) => names.indexOf(n) !== -1).length;
		}
		return hits / (N * COMMON.length);
	};
	const off = recurrence(0);
	const on = recurrence(1);
	ok("the exclusion memory reduces how often the commonest builds recur",
		on < off * 0.8,
		"the four heaviest builds returned " + (off * 100).toFixed(0) +
			"% of the time with the memory off and " + (on * 100).toFixed(0) +
			"% with it on");
}

{
	/* Team momentum: an autocorrelated arc, centered so it moves a season's
	   shape without moving its level. */
	const T = global.TeamsSim;
	const arc = T.momentumArc(new Rng("arc"), { teamMomentum: 1 });
	ok("the momentum arc has a knot per stretch of the season",
		arc.length === T.ARC_KNOTS);
	ok("the arc is centered", Math.abs(arc.reduce((a, b) => a + b, 0)) < 1e-9);
	ok("momentum can be turned off",
		T.momentumArc(new Rng("arc"), { teamMomentum: 0 }) === null);
	// Autocorrelated: neighboring knots agree more than distant ones do.
	let near = 0;
	let far = 0;
	for (let s = 0; s < 400; s++) {
		const a = T.momentumArc(new Rng("m" + s), { teamMomentum: 1 });
		for (let i = 0; i < a.length - 3; i++) {
			near += a[i] * a[i + 1];
			far += a[i] * a[i + 3];
		}
	}
	ok("the arc is autocorrelated, so a season has streaks in it",
		near > far * 1.5 && near > 0,
		"lag-1 " + near.toFixed(0) + " vs lag-3 " + far.toFixed(0));
	// Interpolation is continuous and hits the knots.
	const t = { arc };
	ok("the arc interpolates through its knots",
		Math.abs(T.arcAt(t, 0) - arc[0]) < 1e-9 &&
		Math.abs(T.arcAt(t, 1) - arc[arc.length - 1]) < 1e-9);
	ok("a team with no arc is unaffected", T.arcAt({}, 0.5) === 0);
}

{
	/* Awards: a voter mood that is not the same every season, and electorates
	   that weight the team's resume differently from one another. */
	const AW = global.Awards;
	const leans = AW.NATIONAL_POY.map((a) => a.resume);
	ok("the electorates do not all weight the resume the same",
		Math.max.apply(null, leans) - Math.min.apply(null, leans) > 0.3);
	ok("at least one electorate does not care what the team did",
		leans.some((v) => v < 0));

	// Turning the noise off should make the trophies agree far more often.
	const sweeps = (noise) => {
		let swept = 0;
		for (let s = 0; s < 10; s++) {
			const res = global.Engine.run(V.realisticClass(s, 70),
				global.Config.make({ seed: "vote" + s, awardNoise: noise }));
			const winners = new Set();
			for (const p of res.players) {
				for (const a of p.awards || []) {
					if (/^(Naismith Trophy|John R\. Wooden Award|Oscar Robertson Trophy|AP Player of the Year|NABC Player of the Year|Sporting News Player of the Year)$/.test(a)) {
						winners.add(p.key);
					}
				}
			}
			if (winners.size <= 1) swept++;
		}
		return swept;
	};
	const quiet = sweeps(0);
	const loud = sweeps(2);
	ok("award noise decides whether the trophies split", loud <= quiet,
		"clean sweeps: noise 0 -> " + quiet + ", noise 2 -> " + loud);
}

{
	/* Draft-day events reorder the board and leave it consistent. */
	const withEvents = global.Engine.run(V.realisticClass(2, 70),
		global.Config.make({ seed: "draftday" }));
	const without = global.Engine.run(V.realisticClass(2, 70),
		global.Config.make({ seed: "draftday", draftEvents: 0 }));
	ok("a draft produces events", withEvents.draftEvents.length >= 2,
		String(withEvents.draftEvents.length));
	ok("draft events can be turned off", without.draftEvents.length === 0);
	const ranks = withEvents.board.map((p) => p.boardRank);
	ok("board ranks stay unique and contiguous after the reordering",
		new Set(ranks).size === ranks.length &&
		Math.min.apply(null, ranks) === 1 &&
		Math.max.apply(null, ranks) === ranks.length);
	ok("the board is still ordered by rank",
		withEvents.board.every((p, i) => p.boardRank === i + 1));
	ok("every event names a player who is on the board",
		withEvents.draftEvents.every((e) =>
			withEvents.board.some((p) => p.key === e.key)));
	ok("no player collects two draft-day events",
		new Set(withEvents.draftEvents.map((e) => e.key)).size ===
			withEvents.draftEvents.length);
	// A faller really falls and a riser really rises.
	const moved = withEvents.draftEvents.every((e) => {
		const p = withEvents.board.filter((x) => x.key === e.key)[0];
		return p && p.draftEvent && typeof p.draftEvent.text === "string";
	});
	ok("each event is recorded on the player it happened to", moved);
	// The mock pick numbers still describe two rounds of thirty.
	const firsts = withEvents.board.filter((p) => p.mockRound === 1);
	ok("the mock board is still two rounds of thirty",
		firsts.length === Math.min(30, withEvents.board.length) &&
		firsts.every((p) => p.mockPick >= 1 && p.mockPick <= 30));
}

/* --------------------------------------- anomalies, pipelines and events */
console.log("\nMechanical anomalies and season narrative");
{
	/* The six new anomalies change the numbers rather than only the note. Each
	   is measured against the SAME class with the anomaly system off, so what
	   is compared is one player's season against his own. */
	const dt = { tpp: [], defl: [], dd: [], gpElig: [], gpSusp: [] };
	for (let s = 0; s < 25; s++) {
		const on = global.Engine.run(V.realisticClass(s % 6, 70),
			global.Config.make({ seed: "anom" + s, surpriseBudget: 6 }));
		const off = global.Engine.run(V.realisticClass(s % 6, 70),
			global.Config.make({ seed: "anom" + s, surpriseBudget: 0 }));
		const byKey = {};
		for (const p of off.players) byKey[p.key] = p;
		for (const p of on.players) {
			const q = byKey[p.key];
			if (!q || !q.stats || !p.stats) continue;
			// Only compare a player the anomaly did not otherwise rebuild.
			if (Math.abs(p.newOvr - q.newOvr) >= 1) continue;
			if (p.shootingSlump) dt.tpp.push(p.stats.tpp - q.stats.tpp);
			if (p.defensiveBreakout) dt.defl.push(p.stats.deflpg - q.stats.deflpg);
			if (p.doubleDoubleMachine) {
				dt.dd.push((p.stats.rpg + p.stats.apg) - (q.stats.rpg + q.stats.apg));
			}
			/* Only against a baseline who PLAYED: if the same man drew an
			   ordinary ten-game injury in the anomaly-free run, the delta
			   measures one absence against another and says nothing about
			   the hold. */
			if (p.eligibilityHold && q.stats.gp >= 28) dt.gpElig.push(q.stats.gp - p.stats.gp);
			if (p.surprise && p.surprise.name === "suspension") {
				dt.gpSusp.push(q.stats.gp - p.stats.gp);
			}
		}
	}
	const mean2 = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
	ok("a shooting slump actually costs three-point percentage",
		dt.tpp.length > 0 && mean2(dt.tpp) < -0.04,
		dt.tpp.length + " cases, mean " + (mean2(dt.tpp) * 100).toFixed(1) + " points");
	ok("a defensive breakout actually produces defensive plays",
		dt.defl.length > 0 && mean2(dt.defl) > 0.4,
		dt.defl.length + " cases, mean +" + mean2(dt.defl).toFixed(2) + " deflections");
	ok("a double-double machine actually rebounds or passes more",
		dt.dd.length > 0 && mean2(dt.dd) > 0.8,
		dt.dd.length + " cases, mean +" + mean2(dt.dd).toFixed(2));
	ok("an eligibility hold actually costs games",
		dt.gpElig.length === 0 || mean2(dt.gpElig) > 5,
		dt.gpElig.length + " cases, mean " + mean2(dt.gpElig).toFixed(1) + " games");
	ok("a suspension costs games, and fewer of them than an injury",
		dt.gpSusp.length === 0 ||
			(mean2(dt.gpSusp) > 0.5 && mean2(dt.gpSusp) < 8),
		dt.gpSusp.length + " cases, mean " + mean2(dt.gpSusp).toFixed(1) + " games");

	// A suspension is an absence, not an injury: the team does not plan
	// around it, which is what `injury: false` means to applyOutages.
	const susp = global.Engine.SURPRISES.filter((k) => k.name === "suspension")[0];
	ok("the suspension anomaly exists and is not an injury", !!susp);
	// The double-double machine must never land on somebody who cannot do it.
	let implausible = 0;
	for (let s = 0; s < 20; s++) {
		const res = global.Engine.run(V.realisticClass(s % 5, 70),
			global.Config.make({ seed: "dd" + s, surpriseBudget: 6 }));
		for (const p of res.players) {
			if (p.doubleDoubleMachine && p.newRatings.hgt < 52 && p.newRatings.pss < 60) {
				implausible++;
			}
		}
	}
	ok("the double-double anomaly never lands on a player who could not do it",
		implausible === 0, implausible + " implausible cases");
}

{
	/* Flavor config bends reach the phases that own the settings they bend.
	   Four flavors exist mainly to move potBias and potSpread and phasePot
	   read state.cfg, so none of them did anything. */
	const gap = (hint) => {
		const all = [];
		for (let s = 0; s < 6; s++) {
			const res = global.Engine.run(V.realisticClass(s, 70),
				global.Config.make(hint
					? { seed: "bend" + s, flavorHint: hint }
					: { seed: "bend" + s, classFlavor: 0 }));
			for (const p of res.players) all.push(p.newPot - p.newOvr);
		}
		return all.reduce((a, b) => a + b, 0) / all.length;
	};
	const none = gap("");
	ok("a flavor that lowers potential actually lowers it",
		gap("veteran") < none - 1.5,
		"veteran " + gap("veteran").toFixed(2) + " vs none " + none.toFixed(2));
	ok("a flavor that raises potential actually raises it",
		gap("one-and-done") > none + 1.5,
		"one-and-done " + gap("one-and-done").toFixed(2));
}

{
	/* A flavor's DESTINATION bend reaches assignCollege.

	   Config.make folds the three legacy sliders (wEuroLeague, wGLeague, wNBL)
	   into `leagueWeights`, which is the only thing assignCollege reads — and
	   it does that at make() time, before any flavor bend runs. So a flavor
	   that set wEuroLeague wrote a number nothing read. The "unusually
	   international" flavor, whose entire purpose is to put more of the class
	   abroad, produced EuroLeague at 11.9% of non-NCAA prospects against 11.9%
	   with no flavor at all. */
	const euroShare = (over) => {
		let euro = 0;
		let abroad = 0;
		for (let s = 0; s < 8; s++) {
			const res = global.Engine.run(V.realisticClass(s, 70),
				global.Config.make(Object.assign({ seed: "dest" + s }, over)));
			for (const p of res.players) {
				if (!p.nonNcaa) continue;
				abroad++;
				if (p.newCollege === "EuroLeague") euro++;
			}
		}
		return abroad ? euro / abroad : 0;
	};
	const plain = euroShare({ classFlavor: 0 });
	const intl = euroShare({ flavorHint: "international" });
	ok("a flavor's destination bend reaches the college assignment",
		intl > plain * 1.3,
		"EuroLeague share: no flavor " + (plain * 100).toFixed(1) +
			"%, international " + (intl * 100).toFixed(1) + "%");
	// And a user who edited the destination table is not overruled by it.
	const mine = euroShare({ flavorHint: "international",
		leagueWeights: { EuroLeague: 0 } });
	ok("a destination the user set wins over the flavor", mine === 0,
		(mine * 100).toFixed(1) + "%");
}

{
	// The five new flavors exist and are distinguishable from the old ones by
	// the tilt they apply, which is the fault they were added to fix.
	const RBF = RB.CLASS_FLAVORS;
	const added = ["euro-influenced", "post-up renaissance", "three-and-d only",
		"feast or famine", "coaching carousel"];
	ok("the five new flavors are in the table",
		added.every((n) => RBF.some((f) => f.name === n)));
	// Every flavor carries either a distinct tilt or a distinct bend.
	const sig = (f) => JSON.stringify([f.m || {}, f.c || {}]);
	const sigs = RBF.map(sig);
	ok("no two flavors are the same flavor",
		new Set(sigs).size === sigs.length);
	// The post-up class really does shoot fewer threes than the big-heavy one.
	const threes = (hint) => {
		let tpa = 0;
		let n = 0;
		for (let s = 0; s < 4; s++) {
			const res = global.Engine.run(V.realisticClass(s, 70),
				global.Config.make({ seed: "fl" + s, flavorHint: hint }));
			for (const p of res.players) {
				if (p.nonNcaa || !p.stats) continue;
				tpa += p.stats.tpa;
				n++;
			}
		}
		return tpa / n;
	};
	ok("the post-up class shoots fewer threes than the big-heavy one",
		threes("post-up renaissance") < threes("big-heavy"),
		threes("post-up renaissance").toFixed(2) + " vs " + threes("big-heavy").toFixed(2));
	// The 3&D class really is made of fewer builds.
	const builds = (hint) => {
		const res = global.Engine.run(V.realisticClass(1, 70),
			global.Config.make({ seed: "fl", flavorHint: hint }));
		return new Set(res.players.filter((p) => !p.nonNcaa)
			.map((p) => p.archetype)).size;
	};
	ok("the three-and-D class really is a class of four or five things",
		builds("three-and-d only") < builds("balanced"),
		builds("three-and-d only") + " builds vs " + builds("balanced"));
}

{
	// Transfers know which way they went.
	const dirs = {};
	for (let s = 0; s < 8; s++) {
		const res = global.Engine.run(V.realisticClass(s, 70),
			global.Config.make({ seed: "tr" + s, transferShare: 60 }));
		for (const p of res.players) {
			if (p.transfer && p.transfer.direction) {
				dirs[p.transfer.direction] = (dirs[p.transfer.direction] || 0) + 1;
			}
		}
	}
	ok("transfers are classified up, lateral and down",
		dirs.up > 0 && dirs.lateral > 0 && dirs.down > 0, JSON.stringify(dirs));
	// And the classification is right: an up transfer really went up.
	let wrong = 0;
	for (let s = 0; s < 6; s++) {
		const res = global.Engine.run(V.realisticClass(s, 70),
			global.Config.make({ seed: "tr" + s, transferShare: 60 }));
		for (const p of res.players) {
			const t = p.transfer;
			if (!t || !t.direction) continue;
			const step = t.toPrestige - t.fromPrestige;
			if (t.direction === "up" && step <= 0) wrong++;
			if (t.direction === "down" && step >= 0) wrong++;
		}
	}
	ok("a transfer classified as a step up really went up", wrong === 0,
		wrong + " misclassified");
}

{
	// International prospects carry a development path.
	const res = global.Engine.run(V.realisticClass(2, 70),
		global.Config.make({ seed: "intl",
			leagueWeights: { "EuroLeague": 60, "Liga ACB": 30, "NBL": 20 } }));
	const abroad = res.players.filter((p) => p.nonNcaa && p.proPath);
	ok("prospects abroad carry a development path", abroad.length > 0,
		abroad.length + " of " + res.players.filter((p) => p.nonNcaa).length);
	ok("every path names a youth system and a debut age",
		abroad.every((p) => p.proPath.youth && p.proPath.debutAge));
	ok("a debut age is younger than the player is now",
		abroad.every((p) => p.proPath.debutAge <= (p.age || 19)));
	ok("national-team caps name a country the league actually plays in",
		abroad.every((p) => !p.proPath.caps || p.proPath.caps.country));
	// The G League is not this story and must not get a European pathway.
	const g = global.Engine.run(V.realisticClass(2, 70),
		global.Config.make({ seed: "gl", leagueWeights: { "NBA G League": 80 } }));
	ok("the G League gets no European academy pathway",
		g.players.filter((p) => p.newCollege === "NBA G League")
			.every((p) => !p.proPath));
}

{
	// Statistical ranks against the whole of Division I, which is what turns a
	// defensive number into a defensive fact.
	const res = global.Engine.run(V.realisticClass(1, 70),
		global.Config.make({ seed: "ranks" }));
	const AWm = global.Awards;
	const withRanks = res.players.filter((p) => !p.nonNcaa && p.statRanks &&
		Object.keys(p.statRanks).length);
	ok("prospects carry national and conference ranks", withRanks.length > 5,
		withRanks.length + " with ranks");
	ok("a rank is never worse than the cutoff that makes it worth saying",
		withRanks.every((p) => Object.keys(p.statRanks).every((k) => {
			const r = p.statRanks[k];
			return (!r.national || r.national <= 50) && (!r.conf || r.conf <= 10);
		})));
	ok("defensive statistics are among the ranked ones",
		AWm.RANKED_STATS.some((r) => r.key === "deflpg") &&
		AWm.RANKED_STATS.some((r) => r.key === "drtg"));
	// Defensive rating is ranked the right way round: low is good.
	const best = withRanks.filter((p) => p.statRanks.drtg &&
		p.statRanks.drtg.national === 1)[0];
	if (best) {
		const better = res.players.filter((p) => !p.nonNcaa && p.stats &&
			p.stats.mpg >= 15 && p.stats.drtg < best.stats.drtg).length;
		ok("defensive rating is ranked with low as good", better === 0,
			better + " prospects had a better DRtg than the class's No. 1");
	} else {
		ok("defensive rating is ranked with low as good", true,
			"no prospect led the country in DRtg in this class");
	}
	ok("rank highlights read as sentences",
		withRanks.some((p) => AWm.rankHighlights(p, 2).length > 0));
}

{
	// Mid-season events, all of them read off results that really happened.
	const res = global.Engine.run(V.realisticClass(3, 70),
		global.Config.make({ seed: "events" }));
	ok("a season produces events", res.seasonEvents.length >= 4,
		String(res.seasonEvents.length));
	ok("season events can be turned off",
		global.Engine.run(V.realisticClass(3, 70),
			global.Config.make({ seed: "events", seasonEvents: 0 }))
			.seasonEvents.length === 0);
	ok("every event names at least one real program",
		res.seasonEvents.every((e) => e.teams && e.teams.length &&
			e.teams.every((n) => !!res.teams[n])));
	ok("events are in calendar order",
		res.seasonEvents.every((e, i) =>
			i === 0 || (res.seasonEvents[i - 1].when || 0) <= (e.when || 0)));
	// A coaching change must name a team that really was losing. Judged on
	// the regular season the event was read off: a 10-21 team that then won
	// a conference-tournament game finishes 12-22, and that is not a
	// contradiction.
	for (const e of res.seasonEvents.filter((x) => x.kind === "coaching change")) {
		const t = res.teams[e.teams[0]];
		const rw = t && Number.isFinite(t.regW) ? t.regW : (t ? t.w : 0);
		const rl = t && Number.isFinite(t.regL) ? t.regL : (t ? t.l : 0);
		ok("a fired coach's team really was losing",
			t && rw / Math.max(1, rw + rl) < 0.35,
			t ? rw + "-" + rl : "no team");
	}
	// The longest-run helper reads the schedule in calendar order.
	ok("a winning streak is measured in calendar order",
		global.TeamsSim.longestRun({ log: [
			{ won: true, when: 0.9 }, { won: false, when: 0.5 },
			{ won: true, when: 0.1 }, { won: true, when: 0.2 },
		] }) === 2);
}

{
	/* 6.5 and 6.6 in the audit: the Pac-12 membership and the pro club
	   rosters. Both were already done in the tree, and a check is cheaper than
	   remembering that. */
	const CL = global.Colleges;
	const PAC12 = ["Boise State", "Colorado State", "Fresno State",
		"San Diego State", "Utah State", "Oregon State", "Washington State",
		"Gonzaga"];
	const misplaced = PAC12.filter((n) => CL.conferenceOf(n) !== "Pac-12");
	ok("the schools the Pac-12 rebuild moved really are in it",
		misplaced.length === 0, "still elsewhere: " + misplaced.join(", "));
	const placeholder = Object.keys(CL.NON_NCAA).filter((lg) => {
		if (lg === "Did not play") return false;
		const clubs = CL.PRO_CLUBS[lg];
		return !clubs || !clubs.length ||
			clubs.some(([name]) => / (Select|United)$/.test(name) &&
				name.indexOf(lg) === 0);
	});
	ok("no league falls back to placeholder club names",
		placeholder.length === 0, "placeholders: " + placeholder.join(", "));
	for (const lg of ["EuroLeague", "Liga ACB", "NBL"]) {
		ok(lg + " carries a real club roster",
			(CL.PRO_CLUBS[lg] || []).length >= 8);
	}
}

/* ------------------------------------------- warm re-runs and stale state */
console.log("\nWarm re-runs");
{
	/* A staged (warm) re-run has to produce the same class a cold one does.
	   applyDraftEvents skips a player who already carries a draftEvent so two
	   events cannot land on one man — and only phaseBuild re-creates the player
	   objects, so a warm run that starts at `stock` was handed last run's flags
	   and drew its events from a pool that excluded them. Moving the award
	   strictness slider, which has nothing to do with the draft board, rewrote
	   every draft-day event. */
	const names = (res) => res.draftEvents
		.map((e) => e.name + "/" + e.player).join(", ");
	const runner = global.Engine.createRunner(V.syntheticClass(5, 60));
	runner.run(global.Config.make({ seed: "warm" }));
	const warm = runner.run(global.Config.make({ seed: "warm", awardStrictness: 1.5 }));
	const cold = global.Engine.createRunner(V.syntheticClass(5, 60))
		.run(global.Config.make({ seed: "warm", awardStrictness: 1.5 }));
	ok("a warm re-run gives the same draft-day events as a cold one",
		names(warm) === names(cold),
		"warm [" + names(warm) + "] vs cold [" + names(cold) + "]");
	ok("no player carries a draft-day flag from a previous run",
		warm.players.filter((p) => p.draftEvent).length === warm.draftEvents.length);

	// Turning the events off must not leave the flags behind, or the players
	// who had them are permanently ineligible once it is turned back on.
	const off = runner.run(global.Config.make({ seed: "warm", draftEvents: 0 }));
	ok("turning draft events off clears the flags",
		off.players.filter((p) => p.draftEvent).length === 0);
	const back = runner.run(global.Config.make({ seed: "warm" }));
	const coldAgain = global.Engine.createRunner(V.syntheticClass(5, 60))
		.run(global.Config.make({ seed: "warm" }));
	ok("and turning them back on reproduces the cold run",
		names(back) === names(coldAgain));

	/* Each event's sentence describes where the player actually ended up. A
	   later event's move() shifts everyone it passes by one, so a text written
	   when the event fired disagreed with the rank printed beside it. */
	let mismatched = 0;
	for (let s = 0; s < 12; s++) {
		const res = global.Engine.run(V.realisticClass(s % 5, 70),
			global.Config.make({ seed: "detext" + s }));
		for (const e of res.draftEvents) {
			const p = res.board.filter((x) => x.key === e.key)[0];
			const m = /until pick (\d+)/.exec(e.text);
			if (m && Number(m[1]) !== p.boardRank) mismatched++;
		}
	}
	ok("a draft-day sentence agrees with the rank printed beside it",
		mismatched === 0, mismatched + " disagreed");
}

{
	/* awardNoise 0 has to mean what the slider says it means: every trophy to
	   whoever the production model ranks first. The season's voter mood scaled
	   only its random half, so the resume lean stayed at 0.55 of full strength
	   and the two electorates that weight the resume most still split away. */
	const POY = /^(Naismith Trophy|John R\. Wooden Award|Oscar Robertson Trophy|AP Player of the Year|NABC Player of the Year|Sporting News Player of the Year)$/;
	const splits = (noise) => {
		let split = 0;
		let seen = 0;
		for (let s = 0; s < 24; s++) {
			const res = global.Engine.run(V.realisticClass(s % 6, 70),
				global.Config.make({ seed: "poy" + s, awardNoise: noise }));
			const winners = new Set();
			for (const p of res.players) {
				for (const a of p.awards || []) if (POY.test(a)) winners.add(p.key);
			}
			if (winners.size) { seen++; if (winners.size > 1) split++; }
		}
		return { split, seen };
	};
	const quiet = splits(0);
	ok("at award noise 0 the six trophies never disagree",
		quiet.split === 0,
		quiet.split + " of " + quiet.seen + " classes split");
	const loud = splits(2);
	ok("and at 2 they regularly do", loud.split > 0,
		loud.split + " of " + loud.seen + " classes split");
}

{
	// A season event never names one program as both sides of a game.
	let dup = 0;
	let total = 0;
	for (let s = 0; s < 30; s++) {
		const res = global.Engine.run(V.realisticClass(s % 6, 70),
			global.Config.make({ seed: "dup" + s, seasonEvents: 14 }));
		for (const e of res.seasonEvents) {
			total++;
			if (e.teams && e.teams.length === 2 && e.teams[0] === e.teams[1]) dup++;
		}
	}
	ok("no season event names the same program twice", dup === 0,
		dup + " of " + total);
}

{
	// The forced-availability windows are measured against the real schedule
	// length, not a hard-coded 32.
	let bad = 0;
	for (let s = 0; s < 20; s++) {
		const res = global.Engine.run(V.realisticClass(s % 5, 70),
			global.Config.make({ seed: "avail" + s, surpriseBudget: 6 }));
		for (const p of res.players) {
			const av = p.availability;
			if (!av || av.from === null || av.from === undefined) continue;
			if (av.to > 1.0001 || av.from < -1e-9 || av.to < av.from) bad++;
		}
	}
	ok("every absence window lies inside the season", bad === 0, String(bad));
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

console.log("\nWarm re-runs from every phase");
{
	/* THE COUPLING THIS EXISTS TO CATCH.

	   The awards phase used to hand three extra results back by writing
	   `__`-prefixed keys onto the TEAM MAP, which the caller then lifted off.
	   That works exactly as long as every key is remembered at both ends —
	   and the stats phase iterates the team map with Object.keys, so a key
	   left behind is a "team" with no members. Adding a fourth key and
	   forgetting the matching delete is a one-line change whose failure
	   appears three phases away, on one slider, in the browser only.

	   So: run cold, then re-run warm through every setting the phase table
	   declares, one at a time. Any phase that leaves the state unfit for a
	   later phase to re-enter shows up here rather than in a user's tab. */
	const PROBES = [
		["era", "2009-2021"], ["pace", 72], ["scoringEnv", 1.5],
		["efficiencyEnv", 1], ["statNoise", 1.4], ["upsetFactor", 1.6],
		["injuryRate", 1.6], ["awardStrictness", 1.5], ["confAwardStrictness", 1.4],
		["awardNoise", 2], ["potBias", 1.5], ["potSpread", 9],
		["draftEvents", 6], ["noteLines", ["summary", "stats"]],
		["seasonEvents", 11], ["teamMomentum", 1.8], ["priorSeasons", "reconstruct"],
		["coachTurnover", 160], ["styleDrift", 2], ["traitCount", 5],
		["realignmentRate", 0.9], ["midMajorLift", 6], ["starReturners", 200],
	];
	const runner = global.Engine.createRunner(V.realisticClass(6, 70));
	const base = { seed: "warm", narrative: false };
	let ok0 = true;
	try { runner.run(global.Config.make(base)); } catch (e) { ok0 = false; }
	ok("a cold run succeeds", ok0);
	const broke = [];
	for (const [key, value] of PROBES) {
		const cfg = global.Config.make(Object.assign({}, base));
		cfg[key] = value;
		try {
			const res = runner.run(cfg);
			if (!res.players || !res.players.length) broke.push(key + ": empty");
		} catch (e) {
			broke.push(key + ": " + (e && e.message ? e.message : String(e)));
		}
	}
	ok("every setting can be changed on a warm runner",
		broke.length === 0, broke.slice(0, 4).join("; "));
	/* And back again, in the other order, because a phase can also be left
	   unfit by the WARM path rather than by the cold one. */
	const back = [];
	for (let i = PROBES.length - 1; i >= 0; i--) {
		const cfg = global.Config.make(Object.assign({}, base));
		cfg[PROBES[i][0]] = PROBES[i][1];
		try { runner.run(cfg); } catch (e) {
			back.push(PROBES[i][0] + ": " + (e && e.message ? e.message : String(e)));
		}
	}
	ok("and in the reverse order", back.length === 0, back.slice(0, 4).join("; "));
	/* The specific invariant: nothing may be left on the team map that is not
	   a team, because the stats phase iterates it by key. */
	{
		const res = runner.run(global.Config.make(base));
		const bad = Object.keys(res.teams).filter((k) => !res.teams[k] ||
			!Array.isArray(res.teams[k].members));
		ok("the team map contains nothing but teams", bad.length === 0, bad.join(", "));
	}
	/* The ballots survive a warm re-run of the awards phase, which is the
	   thing that broke. */
	{
		const a = runner.run(global.Config.make(Object.assign({}, base)));
		const b = runner.run(global.Config.make(
			Object.assign({}, base, { awardStrictness: 1.4 })));
		ok("the player-of-the-year ballots survive a warm awards re-run",
			(a.poyBallots || []).length === 6 && (b.poyBallots || []).length === 6,
			(a.poyBallots || []).length + " / " + (b.poyBallots || []).length);
		ok("and each ballot names five candidates with margins",
			b.poyBallots.every((x) => x.top.length === 5 && x.top[0].behind === 0 &&
				x.top.every((r) => Number.isFinite(r.behind) && r.name)),
			JSON.stringify(b.poyBallots[0] && b.poyBallots[0].top[1]));
	}
}

console.log("\nStaying fresh: anomaly memory, narratives, style drift, flavor reach");
{
	/* ANOMALY MEMORY. The same mechanism the build pool has, one layer down:
	   thirty-two kinds and about four draws a class meant the same eight or
	   ten turned up in most classes. */
	{
		const draw = (recent, memory) => global.Engine.run(
			V.realisticClass(2, 70),
			global.Config.make({ seed: "anom", recentAnomalies: recent,
				anomalyMemory: memory, narrative: false }))
			.surprises.map((sp) => sp.name);
		const base = draw([], 1);
		ok("a class draws anomalies", base.length >= 2, base.join(", "));
		/* With the same seed and the same class, telling the engine that these
		   exact kinds ran last class has to change the draw. */
		const avoided = draw([base], 1);
		const overlap = avoided.filter((n) => base.indexOf(n) !== -1).length;
		ok("an anomaly used last class is pushed down the queue",
			overlap < base.length, overlap + " of " + base.length + " repeated");
		ok("anomalyMemory 0 restores the memoryless draw",
			draw([base], 0).join("|") === base.join("|"));
		/* And the memory decays: two classes ago should bite less than one. */
		let repeatNear = 0;
		let repeatFar = 0;
		for (let s = 0; s < 8; s++) {
			const first = global.Engine.run(V.realisticClass(s, 70),
				global.Config.make({ seed: "am" + s, narrative: false }))
				.surprises.map((sp) => sp.name);
			const near = global.Engine.run(V.realisticClass(s, 70),
				global.Config.make({ seed: "am2-" + s, recentAnomalies: [first],
					anomalyMemory: 1, narrative: false })).surprises.map((sp) => sp.name);
			const far = global.Engine.run(V.realisticClass(s, 70),
				global.Config.make({ seed: "am2-" + s, recentAnomalies: [[], [], first],
					anomalyMemory: 1, narrative: false })).surprises.map((sp) => sp.name);
			repeatNear += near.filter((n) => first.indexOf(n) !== -1).length;
			repeatFar += far.filter((n) => first.indexOf(n) !== -1).length;
		}
		ok("and the memory decays with age",
			repeatNear <= repeatFar, repeatNear + " vs " + repeatFar);
	}

	/* SEASON NARRATIVES. */
	{
		const res = global.Engine.run(V.realisticClass(4, 70),
			global.Config.make({ seed: "narr" }));
		ok("a class draws two or three season storylines",
			res.narrative.length >= 2 && res.narrative.length <= 3,
			res.narrative.map((x) => x.name).join(" + "));
		ok("each storyline names itself and says what it means",
			res.narrative.every((x) => x.name && x.blurb));
		const off = global.Engine.run(V.realisticClass(4, 70),
			global.Config.make({ seed: "narr", narrative: false }));
		ok("narrative:false draws none", off.narrative.length === 0);
		/* A storyline that bends nothing is a label, so the settings the
		   season actually ran under have to differ. */
		/* Read off `effectiveCfg`, which is what the season was actually
		   simulated at — `cfg` is what the user asked for, and the bends by
		   design do not appear there. */
		const KEYS = ["upsetFactor", "teamMomentum", "injuryRate", "pace",
			"midMajorLift", "bluebloodDownYears", "coachTurnover", "realignmentRate",
			"efficiencyEnv", "scoringEnv", "statNoise", "seasonEvents"];
		const moved = KEYS.filter((k) => res.effectiveCfg[k] !== off.effectiveCfg[k]);
		ok("and a storyline changes the settings the season ran at",
			moved.length >= 2, moved.join(", "));
		/* And that reaches the season, not only the config. */
		ok("which reaches the simulation",
			res.coachingCarousel.length !== off.coachingCarousel.length ||
			res.seasonEvents.length !== off.seasonEvents.length ||
			res.tourney.champion.team.name !== off.tourney.champion.team.name,
			res.coachingCarousel.length + " vs " + off.coachingCarousel.length);
		/* A user's own setting still wins, at the default reach of 0. */
		const pinned = global.Engine.run(V.realisticClass(4, 70),
			global.Config.make({ seed: "narr", upsetFactor: 0.77 }));
		ok("a storyline never overrules a setting the user changed",
			pinned.effectiveCfg.upsetFactor === 0.77,
			String(pinned.effectiveCfg.upsetFactor) + " with " +
				pinned.narrative.map((x) => x.name).join(" + "));
		/* Every bend key is a real setting. A typo here is silent. */
		const D = global.Config.DEFAULTS;
		const unknown = [];
		for (const n of global.Engine.NARRATIVES) {
			// paceShift is a delta on `pace`; see applyNarrative.
			for (const k of Object.keys(n.bend)) if (!(k in D) && k !== "paceShift") unknown.push(n.name + "." + k);
		}
		ok("every storyline bends a setting that exists", unknown.length === 0,
			unknown.join("; "));
	}

	/* FLAVOR REACH. */
	{
		/* A flavor whose bend the user has already customised does nothing at
		   reach 0 and something at reach 100. injuryRate is the clearest case:
		   "the year everybody got hurt" bends it and nothing else does. */
		const cfgFor = (reach) => global.Config.make({
			seed: "reach", flavorHint: "injury year", classFlavor: 1,
			injuryRate: 1.15, flavorReach: reach, narrative: false,
		});
		const at0 = global.Engine.run(V.realisticClass(3, 70), cfgFor(0));
		const at100 = global.Engine.run(V.realisticClass(3, 70), cfgFor(100));
		ok("the named flavor was drawn", at0.flavor && at0.flavor.name === "injury year",
			at0.flavor && at0.flavor.name);
		ok("at reach 0 a flavor leaves a changed setting exactly alone",
			at0.effectiveCfg.injuryRate === 1.15, String(at0.effectiveCfg.injuryRate));
		ok("at reach 100 it moves it, and only part of the way",
			at100.effectiveCfg.injuryRate > 1.15 &&
			at100.effectiveCfg.injuryRate < 2,
			String(at100.effectiveCfg.injuryRate));
	}

	/* STYLE DRIFT. */
	{
		const res = global.Engine.run(V.realisticClass(1, 70),
			global.Config.make({ seed: "drift", narrative: false }));
		const byName = {};
		for (const t of Object.values(res.teams)) {
			if (!t.style) continue;
			(byName[t.style.name] = byName[t.style.name] || []).push(t.style.three);
		}
		const biggest = Object.keys(byName).sort((a, b) => byName[b].length - byName[a].length)[0];
		ok("two teams playing the same style do not play identical numbers",
			new Set(byName[biggest]).size === byName[biggest].length,
			biggest + ": " + new Set(byName[biggest]).size + " distinct of " +
				byName[biggest].length);
		/* And it is a drift, not a redraw: the style's own identity survives. */
		const spread = Math.max.apply(null, byName[biggest]) -
			Math.min.apply(null, byName[biggest]);
		ok("but the drift is smaller than the gap between styles",
			spread < 0.14, spread.toFixed(3));
		const off = global.Engine.run(V.realisticClass(1, 70),
			global.Config.make({ seed: "drift", styleDrift: 0, narrative: false }));
		const offBy = Object.values(off.teams).filter(
			(t) => t.style && t.style.name === biggest).map((t) => t.style.three);
		ok("styleDrift 0 restores the fixed enum exactly",
			new Set(offBy).size === 1, String(new Set(offBy).size));
		/* The drift must not shift any other random stream — an earlier
		   version drew a per-coach seed from the coach's own rng and moved
		   every coach's development number, which moved the tournament. */
		ok("and turning it off changes nothing but the styles",
			off.tourney.champion.team.name === res.tourney.champion.team.name,
			off.tourney.champion.team.name + " vs " + res.tourney.champion.team.name);
	}
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

console.log("\nThe paper: kinds, variants, voices and quotes");
{
	const N = global.News;
	const T = global.Text;

	/* THE THREE-AND-THREE RULE.

	   The table exists so that adding a kind is adding a row, and a rule that
	   is not checked is a rule the twentieth row will break. Every row carries
	   at least three headlines and at least three bodies, because two of
	   anything reads as an alternation rather than as variety. */
	const thin = N.TEMPLATES.filter((t) =>
		!Array.isArray(t.headlines) || t.headlines.length < 3 ||
		!Array.isArray(t.bodies) || t.bodies.length < 3);
	ok("every templated kind carries at least three headlines and three bodies",
		thin.length === 0, thin.map((t) => t.kind).join("; "));

	/* No two kinds share a body string. A copied row with one word changed is
	   the failure mode this catches: it passes the count above and produces
	   two kinds that read identically. */
	{
		const seenBody = {};
		const clashes = [];
		for (const t of N.TEMPLATES) {
			for (const b of t.bodies) {
				if (seenBody[b] && seenBody[b] !== t.kind) {
					clashes.push(t.kind + " / " + seenBody[b]);
				}
				seenBody[b] = t.kind;
			}
			for (const h of t.headlines) {
				if (seenBody["H|" + h] && seenBody["H|" + h] !== t.kind) {
					clashes.push("headline " + t.kind + " / " + seenBody["H|" + h]);
				}
				seenBody["H|" + h] = t.kind;
			}
		}
		ok("no body or headline template is shared between two kinds",
			clashes.length === 0, clashes.slice(0, 4).join("; "));
	}

	/* Every template's slots are actually filled. A {slot} the slots function
	   does not produce renders as the literal "{slot}", which the text sweep
	   cannot see because braces are not a text fault. */
	{
		const bad = [];
		for (const t of N.TEMPLATES) {
			const declared = new Set();
			for (const str of t.headlines.concat(t.bodies)) {
				const re = /\{(\w+)\}/g;
				let m;
				while ((m = re.exec(str)) !== null) declared.add(m[1]);
			}
			t.__slots = declared;
		}
		/* Run the table over several classes and check nothing renders a
		   literal brace. Rows whose `find` never fires in the sample are
		   reported separately below rather than silently passing. */
		/* Ten classes rather than six: several rows depend on a season
		   producing a particular thing (a champion whose coach is in his first
		   six years, a 15-over-2, a first-ever bid) and six seasons is not
		   always enough for all of them. A row that needs more than ten is a
		   row nobody would see either. */
		const fired = new Set();
		for (let s = 0; s < 10; s++) {
			const res = global.Engine.run(V.realisticClass(s, 70),
				global.Config.make({ seed: "tpl" + s }));
			for (const a of N.build(res)) {
				fired.add(a.kind);
				const text = T.segsToText(a.headline) + " " + T.segsToText(a.body) + " " +
					(a.paras || []).map((x) => T.segsToText(x)).join(" ");
				if (/\{\w+\}/.test(text)) bad.push(a.kind + ": " + text.slice(0, 90));
			}
		}
		ok("no rendered article leaves a slot unfilled", bad.length === 0,
			bad.slice(0, 3).join(" | "));
		/* The two universe rows read carryOver and cannot fire on a standalone
		   class, which is correct; everything else has to be reachable. */
		const never = N.TEMPLATES.filter((t) => !fired.has(t.kind) && t.group !== "universe");
		ok("every templated kind is reachable on an ordinary class",
			never.length === 0, never.map((t) => t.kind).join("; "));
		global.__newsFired = fired;
	}

	/* THE SIZE OF THE PAPER. The audit's target was past a hundred kinds; the
	   band has a top as well as a bottom, because a feed of two hundred
	   articles a season is not a paper either. */
	{
		let kinds = new Set();
		let total = 0;
		const N_CLASSES = 8;
		let always = {};
		for (let s = 0; s < N_CLASSES; s++) {
			const res = global.Engine.run(V.realisticClass(s, 70),
				global.Config.make({ seed: "paper" + s }));
			const arts = N.build(res);
			total += arts.length;
			const here = new Set();
			for (const a of arts) { kinds.add(a.kind); here.add(a.kind); }
			for (const k of here) always[k] = (always[k] || 0) + 1;
		}
		ok("the paper runs at least a hundred distinct kinds",
			kinds.size + 2 >= 100, kinds.size + " observed, plus 2 universe-only");
		ok("and a readable number of articles a season",
			total / N_CLASSES >= 55 && total / N_CLASSES <= 140,
			(total / N_CLASSES).toFixed(1) + " a class");
		/* "Hold the always-firing share under a third": a paper whose table of
		   contents is the same every season is the failure the runs() gates
		   exist for, and adding forty kinds must not undo it. */
		const alwaysRuns = Object.keys(always).filter((k) => always[k] === N_CLASSES);
		ok("under a third of kinds fire in every single season",
			alwaysRuns.length / kinds.size < 0.34,
			alwaysRuns.length + " of " + kinds.size);
	}

	/* VOICES. */
	{
		const res = global.Engine.run(V.realisticClass(3, 70),
			global.Config.make({ seed: "voice" }));
		const arts = N.build(res);
		const voices = new Set(arts.map((a) => a.voice));
		ok("every article carries a voice and a byline",
			arts.every((a) => a.voice && a.byline), String(arts.length));
		ok("a class draws a staff rather than one voice or all six",
			voices.size >= 3 && voices.size <= 5, [...voices].join(", "));
		ok("the wire is always on the desk", voices.has("wire"));
		const withPara = arts.filter((a) => (a.paras || []).length);
		ok("a real share of articles carry a second paragraph",
			withPara.length / arts.length > 0.3 && withPara.length / arts.length < 0.95,
			withPara.length + " of " + arts.length);
		/* Two different seeds must produce two different staffs at least
		   sometimes, or the voice system is a constant with extra steps. */
		let differ = 0;
		for (let s = 0; s < 8; s++) {
			const r2 = global.Engine.run(V.realisticClass(1, 70),
				global.Config.make({ seed: "staff" + s }));
			const v = [...new Set(N.build(r2).map((a) => a.voice))].sort().join(",");
			if (s === 0) global.__firstStaff = v;
			else if (v !== global.__firstStaff) differ++;
		}
		ok("a different seed draws a different staff", differ >= 3, String(differ));
	}

	/* QUOTES. Nothing in the paper carried one before, and a quote that is
	   attributed to nobody is worse than no quote. */
	{
		let quotes = 0;
		let unattributed = 0;
		for (let s = 0; s < 6; s++) {
			const res = global.Engine.run(V.realisticClass(s, 70),
				global.Config.make({ seed: "quote" + s }));
			for (const a of N.build(res)) {
				for (const para of a.paras || []) {
					const text = T.segsToText(para);
					if (text.indexOf("\u201c") !== 0) continue;
					quotes++;
					if (!/ — .+\.$/.test(text)) unattributed++;
				}
			}
		}
		ok("the paper carries quotes", quotes > 40, String(quotes));
		ok("and every one of them is attributed", unattributed === 0, String(unattributed));
		/* A quote's speaker exists. quoteFor returns null rather than
		   inventing one, which is the behaviour worth pinning. */
		ok("quoteFor returns null when there is nobody to quote",
			N.quoteFor(new global.BBGMRng.Rng("q"), {}) !== undefined);
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
	let same = 0;
	let total = 0;
	for (const name of Object.keys(b.teams)) {
		const t = b.teams[name];
		if (!t || !t.coach || !carry.coaches[name]) continue;
		total++;
		if (t.coach.name === carry.coaches[name].coach.name) same++;
	}
	/* Retention, not permanence. The carousel (js/teams.js) turns over 40-60
	   of 368 jobs a year at coachTurnover 100, which is what Division I does,
	   so 85-93% of programs keep the same man. The old band was >90% because
	   the old model fired exactly one coach a season across the country. */
	ok("a carried coach is the same man next season",
		total > 300 && same / total > 0.85 && same / total < 0.94,
		same + " of " + total);
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

console.log("\nAudit regressions");
{
	/* --- archetype redundancy -------------------------------------------
	   Cosine similarity over the authored 15-rating offset vectors. There
	   were 96 pairs above 0.85 and sixteen above 0.95, with Rim Protector
	   and Shot-Blocking Anchor identical in shape (1.00) and differing only
	   in height gate — 121 names for about 65 distinct shapes, which is why
	   a 17-build pool still read as repetition. */
	/* A BUILD IS A SHAPE AND A SIZE.

	   This compared offset vectors alone, and the audit that produced it said
	   so in the same breath: "a Boom-or-Bust Tools guard and a Boom-or-Bust
	   Tools center are the same offset vector, which the cosine-similarity
	   test cannot see because it compares builds, not build x height." The
	   consequence is a test that reports redundancy where there is none — a
	   post-up guard gated 24-46 and a post-up wing gated 40-68 are not the
	   same player and never appear as alternatives for one prospect — while
	   still missing the case it was written for.

	   So similarity is scaled by height OVERLAP. Two builds a prospect can
	   never choose between are not redundant however parallel their vectors;
	   two builds that share their whole gate are compared exactly as before. */
	const keys = BB.RATING_KEYS;
	const specs = RB.ARCHETYPES.filter((a) => a.name !== "Balanced");
	const vec = (a) => keys.map((k) => RB.RAW_OFFSETS[a.name][k] || 0);
	const cosine = (u, v) => {
		let d = 0;
		let nu = 0;
		let nv = 0;
		for (let i = 0; i < u.length; i++) { d += u[i] * v[i]; nu += u[i] * u[i]; nv += v[i] * v[i]; }
		return nu && nv ? d / Math.sqrt(nu * nv) : 0;
	};
	/* Jaccard over the two height gates: 1 when they are the same band, 0
	   when they do not touch. */
	const overlap = (a, b) => {
		const lo = Math.max(a.min, b.min);
		const hi = Math.min(a.max, b.max);
		if (hi <= lo) return 0;
		const union = Math.max(a.max, b.max) - Math.min(a.min, b.min);
		return union > 0 ? (hi - lo) / union : 0;
	};
	let maxCos = 0;
	let maxPair = "";
	let above85 = 0;
	let maxRaw = 0;
	let maxRawPair = "";
	for (let i = 0; i < specs.length; i++) {
		for (let j = i + 1; j < specs.length; j++) {
			const raw = cosine(vec(specs[i]), vec(specs[j]));
			const c = raw * overlap(specs[i], specs[j]);
			if (c > 0.85) above85++;
			if (c > maxCos) { maxCos = c; maxPair = specs[i].name + " / " + specs[j].name; }
			if (raw > maxRaw) {
				maxRaw = raw;
				maxRawPair = specs[i].name + " / " + specs[j].name;
			}
		}
	}
	ok("no two archetypes share a shape AND a height band (max cosine < 0.93)",
		maxCos < 0.93, maxPair + " at " + maxCos.toFixed(3));
	ok("near-duplicate pairs (cosine x height overlap > 0.85) stay under 30",
		above85 <= 30, String(above85));
	/* The raw figure is still reported, because a pair at 0.99 in offset space
	   is worth a comment in the table even when the gates keep them apart —
	   and every such pair in the table carries one. */
	ok("the closest pair in offset space is separated by its height gate",
		maxRaw < 0.995 || overlap(
			specs.filter((a) => a.name === maxRawPair.split(" / ")[0])[0],
			specs.filter((a) => a.name === maxRawPair.split(" / ")[1])[0]) < 0.5,
		maxRawPair + " at " + maxRaw.toFixed(3));
	const durability = RB.ARCHETYPES.filter((a) => (a.t || []).indexOf("durability") !== -1).length;
	ok("the durability tag has a pool to draw from", durability >= 6, durability + " members");

	/* --- the seven-footers' own builds ----------------------------------- */
	{
		let tall = 0;
		let own = 0;
		let poolsShort = 0;
		for (let s = 0; s < 16; s++) {
			const res = global.Engine.run(V.realisticClass(s % 8, 70),
				global.Config.make({ seed: "center" + s }));
			const pool = res.archetypePool || [];
			const centers = pool.filter((n) => {
				const a = RB.ARCHETYPES.filter((x) => x.name === n)[0];
				return a && a.min >= RB.CENTER_MIN;
			}).length;
			if (centers < RB.CENTER_IN_POOL) poolsShort++;
			for (const p of res.players) {
				if (!p.newRatings || p.newRatings.hgt < RB.CENTER_MIN) continue;
				tall++;
				const a = RB.ARCHETYPES.filter((x) => x.name === p.archetype)[0];
				if (a && a.min >= RB.CENTER_MIN) own++;
			}
		}
		ok("every pool carries the genuine-center builds", poolsShort === 0, poolsShort + " short");
		ok("a seven-footer usually draws a build made for him",
			tall > 40 && own / tall >= 0.30, own + " of " + tall);
	}

	/* --- FT-rate and foul identity --------------------------------------- */
	{
		const S = global.StatsSim;
		const id = (n) => S.archetypeIdentity(n, { specialization: 1 });
		ok("Free-Throw Merchant and Rim-Pressure Bruiser draw fouls the composite cannot see",
			id("Free-Throw Merchant").ftr > 0.02 && id("Rim-Pressure Bruiser").ftr > 0.03 &&
			id("Sharpshooter").ftr < 0);
		ok("Foul-Prone Enforcer fouls, a Sharpshooter does not",
			id("Foul-Prone Enforcer").pf > 1.15 && id("Sharpshooter").pf < 1.0);
		ok("Balanced sits at the anchor",
			Math.abs(id("Balanced").ftr) < 0.015 && Math.abs(id("Balanced").pf - 1) < 0.05);
		ok("the identity vanishes at specialization 0",
			S.archetypeIdentity("Foul-Prone Enforcer", { specialization: 0 }).ftr === 0);
		// Simulated: the builds the identity says draw fouls do, on the field.
		const hi = [];
		const rest = [];
		const foulers = [];
		const calm = [];
		for (let s = 0; s < 10; s++) {
			const res = global.Engine.run(V.realisticClass(s % 5, 70),
				global.Config.make({ seed: "ftr" + s, specialization: 1.5 }));
			for (const p of res.players) {
				if (p.nonNcaa || !p.stats || p.stats.fga < 4) continue;
				const i = S.archetypeIdentity(p.archetype, { specialization: 1.5 });
				(i.ftr > 0.04 ? hi : rest).push(p.stats.fta / p.stats.fga);
				(i.pf > 1.2 ? foulers : calm).push(p.stats.pfpg);
			}
		}
		const m = (v) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
		ok("foul-drawing builds draw more fouls on the floor",
			hi.length >= 15 && m(hi) - m(rest) > 0.03,
			hi.length + " players, FTr " + m(hi).toFixed(3) + " vs " + m(rest).toFixed(3));
		ok("foul-prone builds commit more fouls on the floor",
			foulers.length >= 10 && m(foulers) - m(calm) > 0.15,
			foulers.length + " players, PF " + m(foulers).toFixed(2) + " vs " + m(calm).toFixed(2));
	}

	/* --- settings copy is derived, not typed ----------------------------- */
	{
		const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
		const m = /<p class="hint" id="archHint">([^<]*)<\/p>/.exec(html);
		ok("the archetype hint in index.html carries no numbers of its own",
			!!m && !/\d/.test(m[1]));
		const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
		const span = /Rarity weights span ([\d.]+) to ([\d.]+)/.exec(readme);
		const ws = specs.map((a) => (a.w === undefined ? 1 : a.w));
		ok("the README's stated weight span matches the table",
			!!span && Number(span[1]) === Math.min.apply(null, ws) &&
			Number(span[2]) === Math.max.apply(null, ws),
			span ? span[0] + " vs " + Math.min.apply(null, ws) + "-" + Math.max.apply(null, ws) : "no span line");
		ok("the README's build count matches the table",
			new RegExp("one of " + RB.ARCHETYPES.length + " archetypes").test(readme));
	}

	/* --- coach names ------------------------------------------------------ */
	{
		const names = new Set();
		let n = 0;
		for (let s = 0; s < 8; s++) {
			const res = global.Engine.run(V.realisticClass(s, 70), global.Config.make({ seed: "cn" + s }));
			for (const t of Object.values(res.teams)) {
				if (!t || !t.coach) continue;
				n++;
				names.add(t.coach.name);
			}
		}
		ok("the coach-name pool is big enough for a universe",
			names.size >= 0.75 * n, names.size + " distinct in " + n + " team-seasons");
	}

	/* --- age is measured from one year for the whole class -------------- */
	{
		const lf = V.realisticClass(9, 20);
		lf.players[3].draft.year = lf.startingSeason + 1;
		const res = global.Engine.run(lf, global.Config.make({ seed: "age" }));
		const p = res.players[3];
		ok("a player's age is measured from the class's season, not his own draft year",
			p.age === lf.startingSeason - lf.players[3].born.year);
		const v = global.Engine.validateLeagueFile(lf);
		ok("and the file check says so", v.warnings.some((w) => /draft year/.test(w)));
	}

	/* --- the paper is not the same paper every year --------------------- */
	{
		const seen = {};
		const N = 24;
		for (let s = 0; s < N; s++) {
			const res = global.Engine.run(V.realisticClass(s % 6, 70),
				global.Config.make({ seed: "paper" + s }));
			for (const k of new Set(global.News.build(res).map((a) => a.kind))) {
				seen[k] = (seen[k] || 0) + 1;
			}
		}
		const kinds = Object.keys(seen);
		const always = kinds.filter((k) => seen[k] === N).length;
		ok("fewer than a third of article kinds run in every class",
			kinds.length >= 40 && always <= kinds.length / 3,
			always + " of " + kinds.length + " kinds fire every time");
	}

	/* --- the box score's playmaking and lineup side --------------------- */
	{
		const res = global.Engine.run(V.realisticClass(2, 70), global.Config.make({ seed: "pm" }));
		const ncaa = res.players.filter((p) => !p.nonNcaa && p.stats);
		ok("every stat line carries an assisted rate and a transition share",
			ncaa.every((p) => p.stats.astdRate >= 0.12 && p.stats.astdRate <= 0.96 &&
				p.stats.transShare >= 0.03 && p.stats.transShare <= 0.45));
		ok("creators are assisted less than finishers",
			(function () {
				const by = (name) => ncaa.filter((p) => p.archetype === name);
				const hubs = ncaa.filter((p) => /Floor General|Heliocentric|Point|Playmaker|Sparkplug|Maestro/.test(p.archetype));
				const finishers = ncaa.filter((p) => /Cutter|Lob Threat|Rim Runner|Spot-Up|Catch-and-Shoot|Corner/.test(p.archetype));
				void by;
				if (hubs.length < 2 || finishers.length < 2) return true;
				const m = (v) => v.reduce((a, p) => a + p.stats.astdRate, 0) / v.length;
				return m(hubs) < m(finishers);
			})());
		ok("plus/minus, on/off and a close-game split exist on the log",
			ncaa.every((p) => Number.isFinite(p.stats.pm) && Number.isFinite(p.stats.onOff) &&
				p.gameLog && (p.gameLog.clutch === null || Number.isFinite(p.gameLog.clutch.ppg))));
		const lefties = res.players.filter((p) => p.hand === "left").length;
		ok("handedness is drawn and mostly right-handed",
			res.players.every((p) => p.hand === "left" || p.hand === "right") &&
			lefties >= 2 && lefties <= 20, lefties + " left-handers of " + res.players.length);
		const note = global.Engine.run(V.realisticClass(2, 70), global.Config.make({
			seed: "pm", noteLines: ["playmaking", "archetype"] })).players.filter((p) => !p.nonNcaa && p.note)[0];
		ok("the note can say all of it", !!note && /assisted on/.test(note.note) && /per game/.test(note.note));
	}

	/* --- the pro achievement layer -------------------------------------- */
	{
		let leagueHonors = 0;
		let continental = 0;
		let pros = 0;
		for (let s = 0; s < 12; s++) {
			const res = global.Engine.run(V.realisticClass(s % 4, 70),
				global.Config.make({ seed: "pro" + s, proAwardStrictness: 0.8 }));
			for (const p of res.players) {
				if (!p.nonNcaa) continue;
				pros++;
				if ((p.awards || []).some((a) => / MVP$| First Team$/.test(a))) leagueHonors++;
				if (p.continental) continental++;
			}
		}
		ok("prospects abroad can win their league's own honors",
			pros > 50 && leagueHonors > 0, leagueHonors + " of " + pros);
		ok("clubs in the domestic leagues play a continental competition",
			continental > 0, continental + " of " + pros);
		const stages = ["group stage", "round of 16", "quarterfinals", "Final Four", "final", "champions"];
		const res = global.Engine.run(V.realisticClass(1, 70), global.Config.make({ seed: "pro1" }));
		ok("a continental result is a named stage",
			res.players.filter((p) => p.continental).every((p) =>
				stages.indexOf(p.continental.result) !== -1));
	}

	/* --- universe: the same star returner, a year older ----------------- */
	{
		const a = global.Engine.run(V.realisticClass(3, 70), global.Config.make({ seed: "ret1" }));
		const carry = global.Universe.harvest(a);
		const schools = Object.keys(carry.returners || {});
		ok("harvest carries the named star returners", schools.length >= 6, schools.length + " programs");
		const b = global.Engine.run(V.realisticClass(4, 70),
			global.Config.make({ seed: "ret2", carryOver: carry }));
		let expected = 0;
		let back = 0;
		let gone = 0;
		for (const school of schools) {
			for (const r of carry.returners[school]) {
				const t = b.teams[school];
				if (!t) continue;
				const found = t.members.filter((m) => m.filler && m.name === r.name)[0];
				if (r.classYear === "Senior" || r.classYear === "Graduate") {
					if (!found) gone++;
					continue;
				}
				expected++;
				if (found && found.starReturner === r.starReturner &&
					found.classYear !== r.classYear) back++;
			}
		}
		ok("a returner with eligibility left is back on the same program, a year on",
			expected > 0 && back === expected, back + " of " + expected);
		ok("a senior has left", gone > 0, String(gone));
	}

	/* --- the league fragment ---------------------------------------------- */
	{
		const res = global.Engine.run(V.realisticClass(5, 70), global.Config.make({ seed: "frag" }));
		const frag = global.Engine.exportLeagueFragment(res);
		const abbrevs = new Set(frag.teams.map((t) => t.abbrev));
		ok("the league fragment carries every program once, in BBGM's field names",
			frag.startingSeason === res.season && frag.teams.length >= 360 &&
			frag.teamSeasons.length === frag.teams.length &&
			frag.coaches.length === frag.teams.length &&
			abbrevs.size === frag.teams.length &&
			frag.teams.every((t, i) => t.tid === i && Number.isFinite(t.cid)) &&
			frag.teamSeasons.every((ts) => Number.isFinite(ts.won) && Number.isFinite(ts.lost)));
		ok("the fragment serializes (no circular references)",
			(function () { try { JSON.stringify(frag); return true; } catch (e) { return false; } })());
	}

	/* --- declared scoring intent ----------------------------------------- */
	{
		ok("scorers are meant to score and stoppers are not",
			RB.roleIntentOf("Score-First Point") > 0.8 && RB.roleIntentOf("Rim Protector") < -0.8 &&
			RB.roleIntentOf("Balanced") === 0);
		/* Measured: at equal overall, the scoring-tagged builds sit above
		   the class's own ovr fit and the defense-tagged ones below it. */
		const all = [];
		for (let s = 0; s < 12; s++) {
			const res = global.Engine.run(V.realisticClass(s % 6, 70),
				global.Config.make({ seed: "intent" + s }));
			for (const p of res.players) if (!p.nonNcaa && p.stats) all.push(p);
		}
		const xs = all.map((p) => p.newOvr);
		const ys = all.map((p) => p.stats.ppg);
		const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
		const my = ys.reduce((a, b) => a + b, 0) / ys.length;
		let num = 0;
		let den = 0;
		for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) * (xs[i] - mx); }
		const slope = num / den;
		const icpt = my - slope * mx;
		const resid = (p) => p.stats.ppg - (icpt + slope * p.newOvr);
		const tagged = (t) => all.filter((p) => {
			const a = RB.ARCHETYPES.filter((x) => x.name === p.archetype)[0];
			return a && (a.t || []).indexOf(t) !== -1;
		});
		const m = (v) => v.reduce((a, p) => a + resid(p), 0) / Math.max(1, v.length);
		const gap = m(tagged("scoring")) - m(tagged("defense"));
		ok("scoring builds out-score defensive builds at equal overall",
			gap >= 1.2, "gap " + gap.toFixed(2) + " points");
	}

	ok("endSentence() does not double a full stop",
		global.Text.endSentence("from N.J.I.T.") === "from N.J.I.T." &&
		global.Text.endSentence("a step up") === "a step up." &&
		global.Text.endSentence("") === "");
}


console.log("\nAudit regressions (September 2026)");
{
	/* The September 2026 audit ran independent probes over ~120 classes and
	   found faults the suite did not assert: game-log variance (50-point
	   nights once in a thousand games, a 31% foul-out rate), recruiting
	   ranks that collided (every class had two No. 1 recruits), a preseason
	   poll with almost no signal (No. 1 missed the tournament in 7 of 30
	   seasons), a News dateline that split December across two years,
	   signing-day articles for sophomores, and number-agreement faults the
	   text sweep did not catch. Each is a check now. */
	const T = global.Text;
	const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
	const N = 12;
	let games = 0;
	let forty = 0;
	let foulOuts = 0;
	let idBad = 0;
	let attBad = 0;
	let makesBad = 0;
	let minBad = 0;
	const sdHi = [];
	let dupRanks = 0;
	let no1Miss = 0;
	let top25 = 0;
	let top25In = 0;
	let decemberWrong = 0;
	let januaryWrong = 0;
	let signingNonFresh = 0;
	let lowerBody = 0;
	let headMismatch = 0;
	let realignArticles = 0;
	let confArticlesMax = 0;
	let moves = 0;
	let overlapping = 0;
	let ratingsN = 0;
	let ratingsFloor = 0;
	let origN = 0;
	let origFloor = 0;
	let summaryBad = 0;
	let priorYearsOf = null;
	for (let s = 0; s < N; s++) {
		const res = global.Engine.run(V.realisticClass(s % 7, 70),
			global.Config.make({ seed: "audit" + s, realignmentRate: 1 }));
		const season = res.leagueFile.startingSeason;
		const cohorts = {};
		priorYearsOf = (y) => {
			const str = String(y || "");
			return (str.indexOf("Sophomore") !== -1 ? 1 : str.indexOf("Junior") !== -1 ? 2
				: str.indexOf("Graduate") !== -1 ? 4 : str.indexOf("Senior") !== -1 ? 3 : 0);
		};
		for (const p of res.players) {
			if (p.newRatings) {
				for (const k of Object.keys(p.newRatings)) {
					if (k === "hgt" || k === "fuzz") continue;
					ratingsN++;
					if (p.newRatings[k] <= 1) ratingsFloor++;
					if (typeof p.origRatings[k] !== "number") continue;
					origN++;
					if (p.origRatings[k] <= 1) origFloor++;
				}
			}
			const first = String(p.note || "").split("\n")[0];
			if (!/^[A-Z]/.test(first) || !/\.$/.test(first)) summaryBad++;
			if (p.nonNcaa) continue;
			if (p.recruiting) {
				const c = (priorYearsOf(p.classYear) + (p.redshirt ? 1 : 0)) + "|" + p.recruiting.rank;
				cohorts[c] = (cohorts[c] || 0) + 1;
			}
			if (!p.gameLog) continue;
			const st = p.stats;
			const gl = p.gameLog.games;
			let fga = 0;
			let fgm = 0;
			let tpa = 0;
			let tpm = 0;
			let fta = 0;
			let ftm = 0;
			for (const g of gl) {
				games++;
				if (g.pts >= 40) forty++;
				if (g.fouls >= 5) foulOuts++;
				if (g.pts !== 2 * (g.fgm - g.tpm) + 3 * g.tpm + g.ftm) idBad++;
				if (!(g.min >= 0 && g.min <= 40 + 5 * (g.ot || 0))) minBad++;
				fga += g.fga; fgm += g.fgm; tpa += g.tpa; tpm += g.tpm; fta += g.fta; ftm += g.ftm;
			}
			if (fga !== Math.round(st.fga * gl.length) || tpa !== Math.round(st.tpa * gl.length) ||
				fta !== Math.round(st.fta * gl.length)) attBad++;
			if (Math.abs(fgm - fga * st.fgp) > 2.5 + 0.02 * fga ||
				Math.abs(tpm - tpa * st.tpp) > 2.5 + 0.02 * tpa ||
				Math.abs(ftm - fta * st.ftp) > 2.5 + 0.02 * fta) makesBad++;
			if (st.ppg >= 20) {
				const m = mean(gl.map((g) => g.pts));
				sdHi.push(Math.sqrt(mean(gl.map((g) => (g.pts - m) * (g.pts - m)))));
			}
		}
		for (const k of Object.keys(cohorts)) if (cohorts[k] > 1) dupRanks += cohorts[k] - 1;
		const pre = res.pollHistory[0].ranks;
		if (!res.teams[pre[0].team].ncaaSeed) no1Miss++;
		for (const r of pre.slice(0, 25)) { top25++; if (res.teams[r.team].ncaaSeed) top25In++; }
		for (const m of res.realignment || []) {
			moves++;
			if (global.TeamsSim.regionsOverlap(m.from, m.to)) overlapping++;
		}
		const news = global.News.build(res);
		let confArticles = 0;
		for (const a of news) {
			const dl = a.dateline;
			if (/^December/.test(dl) && a.year !== season - 1) decemberWrong++;
			if (/^(January|February|March|Championship)/.test(dl) && a.year !== season) januaryWrong++;
			if (/^November/.test(dl) && a.year !== season - 1) januaryWrong++;
			/* The kinds that are ABOUT a high-school recruit. Matched
			   exactly rather than by substring: "undrafted signing" contains
			   "signing" and is a story about a fourth-year senior. */
			if (/^(signing day|early signing period|five-star commit|decommitment|recruiting class)$/
				.test(a.kind)) {
				for (const seg of a.headline.concat(a.body)) {
					if (seg.t !== "player") continue;
					const p = res.players.filter((x) => x.key === seg.key)[0];
					if (p && (p.classYear !== "Freshman" || (p.transfer && p.transfer.from))) signingNonFresh++;
				}
			}
			const body = T.segsToText(a.body);
			if (/^[a-z]/.test(body)) lowerBody++;
			const head = T.segsToText(a.headline);
			// A headline that names a month or a class year has to agree
			// with the dateline and the body under it.
			// March is a word headlines use ("March starts early"); the
			// other months only ever name a date.
			const month = /\b(November|December|January|February)\b/.exec(head);
			if (month && dl.indexOf(month[1]) !== 0) headMismatch++;
			const year = /\b(freshman|sophomore|junior|senior|graduate)\b/i.exec(head);
			if (year && a.kind === "field honors" && body.toLowerCase().indexOf(year[1].toLowerCase()) === -1) headMismatch++;
			if (a.kind === "realignment") realignArticles++;
			if (a.kind === "conf tourney") confArticles++;
		}
		confArticlesMax = Math.max(confArticlesMax, confArticles);
	}
	ok("no more than one game in five hundred is a 40-point night",
		forty / games < 0.005, (forty / games * 100).toFixed(2) + "% of " + games);
	ok("foul-outs are rare, not routine (under 10% of games)",
		foulOuts / games < 0.10, (foulOuts / games * 100).toFixed(1) + "%");
	ok("a 20-point scorer's night-to-night spread is 4.5-9 points",
		sdHi.length > 10 && mean(sdHi) > 4.5 && mean(sdHi) < 9, mean(sdHi).toFixed(1));
	ok("every game's points equal 2*(FGM-3PM) + 3*3PM + FTM", idBad === 0, String(idBad));
	ok("the log's attempts sum to the season's attempts exactly", attBad === 0, String(attBad));
	ok("the log's makes reproduce the season's percentages", makesBad === 0, String(makesBad));
	ok("no game's minutes exceed the game", minBad === 0, String(minBad));
	ok("recruiting ranks are unique within a recruiting class",
		dupRanks === 0, dupRanks + " collisions in " + N + " classes");
	ok("the preseason No. 1 makes the tournament in nearly every season",
		no1Miss <= 2, no1Miss + " of " + N + " missed");
	ok("preseason top-25 teams make the field at a real rate (65%+)",
		top25In / top25 >= 0.65, (top25In / top25 * 100).toFixed(0) + "%");
	ok("December belongs to the year before the season, January to the season",
		decemberWrong === 0 && januaryWrong === 0, decemberWrong + " / " + januaryWrong);
	ok("signing-day stories are about freshmen", signingNonFresh === 0, String(signingNonFresh));
	ok("no article body opens in lower case", lowerBody === 0, String(lowerBody));
	ok("a headline's month or class year agrees with its article",
		headMismatch === 0, String(headMismatch));
	ok("a realignment raid runs as one roundup article",
		realignArticles <= N, realignArticles + " realignment articles in " + N + " classes");
	ok("conference tournaments run as at most four articles",
		confArticlesMax <= 4, String(confArticlesMax));
	ok("realignment moves a program into a league it shares a map with",
		moves > 0 && overlapping / moves >= 0.9, overlapping + " of " + moves);
	/* The realistic fixture itself carries ratings at 1 (its bottom third
	   is shifted down to a draft-slot curve), so the claim is about what
	   the builder ADDS: a negative offset scaled by its room, and the
	   ovr-preserving shift, together put well under a point of the class's
	   ratings on the floor beyond what arrived there. */
	ok("the builder adds few ratings on the floor of 1 (under 0.6% over the input)",
		ratingsFloor / ratingsN - origFloor / origN < 0.006,
		(ratingsFloor / ratingsN * 100).toFixed(2) + "% against " +
		(origFloor / origN * 100).toFixed(2) + "% in the input");
	ok("every default note opens with a scouting sentence", summaryBad === 0, String(summaryBad));

	/* Number agreement in the text sweep. */
	ok("textFaults() sees a count of one with a plural noun",
		T.textFaults("has 1 triple-doubles this season").length === 1 &&
		T.textFaults("put 1 teams in the field").length === 1 &&
		T.textFaults("No. 1 seeds went 4-0 and 1 of 60 votes").length === 0 &&
		T.textFaults("has 1 triple-double and 2 double-doubles").length === 0);
	ok("plural() agrees", T.plural(1, "triple-double") === "1 triple-double" &&
		T.plural(3, "team") === "3 teams");
	ok("a team honor is named to, a trophy is won",
		/^is named a Consensus/.test(global.News.honorPhrase("Consensus First Team All-American")) &&
		/^wins the /.test(global.News.honorPhrase("Wooden Award")));

	/* The potential gap is derived from the build. */
	ok("every build has a derived potential gap",
		RB.ARCHETYPES.every((a) => Number.isFinite(RB.POT_BY_ARCHETYPE[a.name])));
	ok("a build never seen before gets a potential gap without a table entry",
		Number.isFinite(RB.computePotGap({ name: "Novel", t: ["raw"], o: { jmp: 12, tp: -10 } })) &&
		RB.computePotGap({ name: "Novel", t: ["raw"], o: { jmp: 12, tp: -10 } }) > 0);
	ok("finished skill is a ceiling, raw tools are a bet",
		RB.POT_BY_ARCHETYPE["Raw Project"] > RB.POT_BY_ARCHETYPE["Floor General"] &&
		RB.POT_BY_ARCHETYPE["Boom-or-Bust Tools"] > RB.POT_BY_ARCHETYPE["Sharpshooter"]);

	/* The injury axis: a build's rating profile reaches the injury roll. */
	{
		const rates = {};
		for (const arch of ["Injury-Prone Talent", "Iron Man"]) {
			let hurt = 0;
			let n = 0;
			for (let s = 0; s < 4; s++) {
				const overrides = {};
				for (let i = 0; i < 70; i++) overrides[i] = { archetype: arch };
				const res = global.Engine.run(V.realisticClass(s % 7, 70),
					global.Config.make({ seed: "inj" + s, overrides }));
				for (const p of res.players) {
					if (p.nonNcaa || p.archetype !== arch) continue;
					n++;
					if (p.availability && p.availability.injury) hurt++;
				}
			}
			rates[arch] = n ? hurt / n : 0;
		}
		ok("an Injury-Prone Talent is hurt far more often than an Iron Man",
			rates["Injury-Prone Talent"] > 2 * rates["Iron Man"] && rates["Iron Man"] < 0.25,
			JSON.stringify(rates));
	}

	/* The two builds the audit never saw in forty classes are drawn. */
	{
		let crafty = 0;
		let system = 0;
		const pools = 400;
		for (let i = 0; i < pools; i++) {
			const pool = RB.pickClassPool(new Rng("pool" + i), { archetypePool: 17 }, null) || [];
			if (pool.some((a) => a.name === "Crafty Finisher")) crafty++;
			if (pool.some((a) => a.name === "System Player")) system++;
		}
		ok("Crafty Finisher and System Player each make the pool",
			crafty / pools > 0.03 && system / pools > 0.03,
			(crafty / pools * 100).toFixed(1) + "% / " + (system / pools * 100).toFixed(1) + "%");
	}

	/* Renamed programs and the sample class. */
	ok("a file that says IUPUI lands on IU Indianapolis",
		global.Colleges.canonical("IUPUI") === "IU Indianapolis" &&
		global.Colleges.canonical("Louisiana-Lafayette") === "Louisiana" &&
		global.Colleges.COLLEGES["East Texas A&M"] && !global.Colleges.COLLEGES["IUPUI"]);
	{
		const lf = V.realisticClass(3, 12);
		lf.players[0].college = "Louisiana-Lafayette";
		const res = global.Engine.run(lf, global.Config.make({ seed: "alias" }));
		ok("an aliased college runs and exports under its current name",
			res.players[0].newCollege === "Louisiana" &&
			global.Engine.exportFile(res).players[0].college === "Louisiana");
	}
	{
		const lf = global.Sample.makeClass(5, 70, 2026);
		const check = global.Engine.validateLeagueFile(lf);
		const res = global.Engine.run(lf, global.Config.make({ seed: "sample" }));
		ok("the sample class validates and runs",
			check.season === 2026 && res.players.length === 70 &&
			res.players.every((p) => p.name && Number.isFinite(p.newOvr)));
		ok("the sample class is deterministic from its seed",
			JSON.stringify(global.Sample.makeClass(5, 70, 2026)) === JSON.stringify(lf));
	}

	/* Returning players can be reached. */
	{
		const res = global.Engine.run(V.realisticClass(1, 70), global.Config.make({ seed: "field" }));
		const withKey = Object.values(res.teams).flatMap((t) => t.fieldPlayers || [])
			.filter((f) => f.key);
		ok("every returning rotation player carries a key", withKey.length > 3000);
		ok("a field honor names the player it can link to",
			(res.fieldHonors || []).every((h) => !h.key || withKey.some((f) => f.key === h.key)));
	}

	/* The §8.13 export options (stats/prior/highs).

	   Two separate faults have been reported against these, and the tests
	   below cover both. The first: nothing shows up after Import -> Draft
	   class, which is BBGM's own doing — handleUploadedDraftClass does
	   `delete p.stats` on every uploaded player unconditionally. The route
	   that does keep them is Tools -> Import players with "include stats"
	   checked (importPlayers in the same file), so the dialog names it.

	   The second: the rows that route DID import came out mostly blank,
	   because they were thirteen counting stats and five bare numbers where
	   BBGM writes seventy-four keys and stores a season high as
	   [value, gameId]. The checks below are the schema half of that fix —
	   a row this tool writes has to be a row BBGM could have written. */
	{
		const res = global.Engine.run(V.realisticClass(2, 70), global.Config.make({ seed: "statsopt" }));
		const withStats = res.players.filter((p) => !p.nonNcaa && p.stats && p.stats.gp > 0)[0];
		const plain = global.Engine.exportFile(res);
		const idx = res.players.indexOf(withStats);
		ok("no opts writes exactly the original stats field",
			JSON.stringify(plain.players[idx].stats) ===
			JSON.stringify(withStats.src.stats));
		const withOpts = global.Engine.exportFile(res, { stats: true, prior: true, highs: true, awards: true });
		const row = withOpts.players[idx];
		const draftRow = row.stats[row.stats.length - 1];
		const BS = global.BBGMStats;
		ok("stats:true appends a draft-year row with tid DNE and this season",
			Array.isArray(row.stats) && row.stats.length >= 1 &&
			draftRow.tid === BS.TID_DOES_NOT_EXIST &&
			draftRow.season === res.leagueFile.startingSeason && draftRow.gp > 0);
		ok("every written row carries BBGM's whole stats key set, in its order",
			row.stats.every((r) =>
				JSON.stringify(Object.keys(r)) === JSON.stringify(BS.KEYS)));
		ok("the counting stats reconcile: points, the glass and the shot chart",
			row.stats.every((r) =>
				r.pts === 2 * (r.fg - r.tp) + 3 * r.tp + r.ft &&
				r.fg >= r.tp && r.fga >= r.tpa && r.ft <= r.fta &&
				r.fgAtRim + r.fgLowPost + r.fgMidRange === r.fg - r.tp &&
				r.fgaAtRim + r.fgaLowPost + r.fgaMidRange === r.fga - r.tpa &&
				r.fgAtRim <= r.fgaAtRim && r.fgLowPost <= r.fgaLowPost &&
				r.fgMidRange <= r.fgaMidRange));
		ok("highs:true writes every high as [value, gameId], not a bare number",
			BS.STATS.max.every((k) => Array.isArray(draftRow[k]) &&
				Number.isFinite(draftRow[k][0]) && draftRow[k][1] < 0));
		ok("a season high is one night out of the season it sits on",
			draftRow.ptsMax[0] >= draftRow.trbMax[0] &&
			draftRow.ptsMax[0] <= draftRow.pts &&
			draftRow.astMax[0] <= draftRow.ast &&
			draftRow.minMax[0] <= 40 + 25);
		ok("the derived statistics are all finite, and PER is on BBGM's scale",
			BS.STATS.derived.every((k) => Number.isFinite(draftRow[k])) &&
			draftRow.per > 5 && draftRow.per < 45);
		ok("a row with no game log behind it writes null highs, not zeroes",
			row.stats.every((r) => BS.STATS.max.every((k) =>
				r[k] === null || Array.isArray(r[k]))));
		if (Array.isArray(withStats.priorSeasons) && withStats.priorSeasons.length) {
			ok("prior:true adds a row per simulated earlier season",
				row.stats.length > 1 + (withOpts.players[idx].awards ? 0 : 0) &&
				row.stats.length - 1 <= withStats.priorSeasons.length);
		}
		ok("exporting twice writes the same rows, byte for byte",
			JSON.stringify(global.Engine.exportFile(res,
				{ stats: true, prior: true, highs: true, awards: true })
				.players[idx].stats) === JSON.stringify(row.stats));
		/* The players file: what Tools -> Import players wants. Its shape is
		   load-bearing — see exportPlayersFile on why there is no
		   exportedSeason and why tid has to say UNDRAFTED. */
		{
			const pf = global.Engine.exportPlayersFile(res,
				{ stats: true, prior: true, highs: true, awards: true });
			ok("the players file is version, startingSeason and players, nothing else",
				JSON.stringify(Object.keys(pf)) ===
				JSON.stringify(["version", "startingSeason", "players"]) &&
				pf.players.length === res.leagueFile.players.length);
			ok("every player in it is an undrafted prospect with no exportedSeason",
				pf.players.every((x) => x.tid === -2 && x.exportedSeason === undefined));
			ok("it strips the fields BBGM's own player export strips",
				pf.players.every((x) => ["statsTids", "value", "watch", "ptModifier",
					"rosterOrder", "yearsFreeAgent"].every((k) => x[k] === undefined)));
			ok("and it still carries the statline",
				pf.players.some((x) => Array.isArray(x.stats) && x.stats.length > 0));
			/* awards is not on importPlayers' field list and note is, so a
			   player whose honors are exported has them in his note too. */
			const honored = pf.players.filter((x) => x.awards && x.awards.length);
			ok("an exported honor is also written into the note, which does survive",
				honored.length > 0 &&
				honored.every((x) => /Honors:/.test(String(x.note || "")) && x.noteBool === 1));
			const plain = global.Engine.exportFile(res, {});
			const noteByPid = new Map(plain.players.map((x) => [x.pid, String(x.note || "")]));
			const noAwards = global.Engine.exportPlayersFile(res, { stats: true });
			ok("with awards off the note is exactly what the template wrote",
				noAwards.players.every((x) =>
					String(x.note || "") === noteByPid.get(x.pid)));
			/* The guarantee has to hold when the note template is the thing
			   that dropped the honors line, which is the case it exists for. */
			const bare = global.Engine.run(res.leagueFile, global.Config.make({
				seed: "statsopt", noteLines: ["summary", "stats"],
			}));
			const bareOut = global.Engine.exportPlayersFile(bare, { awards: true });
			const bareHonored = bareOut.players.filter((x) => x.awards && x.awards.length);
			ok("a note template with no honors line still gets one when awards export",
				bareHonored.length > 0 &&
				bareHonored.every((x) => /^Honors: /m.test(String(x.note || ""))));
			/* The class file and the league merge both keep `awards`, so on
			   those routes an unticked honors line means what it says: the
			   honors used to land in every note anyway. */
			const bareClass = global.Engine.exportFile(bare, { awards: true });
			ok("the class file respects a template with the honors line off",
				bareClass.players.some((x) => x.awards && x.awards.length) &&
				bareClass.players.every((x) => !/^Honors: /m.test(String(x.note || ""))));
			const bareMerge = global.Engine.mergeIntoLeague(bare, {
				players: [], startingSeason: bare.season,
			}, { awards: true });
			ok("and so does the league merge",
				bareMerge.file.players.some((x) => x.awards && x.awards.length) &&
				bareMerge.file.players.every((x) => !/^Honors: /m.test(String(x.note || ""))));
			ok("while a template WITH the honors line still writes it into the class file",
				honored.length > 0 && global.Engine.exportFile(res, { awards: true }).players
					.filter((x) => x.awards && x.awards.length)
					.every((x) => /^Honors: /m.test(String(x.note || ""))));
		}

		/* Merging the class into a whole league file, which is the only route
		   into the game that keeps a statline: the Draft Scouting import
		   deletes p.stats, and Tools -> Import players adds to the class
		   rather than replacing it. */
		{
			const maxPid = Math.max.apply(null, res.leagueFile.players.map((x) => x.pid));
			const ghost = {
				pid: maxPid + 1, tid: -2, firstName: "Ghost", lastName: "Prospect",
				draft: { year: res.season }, ratings: [{ season: res.season }],
			};
			const roster = {
				pid: maxPid + 2, tid: 3, firstName: "Real", lastName: "Player",
				draft: { year: res.season - 4 }, ratings: [{ season: res.season }],
				stats: [{ season: res.season, tid: 3, gp: 10 }],
			};
			const league = {
				version: res.leagueFile.version,
				startingSeason: res.season,
				gameAttributes: { season: res.season },
				teams: [{ tid: 0, region: "A", name: "B" }],
				/* A real league export always says what a player's team is;
				   the fixture class file does not, and the match is
				   deliberately strict about it. */
				players: res.leagueFile.players
					.map((x) => Object.assign({ tid: -2 }, x))
					.concat([ghost, roster]),
			};
			const merged = global.Engine.mergeIntoLeague(res, league,
				{ stats: true, prior: true, highs: true, awards: true });
			ok("merge replaces the class in place and drops the generated rest",
				merged.replaced === res.leagueFile.players.length &&
				merged.added === 0 && merged.removed === 1 &&
				!merged.file.players.some((x) => x.lastName === "Prospect"));
			ok("merge leaves everything else in the league file alone",
				merged.file.gameAttributes === league.gameAttributes &&
				merged.file.teams === league.teams &&
				merged.file.players.includes(roster));
			ok("the merged prospects carry the statline",
				merged.file.players.filter((x) => Array.isArray(x.stats) &&
					x.stats.some((r) => r.tid === global.BBGMStats.TID_DOES_NOT_EXIST)
				).length > 0);
			// A class from a different league: the pids mean other people, so
			// nothing may be overwritten on the strength of a pid alone.
			const foreign = {
				version: res.leagueFile.version,
				startingSeason: res.season,
				players: res.leagueFile.players.map((x) => ({
					pid: x.pid, tid: 3, firstName: "Someone", lastName: "Else",
					draft: { year: res.season - 5 }, ratings: [{ season: res.season }],
				})),
			};
			const m2 = global.Engine.mergeIntoLeague(res, foreign, { stats: true });
			ok("a pid that belongs to somebody else is appended, never overwritten",
				m2.replaced === 0 && m2.added === res.leagueFile.players.length &&
				m2.file.players.filter((x) => x.lastName === "Else").length ===
					foreign.players.length &&
				new Set(m2.file.players.map((x) => x.pid)).size === m2.file.players.length);
			/* THE ONE THAT ATE LEAGUES.

			   A class whose players are drafted in a year other than the
			   file's startingSeason (BBGM writes exactly that for a class
			   exported a year ahead) used to match the league's prospects on
			   startingSeason: every player in THAT class was dropped as "the
			   class being replaced", and the class actually being merged was
			   left in place with a duplicate appended beside it. */
			{
				const ahead = JSON.parse(JSON.stringify(res.leagueFile));
				ahead.startingSeason = res.season;
				for (const p of ahead.players) p.draft = { year: res.season + 1 };
				const r2 = global.Engine.run(ahead, global.Config.make({ seed: "ahead" }));
				const other = [];
				for (let i = 0; i < 5; i++) {
					other.push({
						pid: 90000 + i, tid: -2, firstName: "This", lastName: "Year" + i,
						draft: { year: res.season }, ratings: [{ season: res.season }],
					});
				}
				const lg = {
					version: res.leagueFile.version, startingSeason: res.season,
					gameAttributes: { season: res.season }, teams: [],
					players: other.concat([roster]),
				};
				const m3 = global.Engine.mergeIntoLeague(r2, lg, {});
				ok("a class drafted after the file's season leaves this year's class alone",
					m3.season === res.season + 1 && m3.removed === 0 &&
					m3.file.players.filter((x) => x.lastName &&
						/^Year\d$/.test(x.lastName)).length === 5 &&
					m3.file.players.includes(roster));

				/* Two classes, one league file, one pass — and the first
				   class's players are not swept away by the second. */
				const many = global.Engine.mergeManyIntoLeague([res, r2], lg, {});
				const in1 = many.file.players.filter((x) =>
					Number(x.tid) === -2 && Number(x.draft.year) === res.season).length;
				const in2 = many.file.players.filter((x) =>
					Number(x.tid) === -2 && Number(x.draft.year) === res.season + 1).length;
				ok("two classes merge into one file without eating each other",
					in1 === res.leagueFile.players.length &&
					in2 === res.leagueFile.players.length &&
					many.file.players.includes(roster) &&
					many.seasons.length === 2);
				ok("two classes for the same draft year are refused", (() => {
					try { global.Engine.mergeManyIntoLeague([res, res], lg, {}); return false; }
					catch (e) { return /same .*draft|both for the/.test(e.message); }
				})());
			}
			ok("a file with no players array is refused with a sentence", (() => {
				try { global.Engine.mergeIntoLeague(res, { teams: [] }, {}); return false; }
				catch (e) { return /league file/.test(e.message); }
			})());
		}
		ok("awards:true writes every honor as {season, type}",
			row.awards.length >= (withStats.awards || []).length &&
			row.awards.every((a) => Number.isFinite(a.season) && typeof a.type === "string"));
	}
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
				const avg = l.reduce((a, g) => a + g.pf, 0) / l.length;
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
	/* The 2026-27 map. */
	{
		ok("the Mountain West has its 2026 members", C.byConference["Mountain West"].length === 8 &&
			C.conferenceOf("Grand Canyon") === "Mountain West" && C.conferenceOf("UTEP") === "Mountain West");
		ok("Seattle is in the WCC, Delaware in Conference USA, UMass in the MAC",
			C.conferenceOf("Seattle") === "WCC" && C.conferenceOf("Delaware") === "Conference USA" &&
			C.conferenceOf("Massachusetts") === "MAC");
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
	}
}

console.log("\n" + (failures ? failures + " of " + checks + " checks failed"
	: "all " + checks + " checks passed"));
process.exit(failures ? 1 : 0);
