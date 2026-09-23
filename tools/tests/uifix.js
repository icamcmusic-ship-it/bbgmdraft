"use strict";
/* Regression checks for the September 2026 UI audit fixes that can be
   exercised without a browser: the face-blob sanitizer, the default column
   set, and the prospect table's sort order for text-celled numeric columns
   and for class years. tools/uismoke.js covers the rendered half. */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

module.exports = function (ok, V) {
	void V;
	if (!global.window) global.window = global;
	if (!global.self) global.self = global;

	/* ---- #1: a shared class file cannot inject markup through a face ---- */
	require(path.join(ROOT, "js", "vendor", "facesjs.js"));
	require(path.join(ROOT, "js", "faces.js"));
	const F = global.Faces;
	const clean = global.FacesJS.generate(undefined, { gender: "male" });
	ok("faces/a generated face passes the sanitizer", F.usable(clean) === true);
	let generatedOk = 0;
	for (let i = 0; i < 200; i++) {
		if (F.usable(global.FacesJS.generate(undefined, { gender: i % 2 ? "male" : "female" }))) {
			generatedOk++;
		}
	}
	ok("faces/every face facesjs itself generates passes", generatedOk === 200,
		generatedOk + " of 200");
	const evil = (mut) => {
		const f = JSON.parse(JSON.stringify(clean));
		mut(f);
		return f;
	};
	const attacks = {
		"body.color": (f) => { f.body.color = "#fff\"/><script>alert(1)</script>"; },
		"hair.color": (f) => { f.hair.color = "red\"><img src=x onerror=alert(1)>"; },
		"head.shave": (f) => { f.head.shave = "rgba(0,0,0,0)\" onload=\"alert(1)"; },
		"teamColors": (f) => { f.teamColors = ["#000", "</svg><script>x</script>", "#fff"]; },
		"a feature id": (f) => { f.eye.id = "eye1\"><script>"; },
		"a size as a string": (f) => { f.eye.size = "1\" onmouseover=\"x"; },
		"nested markup": (f) => { f.nose.extra = ["ok", { deep: "<b>x</b>" }]; },
	};
	for (const k of Object.keys(attacks)) {
		ok("faces/a malicious " + k + " is rejected", F.usable(evil(attacks[k])) === false);
	}
	// And the player gets his own seeded face, not the file's.
	const p = { key: "xss-probe", src: { face: evil(attacks["body.color"]) } };
	const drawn = F.faceOf(p);
	ok("faces/a rejected face falls back to the seeded one",
		drawn !== p.src.face && F.usable(drawn) &&
		JSON.stringify(drawn).indexOf("script") === -1);

	/* ---- the views, loaded headless: only pure helpers are called ------ */
	require(path.join(ROOT, "js", "views.js"));
	const Vw = global.Views;

	/* ---- #2: the `off` flag seeds the default hidden set ---------------- */
	const hidden = Vw.defaultHiddenColumns();
	const offCols = Vw.COLUMNS.filter((c) => c.off && !c.fixed).map((c) => c.key);
	ok("columns/every column flagged off starts hidden",
		offCols.length > 20 && offCols.every((k) => hidden[k]),
		offCols.filter((k) => !hidden[k]).join(", "));
	ok("columns/the portrait column is off by default", hidden.face === true);
	ok("columns/no default column starts hidden",
		Vw.COLUMNS.filter((c) => !c.off).every((c) => !hidden[c.key]));
	const APP = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
	ok("columns/the app's initial state reads the default set",
		/hiddenColumns:\s*V\.defaultHiddenColumns/.test(APP));
	{
		const was = global.App;
		global.App = { state: { hiddenColumns: hidden } };
		try {
			const lit = Vw.currentColumnPreset();
			ok("columns/the Everything chip is not lit on a fresh install",
				lit !== "Everything", String(lit));
			ok("columns/the Default chip is", lit === "Default", String(lit));
		} finally {
			global.App = was;
		}
	}

	/* ---- #3: numbers in a text column sort as numbers ------------------- */
	const order = (key, vals, dir) => Vw.sortRows(
		vals.map((v) => ({ v, sortVals: { [key]: v } })), [{ key, dir }]).map((r) => r.v);
	ok("sort/team record (w-l) sorts numerically",
		JSON.stringify(order("record", [9, 10, -2, 21, undefined], -1)) ===
			JSON.stringify([21, 10, 9, -2, undefined]),
		JSON.stringify(order("record", [9, 10, -2, 21, undefined], -1)));
	ok("sort/honors count sorts numerically",
		JSON.stringify(order("awards", [2, 10, 1, 0], -1)) === JSON.stringify([10, 2, 1, 0]));
	ok("sort/caps sort numerically",
		JSON.stringify(order("caps", [3, 12, 7], 1)) === JSON.stringify([3, 7, 12]));
	ok("sort/names still sort as names",
		JSON.stringify(order("name", ["b", "A", "c"], 1)) === JSON.stringify(["A", "b", "c"]));

	/* ---- #4: class year is an ordinal, not the alphabet ----------------- */
	const years = ["Senior", "Graduate", "Freshman", "Redshirt Sophomore", "Junior",
		"Sophomore", "Redshirt Freshman"];
	const want = ["Freshman", "Redshirt Freshman", "Sophomore", "Redshirt Sophomore",
		"Junior", "Senior", "Graduate"];
	const sortedYears = Vw.sortRows(years.map((y) => ({ y, sortVals: { year: Vw.classYearRank(y) } })),
		[{ key: "year", dir: 1 }]).map((r) => r.y);
	ok("sort/class year runs Freshman to Graduate",
		JSON.stringify(sortedYears) === JSON.stringify(want), sortedYears.join(", "));
	const SITE = fs.readFileSync(path.join(ROOT, "js", "site.js"), "utf8");
	ok("sort/the exported site sorts Year and Mock on ordinals",
		/h: "Year", get: \(p\) => yearRank\(/.test(SITE) &&
		/h: "Mock", get: \(p\) => mockRank\(/.test(SITE));

	/* ---- smaller items that are one-liners to pin ------------------------ */
	ok("views/feet() never prints 12 inches", Vw.feet(83.6) === "7'0\"" && Vw.feet(71.5) === "6'0\"",
		Vw.feet(83.6) + " " + Vw.feet(71.5));
};
