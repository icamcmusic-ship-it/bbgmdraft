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

	const CONF_TOURNEY_HEADS = [
		"{champ} cut down the {conf} nets",
		"{champ} win the {conf} tournament",
		"March starts early for {champ}",
	];

	const CONF_TOURNEY_UPSET_HEADS = [
		"{champ} crash the {conf} tournament",
		"Nobody had {champ} winning the {conf}",
	];

	const NIT_HEADS = [
		"{champ} take the NIT",
		"{champ} win the consolation bracket that still means something",
	];

	const FINAL_FOUR_HEADS = [
		"The Final Four is set",
		"Four teams left standing",
	];

	const CINDERELLA_HEADS = [
		"{team}'s run has the whole bracket talking",
		"Nobody picked {team} to be here",
		"The Cinderella of this tournament: {team}",
	];

	const FIELD_HONOUR_HEADS = [
		"{name} beats the class to the trophy",
		"The award the freshmen didn't win: {name}",
		"A senior spoils the party: {name}",
	];

	const RETURNING_STAR_HEADS = [
		"The best player in the country isn't in this class",
		"{name} doesn't need the draft to matter",
		"Scouting report on a player nobody can draft: {name}",
	];

	const FRESHMAN_HEADS = [
		"{player} named the country's top freshman",
		"{player} sweeps freshman honours",
	];

	const DPOY_HEADS = [
		"{player} locks down the Defensive Player of the Year award",
		"The country's best defender: {player}",
	];

	const ALL_AMERICA_HEADS = [
		"The All-America team is out",
		"Consensus first team revealed",
	];

	const SIGNING_HEADS = [
		"{player} signs with {college}",
		"The nation's top recruit picks {college}",
		"{college} lands the class's biggest name",
	];

	const TRANSFER_HEADS = [
		"{player} finds a new home at {college}",
		"Portal move: {player} to {college}",
	];

	const ANALYTICS_HEADS = [
		"The computers see {team} differently",
		"{team}: the poll and the metrics disagree",
	];

	const CLASS_FLAVOUR_HEADS = [
		"Scouts agree: this is {label}",
		"The scouting consensus on this class: {label}",
	];

	const INJURY_HEADS = [
		"{player}'s injury changes the picture at {college}",
		"{college} deals with life without {player}",
		"The absence that hurt most: {player}",
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

		// --- an injury that actually moved a team --------------------------
		{
			const withKey = {};
			for (const p of res.players || []) withKey[p.key] = p;
			const candidates = [];
			for (const t of Object.values(teams)) {
				for (const o of t.outages || []) {
					const p = withKey[o.who];
					// The anomaly system already tells this story with more
					// colour for a player who drew one of its injury kinds;
					// this section is for the ordinary draws it didn't touch.
					if (!p || p.surprise) continue;
					candidates.push({ p, t, o });
				}
			}
			candidates.sort((a, b) => b.o.drop - a.o.drop);
			const worst = candidates[0];
			if (worst && worst.o.drop >= 3) {
				const games = (worst.t.log || []).filter(
					(g) => g.stage === "reg" && g.when >= worst.o.from && g.when <= worst.o.to);
				const w = games.filter((g) => g.won).length;
				const l = games.length - w;
				articles.push({
					when: (worst.o.from + worst.o.to) / 2, kind: "injury",
					headline: fill(rng.pick(INJURY_HEADS),
						{ player: PL(worst.p.name, worst.p.key), college: TM(worst.t.name) }),
					body: [PL(worst.p.name, worst.p.key), T(" goes down with " +
						(worst.o.kind || "an injury") + " for "), TM(worst.t.name),
						T(", who go " + w + "-" + l + " while he's out.")],
				});
			}
		}

		// --- the metrics disagree -------------------------------------------
		{
			const ranked = (res.poll || []).filter((t) => Number.isFinite(t.netRank));
			let worst = null;
			ranked.forEach((t, i) => {
				const apRank = i + 1;
				const gap = t.netRank - apRank;
				if (!worst || Math.abs(gap) > Math.abs(worst.gap)) worst = { t, apRank, gap };
			});
			if (worst && Math.abs(worst.gap) >= 15) {
				articles.push({
					when: 0.7, kind: "analytics",
					headline: fill(rng.pick(ANALYTICS_HEADS), { team: TM(worst.t.name) }),
					body: [TM(worst.t.name), T(worst.gap > 0
						? " sits No. " + worst.apRank + " in the AP poll but only No. " +
							worst.t.netRank + " in NET — the voters like the record more " +
							"than the computers like the games."
						: " is No. " + worst.t.netRank + " in NET while the AP poll has " +
							"it down at No. " + worst.apRank + " — the résumé is better " +
							"than the reputation.")],
				});
			}
		}

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

		// --- signing day (preseason) ---------------------------------------
		{
			const fivestars = (res.players || []).filter((p) =>
				!p.nonNcaa && p.recruiting && p.recruiting.stars === 5)
				.sort((a, b) => a.recruiting.rank - b.recruiting.rank);
			for (const p of fivestars.slice(0, 2)) {
				articles.push({
					when: -0.4, kind: "signing day",
					headline: fill(rng.pick(SIGNING_HEADS),
						{ player: PL(p.name, p.key), college: TM(p.newCollege) }),
					body: [PL(p.name, p.key), T(", the No. " + p.recruiting.rank +
						" recruit in the class, signs with "), TM(p.newCollege),
						T(p.recruiting.headliner
							? ". He arrives as the headline signing of the group."
							: ".")],
				});
			}
		}

		// --- transfer portal (preseason) ------------------------------------
		{
			const moves = (res.players || []).filter((p) =>
				!p.nonNcaa && p.transfer && p.transfer.from && p.transfer.story)
				.sort((a, b) =>
					(b.transfer.toPrestige - b.transfer.fromPrestige) -
					(a.transfer.toPrestige - a.transfer.fromPrestige));
			const bigMove = moves.filter((p) => p.transfer.direction === "up")[0];
			if (bigMove) {
				articles.push({
					when: -0.35, kind: "transfer",
					headline: fill(rng.pick(TRANSFER_HEADS),
						{ player: PL(bigMove.name, bigMove.key), college: TM(bigMove.newCollege) }),
					body: [PL(bigMove.name, bigMove.key), T(" arrives at "),
						TM(bigMove.newCollege), T(" — " + bigMove.transfer.story + ".")],
				});
			}
		}

		// --- the class, in one line (preseason) -----------------------------
		if (res.flavor && res.flavor.name !== "balanced" && res.flavor.label) {
			articles.push({
				when: -0.15, kind: "class notebook",
				headline: fill(rng.pick(CLASS_FLAVOUR_HEADS), { label: T(res.flavor.label) }),
				body: [T("Beat writers settling in for the season keep landing on " +
					"the same word for this class: " + res.flavor.label + ".")],
			});
		}

		// --- conference tournaments ------------------------------------------
		{
			const CT = res.confTourneys || {};
			const TS = global.TeamsSim;
			const C = global.Colleges.CONFERENCES;
			const confs = Object.keys(CT).filter((c) => CT[c] && CT[c].champ);
			// The power conferences plus any where a genuine outsider won it —
			// covering all thirty-plus every class would bury the rest of the
			// paper, so this is capped at what a real notebook would run: the
			// upsets first (they are the story), then the strongest leagues.
			const rows = confs.map((conf) => {
				const ct = CT[conf];
				const champ = ct.champ;
				const isUpset = ct.regularChamp && ct.regularChamp !== champ &&
					(ct.regularChamp.cw - ct.regularChamp.cl) - (champ.cw - champ.cl) >= 4;
				return { conf, ct, champ, isUpset, strength: (C[conf] || {}).strength || 0 };
			}).sort((a, b) =>
				(b.isUpset ? 1 : 0) - (a.isUpset ? 1 : 0) || b.strength - a.strength);
			for (const row of rows.slice(0, 8)) {
				const { conf, ct, champ, isUpset } = row;
				const label = TS ? TS.label(conf) : conf;
				const body = [TM(champ.name), T(" win the " + label + " tournament")];
				if (isUpset && ct.regularChamp) {
					body.push(T(", denying "), TM(ct.regularChamp.name),
						T(" (the regular-season champion) the automatic bid"));
				}
				body.push(T("."));
				articles.push({
					when: 1.005, kind: "conf tourney",
					headline: fill(rng.pick(isUpset ? CONF_TOURNEY_UPSET_HEADS : CONF_TOURNEY_HEADS),
						{ champ: TM(champ.name), conf: T(label) }),
					body,
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

			// The Cinderella of the field: the deepest-running double-digit
			// seed. One article, not one per round — that is the whole story.
			const cinderella = [];
			for (const r of Object.keys(t.regions)) {
				for (const x of t.regions[r].seeds) {
					if (x.seed >= 10 && (x.team.ncaaWins || 0) >= 2) cinderella.push(x);
				}
			}
			cinderella.sort((a, b) => (b.team.ncaaWins || 0) - (a.team.ncaaWins || 0));
			if (cinderella.length) {
				const c = cinderella[0];
				articles.push({
					when: 1.13, kind: "cinderella",
					headline: fill(rng.pick(CINDERELLA_HEADS), { team: TM(c.team.name) }),
					body: [T("No. " + c.seed + " "), TM(c.team.name),
						T(" has won " + c.team.ncaaWins + " games in this tournament — " +
							c.team.ncaaResult + ".")],
				});
			}

			// The Final Four, before the final decides it.
			if (t.finalFour && t.finalFour.length === 4) {
				articles.push({
					when: 1.15, kind: "final four",
					headline: [T(rng.pick(FINAL_FOUR_HEADS))],
					body: [T("Heading to the national semifinals: ")].concat(
						t.finalFour.flatMap((x, i) => [
							T(i ? ", " : ""), T("No. " + x.seed + " "), TM(x.team.name),
						])).concat([T(".")]),
				});
			}

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
			if (t.nit && t.nit.champion) {
				articles.push({
					when: 1.18, kind: "nit champion",
					headline: fill(rng.pick(NIT_HEADS), { champ: TM(t.nit.champion.name) }),
					body: [TM(t.nit.champion.name), T(" win the NIT — a real trophy " +
						"for a team that didn't make the 68.")],
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

		// --- freshman of the year, defensive player of the year -------------
		{
			const fry = (res.players || []).filter((p) =>
				(p.awards || []).indexOf("Wayman Tisdale Award") !== -1)[0];
			if (fry) {
				articles.push({
					when: 1.16, kind: "awards",
					headline: fill(rng.pick(FRESHMAN_HEADS), { player: PL(fry.name, fry.key) }),
					body: [PL(fry.name, fry.key), T(" ("), TM(fry.newCollege),
						T(") takes the Wayman Tisdale Award" +
							(fry.stats ? " after averaging " + fry.stats.ppg.toFixed(1) +
								" points a game as a freshman." : "."))],
				});
			}
			const dpoy = (res.players || []).filter((p) =>
				(p.awards || []).indexOf("Naismith Defensive Player of the Year") !== -1)[0];
			if (dpoy) {
				articles.push({
					when: 1.17, kind: "awards",
					headline: fill(rng.pick(DPOY_HEADS), { player: PL(dpoy.name, dpoy.key) }),
					body: [PL(dpoy.name, dpoy.key), T(" ("), TM(dpoy.newCollege),
						T(") is the Naismith Defensive Player of the Year.")],
				});
			}
		}

		// --- the All-America team --------------------------------------------
		{
			const firstTeam = (res.players || []).filter((p) =>
				(p.awards || []).indexOf("Consensus First Team All-American") !== -1);
			if (firstTeam.length) {
				articles.push({
					when: 1.19, kind: "awards",
					headline: [T(rng.pick(ALL_AMERICA_HEADS))],
					body: [T("Consensus First Team: ")].concat(
						firstTeam.flatMap((p, i) => [
							T(i ? ", " : ""), PL(p.name, p.key), T(" ("), TM(p.newCollege), T(")"),
						])).concat([T(".")]),
				});
			}
		}

		// --- the trophy the class didn't win ---------------------------------
		for (const h of (res.fieldHonours || []).slice(0, 3)) {
			const segs = [T(h.name)];
			if (h.school && teams[h.school]) segs.push(T(" ("), TM(h.school), T(")"));
			else if (h.school) segs.push(T(" (" + h.school + ")"));
			articles.push({
				when: 1.21, kind: "field honours",
				headline: fill(rng.pick(FIELD_HONOUR_HEADS), { name: T(h.name) }),
				body: segs.concat([T(" wins the " + h.award +
					(h.classYear ? " as a " + h.classYear.toLowerCase() : "") + " — " +
					"this class had nothing for it.")]),
			});
		}

		// --- the best player nobody drafted -----------------------------------
		{
			const star = (res.fieldTop || [])[0];
			if (star && star.stats) {
				const nameSeg = star.school && teams[star.school]
					? [T(star.name + " (")].concat([TM(star.school)]).concat([T(")")])
					: [T(star.name + " (" + (star.school || "unattached") + ")")];
				articles.push({
					when: 1.22, kind: "returning star",
					headline: fill(rng.pick(RETURNING_STAR_HEADS), { name: T(star.name) }),
					body: nameSeg.concat([T(", a " +
						(star.starReturner || "returning player") +
						(star.classYear ? " and " + star.classYear.toLowerCase() : "") +
						", averaged " + star.stats.ppg.toFixed(1) + " points and " +
						star.stats.rpg.toFixed(1) + " rebounds this season — none of " +
						"it draft eligible.")]),
				});
			}
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
