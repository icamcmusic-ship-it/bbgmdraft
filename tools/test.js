#!/usr/bin/env node
/* Regression tests. These are the checks that turn README claims into things a
   CI run can fail on.

   Usage: node tools/test.js [--update-golden]
   Exit code is non-zero if anything fails. */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const V = require("./validate.js");

V.loadEngine();
const { Rng, clamp } = global.BBGMRng;
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
		["no startingSeason", { players: V.syntheticClass(1, 3).players }],
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
	ok("a teenager abroad is held to the league's youth minutes cap",
		elPlayers.every((p) => p.stats.mpg <= cap + 1e-6),
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
		ok.silent = true;
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

console.log("\n" + (failures ? failures + " of " + checks + " checks failed"
	: "all " + checks + " checks passed"));
process.exit(failures ? 1 : 0);
