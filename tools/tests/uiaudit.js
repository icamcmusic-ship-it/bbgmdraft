"use strict";
/* Regression checks for the 2026-10-10 audit, section 2 (UI/UX and QOL).
   Pure helpers are called headless; the rest is pinned against the source,
   and tools/uismoke.js covers the rendered half. */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

module.exports = function (ok, V) {
	void V;
	if (!global.window) global.window = global;
	require(path.join(ROOT, "js", "views.js"));
	const Vw = global.Views;
	const APP = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
	const VIEWS = fs.readFileSync(path.join(ROOT, "js", "views.js"), "utf8");
	const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
	const CSS = fs.readFileSync(path.join(ROOT, "css", "style.css"), "utf8");

	/* ---- U20: the position filter matches groups ------------------------- */
	const mk = (pos, group, extra) => Object.assign({ newPos: pos, posGroup: group }, extra || {});
	ok("U20/grp:guard matches PG, SG and G",
		["PG", "SG", "G"].every((p) => Vw.boardPosMatch("grp:guard", mk(p, "guard"))) &&
		!Vw.boardPosMatch("grp:guard", mk("SF", "wing")));
	ok("U20/grp:big matches FC and C even without posGroup",
		Vw.boardPosMatch("grp:big", { newPos: "FC" }) && Vw.boardPosMatch("grp:big", { newPos: "C" }) &&
		!Vw.boardPosMatch("grp:big", { newPos: "PF" }));
	ok("U20/an exact position is still exact",
		Vw.boardPosMatch("G", mk("G", "guard")) && !Vw.boardPosMatch("G", mk("PG", "guard")));
	ok("U20/the filter offers the groups", /grp:guard/.test(VIEWS) && /Guards \(PG\/SG\/G\)/.test(VIEWS));

	/* ---- U4/U37: position standing, stars column, sleepers --------------- */
	const board = [
		{ key: "a", boardRank: 1, posGroup: "guard", posBoardRank: 1, posLeader: true, recruiting: { stars: 5 } },
		{ key: "b", boardRank: 2, posGroup: "big", posBoardRank: 1, posLeader: true, recruiting: { stars: 2 } },
		{ key: "c", boardRank: 3, posGroup: "guard", posBoardRank: 2, recruiting: { stars: 3 } },
		{ key: "d", boardRank: 40, posGroup: "guard", posBoardRank: 3, recruiting: { stars: 2 } },
	];
	const line = Vw.posStandingLine(board[2], { board });
	ok("U4/the standing line reads '2nd of 3 guards in this class · 3-star recruit'",
		line === "2nd of 3 guards in this class · 3-star recruit", line);
	ok("U4/the popover carries the standing line",
		Vw.whyLines(board[1], { board }).some((l) => /^1st of 1 big in this class|^1st of 1 bigs/.test(l)),
		JSON.stringify(Vw.whyLines(board[1], { board })));
	ok("U4/the board has Pos# and stars columns", /"Pos#", "Stars"/.test(VIEWS));
	ok("U4/the HS positional rank is labelled as history",
		Vw.hsPosRankText({ posRank: 5, posLabel: "big" }) === " · No. 5 big in his HS class" &&
		Vw.hsPosRankText({}) === "");
	ok("U37/sleepers: a 2-star position leader and a top-30 3-star, not a 5-star or a deep 2-star",
		Vw.isSleeper(board[1]) && Vw.isSleeper(board[2]) && !Vw.isSleeper(board[0]) && !Vw.isSleeper(board[3]));

	/* ---- U19: tiers are few and come from the biggest drops -------------- */
	const ovrs = [60, 59, 58, 50, 49, 49, 48, 44, 43, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33];
	const tb = ovrs.map((o, i) => ({ key: "k" + i, newOvr: o }));
	const tiers = Vw.boardTiers(tb);
	const keys = Object.keys(tiers);
	ok("U19/the 8-point drop starts tier 2", tiers.k3 && tiers.k3.tier === 2 && tiers.k3.drop === 8,
		JSON.stringify(tiers));
	ok("U19/at most five breaks, and 1-point steps are never one", keys.length <= 5 &&
		keys.every((k) => tiers[k].drop >= 3));

	/* ---- small fixes pinned against the source --------------------------- */
	ok("U8/the mock table's wrapper scrolls sideways", /\.tablewrap \{ max-width: 100%; overflow-x: auto; \}/.test(CSS));
	ok("U9/toasts have a close button and a quiet setting",
		/toastx/.test(APP) && /replayQuiet/.test(APP) && /function achievementsQuiet/.test(APP));
	ok("U11/Ledger Light dim and Night Game accent were darkened/lightened",
		/ledger-light"\] \{[^}]*--dim: #55525f/.test(CSS) && /night-game"\] \{[^}]*--accent: #7fa3c4/.test(CSS));
	ok("U12/radar labels are 11px", /"font-size": "11"/.test(VIEWS));
	ok("U13/poll week, article kind and article search are labelled",
		/"Poll week"/.test(VIEWS) && /"Article kind"/.test(VIEWS) && /"Filter articles by team or player"/.test(VIEWS));
	ok("U14/each tab gets an h2", /function tabHeading/.test(APP));
	ok("U15/radio chip groups rove with the arrow keys", /function rovingRadios/.test(APP) &&
		(APP.match(/rovingRadios\(/g) || []).length >= 3);
	ok("U16/JSON parse errors are translated", /function friendlyJsonError/.test(APP) &&
		/parseJsonFriendly\(text\)/.test(APP));
	ok("U17/merge failures use the error banner", !/setStatus\("Could not merge/.test(APP));
	ok("U18/the league-split note is an info banner with a universe button",
		/Run as one universe/.test(APP) && /#warnBanner\.info/.test(CSS));
	ok("U21/copy link and copy text say 'load a class first'", /function needClassFirst/.test(APP));
	ok("U22/Export JSON says why it is disabled", /id="btnExport"[^>]*title="Load a class first/.test(HTML));
	ok("U23/a universe run drives the progress meter", /progressShow\("Universe: season "/.test(APP));
	ok("U25/skill chips name the skill", /Interior defender/.test(VIEWS) && /SKILL_NAMES\[sk\]/.test(VIEWS));
	ok("U26/the player page dl has its own class", /shortcuts playerdl/.test(VIEWS) && /\.playerdl dt/.test(CSS));
	ok("U27/coarse pointers get bigger targets", /@media \(pointer: coarse\)/.test(CSS));
	ok("U28/booleans read off/on in diffs, universe seeds read as world seeds",
		/function settingWord/.test(APP) && /world seed /.test(APP));
	ok("U30/[ and ] cycle tabs, / focuses the page's search",
		/k === "\[" \|\| k === "\]"\) && !\$\("archFilter"\)/.test(APP) && /#view input\[type="search"\]/.test(APP));
	ok("U3/the first class shows the meter", /the first class takes a few seconds/.test(APP));
	ok("U32/settings levels are Basic / More / Everything", /"shape", "Basic"/.test(APP) && /"model", "Everything"/.test(APP));
	ok("U40/the theme picker has no clipped glyph", !/◐/.test(HTML));
	ok("U41/the phone settings sheet has a Done bar", /sheetdone/.test(APP));
	ok("U44/'Reroll until…' and 'Re-run same seed'", />Reroll <\/span>until…</.test(HTML) && / same seed<\/span>/.test(HTML));
	ok("U46/a DNP tag in the PPG cell", /dnptag/.test(VIEWS));
	ok("U47/the board's copy actions are one menu", /copymenu/.test(VIEWS));
	ok("U2/U39/the written file's size is shown", /function fmtBytes/.test(APP));

	/* ---- the second pass: U10, U24, U31-U36, U38, U42, U43, U45 ---------- */
	ok("U10/the small tools are one Tools menu at every width",
		/id="btnHeaderMore"[^>]*aria-haspopup="menu"[^>]*>Tools ▾</.test(HTML.replace(/\n\s*/g, " ")) &&
		/<div class="toolsmenu">/.test(HTML) && /header:not\(\.toolsopen\) #headerTools \{ display: none; \}/.test(CSS));
	ok("U10/Reroll, Undo and Export stay outside the menu", (() => {
		const menu = HTML.slice(HTML.indexOf('id="headerTools"'), HTML.indexOf("</header>"));
		return !/btnReroll|btnUndo|btnExport"/.test(menu) && /btnPin/.test(menu) && /btnPrint/.test(menu);
	})());
	ok("U10/the menu closes on Escape and outside clicks, and arrows walk it",
		/e\.key === "Escape"/.test(APP.slice(APP.indexOf("function bindHeaderMore"))) &&
		/closest\("\.toolsmenu"\)/.test(APP));
	ok("U45/every tool in the menu shows its name beside its icon",
		/header #headerTools > \.iconbtn\[data-tip\]::after/.test(CSS) && /role", "menuitem"/.test(APP));
	ok("U45/added tools get a short name, not their whole tooltip",
		/add\("btnKept", "★", "Kept classes", /.test(APP));
	ok("U24/Player Edit keeps search, position and presets out; the rest folds",
		/quickfilters/.test(VIEWS) && /"Filters" \+ \(nActive \? " \(" \+ nActive \+ " active\)"/.test(VIEWS) &&
		/fold\.open = !!uiMemo\.filtersOpen;/.test(VIEWS));
	ok("U24/the bulk bar sits above the table only while rows are selected",
		/if \(!picked\) fold\.appendChild\(bulk\)/.test(VIEWS) && /if \(picked\) view\.appendChild\(bulk\)/.test(VIEWS));
	ok("U31/no stub settings panel and no disabled tool groups before a class",
		/body\.noclass header > \.btngroup\[aria-label="Generate"\]/.test(CSS) &&
		/body\.noclass #settings \{[^}]*position: fixed/.test(CSS));
	ok("U31/the drop box shows three steps", /<ol class="steps"/.test(HTML) &&
		(HTML.match(/<li><b>(Load|Read the board|Export)<\/b>/g) || []).length === 3);
	ok("U32/a first visit starts at Basic", /settingTier: "shape",/.test(APP));
	ok("U33/the re-run cost is hover/focus only, long hints fold behind (i)",
		/#settings \.ctl \.rerun \{\s*display: none; position: absolute;/.test(CSS) && /function foldLongHints/.test(APP) &&
		/hintclamp/.test(CSS));
	ok("U34/the export menu is in headed sections with folded options",
		/\["bbgm", "Back to BBGM"\]/.test(APP) && /\["pics", "Pictures and pages"\]/.test(APP) &&
		/"Options for BBGM files: "/.test(APP) && /optFold\.id = "exportOptions"/.test(APP));
	ok("U35/the board has a Compact chip, honors as a count, movers fold",
		/"Compact"/.test(VIEWS) && /function honorsCell\(p, compact\)/.test(VIEWS) && /moverfold/.test(VIEWS) &&
		/table\.boardcompact/.test(CSS) && /boardCompact: state\.boardCompact/.test(APP));
	const extras = Vw.boardExtraColumns({ boardExtra: ["recRank", "hgtInches", "bogus"] });
	ok("U36/the board's extra columns come from the registry whitelist, in its order",
		extras.map((c) => c.key).join() === "hgtInches,recRank" && extras[0].label === "Ht",
		JSON.stringify(extras));
	ok("U36/extra cells format height, blanks and decimals",
		Vw.boardExtraText("hgtInches", 83) === "6'11\"" && Vw.boardExtraText("age", undefined) === "—" &&
		Vw.boardExtraText("rpg", 7.25) === "7.3", Vw.boardExtraText("rpg", 7.25));
	ok("U36/the column choice is remembered", /boardHidden: state\.boardHidden/.test(APP) &&
		/boardExtra: state\.boardExtra/.test(APP) && /function boardColumnMenu/.test(VIEWS));
	ok("U38/one progress component with a cancel, used by every long job",
		/function progressShow\(label, frac, detail, onCancel\)/.test(APP) && /lp-cancel/.test(HTML) &&
		/progressShow\("Reroll until: try "/.test(APP) && /progressShow\("Batch: "/.test(APP) &&
		/progressShow\("Exporting "/.test(APP) && /progressShow\("Merging "|step\("Merging "/.test(APP) &&
		/cancelUniverse\);/.test(APP));
	ok("U42/one tab row: short names below 1600px, sideways scroll instead of wrapping",
		/const TAB_SHORT = /.test(APP) && /\.tabs \.tl-long \{ display: none; \}/.test(CSS) &&
		/@media \(min-width: 701px\) \{\s*\.tabs \{\s*flex-wrap: nowrap/.test(CSS));
	ok("U43/the ballot cards carry a key and number tooltips",
		/ballot points behind the winner/.test(VIEWS) && /ballotkey/.test(VIEWS) &&
		/How much this electorate weighs team success/.test(VIEWS));
};
