/* The season almanac (js/almanac.js).

   The document is written once and rendered twice — markdown for the file,
   HTML for the print-to-PDF route — so the checks here are about the two
   staying the same document, about every section actually reaching the page,
   and about the two ways a table quietly breaks: a cell carrying a pipe (a
   scouting note, a team's style) and a bracket entry whose shape differs
   between a play-in game and a regional round. */
"use strict";

module.exports = function (ok, V) {
	const E = global.Engine;
	const C = global.Config;
	const A = global.Almanac;

	const res = E.run(V.realisticClass("almanac", 60), C.make({ seed: "almanac" }));
	const md = A.markdown(res, {});

	/* ---- every section reaches the document ---------------------------- */
	{
		const heads = md.split("\n").filter((l) => /^## /.test(l))
			.map((l) => l.slice(3));
		ok("almanac/every section writes something", heads.length >= 10,
			heads.length + " sections: " + heads.join(", "));
		ok("almanac/opens with the season, not the contents",
			/^# The \d{4} season\n/.test(md), md.split("\n")[0]);
		for (const want of ["Final AP poll", "Conference standings", "March Madness",
			"Honors", "Statistical leaders", "The draft board", "The prospects",
			"Colophon"]) {
			ok("almanac/writes “" + want + "”", heads.indexOf(want) !== -1,
				heads.join(", "));
		}
	}

	/* ---- the season's facts are the run's facts ------------------------ */
	{
		ok("almanac/names the champion",
			md.indexOf(res.tourney.champion.team.name) !== -1);
		ok("almanac/names the AP No. 1", md.indexOf(res.poll[0].name) !== -1);
		ok("almanac/carries the seed", md.indexOf("`" + res.seed + "`") !== -1);
		const missing = res.players.filter((p) => md.indexOf(p.name) === -1);
		ok("almanac/every prospect has a capsule", missing.length === 0,
			missing.slice(0, 3).map((p) => p.name).join(", "));
	}

	/* ---- tables stay tables -------------------------------------------
	   Every row of a markdown table has to carry the same number of unescaped
	   pipes as its header, or the renderer drops the cells past the break.
	   A note with a pipe in it is the way that happens in real data. */
	{
		const lines = md.split("\n");
		let bad = 0;
		let head = null;
		const width = (l) => l.split(/(?<!\\)\|/).length;
		for (let i = 0; i < lines.length; i++) {
			if (!/^\|/.test(lines[i])) { head = null; continue; }
			if (head === null) { head = width(lines[i]); continue; }
			if (width(lines[i]) !== head) bad++;
		}
		ok("almanac/no row disagrees with its header", bad === 0, bad + " rows");

		const piped = res.players.filter((p) => p.awards && p.awards.length)[0];
		const awards = piped.awards.slice();
		piped.awards = ["Best | Player"];
		const md2 = A.markdown(res, { sections: ["awards"] });
		piped.awards = awards;
		ok("almanac/a pipe in a cell is escaped, not a new cell",
			md2.indexOf("Best \\| Player") !== -1 &&
			md2.indexOf("Best | Player") === -1);
	}

	/* ---- the bracket ---------------------------------------------------
	   A play-in game carries the two teams; a regional game carries seeded
	   entries. Reading one shape for both is how the First Four printed four
	   rows of empty team names. */
	{
		const bracket = A.markdown(res, { sections: ["bracket"] });
		for (const g of res.tourney.firstFour || []) {
			ok("almanac/First Four names " + g.winner.name,
				bracket.indexOf(g.winner.name) !== -1);
		}
		const east = res.tourney.regions.East;
		const g = east.rounds[0][0];
		ok("almanac/a regional game names both teams",
			bracket.indexOf(g.winner.team.name) !== -1 &&
			bracket.indexOf((g.winner === g.a ? g.b : g.a).team.name) !== -1);
		ok("almanac/the final is written",
			bracket.indexOf("National championship") !== -1);
	}

	/* ---- section selection --------------------------------------------- */
	{
		const only = A.markdown(res, { sections: { poll: true } });
		const heads = only.split("\n").filter((l) => /^## /.test(l));
		ok("almanac/an unticked section is left out",
			heads.length === 1 && /Final AP poll/.test(heads[0]),
			heads.join(" / "));
		/* And no contents list above one heading. */
		ok("almanac/a short document has no contents list",
			only.indexOf("## Contents") === -1);
		ok("almanac/the front page is itself a section",
			only.indexOf("# The ") === -1);
		const byArray = A.markdown(res, { sections: ["poll"] });
		ok("almanac/an array of ids selects the same sections",
			byArray === only);
	}

	/* ---- the news limit ------------------------------------------------ */
	{
		const all = A.markdown(res, { sections: ["news"] });
		const few = A.markdown(res, { sections: ["news"], newsLimit: 5 });
		ok("almanac/the news limit shortens the feed", few.length < all.length);
		ok("almanac/and says how much was left out",
			/of \d+ articles/.test(few), few.slice(-200));
	}

	/* ---- the awards scope is honoured ---------------------------------- */
	{
		const wide = A.markdown(res, { sections: ["awards"] });
		const narrow = A.markdown(res,
			{ sections: ["awards"], awardsScope: "major" });
		ok("almanac/“major honors only” drops rows", narrow.length < wide.length);
	}

	/* ---- the printable HTML is the same document ----------------------- */
	{
		const html = A.html(res, {});
		ok("almanac/html is a whole document",
			/^<!doctype html>/.test(html) && /<\/html>\s*$/.test(html));
		ok("almanac/html carries a print stylesheet", /@page/.test(html));
		ok("almanac/html renders the tables as tables",
			(html.match(/<table>/g) || []).length >= 5,
			(html.match(/<table>/g) || []).length + " tables");
		ok("almanac/html renders the headings",
			/<h1 id="/.test(html) && /<h2 id="/.test(html));
		ok("almanac/no markdown pipes survive into the HTML body",
			html.split("<body>")[1].indexOf("|") === -1);
		ok("almanac/the champion is in the HTML too",
			html.indexOf(res.tourney.champion.team.name) !== -1);
		/* < and & in a team or player name must not reach the page as markup.
		   Nothing in the shipped data carries one, which is exactly why this
		   is checked on the renderer rather than on a run. */
		const esc = A.renderBody("## A <b>team</b> & co");
		ok("almanac/html escapes markup in the text",
			esc.indexOf("<b>") === -1 && esc.indexOf("&amp;") !== -1, esc);
	}

	/* ---- determinism --------------------------------------------------- */
	{
		const again = E.run(V.realisticClass("almanac", 60), C.make({ seed: "almanac" }));
		ok("almanac/the same seed writes the same almanac",
			A.markdown(again, {}) === md);
	}
};
