/* The note template: what is ticked is what is written.

   The scouting note is the one thing in the export a person reads, and the
   template is the one control that says what it holds. These pin the ways the
   two came apart: an empty template that fell back to the defaults, a summary
   sentence that carried facts from lines that were unticked, and an export
   that rewrote the honors line into a different shape and place from the one
   the Notes tab shows. */
"use strict";

module.exports = function (ok, V) {
	const E = global.Engine;
	const C = global.Config;
	const run = (lf, seed, extra) => E.run(lf, C.make(Object.assign({ seed }, extra || {})));

	/* ---- an empty template is a real choice ----------------------------- */
	{
		ok("notes/an empty noteLines stays empty",
			Array.isArray(C.make({ noteLines: [] }).noteLines) &&
			C.make({ noteLines: [] }).noteLines.length === 0,
			JSON.stringify(C.make({ noteLines: [] }).noteLines));
		ok("notes/a missing noteLines still takes the default template",
			C.make({}).noteLines.length === C.DEFAULTS.noteLines.length);
		ok("notes/a non-list noteLines still falls back to the default",
			C.make({ noteLines: "stats" }).noteLines.length === C.DEFAULTS.noteLines.length);

		const lf = V.realisticClass("notes-empty", 14);
		lf.players[2].note = "my own scouting scribble";
		const res = run(lf, "notes-empty", { noteLines: [] });
		ok("notes/every box unticked writes no note",
			res.players.every((p) => p.note === ""),
			res.players.filter((p) => p.note).length + " players have a note");
		const file = E.exportFile(res, { awards: true });
		ok("notes/an empty template exports no note and no noteBool on a note-less player",
			file.players.every((p, i) => i === 2 || (p.note === undefined && p.noteBool === undefined)),
			JSON.stringify(file.players.filter((p, i) => i !== 2 && (p.note !== undefined || p.noteBool !== undefined)).length));
		ok("notes/an empty template leaves the file's own note alone",
			file.players[2].note === "my own scouting scribble" && file.players[2].noteBool === 1,
			JSON.stringify(file.players[2].note));
	}

	/* ---- the summary says only what is ticked --------------------------- */
	{
		const lf = V.realisticClass("notes-summary", 40);
		const only = run(lf, "notes-summary", { noteLines: ["summary"] });
		let leaks = 0;
		let built = 0;
		for (const p of only.players) {
			const note = p.note;
			if (note.split("\n").length !== 1) leaks++;
			else if (p.newCollege && !p.nonNcaa && note.indexOf(p.newCollege) !== -1) leaks++;
			else if (p.archetype && p.archetype !== "Balanced" && note.indexOf(p.archetype) !== -1) leaks++;
			else if (/\d/.test(note.replace(/\d'\d+"/, ""))) leaks++;
			if (note) built++;
		}
		ok("notes/a summary-only note carries no school, build, record or numbers",
			leaks === 0 && built === only.players.length,
			leaks + " of " + only.players.length + " leaked; " + built + " written");

		const all = run(lf, "notes-summary", { noteLines: ["summary", "team", "archetype", "stats", "shooting", "record"] });
		const withBuild = all.players.filter((p) => p.archetype && p.archetype !== "Balanced");
		ok("notes/ticking archetype puts the build back in the summary",
			withBuild.length > 0 && withBuild.every((p) =>
				p.note.split("\n")[0].toLowerCase().indexOf(p.archetype.toLowerCase()) !== -1),
			withBuild.filter((p) => p.note.split("\n")[0].toLowerCase()
				.indexOf(p.archetype.toLowerCase()) === -1).length + " missing");
		ok("notes/ticking team puts the school back in the summary",
			all.players.filter((p) => !p.nonNcaa).every((p) =>
				p.note.split("\n")[0].indexOf(p.newCollege) !== -1));
	}

	/* ---- the template's order is the order the lines are written -------- */
	{
		const lf = V.realisticClass("notes-order", 20);
		const everything = E.NOTE_LINES.map((x) => x[0]);
		const res = run(lf, "notes-order", { noteLines: everything });
		const p = res.players.slice().sort((a, b) => b.newOvr - a.newOvr)[0];
		const prefixes = {
			stats: /^\d{4}: \d+ GP/, shooting: /^FG /, advanced: /^USG /, defense: /^Defense:/,
			signature: /^Season high:/, awards: /^Honors:/, stock: /^Board:/,
		};
		const order = Object.keys(prefixes).map((k) => ({
			k, at: p.note.split("\n").findIndex((l) => prefixes[k].test(l)),
		})).filter((x) => x.at >= 0);
		const listed = order.slice().sort((a, b) => everything.indexOf(a.k) - everything.indexOf(b.k));
		ok("notes/the picker lists lines in the order the note writes them",
			order.map((x) => x.k).join() === listed.map((x) => x.k).join() && order.length >= 5,
			order.map((x) => x.k).join() + " vs " + listed.map((x) => x.k).join());
	}

	/* ---- the export's honors line is the Notes tab's honors line -------- */
	{
		const lf = V.realisticClass("notes-honors", 30);
		const res = run(lf, "notes-honors", { noteLines: ["summary", "awards", "stock", "team"] });
		const file = E.exportFile(res, { awards: true });
		let same = 0;
		let checked = 0;
		let leading = 0;
		res.players.forEach((p, i) => {
			const tab = p.note.split("\n");
			const out = String(file.players[i].note || "").split("\n");
			if (/^\n/.test(String(file.players[i].note || ""))) leading++;
			const ti = tab.findIndex((l) => l.indexOf("Honors:") === 0);
			if (ti < 0) return;
			checked++;
			if (out[ti] === tab[ti]) same++;
		});
		ok("notes/the exported honors line is in the Notes tab's position and shape",
			checked > 0 && same === checked, same + " of " + checked + " match");
		ok("notes/an export never starts a note with a blank line", leading === 0, leading + " do");

		// A template with no honors line still gets one on the route that needs it.
		const bare = run(lf, "notes-honors", { noteLines: ["summary"] });
		const noHonors = E.exportFile(bare, { awards: true });
		ok("notes/a template without honors writes none on the class-file route",
			noHonors.players.every((p) => String(p.note || "").indexOf("Honors:") === -1));
		const forced = E.exportFile(bare, { awards: true, honorsInNote: true });
		const winners = bare.players.map((p, i) => ({ p, i })).filter((x) => x.p.awards && x.p.awards.length);
		ok("notes/honorsInNote appends the line when the template has none",
			winners.length > 0 && winners.every((x) => /(^|\n)Honors: /.test(forced.players[x.i].note)),
			winners.length + " winners");
	}

	/* ---- the user's own notes and stars reach the file ------------------- */
	{
		const lf = V.realisticClass("notes-mine", 20);
		const res = run(lf, "notes-mine", { noteLines: ["summary", "awards"] });
		const k0 = res.players[0].key;
		const k1 = res.players[1].key;
		res.userMarks = { notes: { [k0]: "  Late riser, watch the jumper  " }, watch: { [k1]: true } };

		const plain = E.exportFile(res, { awards: true });
		ok("mynotes/nothing is written unless the export asks for it",
			String(plain.players[0].note).indexOf("My notes:") === -1 && plain.players[1].watch === undefined);

		const on = E.exportFile(res, { awards: true, myMarks: true });
		const lines0 = String(on.players[0].note).split("\n");
		ok("mynotes/the note is the last block, labelled, trimmed",
			lines0[lines0.length - 1] === "My notes: Late riser, watch the jumper",
			JSON.stringify(on.players[0].note));
		ok("mynotes/a player with no note of his own is untouched",
			on.players[2].note === plain.players[2].note);
		ok("mynotes/a starred player is written as watched, and only he is",
			on.players[1].watch === true && on.players.filter((p) => p.watch).length === 1);
		ok("mynotes/the template's own lines are still there above it",
			lines0[0] === res.players[0].note.split("\n")[0]);

		const off = E.exportFile(res, { awards: true, myMarks: true, includeNotes: false });
		ok("mynotes/they survive 'Include scouting notes' being off, alone",
			off.players[0].note === "My notes: Late riser, watch the jumper" &&
			off.players[0].noteBool === 1 && off.players[2].note === undefined);

		// A round trip: the exported file comes back in and is exported again.
		const again = run(JSON.parse(JSON.stringify(on)), "notes-mine", { noteLines: ["summary", "awards"] });
		again.userMarks = { notes: { [again.players[0].key]: "Second thought" }, watch: {} };
		const twice = E.exportFile(again, { awards: true, myMarks: true, noteAppend: true });
		const blocks = (String(twice.players[0].note).match(/My notes:/g) || []).length;
		ok("mynotes/a round trip replaces the block rather than stacking it",
			blocks === 1 && /My notes: Second thought$/.test(twice.players[0].note),
			JSON.stringify(twice.players[0].note));
		ok("mynotes/...and an old block is dropped when none is wanted now",
			(String(E.exportFile(again, { awards: true, noteAppend: true }).players[0].note)
				.indexOf("My notes:")) === -1);
	}
};
