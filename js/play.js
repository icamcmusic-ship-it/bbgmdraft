/* The Play tab: three games played against a class that has already been
   simulated (audit section 4, ideas 4, 5 and 8).

   Prediction: pick the champion, the player of the year and the No. 1 pick
   from what was known before the season. Bracket pool: fill in the 68-team
   field's bracket, scored ESPN-style. Blind scout: rank a top 10 with the
   ratings hidden, scored against the final board.

   Nothing here re-simulates or touches the engine. The season has already
   run (the app runs it when a class loads), so the answers are read off the
   live result at reveal time and never before: the pick views render only
   what was known before the phase being predicted (the build phase's names,
   colleges and bios; the selection's seeds), and every other tab is gated
   while a game is open. Same seed, same answers. */
(function (global) {
	"use strict";

	const POINTS = [10, 20, 40, 80, 160, 320];
	const ROUND_LABEL = ["Round of 64", "Round of 32", "Sweet 16", "Elite Eight",
		"Final Four", "Championship"];
	const RECORD_KEY = "bbgm-play-record";

	/* ------------------------------------------------------------ scoring */

	/* The 64-team bracket as the tournament plays it: regions in REGIONS
	   order, each in SEED_ORDER, so game g of round k is fed by games 2g and
	   2g+1 of round k-1 and the semis pair East-West and South-Midwest (see
	   tournament.js). Seeds are the post-First-Four lines. Null when the
	   field is too small for four full regions. */
	function bracketBase(tourney) {
		const TT = global.Tournament;
		if (!tourney || !tourney.regions || !TT) return null;
		const slots = [];
		for (const r of TT.REGIONS) {
			const reg = tourney.regions[r];
			if (!reg || !reg.seeds) return null;
			const bySeed = {};
			for (const x of reg.seeds) bySeed[x.seed] = x;
			for (const sd of TT.SEED_ORDER) {
				if (!bySeed[sd]) return null;
				slots.push({ name: bySeed[sd].team.name, seed: sd, region: r });
			}
		}
		return slots.length === 64 ? slots : null;
	}

	// Empty picks: rounds of 32, 16, 8, 4, 2, 1 games.
	function emptyPicks() {
		return POINTS.map((_, k) => new Array(32 >> k).fill(null));
	}

	// The two teams in game g of round k given the picks so far (nulls allowed).
	function participants(base, picks, k, g) {
		if (k === 0) return [base[2 * g].name, base[2 * g + 1].name];
		return [picks[k - 1][2 * g], picks[k - 1][2 * g + 1]];
	}

	/* Set one winner and clear every later pick that the change made
	   impossible (a team that is no longer in that game). */
	function setPick(base, picks, k, g, name) {
		const out = picks.map((r) => r.slice());
		out[k][g] = name;
		for (let r = 1; r < out.length; r++) {
			for (let i = 0; i < out[r].length; i++) {
				const pp = participants(base, out, r, i);
				if (out[r][i] && pp.indexOf(out[r][i]) === -1) out[r][i] = null;
			}
		}
		return out;
	}

	// Fill every open game with `choose(a, b)` round by round.
	function fillWith(base, picks, choose) {
		let out = picks.map((r) => r.slice());
		for (let k = 0; k < out.length; k++) {
			for (let g = 0; g < out[k].length; g++) {
				if (out[k][g]) continue;
				const [a, b] = participants(base, out, k, g);
				if (a && b) out = setPick(base, out, k, g, choose(a, b));
			}
		}
		return out;
	}

	// Chalk: the better seed; equal seeds (the Final Four) by name, stably.
	function autoFillBySeed(base, picks) {
		const seed = {};
		for (const s of base) seed[s.name] = s.seed;
		return fillWith(base, picks || emptyPicks(), (a, b) =>
			seed[a] !== seed[b] ? (seed[a] < seed[b] ? a : b) : (a < b ? a : b));
	}

	/* Random, weighted a little toward the better seed so it looks like a
	   bracket. Deterministic: rng is a BBGMRng.Rng drawn from the seed. */
	function randomFill(base, picks, rng) {
		const seed = {};
		for (const s of base) seed[s.name] = s.seed;
		return fillWith(base, picks || emptyPicks(), (a, b) => {
			const pa = 0.5 + (seed[b] - seed[a]) * 0.025;
			return rng.random() < pa ? a : b;
		});
	}

	function complete(picks) {
		return picks.every((r) => r.every(Boolean));
	}

	/* The real results in the same shape as the picks, from each team's
	   number of wins in the 64: the winner of game (k, g) is the one team in
	   that game's subtree that won k+1 games. */
	function bracketTruth(tourney, base) {
		const wins = {};
		const add = (w) => { if (w && w.team) wins[w.team.name] = (wins[w.team.name] || 0) + 1; };
		for (const r of Object.keys(tourney.regions || {})) {
			for (const round of tourney.regions[r].rounds || []) for (const gm of round) add(gm.winner);
		}
		for (const gm of tourney.semis || []) add(gm.winner);
		if (tourney.final && tourney.final.b) add(tourney.final.winner);
		return POINTS.map((_, k) => {
			const span = 2 << k;
			return new Array(32 >> k).fill(null).map((__, g) => {
				for (let i = g * span; i < (g + 1) * span; i++) {
					if ((wins[base[i].name] || 0) >= k + 1) return base[i].name;
				}
				return null;
			});
		});
	}

	// ESPN-style: 10/20/40/80/160/320 per correct pick, 1920 for a perfect one.
	function scoreBracket(picks, truth) {
		const byRound = POINTS.map((pt, k) => {
			let hits = 0;
			for (let g = 0; g < truth[k].length; g++) {
				if (picks[k] && picks[k][g] && picks[k][g] === truth[k][g]) hits++;
			}
			return { hits, games: truth[k].length, points: hits * pt };
		});
		return {
			points: byRound.reduce((s, r) => s + r.points, 0),
			max: POINTS.reduce((s, pt, k) => s + pt * (32 >> k), 0),
			byRound,
		};
	}

	// The upset factor, said as a difficulty.
	function difficulty(upsetFactor) {
		const u = Number.isFinite(upsetFactor) ? upsetFactor : 1;
		return u < 0.6 ? "Easy (chalk)" : u < 1.2 ? "Normal" : u < 1.6 ? "Hard" : "Chaos";
	}

	/* The prediction's answer key, read off a finished result. */
	function predictionAnswers(res) {
		const t = res.tourney || {};
		const set = global.Universe && global.Universe.nationalPOYSet
			? global.Universe.nationalPOYSet() : new Set();
		const poy = (res.players || []).filter((p) => (p.awards || []).some((a) => set.has(a)));
		return {
			champion: t.champion && t.champion.team ? t.champion.team.name : null,
			finalFour: (t.finalFour || []).map((x) => x.team.name),
			poy: poy.map((p) => p.key),
			poyName: poy.length ? poy[0].name : null,
			no1: res.board && res.board[0] ? res.board[0].key : null,
			no1Name: res.board && res.board[0] ? res.board[0].name : null,
			top5: (res.board || []).slice(0, 5).map((p) => p.key),
		};
	}

	/* Champion 5 (2 for a Final Four team), POY 3, No. 1 pick 3 (1 for a
	   top-5 pick). Max 11. A season whose POY is not in this class has no
	   right answer there; "nobody in the class" is the pick that scores. */
	function gradePrediction(picks, ans) {
		const champ = picks.champion && picks.champion === ans.champion ? 5
			: ans.finalFour.indexOf(picks.champion) !== -1 ? 2 : 0;
		const poy = ans.poy.length
			? (ans.poy.indexOf(picks.poy) !== -1 ? 3 : 0)
			: (picks.poy === "none" ? 3 : 0);
		const no1 = picks.no1 && picks.no1 === ans.no1 ? 3
			: ans.top5.indexOf(picks.no1) !== -1 ? 1 : 0;
		return { champion: champ, poy, no1, points: champ + poy + no1, max: 11 };
	}

	/* Blind scout: each of the ten slots scores 10 minus how far off the
	   player's real board rank is (floored at 0), so an exact slot is 10 and
	   a man ranked outside the top 20 scores nothing. Max 100. */
	function scoreScout(order, board) {
		const rank = {};
		(board || []).forEach((p, i) => { rank[p.key] = i + 1; });
		const rows = order.slice(0, 10).map((key, i) => {
			const r = rank[key] || Infinity;
			return { key, slot: i + 1, actual: Number.isFinite(r) ? r : null,
				points: Math.max(0, 10 - Math.abs(r - (i + 1))) || 0 };
		});
		const top10 = new Set((board || []).slice(0, 10).map((p) => p.key));
		return {
			points: rows.reduce((s, r) => s + r.points, 0), max: 100,
			hits: rows.filter((r) => top10.has(r.key)).length,
			error: rows.reduce((s, r) => s + (r.actual ? Math.abs(r.actual - r.slot) : 60), 0),
			rows,
		};
	}

	/* The reference a user is scored beside: the preseason consensus (each
	   player's preseasonRank, the board before a game was played). */
	function preseasonTop10(players) {
		return (players || []).filter((p) => Number.isFinite(p.preseasonRank))
			.sort((a, b) => a.preseasonRank - b.preseasonRank).slice(0, 10).map((p) => p.key);
	}

	/* ------------------------------------------------------------- record */

	function loadRecord() {
		try {
			const r = JSON.parse(global.localStorage.getItem(RECORD_KEY) || "null");
			if (r && typeof r === "object") return r;
		} catch (e) { /* storage blocked or corrupt: start clean */ }
		return {};
	}
	function saveRecord(kind, points, max, seed) {
		const all = loadRecord();
		const r = all[kind] || { played: 0, points: 0, max: 0, best: null };
		r.played++;
		r.points += points;
		r.max += max;
		if (!r.best || points > r.best.points) r.best = { points, max, seed };
		all[kind] = r;
		try { global.localStorage.setItem(RECORD_KEY, JSON.stringify(all)); } catch (e) {}
		return r;
	}

	/* ---------------------------------------------------------------- view */

	const GAMES = {
		predict: "Prediction",
		bracket: "Bracket pool",
		scout: "Blind scout",
	};

	function resKey(res) {
		const st = global.App.state;
		return String(st.active) + "|" + res.seed;
	}

	// While a game is open and unrevealed, every tab but Play is a spoiler.
	function gated(st, res) {
		return !!(st.play && !st.play.revealed && st.tab !== "play" && res);
	}

	function gateView(view) {
		const el = global.Views.el;
		const st = global.App.state;
		const box = el("div", "empty-state playgate");
		box.appendChild(el("h3", null, "Spoilers hidden: a " + GAMES[st.play.kind] + " game is open"));
		box.appendChild(el("p", "hint", "This tab shows the season's results. Finish the " +
			"game on the Play tab, or abandon it to look."));
		const row = el("div", "rowflex");
		row.style.justifyContent = "center";
		const back = el("button", "primary", "Back to Play");
		back.addEventListener("click", () => global.App.showTab("play"));
		const quit = el("button", null, "Abandon game and show");
		quit.addEventListener("click", () => { st.play = null; global.App.render(); });
		row.appendChild(back);
		row.appendChild(quit);
		box.appendChild(row);
		view.appendChild(box);
	}

	function playerLabel(p) {
		return p.name + " (" + (p.nonNcaa ? (p.proClub || "pro") : (p.newCollege || "?")) + ")";
	}
	function byName(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }

	function viewPlay(view, res) {
		const el = global.Views.el;
		const App = global.App;
		const st = App.state;
		if (st.play && st.play.key !== resKey(res)) st.play = null;   // the class was re-run
		const wrap = el("div", "playtab");
		wrap.appendChild(el("h2", null, "Play"));
		if (!st.play) {
			wrap.appendChild(el("p", "hint", "Three games against this class and seed. The " +
				"season has been simulated but is not shown here; while a game is open " +
				"every other tab is hidden, because they would give the answers away."));
			const rec = loadRecord();
			const cards = el("div", "cards playcards");
			for (const [kind, blurb] of [
				["predict", "Before the season: pick the national champion, the player of " +
					"the year and the No. 1 pick. Graded out of 11."],
				["bracket", "After Selection Sunday: fill in the 64-team bracket and score " +
					"it ESPN-style (10/20/40/80/160/320). Difficulty: " +
					difficulty((res.effectiveCfg || res.cfg || {}).upsetFactor) + "."],
				["scout", "Ratings hidden: rank your top 10 prospects from their bios " +
					"and stat lines, then compare to the final board. Out of 100."],
			]) {
				const c = el("div", "card");
				c.appendChild(el("h4", null, GAMES[kind]));
				c.appendChild(el("p", "hint", blurb));
				const r = rec[kind];
				if (r && r.played) {
					c.appendChild(el("p", "hint", "Your record: " + r.played + " played, " +
						Math.round(100 * r.points / Math.max(1, r.max)) + "% of points; best " +
						r.best.points + "/" + r.best.max + "."));
				}
				const b = el("button", "primary", "Start");
				b.setAttribute("data-play", kind);
				if (kind === "bracket" && !bracketBase(res.tourney)) {
					b.disabled = true;
					c.appendChild(el("p", "hint", "This field is too small for a full bracket."));
				}
				b.addEventListener("click", () => {
					st.play = { kind, key: resKey(res), revealed: false,
						picks: kind === "bracket" ? emptyPicks() : kind === "scout" ? [] : {},
						round: 0, rolls: 0 };
					App.render();
				});
				c.appendChild(b);
				cards.appendChild(c);
			}
			wrap.appendChild(cards);
			view.appendChild(wrap);
			return;
		}
		const g = st.play;
		const head = el("div", "rowflex");
		head.appendChild(el("h3", null, GAMES[g.kind]));
		const quit = el("button", null, g.revealed ? "Done" : "Abandon");
		quit.setAttribute("data-play-quit", "1");
		quit.addEventListener("click", () => { st.play = null; App.render(); });
		head.appendChild(quit);
		wrap.appendChild(head);
		if (!g.revealed) {
			wrap.appendChild(el("p", "hint playspoiler",
				"Spoilers: the other tabs are hidden until you reveal."));
		}
		if (g.kind === "predict") predictView(wrap, res, g, el);
		else if (g.kind === "bracket") bracketView(wrap, res, g, el);
		else scoutView(wrap, res, g, el);
		view.appendChild(wrap);
	}

	function revealButton(label, enabled, onReveal, el) {
		const b = el("button", "primary", label);
		b.setAttribute("data-play-reveal", "1");
		b.disabled = !enabled;
		b.addEventListener("click", () => { onReveal(); global.App.render(); });
		return b;
	}

	function predictView(wrap, res, g, el) {
		/* Only what the build phase knows: team names by prestige, the
		   class's names and schools. No ratings, no results. */
		const teams = Object.values(res.teams || {}).slice()
			.sort((a, b) => (b.prestige || 0) - (a.prestige || 0) || byName(a, b));
		const players = (res.players || []).slice().sort(byName);
		const field = (label, key, options) => {
			const row = el("label", "rowflex");
			row.appendChild(el("span", null, label));
			const s = el("select");
			s.setAttribute("data-play-pick", key);
			s.appendChild(new Option("—", ""));
			for (const [v, t] of options) s.appendChild(new Option(t, v));
			s.value = g.picks[key] || "";
			s.disabled = g.revealed;
			s.addEventListener("change", () => { g.picks[key] = s.value || null; global.App.render(); });
			row.appendChild(s);
			wrap.appendChild(row);
		};
		field("National champion", "champion", teams.map((t) => [t.name, t.name]));
		field("Player of the year", "poy", [["none", "Nobody in this class"]]
			.concat(players.filter((p) => !p.nonNcaa).map((p) => [p.key, playerLabel(p)])));
		field("No. 1 pick", "no1", players.map((p) => [p.key, playerLabel(p)]));
		if (!g.revealed) {
			wrap.appendChild(revealButton("Lock in and reveal",
				g.picks.champion && g.picks.poy && g.picks.no1, () => {
					g.revealed = true;
					g.answers = predictionAnswers(res);
					g.grade = gradePrediction(g.picks, g.answers);
					g.record = saveRecord("predict", g.grade.points, g.grade.max, res.seed);
				}, el));
			return;
		}
		const a = g.answers;
		const gr = g.grade;
		const out = el("div", "card playresult");
		out.appendChild(el("h4", null, "Score: " + gr.points + " / " + gr.max));
		out.appendChild(el("p", null, "Champion: " + (a.champion || "none") + " (+" + gr.champion + ")"));
		out.appendChild(el("p", null, "Player of the year: " +
			(a.poyName || "nobody in this class") + " (+" + gr.poy + ")"));
		out.appendChild(el("p", null, "No. 1 pick: " + (a.no1Name || "?") + " (+" + gr.no1 + ")"));
		wrap.appendChild(out);
	}

	function bracketView(wrap, res, g, el) {
		const base = bracketBase(res.tourney);
		const seedOf = {};
		for (const s of base) seedOf[s.name] = s.seed;
		const u = (res.effectiveCfg || res.cfg || {}).upsetFactor;
		wrap.appendChild(el("p", "hint", "Difficulty: " + difficulty(u) +
			" (upset factor " + (Number.isFinite(u) ? u.toFixed(2) : "1.00") + "). " +
			"Seeds are after the First Four."));
		const tools = el("div", "rowflex");
		if (!g.revealed) {
			const auto = el("button", null, "Auto-fill by seed");
			auto.setAttribute("data-play-auto", "1");
			auto.addEventListener("click", () => { g.picks = autoFillBySeed(base, g.picks); global.App.render(); });
			const rnd = el("button", null, "Random");
			rnd.setAttribute("data-play-random", "1");
			rnd.addEventListener("click", () => {
				const Rng = global.BBGMRng.Rng;
				g.picks = randomFill(base, emptyPicks(), new Rng(res.seed + "|pool|" + (g.rolls++)));
				global.App.render();
			});
			const clr = el("button", null, "Clear");
			clr.addEventListener("click", () => { g.picks = emptyPicks(); global.App.render(); });
			tools.appendChild(auto);
			tools.appendChild(rnd);
			tools.appendChild(clr);
		}
		wrap.appendChild(tools);
		const chips = el("div", "chips");
		ROUND_LABEL.forEach((lab, k) => {
			const done = g.picks[k].filter(Boolean).length;
			const c = el("button", "chip" + (g.round === k ? " on" : ""),
				lab + " " + done + "/" + g.picks[k].length);
			c.setAttribute("data-play-round", String(k));
			c.addEventListener("click", () => { g.round = k; global.App.render(); });
			chips.appendChild(c);
		});
		wrap.appendChild(chips);
		const k = g.round;
		const list = el("div", "playgames");
		for (let i = 0; i < g.picks[k].length; i++) {
			const row = el("div", "rowflex playgame");
			if (k <= 3) row.appendChild(el("span", "hint", base[i * (2 << k)].region));
			const pp = participants(base, g.picks, k, i);
			pp.forEach((name, j) => {
				if (j) row.appendChild(el("span", "hint", "vs"));
				const b = el("button", "chip" + (name && g.picks[k][i] === name ? " on" : ""),
					name ? seedOf[name] + " " + name : "TBD");
				b.disabled = !name || g.revealed;
				if (g.revealed && g.truth) {
					if (g.truth[k][i] === name) b.style.fontWeight = "700";
				}
				b.addEventListener("click", () => {
					g.picks = setPick(base, g.picks, k, i, name);
					global.App.render();
				});
				row.appendChild(b);
			});
			if (g.revealed && g.truth) {
				row.appendChild(el("span", "hint", g.picks[k][i] === g.truth[k][i]
					? "+" + POINTS[k] : "won: " + g.truth[k][i]));
			}
			list.appendChild(row);
		}
		wrap.appendChild(list);
		if (!g.revealed) {
			wrap.appendChild(revealButton("Lock in and reveal March", complete(g.picks), () => {
				g.revealed = true;
				g.truth = bracketTruth(res.tourney, base);
				g.score = scoreBracket(g.picks, g.truth);
				g.record = saveRecord("bracket", g.score.points, g.score.max, res.seed);
			}, el));
			return;
		}
		const out = el("div", "card playresult");
		out.appendChild(el("h4", null, "Score: " + g.score.points + " / " + g.score.max));
		out.appendChild(el("p", "hint", g.score.byRound.map((r, j) =>
			ROUND_LABEL[j] + " " + r.hits + "/" + r.games).join(" · ")));
		wrap.appendChild(out);
	}

	function scoutView(wrap, res, g, el) {
		const V = global.Views;
		const byKey = {};
		for (const p of res.players || []) byKey[p.key] = p;
		wrap.appendChild(el("p", "hint", "Click a prospect to add him to your top 10; " +
			"overall, potential and board rank are hidden."));
		const mine = el("ol", "playpicks");
		g.picks.forEach((key, i) => {
			const li = el("li", "rowflex");
			li.appendChild(el("span", null, playerLabel(byKey[key])));
			if (!g.revealed) {
				const up = el("button", null, "↑");
				up.setAttribute("aria-label", "Move up");
				up.disabled = i === 0;
				up.addEventListener("click", () => {
					const t = g.picks[i - 1]; g.picks[i - 1] = key; g.picks[i] = t; global.App.render();
				});
				const rm = el("button", null, "×");
				rm.setAttribute("aria-label", "Remove");
				rm.addEventListener("click", () => { g.picks.splice(i, 1); global.App.render(); });
				li.appendChild(up);
				li.appendChild(rm);
			} else {
				const r = g.score.rows[i];
				li.appendChild(el("span", "hint", "board No. " + (r.actual || "—") + " · +" + r.points));
			}
			mine.appendChild(li);
		});
		wrap.appendChild(mine);
		if (!g.revealed) {
			wrap.appendChild(revealButton("Lock in and reveal the board", g.picks.length === 10, () => {
				g.revealed = true;
				g.score = scoreScout(g.picks, res.board);
				g.ref = scoreScout(preseasonTop10(res.players), res.board);
				g.record = saveRecord("scout", g.score.points, g.score.max, res.seed);
			}, el));
			// The blind table: bio and box score only, alphabetical.
			const cols = [["Pos", "pos"], ["Yr", "year"], ["College", "college"],
				["Hgt", "hgtInches"], ["MPG", "mpg"], ["PPG", "ppg"], ["RPG", "rpg"],
				["APG", "apg"], ["TS%", "ts"]];
			const tw = el("div", "tablewrap");
			const tb = el("table", "playscout");
			const hr = el("tr");
			hr.appendChild(el("th", null, "Name"));
			for (const [h] of cols) hr.appendChild(el("th", null, h));
			const thead = el("thead");
			thead.appendChild(hr);
			tb.appendChild(thead);
			const body = el("tbody");
			for (const p of (res.players || []).slice().sort(byName)) {
				if (g.picks.indexOf(p.key) !== -1) continue;
				const tr = el("tr");
				tr.style.cursor = "pointer";
				tr.appendChild(el("td", null, p.name));
				for (const [, key] of cols) {
					let v = null;
					if (key === "pos") v = p.pos;
					else if (key === "year") v = p.classYear;
					else if (key === "college") v = p.nonNcaa ? (p.proClub || "pro") : p.newCollege;
					else {
						try { v = V.cellValue(p, key, res); } catch (e) { v = null; }
						if (key === "hgtInches") v = V.feet(v);
						else if (typeof v === "number") v = (key === "ts" && v < 1.5 ? v * 100 : v).toFixed(1);
					}
					tr.appendChild(el("td", null, v == null ? "" : String(v)));
				}
				tr.addEventListener("click", () => {
					if (g.picks.length < 10) { g.picks.push(p.key); global.App.render(); }
				});
				body.appendChild(tr);
			}
			tb.appendChild(body);
			tw.appendChild(tb);
			wrap.appendChild(tw);
			return;
		}
		const out = el("div", "card playresult");
		out.appendChild(el("h4", null, "Score: " + g.score.points + " / 100 · " +
			g.score.hits + " of 10 in the real top 10"));
		out.appendChild(el("p", "hint", "The preseason consensus would have scored " +
			g.ref.points + " / 100 (" + g.ref.hits + " hits)."));
		wrap.appendChild(out);
	}

	global.Play = {
		POINTS, ROUND_LABEL, bracketBase, emptyPicks, participants, setPick,
		autoFillBySeed, randomFill, complete, bracketTruth, scoreBracket, difficulty,
		predictionAnswers, gradePrediction, scoreScout, preseasonTop10,
		loadRecord, saveRecord, gated, gateView, view: viewPlay,
	};
	if (global.Views) global.Views.play = viewPlay;
})(typeof window !== "undefined" ? window : self);
