/* Universe mode from nothing (audit section 5, items 1, 11, 12): synthetic
   seasons regenerable from a seed, forward simulation as an extension on
   synthetic classes, and named undrafted returners re-entering the next
   synthetic class through the registry. */
"use strict";

module.exports = function (ok, V) {
	const fs = require("fs");
	const path = require("path");
	const E = global.Engine;
	const CFG = global.Config;
	const U = global.Universe;

	/* Drive beginChain as js/app.js does: persistent runners, rebuilt when
	   a synthetic class's data changes. */
	const drive = (files, extra, runners) => {
		runners = runners || files.map((f) => E.createRunner(f.data));
		const c = U.beginChain(Object.assign({
			mode: "cold", files,
			runnable: files.map((f, i) => ({ index: i, name: f.name, season: f.data.startingSeason }))
				.filter((d) => !(extra && extra.skip && extra.skip(d))),
			settings: CFG.make({ seed: "syn" }), baseSeed: "syn",
			make: (s) => CFG.make(s),
			runnerFor: (i) => runners[i],
			dataChanged: (i) => { runners[i] = E.createRunner(files[i].data); },
			extrapolateGaps: false,
		}, extra || {}));
		for (let k = 0; k < c.runnable.length; k++) c.step(k);
		const out = c.finish({});
		return { u: c.universe, out, runners };
	};
	const rowsOf = (u) => JSON.stringify(u.rows.map((r) => [r.season, r.champion, r.result]));

	/* --- the synthetic files ------------------------------------------- */
	{
		const a = U.synthFile("s1", 2030);
		const b = U.synthFile("s1", 2030);
		ok("a synthetic class is regenerable: same seed and season, same file",
			a.fingerprint === b.fingerprint && JSON.stringify(a.data) === JSON.stringify(b.data));
		ok("...with a stable seed-derived fingerprint",
			a.fingerprint === U.synthFingerprint("s1", 2030) && /^syn/.test(a.fingerprint));
		const c = U.synthFile("s1", 2031);
		const d = U.synthFile("s2", 2030);
		ok("...and a different season or seed is a different class",
			c.fingerprint !== a.fingerprint && d.fingerprint !== a.fingerprint &&
			JSON.stringify(c.data.players[0]) !== JSON.stringify(a.data.players[0]));
		const list = U.synthFiles("s1", 2030, 3);
		ok("synthFiles is consecutive seasons",
			list.map((f) => f.data.startingSeason).join() === "2030,2031,2032" &&
			list[0].fingerprint === a.fingerprint);
		const o = { fingerprint: a.fingerprint, synth: a.synthetic };
		const r = U.synthFromOrder(o);
		ok("an order entry's synth record regenerates the file",
			r && r.fingerprint === a.fingerprint && JSON.stringify(r.data) === JSON.stringify(a.data));
		ok("...and refuses one whose fingerprint does not match",
			U.synthFromOrder({ fingerprint: "nope", synth: a.synthetic }) === null &&
			U.synthFromOrder({ fingerprint: "x" }) === null);
		const real = { name: "r.json", data: V.realisticClass(3, 40), fingerprint: "r" };
		const before = JSON.stringify(real.data);
		ok("a real file is never given entrants",
			U.applyEntrants(real, [{ id: "x/1", name: "A B", ratings: {}, from: 2029 }], 2030) === false &&
			JSON.stringify(real.data) === before);
		const f = U.synthFile("s1", 2030);
		const ratings = {};
		for (const k of global.BBGM.RATING_KEYS) ratings[k] = 50;
		const changed = U.applyEntrants(f, [{ id: "fp/7", name: "Ned Returner", school: "Duke",
			ratings, pot: 60, from: 2029 }], 2030);
		const p = f.data.players[f.data.players.length - 1];
		ok("a synthetic class takes a named returner, base untouched",
			changed && f.data.players.length === 71 && f.base.players.length === 70 &&
			p.firstName === "Ned" && p.lastName === "Returner" && p.college === "Duke" &&
			p.ratings[0].season === 2030, JSON.stringify(p && p.ratings[0]));
		ok("...and the same entrants again change nothing",
			U.applyEntrants(f, [{ id: "fp/7", name: "Ned Returner", ratings, from: 2029 }], 2030) === false);
		ok("...and none puts the drawn class back",
			U.applyEntrants(f, [], 2030) === true && f.data === f.base);
		E.createRunner(U.synthFile("s1", 2040).data);
		ok("a synthetic class validates as a league file",
			!!E.validateLeagueFile(U.synthFile("s1", 2040).data));
	}

	/* --- a universe from nothing: determinism and named returners ------- */
	const cold = () => drive(U.synthFiles("s1", 2030, 4));
	const A = cold();
	const B = cold();
	ok("a synthetic universe is identical for one seed and settings",
		rowsOf(A.u) === rowsOf(B.u) &&
		JSON.stringify(A.u.registry) === JSON.stringify(B.u.registry), rowsOf(A.u));
	ok("...every season played, none failed",
		A.u.rows.length === 4 && A.u.rows.every((r) => !r.error && r.champion));
	ok("...and its order records how to regenerate every season",
		A.u.order.every((o) => o.synth && o.synth.seed === "s1" && o.fingerprint === U.synthFingerprint("s1", o.season)));
	{
		const reg = A.u.registry;
		const back = Object.keys(reg).map((id) => reg[id]).filter((e) => (e.returned || []).length);
		ok("undrafted returners are in the registry under the file they were drafted out of",
			back.length > 0 && back.every((e) => e.draft && e.draft.season < e.returned[0] &&
				e.seasons.some((s) => s.as === "draft class" && s.season === e.draft.season)),
			back.slice(0, 2).map((e) => JSON.stringify(e.seasons)).join(" | "));
		const handed = Object.keys(A.u.cfgs).map((k) => A.u.cfgs[k].entrants || []);
		const all = [].concat.apply([], handed);
		ok("an out-of-eligibility returner re-enters the next synthetic class by name",
			all.length > 0 && all.every((x) => reg[x.id] && reg[x.id].name === x.name),
			JSON.stringify(handed.map((h) => h.length)));
		ok("...and his career row says so",
			all.every((x) => reg[x.id].seasons.some((s) => s.as === "re-entered the draft")));
		const files = U.synthFiles("s1", 2030, 4);
		drive(files);
		const names = new Set(files.flatMap((f) => f.data.players.map((p) => p.firstName + " " + p.lastName)));
		ok("...as a player of that season's class",
			all.every((x) => names.has(x.name)) && files.some((f) => f.data.players.length > 70));
		ok("the tail carries the entrants for an extension", Array.isArray(A.u.tail.entrants));
	}

	/* --- resume and extend reproduce the world ------------------------- */
	{
		const files = U.synthFiles("s1", 2030, 4);
		const r = drive(files);
		const before = rowsOf(r.u);
		const res = drive(files, {
			mode: "resume", from: 2, universe: r.u,
			runnable: r.u.order.slice(2).map((d) => ({ index: d.index, name: d.name, season: d.season })),
		}, r.runners);
		ok("resuming a synthetic universe with nothing changed gives the same world",
			rowsOf(res.u) === before, rowsOf(res.u) + " vs " + before);
	}
	{
		// Two + two extended, twice: the same future both times.
		const ext = () => {
			const f1 = U.synthFiles("s1", 2030, 2);
			const a = drive(f1);
			const f2 = f1.concat(U.synthFiles("s1", 2032, 2));
			const b = drive(f2, {
				mode: "extend", universe: a.u,
				runnable: [2, 3].map((i) => ({ index: i, name: f2[i].name, season: f2[i].data.startingSeason })),
			}, a.runners.concat([E.createRunner(f2[2].data), E.createRunner(f2[3].data)]));
			return b.u;
		};
		const x = ext();
		const y = ext();
		ok("forward simulation (an extension on synthetic classes) is deterministic",
			rowsOf(x) === rowsOf(y) && x.rows.length === 4 && !x.rows.some((r) => r.extrapolated), rowsOf(x));
		ok("...records an extend segment an import can replay",
			x.segments.map((g) => g.kind).join() === "cold,extend" &&
			U.replayPlan(U.exportUniverse(x), U.synthFiles("s1", 2030, 4)).followed);
		const json = U.exportUniverse(x);
		ok("the export's order carries the synth records",
			json.order.every((o) => o.synth && U.synthFromOrder(o)));
	}

	/* --- the app wiring (source checks; the UI smoke drives it) --------- */
	{
		const root = path.join(__dirname, "..", "..");
		const app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
		const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
		const views = fs.readFileSync(path.join(root, "js", "views.js"), "utf8");
		ok("the empty screen offers a synthetic universe", /id="btnSynthUniverse"/.test(html));
		ok("the Universe tab offers forward simulation and a new synthetic world",
			/btnSimForward/.test(views) && /btnSynthUniverseTab/.test(views));
		ok("a synthetic file keeps its seed-derived fingerprint on install",
			/if \(!f\.synthetic\) f\.fingerprint = fingerprint\(f\)/.test(app));
		ok("a reload rebuilds a synthetic universe from its seed",
			/restoreSyntheticUniverse\(\)/.test(app) && /synth: d\.synth/.test(app));
		ok("an import regenerates synthetic seasons", /U\.synthFromOrder\(o\)/.test(app));
		ok("extrapolation stays the fallback", /extrapolateYears: state\.cfg\.extrapolateYears/.test(app));
	}
};
