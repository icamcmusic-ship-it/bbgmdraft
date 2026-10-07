"use strict";
/* Regression checks for the October 2026 audit's UI-side fixes that can be
   exercised without a browser: the pure helpers in js/views.js (the note
   copy texts, the export-option summary and its validator, the label suffixes
   on the note template) and static reads of js/app.js, index.html and
   css/style.css for the handful of behaviours that live in event handlers.
   The behaviours themselves (preset keeps the template, restore of a session
   saved for another class, the saved universe after a reload) are driven in
   a browser by the "October 2026 audit" section of tools/uismoke.js. */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

module.exports = function (ok, V) {
	void V;
	if (!global.window) global.window = global;
	if (!global.self) global.self = global;
	require(path.join(ROOT, "js", "views.js"));
	const Vw = global.Views;
	const APP = read("js", "app.js");
	const HTML = read("index.html");
	const CSS = read("css", "style.css");
	const VIEWS = read("js", "views.js");

	/* ---- N14: the copy actions skip empty notes, like the cards -------- */
	{
		const players = [
			{ name: "Ada", newOvr: 50, newPos: "G", newCollege: "Duke", note: "A line\nB line" },
			{ name: "Blank", newOvr: 60, newPos: "F", newCollege: "UNC", note: "" },
			{ name: "Space", newOvr: 55, newPos: "C", newCollege: "UK", note: "  \n " },
			{ name: "Cy", newOvr: 40, newPos: "F", proClub: "Zalgiris", note: "Only line" },
		];
		const plain = Vw.noteCopyText(players, "plain");
		ok("notes/copy all: only players with a note, best first",
			plain === "Ada\nA line\nB line\n\nCy\nOnly line", JSON.stringify(plain));
		const tsv = Vw.noteCopyText(players, "tsv").split("\n");
		ok("notes/spreadsheet rows: header plus one row per noted player, newlines folded",
			tsv.length === 3 && tsv[0] === "name\tnote" && tsv[1] === "Ada\tA line · B line" &&
			tsv[2] === "Cy\tOnly line", JSON.stringify(tsv));
		const md = Vw.noteCopyText(players, "md");
		ok("notes/markdown: a heading and bullets for noted players only",
			md.indexOf("### Blank") === -1 && md.indexOf("### Space") === -1 &&
			md.indexOf("### Ada — G, Duke\n\n- A line\n- B line") === 0 &&
			md.indexOf("### Cy — F, Zalgiris") !== -1, JSON.stringify(md));
		ok("notes/an all-empty class copies as an empty list, not blank names",
			Vw.noteCopyText([{ name: "X", newOvr: 1, note: "" }], "plain") === "" &&
			Vw.noteCopyText([{ name: "X", newOvr: 1, note: "" }], "tsv") === "name\tnote");
		ok("notes/the .tsv and .md downloads skip empty notes too",
			/noteCopyText\(res\.players, "tsv"\)/.test(APP) &&
			/No note, no entry/.test(APP));
	}

	/* ---- N16/N10: the note template says which lines print for some only - */
	{
		const keys = Object.keys(Vw.NOTE_LINE_NOTES);
		const known = global.Engine.NOTE_LINES.map((x) => x[0]);
		ok("notes/every suffixed template line is a real line",
			keys.length >= 8 && keys.every((k) => known.indexOf(k) !== -1),
			keys.filter((k) => known.indexOf(k) === -1).join(", "));
		for (const k of ["ranks", "injury", "coach", "path", "awards"]) {
			ok("notes/the " + k + " line says it prints for some players only",
				typeof Vw.NOTE_LINE_NOTES[k] === "string" && Vw.NOTE_LINE_NOTES[k].length > 6);
		}
		ok("notes/the Notes tab no longer claims to be exactly what gets written",
			!/exactly what gets written/.test(VIEWS) && !/Exactly these lines/.test(HTML));
		ok("notes/the Notes tab names what can differ in the file",
			/awards/i.test(VIEWS.slice(VIEWS.indexOf("function viewNotes"), VIEWS.indexOf("function viewNotes") + 900)) &&
			/My notes/.test(VIEWS.slice(VIEWS.indexOf("function viewNotes"), VIEWS.indexOf("function viewNotes") + 900)) &&
			/Include scouting notes/.test(VIEWS.slice(VIEWS.indexOf("function viewNotes"), VIEWS.indexOf("function viewNotes") + 900)));
		ok("notes/the sidebar hint names what can differ in the file",
			/can differ/.test(HTML) && /My notes/.test(HTML));
	}

	/* ---- N5: the export options survive a reload, validated ------------- */
	{
		const clean = Vw.cleanExportOpts({
			stats: true, awards: "yes", ages: false, junk: 1, awardsScope: "major",
			majorConferences: ["SEC", 7, " ", "ACC"],
		});
		ok("export/the stored options keep booleans and drop everything else",
			clean && clean.stats === true && clean.ages === false &&
			!("awards" in clean) && !("junk" in clean), JSON.stringify(clean));
		ok("export/a known scope is kept, an unknown one dropped",
			clean.awardsScope === "major" &&
			!("awardsScope" in Vw.cleanExportOpts({ stats: true, awardsScope: "everything" })));
		ok("export/the conference list keeps only non-empty strings",
			JSON.stringify(clean.majorConferences) === JSON.stringify(["SEC", "ACC"]),
			JSON.stringify(clean.majorConferences));
		ok("export/non-objects and empty objects come back as nothing",
			[null, undefined, "x", 3, [], {}, { junk: 1 }].every((v) => Vw.cleanExportOpts(v) === null));
		ok("export/the summary is empty for the defaults",
			Vw.exportSummary(null) === "" &&
			Vw.exportSummary({ ages: true, injuries: true, jerseys: true }) === "");
		const sum = Vw.exportSummary({ stats: true, awards: true, awardsScope: "major",
			myMarks: true, includeNotes: false, jerseys: false });
		ok("export/the summary lists what is on and what is off",
			sum === "statline, awards (major only), my notes · no notes, jerseys", sum);
		ok("export/persist() writes the options and restore() reads them back validated",
			/exportOpts: state\.exportOpts \|\| null/.test(APP) &&
			/V\.cleanExportOpts\(saved\.exportOpts\)/.test(APP));
		ok("export/the dialog saves through rememberExportOpts, not a bare assignment",
			!/state\.exportOpts = exportOpts\(\)/.test(APP) &&
			(APP.match(/rememberExportOpts\(exportOpts\(\)\)/g) || []).length >= 3);
		ok("export/the button has a summary line", /id="exportSummary"/.test(HTML));
	}

	/* ---- N1: presets leave the note template alone ---------------------- */
	{
		const m = /const SESSION_TOGGLES = \[([^\]]*)\]/.exec(APP);
		ok("preset/noteLines is a session setting a preset does not reset",
			m && /"noteLines"/.test(m[1]) && /"universe"/.test(m[1]), m && m[1]);
		ok("preset/a preset that names noteLines still applies it",
			/for \(const k of SESSION_TOGGLES\) if \(!\(k in p\)\)/.test(APP));
	}

	/* ---- N8: a notes-only change re-renders ----------------------------- */
	ok("notes/a notes-only run re-renders the page (tooltips, player page)",
		!/notesOnly/.test(APP));

	/* ---- B2: sessions carry their file and restore checks it ------------ */
	{
		const rs = APP.slice(APP.indexOf("function restoreSession"),
			APP.indexOf("function sessionDepths"));
		ok("session/each session stores the file fingerprint",
			/snap\.fileFp = /.test(APP));
		ok("session/restore switches to the session's file or drops its locks",
			/findIndex\(\(f\) => f\.fingerprint === snap\.fileFp\)/.test(rs) &&
			/snap\.overrides = \{\}/.test(rs) && /showWarning/.test(rs));
	}

	/* ---- B11: switching files clears the previous class's pointers ------ */
	{
		const h = APP.slice(APP.indexOf('$("fileSelect").addEventListener("change"'));
		const body = h.slice(0, h.indexOf("let depth = 0"));
		ok("files/the file picker clears editing, selection, player, compare and game log",
			["state.editing = null", "state.selected = {}", "state.player = null",
				"state.compare = [null, null, null, null]", "state.logPlayer = null"]
				.every((s) => body.indexOf(s) !== -1), body.slice(0, 400));
	}

	/* ---- U1, U4, U2, U21, U16, U7: layout and wording ------------------- */
	ok("until/the Reroll-until list has its own single-column container",
		/el\("div", "untillist"\)/.test(APP) && /\.untillist \{/.test(CSS) &&
		!/const list = el\("div", "colpicker"\);\s*const rows = \[\];/.test(APP));
	ok("modal/a read-only dialog focuses its heading, not the last button",
		/!onOk && \(!first \|\| !\$\("modalBody"\)\.contains\(first\)\)/.test(APP) &&
		/preventScroll: true/.test(APP));
	ok("css/board names wrap on phones instead of ellipsis",
		/td\.sticky \{ white-space: normal;/.test(CSS) && /max-width: 44vw/.test(CSS));
	ok("css/the settings FAB has room below the content",
		/body:not\(\.noclass\):not\(\.settings-open\) \{ padding-bottom: 72px; \}/.test(CSS));
	ok("css/the sidebar's Randomize row wraps",
		/\.btngroup\.wide \{[^}]*flex-wrap: wrap/.test(CSS));
	ok("settings/the preset diff and lock labels use the sidebar's names",
		/diff\.map\(labelDiffLine\)/.test(APP) &&
		/Unlock " : "Lock "\) \+ settingLabel\(key\)/.test(APP) &&
		/function settingLabel\(key\)/.test(APP));
	/* The labels the helper reads exist in the sidebar for the keys the audit named. */
	for (const k of ["potBias", "archetypeDiversity", "buildNoise", "flavorMemory", "classQuality"]) {
		ok("settings/the sidebar has a label for " + k,
			new RegExp('<label for="' + k + '">[^<]+').test(HTML));
	}

	/* ---- UV2: a saved universe is shown after a reload ------------------ */
	ok("universe/a saved timeline with no files is shown view-only",
		/!state\.files\.length && state\.universe && state\.universe\.rows/.test(APP) &&
		/stranded/.test(VIEWS) && /btnStrandedLoad/.test(VIEWS));
};
