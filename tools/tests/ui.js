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
};
