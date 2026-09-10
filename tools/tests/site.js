/* The season website (js/site.js).

   The export is two things joined at one seam — the season as JSON, and a
   page that draws that JSON — so the checks here are about the seam holding:
   every section reaching the data, the data staying data (numbers as
   numbers, no markup), the page carrying its own reader with nothing
   fetched, and the one way a self-contained page silently breaks — a
   "</script>" inside a scouting note ending the payload early. */
"use strict";

module.exports = function (ok, V) {
	const E = global.Engine;
	const C = global.Config;
	const S = global.SeasonSite;

	const res = E.run(V.realisticClass("site", 60), C.make({ seed: "site" }));
	const d = S.data(res, {});

	/* ---- the data ------------------------------------------------------ */
	{
		ok("site/stamps its format and version",
			d.format === "bbgm-draft-season-site" && d.version === 1,
			d.format + " v" + d.version);
		const ids = d.sections.map((s) => s.id);
		for (const want of ["front", "poll", "standings", "bracket", "awards",
			"leaders", "board", "capsules", "news", "colophon"]) {
			ok("site/builds “" + want + "”", ids.indexOf(want) !== -1, ids.join(", "));
		}
		ok("site/every section names the key it wrote",
			d.sections.every((s) => d[s.key] !== undefined),
			d.sections.filter((s) => d[s.key] === undefined).map((s) => s.id).join(", "));
		ok("site/the capsules land under “players”",
			Array.isArray(d.players) && d.players.length === res.players.length,
			(d.players || []).length + " of " + res.players.length);
		ok("site/names the champion",
			d.front.champion === res.tourney.champion.team.name,
			d.front.champion);
		ok("site/carries the seed", d.seed === res.seed);
		ok("site/the board is the whole class",
			d.board.length === res.players.length, d.board.length + " rows");
	}

	/* ---- numbers stay numbers ------------------------------------------ */
	/* The page sorts on these. One column of pre-formatted strings and a
	   "9.5" sorts above a "12.1" for the rest of the file's life. */
	{
		let bad = [];
		for (const p of d.board) {
			for (const k of ["rank", "ovr", "pot", "ppg"]) {
				if (p[k] !== null && typeof p[k] !== "number") bad.push(p.name + "." + k);
			}
		}
		ok("site/board numbers are numbers, not formatted strings",
			bad.length === 0, bad.slice(0, 5).join(", "));
		/* The colophon is exempt: a setting is reported at whatever precision
		   the run actually used, and rounding it there would make the file
		   disagree with the seed it claims to reproduce. */
		const rest = Object.assign({}, d);
		delete rest.colophon;
		const long = JSON.stringify(rest).match(/\d+\.\d{6,}/g);
		ok("site/no float noise in the data", !long, long ? long.slice(0, 3).join(", ") : "");
	}

	/* ---- the data is data ---------------------------------------------- */
	{
		const flat = JSON.stringify(d);
		ok("site/the JSON carries no markup",
			flat.indexOf("<div") === -1 && flat.indexOf("<table") === -1);
		ok("site/a prospect's id resolves from the board to a capsule",
			d.board.every((b) => d.players.some((p) => p.id === b.id)));
		const linked = d.news.articles
			.reduce((n, a) => n + a.headline.filter((s) => s.id).length, 0);
		ok("site/news headlines link prospects to their capsules", linked > 0,
			linked + " linked segments");
		const orphan = [];
		for (const a of d.news.articles) {
			for (const s of a.headline.concat(a.body)) {
				if (s.id && !d.players.some((p) => p.id === s.id)) orphan.push(s.v);
			}
		}
		ok("site/no news link points at a prospect who is not in the file",
			orphan.length === 0, orphan.slice(0, 3).join(", "));
	}

	/* ---- the sections a run has nothing for are left out --------------- */
	{
		const few = S.data(res, { sections: ["front", "board"] });
		ok("site/an unticked section is left out",
			few.news === undefined && few.poll === undefined &&
			few.sections.length === 2, few.sections.map((s) => s.id).join(", "));
		ok("site/an array of ids selects the same sections",
			JSON.stringify(S.data(res, { sections: { front: true, board: true } })) ===
			JSON.stringify(few));
		const capped = S.data(res, { newsLimit: 5 });
		ok("site/the news limit shortens the feed",
			capped.news.articles.length === 5 &&
			capped.news.total === d.news.total, capped.news.articles.length);
	}

	/* ---- the page ------------------------------------------------------ */
	{
		const html = S.html(res, {});
		ok("site/html is a whole document",
			/^<!doctype html>/.test(html) && /<\/html>\s*$/.test(html));
		ok("site/the page carries its stylesheet inline",
			html.indexOf("<style>") !== -1 && html.indexOf("--accent") !== -1);
		ok("site/the page carries its reader inline",
			html.indexOf("season-data") !== -1 && /<script>\n\(function/.test(html));
		/* The whole promise of the file is that it opens off a thumb drive. */
		ok("site/nothing is fetched",
			!/src=["']http/.test(html) && !/<link /.test(html) &&
			html.indexOf("fetch(") === -1);
		const m = /<script type="application\/json" id="season-data">\n([\s\S]*?)\n<\/script>/
			.exec(html);
		ok("site/the payload is one JSON script element", !!m);
		ok("site/the embedded payload is the same season",
			JSON.stringify(JSON.parse(m[1])) === JSON.stringify(d));
		ok("site/the payload closes no element early",
			m[1].indexOf("</") === -1 && m[1].indexOf("<") === -1);
		ok("site/html can be handed the data instead of the result",
			S.html(d, {}) === html);
	}

	/* ---- a note that would end the payload early ----------------------- */
	{
		const evil = E.run(V.realisticClass("site-evil", 12), C.make({ seed: "site-evil" }));
		evil.players[0].note = "Ends it: </script><script>alert(1)</script> & <b>bold</b>  .";
		const html = S.html(evil, {});
		const m = /<script type="application\/json" id="season-data">\n([\s\S]*?)\n<\/script>/
			.exec(html);
		/* Not "the word script is gone" — it is still in the note, and should
		   be. What must be gone is the angle bracket that would close the
		   element around it. */
		ok("site/a note carrying markup does not end the payload",
			!!m && m[1].indexOf("<") === -1 && m[1].indexOf(">") === -1,
			m ? m[1].slice(0, 40) : "no payload");
		ok("site/exactly two script elements close in the file",
			(html.match(/<\/script>/g) || []).length === 2,
			(html.match(/<\/script>/g) || []).length + " closers");
		ok("site/the note survives the escaping intact",
			S.data(evil, {}).players.some((p) => p.note === evil.players[0].note));
		ok("site/and comes back out of the payload unchanged",
			JSON.parse(m[1]).players.some((p) => p.note === evil.players[0].note));
	}

	/* ---- one seed, one site -------------------------------------------- */
	{
		const again = E.run(V.realisticClass("site", 60), C.make({ seed: "site" }));
		ok("site/the same seed writes the same site",
			S.html(again, {}) === S.html(res, {}));
		ok("site/and nothing in it reads a clock",
			S.html(res, {}).indexOf(String(new Date().getFullYear()) + "-") === -1 ||
			!/"generated"/.test(S.html(res, {})));
	}
};
