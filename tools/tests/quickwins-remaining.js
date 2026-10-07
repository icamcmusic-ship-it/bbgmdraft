"use strict";
/* Checks for the two quick wins left from the October 2026 audit: Q1 (remember
   and restore the session in IndexedDB) and Q5 (pinned settings). The pure
   helpers live in js/views.js (the pin-list cleaner, the time-ago text, the
   session record shaper with its size cap, the record reader and the card
   sentence) and are tested here directly; the wiring in js/app.js, index.html
   and css/style.css is read statically. The behaviour in a browser (a reload,
   the card, Restore, Discard, the database upgrade, pinned controls) is the
   "Remembered session and pinned settings" section of tools/uismoke.js. */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

module.exports = function (ok, V) {
	if (!global.window) global.window = global;
	if (!global.self) global.self = global;
	require(path.join(ROOT, "js", "views.js"));
	const Vw = global.Views;
	const APP = read("js", "app.js");
	const HTML = read("index.html");
	const CSS = read("css", "style.css");

	const known = new Set(Object.keys(global.Config.DEFAULTS));

	/* ---- Q5: the pin list ------------------------------------------------ */
	{
		const isKnown = (k) => known.has(k);
		ok("pins/a clean list is returned as it is",
			JSON.stringify(Vw.cleanStarredSettings(["pace", "potBias"], isKnown)) === '["pace","potBias"]');
		ok("pins/non-arrays and nulls give an empty list",
			[undefined, null, "pace", 5, {}, { 0: "pace" }].every((v) => Vw.cleanStarredSettings(v, isKnown).length === 0));
		ok("pins/unknown keys, non-strings and prototype names are dropped",
			JSON.stringify(Vw.cleanStarredSettings(["nope", 5, null, "__proto__", "constructor", "toString", "pace", {}], isKnown)) === '["pace"]',
			JSON.stringify(Vw.cleanStarredSettings(["nope", 5, null, "__proto__", "constructor", "toString", "pace", {}], isKnown)));
		ok("pins/duplicates are dropped and the first one keeps its place",
			JSON.stringify(Vw.cleanStarredSettings(["pace", "potBias", "pace", "potBias", "seed"], isKnown)) === '["pace","potBias","seed"]');
		const many = Array.from(known).slice(0, 20);
		ok("pins/the list is capped at 8 by default and at the cap given",
			Vw.PIN_MAX === 8 && Vw.cleanStarredSettings(many, isKnown).length === 8 &&
			Vw.cleanStarredSettings(many, isKnown, 3).length === 3 &&
			JSON.stringify(Vw.cleanStarredSettings(many, isKnown)) === JSON.stringify(many.slice(0, 8)));
		ok("pins/a bad cap falls back to 8",
			[0, -1, NaN, "x", undefined].every((m) => Vw.cleanStarredSettings(many, isKnown, m).length === 8));
		ok("pins/without a predicate only identifier-shaped strings pass",
			JSON.stringify(Vw.cleanStarredSettings(["a_b1", "has space", "", "x".repeat(80), "9lives"])) === '["a_b1"]');
		ok("pins/the cleaner does not mutate its input",
			(() => { const a = ["pace", "pace"]; Vw.cleanStarredSettings(a, isKnown); return a.length === 2; })());
	}

	/* ---- Q1: time ago ----------------------------------------------------- */
	{
		const now = Date.UTC(2026, 9, 7, 12, 0, 0);
		const ago = (s) => Vw.timeAgo(now - s * 1000, now);
		ok("timeago/seconds read as just now", ago(0) === "just now" && ago(44) === "just now");
		ok("timeago/a minute, then minutes", ago(60) === "a minute ago" && ago(300) === "5 minutes ago" && ago(40 * 60) === "40 minutes ago");
		ok("timeago/an hour, then hours", ago(3600) === "an hour ago" && ago(3 * 3600) === "3 hours ago");
		ok("timeago/yesterday, days, months", ago(30 * 3600) === "yesterday" && ago(3 * 86400) === "3 days ago" &&
			ago(40 * 86400) === "40 days ago" && ago(90 * 86400) === "3 months ago");
		ok("timeago/the bands meet cleanly", ago(61 * 60 + 40) === "an hour ago" && ago(5400) === "2 hours ago" &&
			Vw.timeAgo(now - 100 * 3600 * 1000, now) === "4 days ago" && ago(44 * 60) === "44 minutes ago" && ago(45 * 60) === "an hour ago");
		ok("timeago/a clock that ran backwards reads as just now", Vw.timeAgo(now + 3600 * 1000, now) === "just now");
		ok("timeago/an ISO string works and garbage does not throw",
			Vw.timeAgo(new Date(now - 7200 * 1000).toISOString(), now) === "2 hours ago" && Vw.timeAgo("nope", now) === "a while ago" &&
			Vw.timeAgo(undefined, now) === "a while ago");
	}

	/* ---- Q1: the session record -------------------------------------------- */
	{
		const cls = (seed, n) => V.syntheticClass(seed, n);
		const fileOf = (name, data, extra) => Object.assign({ name, data, warnings: [] }, extra || {});
		const a = fileOf("a.json", cls(11, 12), { fingerprint: "fa" });
		const b = fileOf("b.json", cls(12, 8), { fingerprint: "fb", warnings: ["a warning", 5, "another"] });
		const snap = JSON.stringify({ v: 3, cfg: { pace: 70 }, overrides: { 7: { ovr: 60 } } });
		const sh = Vw.sessionShape([a, b], { active: 1, payloadJson: snap, now: 1000 });
		ok("session/two files shape into a state record and a files record", !sh.skip && sh.state.id === "state" && sh.files.id === "files" &&
			sh.state.sig === sh.files.sig && sh.files.files.length === 2, JSON.stringify(Object.keys(sh)));
		ok("session/the state record carries names, player count, active index, time and the payload",
			sh.state.names.join() === "a.json,b.json" && sh.state.players === 20 && sh.state.count === 2 && sh.state.active === 1 &&
			sh.state.savedAt === 1000 && sh.state.payload === snap && sh.state.v === 1, JSON.stringify(sh.state).slice(0, 300));
		ok("session/each file is stored as the JSON it was loaded from",
			sh.files.files.every((f, i) => f.json === JSON.stringify([a, b][i].data)) &&
			sh.files.files[0].fingerprint === "fa" && sh.files.files[1].warnings.join() === "a warning,another");
		ok("session/bytes is the sum of the JSON strings", sh.bytes === sh.files.files[0].json.length + sh.files.files[1].json.length);
		const back = Vw.sessionFiles(sh.files);
		ok("session/the files read back equal to what went in",
			back && back.length === 2 && JSON.stringify(back[0].data) === JSON.stringify(a.data) &&
			back[1].name === "b.json" && back[1].warnings.join() === "a warning,another" && !back[0].league);
		ok("session/a changed file changes the signature, a changed active index or payload does not",
			Vw.sessionShape([a, fileOf("b.json", cls(13, 8), { fingerprint: "fb" })], {}).sig !== sh.sig &&
			Vw.sessionShape([a, b], { active: 0, payloadJson: "{}" }).sig === sh.sig);

		// The size cap.
		const big = Vw.sessionShape([a, b], { maxBytes: 100 });
		ok("session/over the cap the session is skipped, not truncated", big.skip === "toobig" && !big.state && !big.files);
		ok("session/the default cap is 60 MB", Vw.SESSION_MAX_BYTES === 60 * 1024 * 1024);
		const exact = sh.bytes;
		ok("session/exactly at the cap is kept, one under is not",
			!Vw.sessionShape([a, b], { maxBytes: exact }).skip && Vw.sessionShape([a, b], { maxBytes: exact - 1 }).skip === "toobig");

		// Nothing to store.
		ok("session/no files, a file with no data and a synthetic universe file are not stored",
			Vw.sessionShape([], {}).skip === "empty" && Vw.sessionShape(null, {}).skip === "empty" &&
			Vw.sessionShape([{ name: "x" }], {}).skip === "empty" &&
			Vw.sessionShape([a, fileOf("s.json", cls(14, 4), { synthetic: { seed: "1" } })], {}).skip === "synthetic");
		ok("session/data that cannot be serialised is reported, not thrown",
			(() => { const c = { players: [] }; c.self = c; return Vw.sessionShape([fileOf("c.json", c)], {}).skip === "error"; })());

		// Leagues: shared by identity, and dropped first when they break the cap.
		const league = { name: "league.json", data: Object.assign(cls(15, 30), { teams: [] }) };
		const l1 = fileOf("league - 2027 class", cls(16, 5), { league });
		const l2 = fileOf("league - 2028 class", cls(17, 5), { league });
		const withLeague = Vw.sessionShape([l1, l2], { now: 5 });
		ok("session/a league file shared by two classes is stored once and linked from both",
			!withLeague.skip && withLeague.files.leagues.length === 1 && withLeague.files.files.every((f) => f.league === 0) &&
			!withLeague.leagueDropped);
		const lback = Vw.sessionFiles(withLeague.files);
		ok("session/...and comes back as one shared object",
			lback[0].league && lback[0].league === lback[1].league && lback[0].league.name === "league.json" &&
			Array.isArray(lback[0].league.data.players));
		const classBytes = l1.data && JSON.stringify(l1.data).length + JSON.stringify(l2.data).length;
		const noLeague = Vw.sessionShape([l1, l2], { maxBytes: classBytes + 10 });
		ok("session/a league that would break the cap is dropped and the classes are kept",
			!noLeague.skip && noLeague.files.leagues.length === 0 && noLeague.files.files.every((f) => f.league === -1) &&
			noLeague.leagueDropped === true && !Vw.sessionFiles(noLeague.files)[0].league);

		// The JSON cache avoids re-serialising.
		const cache = new WeakMap();
		const sh1 = Vw.sessionShape([a, b], { cache });
		const sh2 = Vw.sessionShape([a, b], { cache });
		ok("session/a cache makes the second shape reuse the same strings",
			cache.has(a.data) && sh1.files.files[0].json === sh2.files.files[0].json);

		// Damaged records are "no session".
		ok("session/a damaged files record reads as nothing",
			Vw.sessionFiles(null) === null && Vw.sessionFiles({}) === null && Vw.sessionFiles({ files: [] }) === null &&
			Vw.sessionFiles({ files: [{ name: "x", json: "{not json" }] }) === null &&
			Vw.sessionFiles({ files: [{ name: "x", json: "[1,2]" }] }) === null &&
			Vw.sessionFiles({ files: [{ name: "x" }] }) === null);
		ok("session/a league index that points nowhere is ignored",
			!Vw.sessionFiles({ files: [{ name: "x", json: "{\"players\":[]}", league: 4 }], leagues: [] })[0].league);

		// The sentence on the card.
		const now = 10 * 3600 * 1000;
		ok("card/one file", Vw.sessionLabel({ names: ["class.json"], players: 70, savedAt: now - 5 * 60 * 1000 }, now) ===
			"Restore last session: class.json, 70 players, saved 5 minutes ago");
		ok("card/singular player and long lists are shortened",
			Vw.sessionLabel({ names: ["a"], players: 1, savedAt: now }, now) === "Restore last session: a, 1 player, saved just now" &&
			Vw.sessionLabel({ names: ["a", "b", "c", "d", "e"], players: 200, savedAt: now - 3600 * 1000 * 3 }, now) ===
				"Restore last session: a, b, c and 2 more, 200 players, saved 3 hours ago");
		ok("card/no names gives no sentence", Vw.sessionLabel(null, now) === "" && Vw.sessionLabel({ names: [] }, now) === "");
	}

	/* ---- the wiring, read from the source ---------------------------------- */
	{
		ok("wiring/the database is version 2 and the upgrade only adds a missing store",
			/const IDB_VERSION = 2;/.test(APP) && /indexedDB\.open\(IDB_NAME, IDB_VERSION\)/.test(APP) &&
			/const SESSION_STORE = "session";/.test(APP) &&
			/objectStoreNames\.contains\(n\)\) req\.result\.createObjectStore\(n, \{ keyPath: k \}\)/.test(APP) &&
			!/deleteObjectStore/.test(APP));
		ok("wiring/the universe store and its key path are still declared for the upgrade",
			/\[\[IDB_STORE, "slot"\], \[SESSION_STORE, "id"\]\]/.test(APP));
		ok("wiring/an open connection steps aside for a newer tab's upgrade",
			/onversionchange = \(\) => \{ try \{ req\.result\.close\(\)/.test(APP));
		ok("wiring/persist() schedules the session write, debounced, and pagehide flushes it",
			/function persist\(\) \{\s*scheduleAutosave\(\);\s*scheduleSessionSave\(\);/.test(APP) &&
			/const SESSION_DEBOUNCE = 1500;/.test(APP) && /addEventListener\("pagehide"/.test(APP));
		ok("wiring/the write is skipped by size through Views.sessionShape and says so once",
			/V\.sessionShape\(state\.files/.test(APP) && /function sessionSay\(key, text\)/.test(APP) &&
			/if \(sessionSaid === key\) return;/.test(APP));
		ok("wiring/every IndexedDB call returns a result object and never throws into the page",
			/function sessionTx\(mode, make\)[\s\S]{0,900}catch \(e\) \{ resolve\(\{ ok: false/.test(APP) &&
			/\.catch\(\(\) => \(\{ ok: false, why: "error" \}\)\)/.test(APP));
		ok("wiring/Restore goes through installFiles with the active index, after the payload is applied",
			/restore\(snap\);\s*paintConfig\(\);/.test(APP) && /installFiles\(files, \[\], \{ active: Number\(meta\.active\) \|\| 0, noRun: true \}\)/.test(APP) &&
			/opts\.active >= 0 && opts\.active < state\.files\.length/.test(APP));
		ok("wiring/restore() can apply a given payload instead of localStorage's",
			/function restore\(given\) \{/.test(APP) && /let saved = given \|\| null;/.test(APP));
		ok("wiring/the snapshot leaves out the universe, the run history, the theme and the pins",
			/universe: null, sessions: undefined, theme: undefined,\s*density: undefined, starredSettings: undefined/.test(APP));
		ok("wiring/nothing restores by itself: the card calls restoreLastSession from a click only",
			(APP.match(/restoreLastSession\(/g) || []).length === 1 && /addEventListener\("click", restoreLastSession\)/.test(APP));
		ok("wiring/Reset to defaults leaves the stored session alone",
			!/SESSION_STORE|sessionTx|discardLastSession/.test(
				(APP.match(/\$\("btnReset"\)\.addEventListener[\s\S]{0,1500}/) || [""])[0]) &&
			/\$\("btnReset"\)\.addEventListener/.test(APP));
		ok("wiring/the card is in the page after the drop box, hidden, with Restore and Discard",
			/id="empty"[\s\S]{0,2500}id="sessionCard"[^>]*hidden/.test(HTML) &&
			/id="btnSessionRestore"/.test(HTML) && /id="btnSessionDiscard"/.test(HTML) && /id="sessionCardText"/.test(HTML));
		ok("wiring/the card is shown wherever the drop box is, so a stranded universe offers it too",
			/!state\.files\.length && !!\$\("empty"\) && !\$\("empty"\)\.hidden/.test(APP));

		ok("pins/the Pinned group is the first group, with the empty hint",
			/id="grp-pinned"/.test(HTML) && HTML.indexOf('id="grp-pinned"') < HTML.indexOf('id="grp-quality"') &&
			/Star a setting to keep it here/.test(HTML) && /id="pinnedHint"/.test(HTML));
		ok("pins/the list is in the persisted payload and read back through the cleaner",
			/starredSettings: state\.starredSettings,/.test(APP) &&
			/V\.cleanStarredSettings\(saved\.starredSettings, starrable, V\.PIN_MAX\)/.test(APP));
		ok("pins/the real control is moved, never copied: no second id, a marker left behind",
			/function applyStarredSettings\(\)/.test(APP) && /box\.appendChild\(ctl\)/.test(APP) &&
			/document\.createComment\("home of " \+ key\)/.test(APP) && !/cloneNode/.test(
				(APP.match(/function applyStarredSettings[\s\S]{0,1800}/) || [""])[0]));
		ok("pins/the star is a button with aria-pressed and the label \"Pin <label> to the top\"",
			/"aria-label", "Pin " \+ name \+ " to the top"/.test(APP) && /setAttribute\("aria-pressed", on \? "true" : "false"\)/.test(APP) &&
			/b = el\("button", "star-btn"\);\s*b\.type = "button";/.test(APP));
		ok("pins/the filter exempts the group from the tier and hides it when nothing matches",
			/grp\.id !== "grp-pinned" &&\s*TIER_RANK/.test(APP) && /grp\.id === "grp-pinned" && !!\(q \|\| changedOnly\)/.test(APP));
		ok("pins/a pinned control still counts toward its own group's changed badge and reset",
			/ctl\.dataset\.home === details\.id/.test(APP) && /ctl\.dataset\.home = ctl\.parentNode\.id/.test(APP));
		ok("pins/paintConfig repaints the stars after the locks, and startup applies the list first",
			/paintLockButtons\(\);\s*paintStarButtons\(\);/.test(APP) && /applyStarredSettings\(\);\s*paintConfig\(\);/.test(APP));
		ok("pins/the changed dot and revert button go before the star so it stays last",
			/label\.insertBefore\(dot, label\.querySelector\("\.star-btn"\)\)/.test(APP) &&
			/label\.insertBefore\(revertBtn, label\.querySelector\("\.star-btn"\)\)/.test(APP));
		ok("pins/styles: the star, the session card, and the hidden hint",
			/\.ctl \.star-btn\s*\{/.test(CSS) && /\.sessioncard\s*\{/.test(CSS) && /#grp-pinned > \.hint\[hidden\]/.test(CSS));
		ok("pins/the empty-state CSS still hides the whole settings column but the theme row",
			/body\.noclass #settings > :not\(\.themerow\):not\(\.noclassnote\) \{ display: none; \}/.test(CSS));
	}
};
