"use strict";
/* Static checks on the page's chrome — the half of the UI a headless browser
   run does not fail on.

   tools/uismoke.js drives the page and reads what it renders; it cannot see a
   custom property that no theme defines, because a var() with a fallback is
   valid CSS that renders the fallback in silence. That is exactly how
   `.phasecost` came to paint the same three light-theme hexes in every dark
   theme (var(--ok), var(--warn) — neither has ever existed), how the poll
   movement column kept a dark green on a dark panel (var(--win)), and how the
   two heaviest upset shades in the bracket stayed light-theme brown
   (--upset-bg2, --upset-bg3). One grep over the stylesheet catches the class. */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const CSS = fs.readFileSync(path.join(ROOT, "css", "style.css"), "utf8");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

module.exports = function (ok, V) {
	void V;

	/* Every token a rule reads has to be set by some palette. Comments name
	   tokens too ("reads var(--ok)"), so they come out first. */
	const css = CSS.replace(/\/\*[\s\S]*?\*\//g, " ");
	const defined = {};
	for (const m of css.match(/(^|[\s{;])--[A-Za-z0-9-]+\s*:/gm) || []) {
		defined[m.replace(/[\s{;:]/g, "")] = true;
	}
	const used = {};
	for (const m of css.match(/var\(\s*--[A-Za-z0-9-]+/g) || []) {
		used[m.replace(/var\(\s*/, "")] = true;
	}
	const missing = Object.keys(used).filter((k) => !defined[k]).sort();
	ok("every CSS custom property the stylesheet reads is defined by a palette",
		missing.length === 0, missing.join(", "));

	/* The themes are full palettes, so a token added for one of them has to be
	   added for all of them or a theme falls back to another theme's value.
	   --on-accent is the one that decides whether the most-pressed button in
	   the tool is readable: white on the light-blue accent the dark palettes
	   use is 2.6:1. */
	const themes = (CSS.match(/:root\[data-theme="[a-z-]+"\]\s*{[^}]*}/g) || [])
		.filter((b) => /--accent\s*:/.test(b));
	ok("the named themes are full palettes", themes.length >= 6, String(themes.length));
	const darkish = themes.filter((b) => /--on-accent\s*:\s*#[0-3]/.test(b));
	ok("a theme with a light accent states its own text-on-accent color",
		darkish.length >= 3, darkish.length + " themes set a dark --on-accent");
	for (const b of themes) {
		const name = (b.match(/data-theme="([a-z-]+)"/) || [])[1];
		// Every theme that overrides --win-bg overrides the upset shades with
		// it; half a bracket palette is how the dark bracket kept brown.
		if (/--win-bg\s*:/.test(b)) {
			ok("theme " + name + " carries the whole bracket palette",
				/--upset-bg\s*:/.test(b) && /--upset-bg2\s*:/.test(b) &&
				/--upset-bg3\s*:/.test(b));
		}
	}

	/* Icon-only buttons in the shell. A ⌘ or a ↶ with no accessible name is a
	   button a screen reader announces as "button". */
	const buttons = HTML.match(/<button[^>]*>[\s\S]*?<\/button>/g) || [];
	const unnamed = buttons.filter((b) => {
		const text = b.replace(/<[^>]*>/g, "").replace(/\s+/g, "");
		if (text.length > 3 || /[a-z]{2}/i.test(text)) return false;
		// A button whose label is written by the app (the seed pill) is named
		// at render time; it needs a title here and nothing else.
		if (!text) return !/title=/.test(b);
		return !/aria-label=/.test(b);
	});
	ok("every icon-only button in index.html has an aria-label",
		unnamed.length === 0, unnamed.join(" | ").slice(0, 200));

	/* The header's flex spacer: with a height of its own it becomes an empty
	   band across the page the moment the header wraps, which it does at every
	   width once the seed history and a long "Undo …" label are in it. */
	ok("the header spacer collapses when the header wraps",
		/\.spacer\s*{[^}]*height:\s*0/.test(CSS));
	ok("the undo label cannot widen the header without limit",
		/#btnUndo\s*{[^}]*max-width/.test(CSS));

	/* prefers-reduced-motion, for the spinner and the note-card reveal. */
	ok("the stylesheet answers prefers-reduced-motion",
		/@media\s*\(prefers-reduced-motion/.test(CSS));

	/* ------------------------------- the September 2026 external audit */

	/* A prospect with no season is dimmed rather than left as two blank cells
	   that read as missing data. The rule and the class that sets it have to
	   exist together: either one alone is dead code. */
	const VIEWS = fs.readFileSync(path.join(ROOT, "js", "views.js"), "utf8");
	ok("a prospect with no season is marked on the board",
		/classList\.add\("dnp"\)/.test(VIEWS) && /tr\.dnp/.test(CSS));
	ok("and the marked row still explains itself",
		/did not play/i.test(VIEWS));

	/* Long tables skip their off-screen rows, and stop skipping them when the
	   page is printed — where every row has to be on the paper. */
	ok("long tables skip their off-screen rows",
		/content-visibility:\s*auto/.test(CSS));
	ok("and stop skipping them when the page is printed",
		/@media print[\s\S]*content-visibility:\s*visible/.test(CSS));

	/* The two copy buttons: a link for someone who will click it, and plain
	   text for the places a link is eaten. */
	ok("the header offers both a link and a plain-text copy",
		/id="btnCopyLink"/.test(HTML) && /id="btnCopyText"/.test(HTML));

	/* The build-pool slider's cap is written from the build table at startup,
	   so the markup's own number is only a floor. It still must not be the
	   stale 40 that made the documented off switch unreachable. */
	{
		const m = /id="archetypePool"[^>]*max="(\d+)"/.exec(HTML);
		ok("the build-pool slider is not still capped at 40",
			!!m && Number(m[1]) > 40, m ? "max " + m[1] : "slider not found");
	}

	/* ------------------------------------ the second audit (app.js faults) */

	/* The text choices go through Config.make like the numbers do. A link
	   carrying an era that does not exist was stored verbatim and threw
	   inside the first paint, before any control was bound. */
	{
		const CFG = global.Config;
		const c = CFG.make({ era: "bogus", ovrMode: "x", priorSeasons: 3,
			collegeSource: null, flavorHint: "no such flavor", universe: "true",
			narrative: "maybe", noteLines: ["stats", "nope", "stats"], wEuroLeague: "50" });
		ok("Config.make puts an unknown era, mode or flavor back to its default",
			c.era === CFG.DEFAULTS.era && c.ovrMode === "preserve" &&
			c.priorSeasons === "simulate" && c.collegeSource === "blanks" &&
			c.flavorHint === "", JSON.stringify([c.era, c.ovrMode, c.priorSeasons,
				c.collegeSource, c.flavorHint]));
		ok("and coerces the switches to booleans",
			c.universe === true && c.narrative === CFG.DEFAULTS.narrative);
		ok("and keeps only the note lines the engine knows, once each",
			JSON.stringify(c.noteLines) === '["stats"]', JSON.stringify(c.noteLines));
		ok("and folds a legacy destination weight that arrived as a string",
			c.leagueWeights.EuroLeague === 50, String(c.leagueWeights.EuroLeague));
		ok("and a payload that is not an object is the defaults",
			CFG.make(null).pace === CFG.DEFAULTS.pace &&
			CFG.make("junk").era === CFG.DEFAULTS.era);
		// Every preset that moves a curve dial asks for the curve.
		const curveKeys = ["classQuality", "classDepth", "eliteCount"];
		const inert = Object.keys(CFG.PRESETS).filter((n) =>
			curveKeys.some((k) => k in CFG.PRESETS[n]) && CFG.PRESETS[n].ovrMode !== "curve");
		ok("every preset that sets a curve dial turns the curve on",
			inert.length === 0, inert.join(", "));
	}

	const APP = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
	/* rerollUntil's worker branch returns before the inline fallback's
	   helpers are reached, so they must be hoisted declarations — as consts
	   the worker's onerror hit them in the temporal dead zone. */
	{
		const body = (APP.match(/function rerollUntil\(keys, maxTries\) \{[\s\S]*?\n\t\}\n/) || [""])[0];
		ok("rerollUntil's fallback helpers are declarations, not late consts",
			!!body && !/const (step|finish|finishFound) =/.test(body) &&
			/function step\(\)/.test(body), body ? "" : "rerollUntil not found");
	}
	ok("nothing assigns the body's whole className (it carries panel state)",
		!/document\.body\.className\s*=/.test(APP));
	/* The density classes are toggled one at a time, and the number box
	   under the cursor is not rewritten by a repaint. */
	ok("paintConfig does not repaint the number box being typed in",
		/num !== document\.activeElement/.test(APP));
	ok("defaults are compared after Config.make expands them",
		/function isDefaultSetting\(/.test(APP) &&
		!/JSON\.stringify\(state\.cfg\[k\]\) !== JSON\.stringify\(CFG\.DEFAULTS\[k\]\)/.test(APP));
};
