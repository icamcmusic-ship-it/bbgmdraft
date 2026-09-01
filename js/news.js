/* The season as news. The raw material has always existed — mid-season events
   read off simulated results, draft-day events, the class anomalies, the poll,
   the bracket, the awards — and it was rendered as four walls of centre-dots.
   This module turns it into dated articles with resolved entities, so every
   player and team mention can be a link in the view.

   An article is { when, dateline, kind, headline: segs, body: segs } where a
   seg is {t: "text"|"team"|"player", v, key?}. The view decides how a team or
   player seg renders; this module never touches the DOM.

   Template variants are drawn deterministically from the run's own seed, so
   the same class always writes the same paper. */
(function (global) {
	"use strict";

	const { Rng } = global.BBGMRng;

	const T = (v) => ({ t: "text", v });
	const TM = (v) => ({ t: "team", v });
	const PL = (name, key) => ({ t: "player", v: name, key });

	/* `when` runs 0..1 across the regular season and above 1 in March. */
	function dateline(when) {
		if (when === undefined || when === null) return "Preseason";
		if (when < 0) return "Offseason";
		if (when > 1.1) return "March";
		if (when > 1) return "Championship Week";
		const months = ["November", "November", "December", "December",
			"January", "January", "February", "February", "March"];
		return months[Math.min(months.length - 1,
			Math.floor(when * months.length))];
	}

	/* Substitute {name} slots in a template string with segments. */
	function fill(tpl, slots) {
		const out = [];
		const re = /\{(\w+)\}/g;
		let last = 0;
		let m;
		while ((m = re.exec(tpl)) !== null) {
			if (m.index > last) out.push(T(tpl.slice(last, m.index)));
			const seg = slots[m[1]];
			if (seg) out.push(seg);
			else out.push(T(m[0]));
			last = m.index + m[0].length;
		}
		if (last < tpl.length) out.push(T(tpl.slice(last)));
		return out;
	}

	/* Headline variants per season-event kind. Several variants per kind is
	   what stops twenty-five classes reading like one class re-run. */
	const EVENT_HEADS = {
		"upset": [
			"{winner} stuns {loser}",
			"{loser} falls to {winner} in the shock of the season",
			"The bracket busters arrived early: {winner} over {loser}",
		],
		"game of the year": [
			"An instant classic between {winner} and {loser}",
			"{winner} outlasts {loser} in the game of the year",
			"One for the ages: {winner} edges {loser}",
		],
		"coaching change": [
			"The seat finally gave way",
			"A December divorce on the sideline",
			"Coaching carousel spins early",
		],
		"blowout": [
			"No mercy: {winner} demolishes {loser}",
			"{winner} runs {loser} out of the gym",
		],
		"streak": [
			"The streak nobody saw coming",
			"They simply will not lose",
		],
		"collapse": [
			"The wheels have come off",
			"From ranked to reeling",
		],
	};

	const GENERIC_HEADS = [
		"Around the country",
		"Midweek notebook",
		"The week in college basketball",
	];

	function pushEvent(articles, rng, e, teams) {
		const heads = EVENT_HEADS[e.kind] || GENERIC_HEADS;
		const names = e.teams || [];
		const slots = {
			winner: names[0] && teams[names[0]] ? TM(names[0]) : T(names[0] || ""),
			loser: names[1] && teams[names[1]] ? TM(names[1]) : T(names[1] || ""),
		};
		const bodySegs = [];
		// The event text mentions its teams by name; link them in place.
		let rest = e.text;
		for (const nm of names) {
			const i = rest.indexOf(nm);
			if (i === -1) continue;
			if (i > 0) bodySegs.push(T(rest.slice(0, i)));
			bodySegs.push(TM(nm));
			rest = rest.slice(i + nm.length);
		}
		bodySegs.push(T(rest + "."));
		articles.push({
			when: e.when === undefined ? 0.5 : e.when,
			kind: e.kind,
			headline: fill(rng.pick(heads), slots),
			body: bodySegs,
		});
	}

	const SURPRISE_HEADS = [
		"The story writes itself: {player}",
		"Scouts keep circling back to {player}",
		"Every class has one: {player}",
		"The name on everybody's board notes: {player}",
	];

	const DRAFT_HEADS = [
		"Draft day: {player} moves the board",
		"War rooms react to {player}",
		"The pick that made the room gasp",
	];

	function build(res) {
		if (!res || !res.players) return [];
		const rng = new Rng("news|" + ((res.cfg && res.cfg.seed) || ""));
		const teams = res.teams || {};
		const articles = [];
		const season = res.leagueFile && res.leagueFile.startingSeason;

		// --- preseason ---------------------------------------------------
		const pre = res.pollHistory && res.pollHistory[0];
		if (pre && pre.ranks.length) {
			articles.push({
				when: -0.2, kind: "preseason poll",
				headline: fill(rng.pick([
					"{one} opens the season at No. 1",
					"The preseason poll is out — {one} on top",
				]), { one: TM(pre.ranks[0].team) }),
				body: [T("The preseason AP poll: ")]
					.concat(pre.ranks.slice(0, 5).flatMap((r, i) => [
						T((i ? ", " : "") + "No. " + r.rank + " "), TM(r.team),
					]))
					.concat([T(". " + (pre.ranks[0].firstPlace || 0) +
						" of " + (global.Rankings ? global.Rankings.VOTERS : 60) +
						" first-place votes went to the top line.")]),
			});
		}

		// --- realignment (an offseason story) -----------------------------
		for (const m of res.realignment || []) {
			articles.push({
				when: -0.3, kind: "realignment",
				headline: fill(rng.pick([
					"{school} is leaving the {from}",
					"Realignment again: {school} to the {to}",
				]), { school: TM(m.school), from: T(m.from), to: T(m.to) }),
				body: [TM(m.school), T(" leaves the " + m.from + " for the " +
					m.to + ". The schedule, the conference tournament and the " +
					"all-conference teams follow it.")],
			});
		}

		// --- class anomalies, spread across the season --------------------
		(res.surprises || []).forEach((sp, i) => {
			articles.push({
				when: 0.12 + (i * 0.61) % 0.75,
				kind: "prospect story",
				headline: fill(rng.pick(SURPRISE_HEADS),
					{ player: PL(sp.player, sp.key) }),
				body: [PL(sp.player, sp.key), T(" — " + sp.label + ".")],
			});
		});

		// --- the season's own events --------------------------------------
		for (const e of res.seasonEvents || []) pushEvent(articles, rng, e, teams);

		// --- poll movement -------------------------------------------------
		const hist = res.pollHistory || [];
		if (hist.length > 2) {
			// A change at No. 1 mid-season is always a story.
			let prevTop = hist[0].ranks[0] && hist[0].ranks[0].team;
			for (let w = 1; w < hist.length; w++) {
				const top = hist[w].ranks[0] && hist[w].ranks[0].team;
				if (top && prevTop && top !== prevTop) {
					articles.push({
						when: (w / (hist.length - 1)) * 0.98,
						kind: "new number one",
						headline: fill(rng.pick([
							"A new No. 1: {top}",
							"{top} takes over the top spot",
						]), { top: TM(top) }),
						body: [TM(top), T(" replaces "), TM(prevTop),
							T(" at the top of the AP poll in " +
								hist[w].label.toLowerCase() + ".")],
					});
				}
				prevTop = top || prevTop;
			}
			// Biggest riser: final rank against preseason.
			const preRank = {};
			hist[0].ranks.forEach((r) => { preRank[r.team] = r.rank; });
			const final = hist[hist.length - 1];
			let riser = null;
			for (const r of final.ranks) {
				const delta = (preRank[r.team] || 30) - r.rank;
				if (!riser || delta > riser.delta) riser = { team: r.team, rank: r.rank, delta };
			}
			if (riser && riser.delta >= 8) {
				articles.push({
					when: 0.99, kind: "poll riser",
					headline: fill(rng.pick([
						"Nobody saw {team} coming",
						"{team}, the season's biggest riser",
					]), { team: TM(riser.team) }),
					body: [TM(riser.team), T(
						(preRank[riser.team]
							? " opened the season ranked No. " + preRank[riser.team]
							: " opened the season unranked") +
						" and finished No. " + riser.rank + ".")],
				});
			}
		}

		// --- Selection Sunday ---------------------------------------------
		const sel = res.tourney && res.tourney.selection;
		if (sel) {
			if (sel.bubble && sel.bubble.length) {
				articles.push({
					when: 1.02, kind: "selection",
					headline: [T(rng.pick([
						"Selection Sunday: the snubs",
						"The bubble bursts",
					]))],
					body: [T("First teams out: ")].concat(
						sel.bubble.slice(0, 4).flatMap((t, i) => [
							T(i ? ", " : ""), TM(t.name),
							T(t.quads ? " (Q1 " + t.quads.q1w + "-" + t.quads.q1l + ")" : ""),
						])).concat([T(".")]),
				});
			}
			for (const bc of sel.bidCheck || []) {
				articles.push({
					when: 1.03, kind: "selection",
					headline: [T(bc.got > bc.expected
						? "The " + bc.conf + " cashes in: " + bc.got + " bids"
						: "A lean year for the " + bc.conf)],
					body: [T("The " + bc.conf + " put " + bc.got +
						" teams in the field, against a typical " + bc.expected + ".")],
				});
			}
		}

		// --- March --------------------------------------------------------
		const t = res.tourney;
		if (t && t.regions) {
			const upsets = [];
			for (const r of Object.keys(t.regions)) {
				for (const round of t.regions[r].rounds) {
					for (const g of round) if (g.upset) upsets.push(g);
				}
			}
			upsets.sort((a, b) => (b.winner.seed - 0) - (a.winner.seed - 0));
			for (const g of upsets.slice(0, 3)) {
				const loserSide = g.winner === g.a ? g.b : g.a;
				articles.push({
					when: 1.12, kind: "bracket upset",
					headline: fill(rng.pick([
						"No. {ws} {winner} shocks No. {ls} {loser}",
						"Madness: {winner} sends {loser} home",
					]), {
						winner: TM(g.winner.team.name), loser: TM(loserSide.team.name),
						ws: T(String(g.winner.seed)), ls: T(String(loserSide.seed)),
					}),
					body: [TM(g.winner.team.name),
						T(" won " + g.score + " in the " +
							(g.region ? g.region + " region" : "bracket") + ".")],
				});
			}
			if (t.champion) {
				const segs = [TM(t.champion.team.name),
					T(" (No. " + t.champion.seed + " seed) cut down the nets")];
				if (t.runnerUp) {
					segs.push(T(", beating "), TM(t.runnerUp.team.name),
						T(" " + (t.final && t.final.score ? t.final.score : "") + " in the final"));
				}
				segs.push(T("."));
				articles.push({
					when: 1.2, kind: "champion",
					headline: fill(rng.pick([
						"{champ} are national champions",
						"The nets come down for {champ}",
					]), { champ: TM(t.champion.team.name) }),
					body: segs,
				});
			}
		}

		// --- awards -------------------------------------------------------
		const poy = (res.players || []).filter((p) => (p.awards || []).some(
			(a) => /Player of the Year|Naismith Trophy$|Wooden Award$/.test(a) &&
				!/finalist|Top 20|Defensive/.test(a)));
		if (poy.length) {
			const p = poy[0];
			articles.push({
				when: 1.15, kind: "awards",
				headline: fill(rng.pick([
					"{player} sweeps the hardware",
					"{player}, player of the year",
				]), { player: PL(p.name, p.key) }),
				body: [PL(p.name, p.key), T(" (" ), TM(p.newCollege),
					T(") took " + (p.awards || []).filter((a) =>
						/Player of the Year|Trophy|Award/.test(a) &&
						!/finalist|Top 20|watch/.test(a)).length +
						" national honours" +
						(p.stats ? " on " + p.stats.ppg.toFixed(1) + " points a game." : ".")),
				],
			});
		}

		// --- draft day ----------------------------------------------------
		for (const e of res.draftEvents || []) {
			articles.push({
				when: 1.4, kind: "draft",
				headline: fill(rng.pick(DRAFT_HEADS), { player: PL(e.player, e.key) }),
				body: [PL(e.player, e.key), T(" — " + e.text +
					(e.detail ? " (" + e.detail + ")" : "") + ".")],
			});
		}

		articles.sort((a, b) => a.when - b.when);
		for (const a of articles) {
			a.dateline = dateline(a.when) + (season ? " " +
				(a.when < 0 ? season - 1 : a.when > 0.35 && a.when < 1.6 ? season : season - 1) : "");
		}
		return articles;
	}

	global.News = { build, dateline };
})(typeof window !== "undefined" ? window : self);
