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

/* ---------------------------------------------------------- program style */
/* A shooter at a four-out programme and the same shooter in a pack-line
   offence should not produce the same line. Programs had a strength and
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
	ok("a four-out programme takes more threes than a post-heavy one",
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
	   The old normaliser did that by subtracting uniformly, which took the
	   points out of exactly the ratings BBGM's usage composite reads — so a
	   defensive build came out ovr-neutral by construction and offence-negative
	   by side effect, and "the best defensive big in the class" was a player
	   nobody would draft. */
	const usageKeys = ["ins", "dnk", "fg", "tp"];
	const OVR_W = RB.OVR_W;
	const SHIFT_SCALE = RB.SHIFT_SCALE;
	// What the old uniform normaliser would have produced, for comparison.
	let shiftW = 0;
	for (const k of BB.RATING_KEYS) shiftW += OVR_W[k] * SHIFT_SCALE[k];
	const uniformNormalise = (raw) => {
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
		const was = usageHit(uniformNormalise(RB.RAW_OFFSETS[name]));
		const now = usageHit(a.o);
		ok(name + " keeps more of its offence than a uniform shift would",
			now > was + 1.5,
			"usage ratings shifted " + now.toFixed(1) + ", against " +
				was.toFixed(1) + " under a uniform shift");
	}
	// And it is still ovr-neutral, which is the whole point of normalising.
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
		spec.length > 1 && spec[0] / spec[spec.length - 1] <= 25,
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
	const fingerprint = (res) => res.players.map((p) =>
		p.newOvr + "/" + p.archetype + "/" + (p.stats ? p.stats.ppg.toFixed(2) : "-")).join("|");
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
	   ovr-neutral and the specialisation slider starts meaning something
	   different per build. Nothing could see that.

	   So derive the weights numerically by finite differences and check them
	   against the table. This runs against BB.ovrRaw — the linear half, before
	   the piecewise fudge and the rounding — because against ovr() itself a
	   single rating's contribution disappears into the quantisation: endu moves
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
		ok("a 14-programme season still produces a champion",
			!!(res.tourney && res.tourney.champion && res.tourney.champion.team));
		ok("every prospect still gets a stat line",
			res.players.filter((p) => !p.nonNcaa).every((p) => p.stats));
	} catch (err) {
		ok("a 14-programme season still produces a champion", false, err.message);
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
			rows.push(B.summarise(runner.run(c)));
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
	const row = B.summarise(res);
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
	ok("an upperclassman is given more of the offence than a freshman",
		S.experienceUsage("Senior") > S.experienceUsage("Junior") &&
			S.experienceUsage("Junior") > S.experienceUsage("Sophomore") &&
			S.experienceUsage("Sophomore") > S.experienceUsage("Freshman"));

	/* PPG was typed into the era table and disagreed with the anchors it
	   claimed to follow. It is derived now, so the two cannot drift apart. */
	const CAL = global.Calibration;
	let derivedOk = true;
	for (const name of Object.keys(CAL.ERAS)) {
		const e = CAL.ERAS[name];
		const d = CAL.impliedPpg(e.draftYear, e.team);
		if (Math.abs(d.mean - e.draftYear.ppg.mean) > 1e-9) derivedOk = false;
	}
	ok("the PPG anchor is derived from the era's own numbers", derivedOk);
}

console.log("\n" + (failures ? failures + " of " + checks + " checks failed"
	: "all " + checks + " checks passed"));
process.exit(failures ? 1 : 0);
