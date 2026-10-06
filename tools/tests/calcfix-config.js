/* Regression checks for the settings / calibration / potential half of the
   2026-10-05 audit's calculation findings (section 3, C9-C13, and B1's
   anomaly draw and B6). Each is written to fail on the code the finding was
   made against; the numbers in the messages are the ones measured then. */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

module.exports = function (ok, V) {
	const E = global.Engine;
	const C = global.Config;
	const ROOT = path.join(__dirname, "..", "..");
	const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
	const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
	const sd = (a) => {
		const m = mean(a);
		return Math.sqrt(mean(a.map((x) => (x - m) * (x - m))));
	};
	const gapOf = (file) => file.players.map((p) => {
		const r = p.ratings[p.ratings.length - 1];
		return r.pot - r.ovr;
	});

	/* ---- B6: re-importing the tool's own output does not inflate pot ------- */
	{
		/* Six generations at one seed, each export fed back as the next input:
		   the mean gap walked 12.0, 12.3, 13.2, 14.7, 16.3, 17.9, 19.6 (seed
		   "a"; 11.0 -> 14.2 in the audit's own run), and its sd 5.0, 6.7, 9.7,
		   12.7... */
		let lf = V.realisticClass("a", 100);
		const input = gapOf(lf);
		const series = [];
		const sds = [];
		let last = null;
		for (let gen = 0; gen < 6; gen++) {
			const res = E.run(lf, C.make({ seed: "a" }));
			last = E.exportFile(res, {});
			const g = gapOf(last);
			series.push(mean(g));
			sds.push(sd(g));
			lf = JSON.parse(JSON.stringify(last));
		}
		const flat = Math.max.apply(null, series.slice(1)) - Math.min.apply(null, series.slice(1));
		ok("B6/the mean pot-ovr gap is flat over six generations of re-import",
			flat <= 0.05, "means " + series.map((x) => x.toFixed(2)).join(" ") + " (input " + mean(input).toFixed(2) + ")");
		ok("B6/...and so is its spread",
			Math.max.apply(null, sds.slice(1)) - Math.min.apply(null, sds.slice(1)) <= 0.05,
			sds.map((x) => x.toFixed(2)).join(" "));
		ok("B6/a native file's first pass does not collapse or inflate the class",
			Math.abs(series[0] - mean(input)) <= 1.5 && sds[0] >= 0.8 * sd(input) && sds[0] <= 1.8 * sd(input),
			"mean " + mean(input).toFixed(2) + " -> " + series[0].toFixed(2) + ", sd " + sd(input).toFixed(2) + " -> " + sds[0].toFixed(2));
		ok("B6/the file carries the tool's mark at its root, and only there",
			last.bbgmdraft && last.bbgmdraft.pot && last.bbgmdraft.pot["2026"] &&
			last.players.every((p) => !("bbgmdraft" in p) && !("bbgmdraft" in p.draft)),
			JSON.stringify(last.bbgmdraft));
		/* The same re-import with the mark removed is a BBGM file to the tool:
		   it adjusts again (so the mark is what the flat series depends on). */
		const stripped = JSON.parse(JSON.stringify(last));
		delete stripped.bbgmdraft;
		const again = E.exportFile(E.run(stripped, C.make({ seed: "a" })), {});
		ok("B6/without the mark the file is adjusted again, as any native file is",
			JSON.stringify(gapOf(again)) !== JSON.stringify(gapOf(last)));
		/* A dial moved on a marked file still moves it: by the difference. */
		const up = E.exportFile(E.run(JSON.parse(JSON.stringify(last)), C.make({ seed: "a", potBias: 2 })), {});
		ok("B6/a marked file still answers the bias dial, by the difference",
			mean(gapOf(up)) - mean(gapOf(last)) > 3.5 && mean(gapOf(up)) - mean(gapOf(last)) < 5.5,
			(mean(gapOf(up)) - mean(gapOf(last))).toFixed(2));
		const res2 = E.run(JSON.parse(JSON.stringify(last)), C.make({ seed: "a" }));
		ok("B6/the editor's potential breakdown says the file's potential was kept",
			res2.players.every((p) => p.potFactors && p.potFactors.fromFile === true));
		/* The factors average zero over a class (they redistribute the file's
		   gap), so a fresh file's level is the file's. */
		const fresh = E.run(V.realisticClass("a", 100), C.make({ seed: "a" }));
		const net = mean(fresh.players.map((p) => p.potFactors.total + p.potFactors.centre));
		ok("B6/the additive factors are centred on zero over a class", Math.abs(net) < 1e-9, String(net));
		/* A curve-drawn gap is not the file's, so the mark does not freeze it. */
		const curve = E.run(JSON.parse(JSON.stringify(last)), C.make({ seed: "a", ovrMode: "curve" }));
		ok("B6/in curve mode a marked file's potential is still drawn",
			curve.players.some((p) => !p.potFactors.fromFile));
		/* league merges and class extraction keep the mark for the right year */
		const league = { version: last.version, startingSeason: 2026, gameAttributes: { season: 2026 },
			teams: [], players: last.players.concat([]) };
		league.bbgmdraft = last.bbgmdraft;
		ok("B6/extracting a class from a league carries that class's mark",
			!!E.extractDraftClass(league, 2026).bbgmdraft &&
			!!E.extractDraftClass(league, 2026).bbgmdraft.pot["2026"]);
	}

	/* ---- B1: the physical outlier is half a foot from HIS height ----------- */
	{
		const shifts = [];
		let outOfRange = 0;
		let exportMismatch = 0;
		let lowRatingFromTall = 0;
		for (let i = 0; i < 12; i++) {
			const lf = V.realisticClass("o" + i, 40);
			const res = E.run(lf, C.make({ seed: "o" + i, lockHeights: false, surpriseBudget: 10 }));
			const file = E.exportFile(res, {});
			res.players.forEach((p, k) => {
				if (!p.sizeOutlier) return;
				shifts.push(p.newHgtInches - p.hgtInches);
				if (p.newHgtInches < 66 || p.newHgtInches > 93) outOfRange++;
				if (file.players[k].hgt !== p.newHgtInches) exportMismatch++;
				if (p.hgtInches >= 72 && p.newHgtInches < p.hgtInches && p.newRatings.hgt <= 7) lowRatingFromTall++;
			});
		}
		ok("B1/the outlier anomaly occurred", shifts.length >= 6, String(shifts.length));
		ok("B1/every outlier is 5-7 inches from his own height (was -19..+21)",
			shifts.every((d) => Math.abs(d) >= 5 && Math.abs(d) <= 7),
			shifts.join(","));
		ok("B1/...stays inside the 5'6\"-7'9\" range", outOfRange === 0, String(outOfRange));
		ok("B1/...and the export writes the changed height", exportMismatch === 0, String(exportMismatch));
		ok("B1/a man who was 6'0\" or taller does not come out with a hgt rating of 0-7", lowRatingFromTall === 0,
			String(lowRatingFromTall));
	}

	/* ---- C9: the bands can fail ------------------------------------------- */
	{
		const sdFile = V.SD_FILE;
		ok("C9/the sampling-sd table is committed", fs.existsSync(sdFile));
		const table = fs.existsSync(sdFile) ? JSON.parse(fs.readFileSync(sdFile, "utf8")) : { values: {} };
		const keys = Object.keys(table.values);
		ok("C9/...and covers the rows (330+ keys)", keys.length >= 330, String(keys.length));

		const { rows } = V.collect(3, { era: "modern" }, "realistic");
		const SIGNED = /corr\(|minus|BPM|On\/off|mean vs source|\bshift\b/i;
		const neg = rows.filter((r) => r.lo < 0 && !SIGNED.test(r.name));
		ok("C9/no unsigned row has a negative lower edge (was 58 of 362 at 3 seeds)",
			neg.length === 0, neg.map((r) => r.name + " " + r.lo.toFixed(2)).join("; "));
		const widths = (rs) => rs.filter((r) => /^MPG p5$|^PF mean$|^BPG p95$/.test(r.name))
			.map((r) => r.name + " [" + r.lo.toFixed(2) + ", " + r.hi.toFixed(2) + "]");
		const mpg = rows.filter((r) => r.name === "MPG p5")[0];
		ok("C9/MPG p5 is no longer [3.93, 40.07]", mpg && mpg.hi / mpg.lo < 2.5, widths(rows).join(" "));

		/* The bands can FAIL: a model scaled the way an uncalibrated one is
		   wrong (see PERTURBATION) trips many of them at the documented 3
		   seeds, and the model as it is does not trip them. */
		const st = V.selfTest(3);
		ok("C9/a deliberately wrong model fails many bands at 3 seeds (and the real one does not)",
			st.bad.length >= V.SELF_TEST_MIN && st.bad.length > st.base.length + 8,
			"as is " + st.base.length + " (" + st.base.map((r) => r.name).join("; ") + "); perturbed " + st.bad.length +
			" (" + st.bad.map((r) => r.name).join("; ").slice(0, 400) + ")");

		/* The mechanism, on its own. */
		const b = { kind: "scaled", nlo: 10, nhi: 14, lo: 12 - 2 * 2.58, hi: 12 + 2 * 2.58 };
		const at20 = V.resolveBand("x", b, undefined, 20, "none/none");
		ok("C9/a band with no recorded sd falls back to the old rule", at20[0] === b.lo && at20[1] === b.hi);
		ok("C9/a count's lower edge is floored at zero, a correlation's is not",
			V.resolveBand("25+ PPG scorers/class", { kind: "scaled", nlo: 0.5, nhi: 3.8, lo: -2, hi: 6 }, undefined, 3, "x")[0] === 0 &&
			V.resolveBand("corr(a, b)", { kind: "corr", nlo: 0.1, nhi: 0.7, lo: -0.3, hi: 1 }, undefined, 3, "x")[0] === -0.3);
		ok("C9/a fixed band is passed through", V.resolveBand("x", 1, 2, 3, "x").join() === "1,2");

		/* The bands are anchored to the era's real-world numbers, not to the
		   model: a row's centre does not move when the model does. */
		const CAL = global.Calibration;
		const dy = CAL.eraInfo("modern").draftYear;
		const ts = rows.filter((r) => r.name === "TS% mean")[0];
		ok("C9/TS% mean's band is centred on the era anchor, not on the model's own value",
			ts && Math.abs((ts.lo + ts.hi) / 2 - dy.ts.mean * 100) < 0.01,
			ts ? ((ts.lo + ts.hi) / 2).toFixed(3) + " vs " + dy.ts.mean * 100 : "no row");
	}

	/* ---- C10: Balanced is exact ------------------------------------------- */
	{
		for (const d of [0, 50, 85, 92, 100]) {
			const counts = [];
			for (let i = 0; i < 4; i++) {
				const res = E.run(V.realisticClass("bal" + i, 70),
					C.make({ seed: "bal" + i, archetypeDiversity: d, surpriseBudget: 0 }));
				counts.push(res.players.filter((p) => p.archetype === "Balanced").length);
			}
			const want = Math.round((70 * (100 - d)) / 100);
			ok("C10/diversity " + d + " leaves exactly " + want + " of 70 Balanced in every class (was 2-14 at 85)",
				counts.every((c) => c === want), counts.join(","));
		}
		/* A lone re-draw has no plan and keeps the old per-player draw. */
		const RB = global.RatingsBuilder;
		ok("C10/planBalanced picks round(n x share) ranks, deterministically",
			RB.planBalanced(new global.BBGMRng.Rng("p"), 70, 85).size === 11 &&
			JSON.stringify(Array.from(RB.planBalanced(new global.BBGMRng.Rng("p"), 70, 85))) ===
			JSON.stringify(Array.from(RB.planBalanced(new global.BBGMRng.Rng("p"), 70, 85))));
		ok("C10/the slider hint says the count is rounded to a whole player",
			/rounded to a whole "\s*\+\s*"player/.test(read("js/app.js")));
	}

	/* ---- C11: presets do what they say ------------------------------------ */
	{
		const preset = C.PRESETS["Guard-heavy class"];
		ok("C11/Guard-heavy class names its flavor", preset.flavorHint === "guard-heavy");
		let drawn = 0;
		for (let i = 0; i < 6; i++) {
			const res = E.run(V.realisticClass("gh" + i, 40), C.make(Object.assign({ seed: "gh" + i }, preset)));
			if (res.flavor && res.flavor.name === "guard-heavy") drawn++;
		}
		ok("C11/...and every seed draws it (was 1 of 12)", drawn === 6, drawn + " of 6");

		const intl = C.PRESETS["International class"];
		ok("C11/International class redraws every destination", intl.collegeSource === "rewrite");
		const live = C.defaultLeagueWeights();
		ok("C11/...with a weight for every league in the live table",
			Object.keys(live).every((k) => intl.leagueWeights[k] > 0));
		const NN = global.Colleges.NON_NCAA;
		NN["Test Stub League"] = Object.assign({}, NN["EuroLeague"], { w: 5 });
		let added;
		try { added = C.PRESETS["International class"].leagueWeights["Test Stub League"]; } finally {
			delete NN["Test Stub League"];
		}
		ok("C11/...computed when the preset is applied, so a new league is in it", added === 20, String(added));
		ok("C11/...abroad up, the American paths down",
			intl.leagueWeights["EuroLeague"] > live["EuroLeague"] && intl.leagueWeights["JUCO"] <= live["JUCO"]);
		const share = (cfg) => {
			let n = 0;
			let t = 0;
			for (let i = 0; i < 6; i++) {
				const res = E.run(V.realisticClass("in" + i, 70), C.make(Object.assign({ seed: "in" + i, narrative: false }, cfg)));
				for (const p of res.players) { t++; if (p.nonNcaa) n++; }
			}
			return n / t;
		};
		const base = share({});
		const abroad = share(intl);
		ok("C11/the International preset sends clearly more of the class outside Division I (was 16.0% vs 16.0%)",
			abroad > base * 1.5, (base * 100).toFixed(1) + "% -> " + (abroad * 100).toFixed(1) + "%");
		/* Under rewrite the weights are absolute against the table: the share
		   they were normalised out of is back. */
		const plain = share({ collegeSource: "rewrite" });
		const doubled = share({ collegeSource: "rewrite", leagueWeights: intl.leagueWeights });
		ok("C11/under rewrite a table of bigger weights raises the share abroad", doubled > plain * 1.4,
			(plain * 100).toFixed(1) + "% -> " + (doubled * 100).toFixed(1) + "%");
	}

	/* ---- C12: labels and curve shape ------------------------------------- */
	{
		const html = read("index.html");
		const cfgSrc = read("js/config.js");
		const app = read("js/app.js");
		ok("C12/the potModel label no longer promises what the game will show",
			!/what the game will show/.test(html) && /monteCarloPot/.test(html));
		ok("C12/potSpread's comment no longer calls it the sd of the gap",
			!/potSpread: 6,\s*\/\/ sd of the ovr -> pot gap/.test(cfgSrc) && /0\.35/.test(cfgSrc.split("potSpread:")[1].split("\n")[0]));
		ok("C12/the potBias hint says the floor at ovr+1 binds", /below ovr\+1/.test(app));
		/* measured: -3 gives about -4.7, +3 about +7 */
		const m = (b) => mean(E.run(V.realisticClass("pb", 70), C.make({ seed: "pb", potBias: b, narrative: false })).players
			.map((p) => p.newPot - p.newOvr));
		const lo = m(-3);
		const mid = m(0);
		const hi = m(3);
		ok("C12/potBias -3 moves the mean by less than the 6.6 the dial asks for, +3 by about that",
			mid - lo < 6.0 && mid - lo > 3.0 && hi - mid > 5.5,
			"-3: " + (lo - mid).toFixed(2) + ", +3: " + (hi - mid).toFixed(2));
		/* the curve's gap falls with ovr, as BBGM's does (was 15.0 -> 20.8) */
		const gaps = { low: [], high: [] };
		for (let i = 0; i < 8; i++) {
			const res = E.run(V.realisticClass("cv" + i, 70), C.make({ seed: "cv" + i, ovrMode: "curve", narrative: false }));
			for (const p of res.players) {
				if (p.newOvr < 25) gaps.low.push(p.newPot - p.newOvr);
				else if (p.newOvr >= 42) gaps.high.push(p.newPot - p.newOvr);
			}
		}
		ok("C12/in curve mode the weak prospects' gap is larger than the strong ones' (bbgm: 21.5 -> 17.0)",
			mean(gaps.low) > mean(gaps.high) + 1.5,
			mean(gaps.low).toFixed(1) + " vs " + mean(gaps.high).toFixed(1));
	}

	/* ---- C13: inert controls ---------------------------------------------- */
	{
		const html = read("index.html");
		const app = read("js/app.js");
		ok("C13/rookieOvrCap is dimmed in preserve mode with the other curve controls",
			/data-curve><label for="rookieOvrCap"/.test(html) && /CURVE_KEYS = \[[^\]]*"rookieOvrCap"/.test(app));
		const memory = (app.match(/MEMORY_NOTE/g) || []).length;
		ok("C13/the three memory settings say they need the page's previous classes",
			memory >= 4 && /no effect from the command line/.test(app), String(memory));

		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bbgmdraft-cf-"));
		const BIN = path.join(ROOT, "bin", "bbgmdraft.js");
		const file = path.join(dir, "c.json");
		fs.writeFileSync(file, JSON.stringify(V.realisticClass("cf", 24)));
		const cli = (...args) => spawnSync(process.execPath, [BIN, "run", file, "--seed", "s", "-q", "--out", "-"].concat(args),
			{ encoding: "utf8", cwd: dir });
		const plain = cli();
		const weighted = cli("--set", 'leagueWeights={"EuroLeague":100,"JUCO":1}', "--set", "collegeSource=rewrite");
		const rewrite = cli("--set", "collegeSource=rewrite");
		ok("C13/--set leagueWeights takes a JSON object and the engine sees it",
			plain.status === 0 && weighted.status === 0 && rewrite.status === 0 && weighted.stdout !== rewrite.stdout,
			weighted.stderr);
		const bad = cli("--set", "leagueWeights=EuroLeague");
		ok("C13/an unparseable value is refused with a clear message",
			bad.status !== 0 && /leagueWeights takes a JSON object/.test(bad.stderr), bad.status + " " + bad.stderr);
		const unknown = cli("--set", 'leagueWeights={"Nowhere":3}');
		ok("C13/an unknown league name is refused", unknown.status !== 0 && /no entry called "Nowhere"/.test(unknown.stderr),
			unknown.stderr);
		const euro = cli("--set", "wEuroLeague=0", "--set", "wGLeague=100");
		ok("C13/--set wEuroLeague takes a number and the engine sees it", euro.status === 0 && euro.stdout !== plain.stdout, euro.stderr);
		const nan = cli("--set", "wEuroLeague=lots");
		ok("C13/...and refuses a word", nan.status !== 0 && /wEuroLeague takes a number/.test(nan.stderr), nan.stderr);
		const ring = cli("--set", "recentPools=[]");
		ok("C13/a page-only container cannot be set from the command line",
			ring.status !== 0 && /cannot be set from the command line/.test(ring.stderr), ring.stderr);
	}
};
