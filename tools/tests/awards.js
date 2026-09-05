/* Regression checks for the awards / news / draft-board audit.

   Each check below is a bug that shipped: a "sweeps the hardware" story for a
   conference player of the year, a draft class that could not win a national
   defensive award, mock-draft prose reading a board the draft-day events had
   already reordered, an MVP who was not on the first team, a walk-on named a
   newcomer, a domestic cup in a prep league, and a paper that filed every
   pre-draft story from March. */
"use strict";

module.exports = function (ok, V) {
	const AW = global.Awards;
	const NEWS = global.News;
	const TEXT = global.Text;

	const SEEDS = [201, 202, 203, 204, 205, 206];
	const runs = SEEDS.map((seed) => {
		const lf = V.realisticClass(seed, 70);
		const res = global.Engine.run(lf, global.Config.make({ seed: "awtest" + seed }));
		return { res, news: NEWS.build(res) };
	});
	const players = runs.reduce((a, r) => a.concat(r.res.players), []);
	const articles = runs.reduce((a, r) => a.concat(r.news), []);

	/* ------------------------------------------------ text helpers */
	ok("text/ordinal", TEXT.ordinal(1) === "1st" && TEXT.ordinal(2) === "2nd" &&
		TEXT.ordinal(3) === "3rd" && TEXT.ordinal(11) === "11th" &&
		TEXT.ordinal(13) === "13th" && TEXT.ordinal(21) === "21st",
		[1, 2, 3, 11, 13, 21].map(TEXT.ordinal).join(","));
	ok("text/a before a lowercase vowel is a fault",
		TEXT.textFaults("a old-school disciplinarian").indexOf("a before a vowel sound") !== -1);
	ok("text/legal lowercase vowel words are not faults",
		!TEXT.textFaults("a one-and-done on a usage rate of 24%").length,
		TEXT.textFaults("a one-and-done on a usage rate of 24%").join(","));
	ok("text/n+th is a fault", TEXT.textFaults("his 1th season").length > 0);

	/* ------------------------------------------------ the sweep story */
	const NAT_POY = new Set((AW.NATIONAL_POY || []).map((a) => a.name)
		.concat(["Consensus National Player of the Year"]));
	let sweepBad = 0;
	for (const { res, news } of runs) {
		const fieldPOY = (res.fieldHonors || []).some((h) => NAT_POY.has(h.award));
		for (const a of news) {
			const head = TEXT.segsToText(a.headline);
			if (!/sweeps the hardware|takes them all|Unanimous, near enough/.test(head)) continue;
			const who = (a.headline.filter((sg) => sg.t === "player")[0] || {}).key;
			const p = res.players.filter((x) => x.key === who)[0];
			const n = p ? (p.awards || []).filter((x) => NAT_POY.has(x)).length : 0;
			if (n < 2 || fieldPOY) sweepBad++;
		}
	}
	ok("news/a sweep story needs two national trophies and no field winner",
		sweepBad === 0, sweepBad + " bad sweeps");
	ok("news/no unpluralized honor count",
		!articles.some((a) => / 1 national (honors|player-of-the-year trophies)\b/
			.test(TEXT.segsToText(a.body))));

	/* ------------------------------------------------ national defensive awards */
	const NATDEF = /^(Naismith Defensive Player of the Year|NABC Defensive Player of the Year|Lefty Driesell Award)$/;
	let defClasses = 0;
	let anyDefClasses = 0;
	for (const { res } of runs) {
		const aw = res.players.reduce((a, p) => a.concat(p.awards || []), []);
		if (aw.some((a) => NATDEF.test(a))) defClasses++;
		if (aw.some((a) => NATDEF.test(a) || /^NABC All-Defensive/.test(a))) anyDefClasses++;
	}
	// The bug was total — 45 of 45 national defensive trophies to the unseen
	// field over fifteen classes — so the check is that the class can win one
	// at all, and that it usually takes some national defensive honor.
	ok("awards/the class can win a national defensive trophy", defClasses >= 1,
		defClasses + "/" + runs.length + " classes");
	ok("awards/the class usually takes a national defensive honor",
		anyDefClasses >= Math.ceil(runs.length / 2),
		anyDefClasses + "/" + runs.length + " classes");
	// ...without the field's defensive scale being simply deleted: a returning
	// player still wins most of them.
	const fieldDef = runs.reduce((a, r) =>
		a + (r.res.fieldHonors || []).filter((h) => NATDEF.test(h.award)).length, 0);
	ok("awards/the field still wins national defensive trophies", fieldDef >= runs.length,
		fieldDef + " of " + (runs.length * 3));

	/* The calibration itself: the field's defensive scores must sit on the
	   prospects' scale rather than two points above it with four times the
	   tail. */
	{
		const { res } = runs[0];
		const ncaa = res.players.filter((p) => !p.nonNcaa);
		const cal = AW.defCalibration(ncaa, res.teams);
		const field = AW.buildField(res.teams, new global.BBGMRng.Rng("cal"), 1, cal)
			.filter((f) => f.stats.mpg >= 20);
		const pr = ncaa.filter((p) => p.stats && p.stats.mpg >= 20);
		const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
		const pm = mean(pr.map((p) => p.scoreDef));
		const fm = mean(field.map((f) => f.scoreDef));
		ok("awards/the field's defense is not scored above the class", fm <= pm,
			"field " + fm.toFixed(2) + " vs prospects " + pm.toFixed(2));
		const fmax = Math.max.apply(null, field.map((f) => f.scoreDef));
		const pmax = Math.max.apply(null, pr.map((p) => p.scoreDef));
		ok("awards/the field's defensive tail is bounded", fmax <= pmax * 1.35,
			"field max " + fmax.toFixed(1) + " vs prospect max " + pmax.toFixed(1));
		/* The cap is applied by the SCORE, not written back onto the stat
		   line, so it is checked where it acts: a line at twice the prospect
		   envelope must not score above one exactly at it. */
		const at = {};
		for (const k of ["spg", "bpg", "drpg", "cspg", "deflpg", "chgpg"]) at[k] = cal.cap[k];
		at.mpg = 32;
		at.pfpg = 2.0;
		at.drtg = cal.cap.drtg;
		const over = Object.assign({}, at);
		for (const k of ["spg", "bpg", "drpg", "cspg", "deflpg", "chgpg"]) over[k] = at[k] * 2;
		over.drtg = at.drtg - 15;
		ok("awards/the field's event rates are capped at the prospect envelope",
			Math.abs(AW.fieldDefenseScore(over, cal) -
				AW.fieldDefenseScore(at, cal)) < 1e-6,
			AW.fieldDefenseScore(over, cal).toFixed(2) + " vs " +
				AW.fieldDefenseScore(at, cal).toFixed(2));
	}

	/* ------------------------------------------------ the draft board */
	let boardMismatch = 0;
	let riserWrongSign = 0;
	let eventInconsistent = 0;
	for (const { res } of runs) {
		(res.board || []).forEach((p, i) => { if (p.boardRank !== i + 1) boardMismatch++; });
		for (const p of res.risers || []) if (!(p.stockMove > 0)) riserWrongSign++;
		for (const p of res.fallers || []) if (!(p.stockMove < 0)) riserWrongSign++;
		for (const p of res.board || []) {
			if (!p.draftEvent) continue;
			// The event describes a move from the BOARD slot to the draft slot.
			const moved = (p.draftSlot || p.boardRank) - p.boardRank;
			const text = p.draftEvent.text || "";
			const m = /(\d+) spots/.exec(text);
			if (m && Math.abs(Math.abs(moved) - Number(m[1])) > 0) eventInconsistent++;
			if (p.draftEvent.kind === "rise" && moved >= 0) eventInconsistent++;
			if (p.draftEvent.kind === "fall" && moved <= 0) eventInconsistent++;
		}
	}
	ok("board/boardRank is the board's own order", boardMismatch === 0, boardMismatch);
	ok("board/risers rose and fallers fell", riserWrongSign === 0, riserWrongSign);
	ok("board/a draft event's sentence matches the move it made",
		eventInconsistent === 0, eventInconsistent);
	ok("board/every player has a draft slot",
		runs.every((r) => (r.res.board || []).every((p) => p.draftSlot >= 1)));

	/* An age term exists at all. The board correlated -0.88 with ovr and
	   -0.86 with pot and 0.00 with age, so two players with the same ratings
	   and three years between them tied. Measured two ways: the ordering
	   correlates with age, and among near-identical pairs the younger man is
	   ahead more often than not. */
	{
		/* The DRAFT age. Most source files carry 19 for everybody, which is
		   why the engine reads the class year instead (see draftAge) — a check
		   against p.age alone would be a check against a constant. */
		const AGE = { Freshman: 19, Sophomore: 20, Junior: 21, Senior: 22, Graduate: 23 };
		const ageOf = (p) => {
			const cy = String(p.classYear || "Freshman");
			return (AGE[cy.replace(/^Redshirt /, "")] || 19) + (/^Redshirt /.test(cy) ? 1 : 0);
		};
		let younger = 0;
		let older = 0;
		const rank = [];
		const ages = [];
		for (const { res } of runs) {
			const b = res.board || [];
			for (const p of b) {
				rank.push(p.boardRank);
				ages.push(ageOf(p));
			}
			for (let i = 0; i < b.length; i++) {
				for (let j = i + 1; j < b.length; j++) {
					const a = b[i];
					const c = b[j];
					if (Math.abs(a.newOvr - c.newOvr) > 2 || Math.abs(a.newPot - c.newPot) > 2) continue;
					// A one-year gap is worth 0.6 against a 1.8-point noise
					// term, which is not a signal anybody could read; a
					// senior against a freshman is.
					if (Math.abs(ageOf(a) - ageOf(c)) < 3) continue;
					if (ageOf(a) < ageOf(c)) younger++;
					else older++;
				}
			}
		}
		const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
		const mr = mean(rank);
		const ma = mean(ages);
		let sxy = 0;
		let sx = 0;
		let sy = 0;
		for (let i = 0; i < rank.length; i++) {
			sxy += (rank[i] - mr) * (ages[i] - ma);
			sx += (rank[i] - mr) * (rank[i] - mr);
			sy += (ages[i] - ma) * (ages[i] - ma);
		}
		const corr = sxy / Math.sqrt(sx * sy);
		ok("board/the board reads age at all", corr > 0.05, "corr(boardRank, age) " + corr.toFixed(3));
		ok("board/age breaks a tie between near-identical prospects",
			younger >= older, younger + " younger ahead vs " + older + " older ahead");
	}
	// The "reach" detail is keyed to the player, so nobody is called a
	// 19-year-old who is not one.
	{
		let wrongAge = 0;
		for (const { res } of runs) {
			for (const p of res.board || []) {
				const d = p.draftEvent && p.draftEvent.detail;
				if (!d) continue;
				const m = /^a (\d+)-year-old/.exec(d);
				if (m && Math.floor(p.age) !== Number(m[1])) wrongAge++;
				if (/youngest player in the class/.test(d)) {
					const min = Math.min.apply(null, res.board.map((x) => x.age));
					if (p.age > min) wrongAge++;
				}
			}
		}
		ok("board/a draft event's age detail is the player's own age", wrongAge === 0, wrongAge);
	}

	/* ------------------------------------------------ pro / non-NCAA honors */
	let mvpNoTeam = 0;
	let mvpAndPoy = 0;
	let oddCup = 0;
	let walkonNewcomer = 0;
	for (const p of players) {
		const aw = p.awards || [];
		const mvp = aw.filter((a) => / MVP$/.test(a) &&
			!/(Finals|Cup Final|Tournament|Final Four) MVP$/.test(a));
		// Youth-league ladders (Overtime Elite, the NBA Academies) mint their
		// MVP from the age-restricted list and have their own first team.
		const youth = /^(Overtime Elite|NBA Academy)/.test(p.newCollege || "");
		if (mvp.length && !youth && !aw.some((a) => /^All-.+ First Team$/.test(a))) mvpNoTeam++;
		if (mvp.length && aw.some((a) => /Player of the Year$/.test(a))) mvpAndPoy++;
		const meta = (global.Colleges.NON_NCAA || {})[p.newCollege];
		if (aw.some((a) => / Cup Winner$/.test(a)) && meta && (!meta.pro || meta.youth)) oddCup++;
		if (p.transfer && !p.transfer.from &&
			aw.some((a) => /Newcomer Team$/.test(a))) walkonNewcomer++;
	}
	ok("awards/a pro MVP is on his league's first team", mvpNoTeam === 0, mvpNoTeam);
	ok("awards/no MVP and player of the year for the same season", mvpAndPoy === 0, mvpAndPoy);
	ok("awards/only a real pro league plays a domestic cup", oddCup === 0, oddCup);
	ok("awards/a newcomer arrived from somewhere else", walkonNewcomer === 0, walkonNewcomer);

	/* ------------------------------------------------ conference honors lost */
	const confLost = runs.reduce((a, r) => a + (r.res.fieldHonors || [])
		.filter((h) => / Player of the Year$/.test(h.award) &&
			!/Defensive/.test(h.award) && !/^(Naismith|AP |NABC|Sporting)/.test(h.award))
		.length, 0);
	ok("awards/conference races lost to the field are recorded", confLost > 0, confLost);

	/* ------------------------------------------------ the paper */
	const late = {};
	for (const a of articles) {
		if (a.when > 1.1) {
			const d = NEWS.dateline(a.when);
			late[d] = (late[d] || 0) + 1;
		}
	}
	ok("news/the pre-draft calendar is not all March",
		(late.June || 0) > 0 && (late.May || 0) > 0 && (late.March || 0) > 0,
		JSON.stringify(late));
	ok("news/the draft itself is not filed in March", NEWS.dateline(1.4) === "June",
		NEWS.dateline(1.4));

	// The conference-POY story is about an NCAA player.
	{
		let bad = 0;
		for (const { res, news } of runs) {
			for (const a of news) {
				if (a.kind !== "conference poy") continue;
				const key = (a.headline.concat(a.body).filter((sg) => sg.t === "player")[0] || {}).key;
				const p = res.players.filter((x) => x.key === key)[0];
				if (p && p.nonNcaa) bad++;
			}
		}
		ok("news/the conference player-of-the-year story is an NCAA story", bad === 0, bad);
	}

	// Every generated string, once more, through the shared sweep.
	{
		const faults = [];
		for (const a of articles) {
			for (const seg of [a.headline, a.body].concat(a.paras || [])) {
				const t = TEXT.segsToText(seg);
				const f = TEXT.textFaults(t);
				if (f.length) faults.push(f + ": " + t.slice(0, 90));
			}
		}
		for (const p of players) {
			const f = TEXT.textFaults(p.note || "");
			if (f.length) faults.push(f + ": " + String(p.note).slice(0, 90));
		}
		ok("news/no text faults in any article or note", faults.length === 0,
			faults.slice(0, 3).join(" | "));
	}

	// The new kinds fire, and the statBlurb branches spread.
	{
		const kinds = new Set(articles.map((a) => a.kind));
		const added = ["final four mop", "career milestone", "player of the week",
			"coaching record", "facing the old school", "poy race lost",
			"back from injury", "upset hero"];
		const missing = added.filter((k) => !kinds.has(k));
		ok("news/the new table-driven kinds fire", missing.length <= 1, missing.join(","));

		const blurbs = {};
		let n = 0;
		for (const p of players) {
			if (!p.stats || !(p.stats.gp > 0)) continue;
			n++;
			const b = NEWS.statBlurb(p.stats).replace(/[\d.]+/g, "#");
			blurbs[b] = (blurbs[b] || 0) + 1;
		}
		const top = Math.max.apply(null, Object.values(blurbs));
		ok("news/the stat blurb is not one sentence for everybody",
			Object.keys(blurbs).length >= 10 && top / n < 0.20,
			Object.keys(blurbs).length + " shapes, top " + (100 * top / n).toFixed(1) + "%");
	}
};
