#!/usr/bin/env node
/* Single-file build of the tool, for email and a USB stick. Optional: the
   project has no build step and the page runs straight off the disk; this
   only writes one HTML file with the stylesheet and every script inlined
   (about 3.3 MB), no dependencies.

   Usage: node tools/bundle.js [--out dist/bbgm-draft-workshop.html]
          npm run bundle

   The scripts are the ones js/manifest.js lists for the page, in its order,
   and index.html must load exactly those (tools/tests/fixes.js already fails
   when it does not); this reads the tags from index.html so the page's own
   order is the order written, and refuses to build when the two disagree.

   What the bundle leaves out, on purpose: the web app manifest and the
   service worker (they are for an installed copy served over https, and a
   file opened from a disk can use neither), and the batch worker, which a
   page opened from a disk cannot start anyway (the page already falls back to
   running a batch on its own thread when it cannot). Everything else is the
   page as it is. */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

/* A script's text made safe to sit inside <script>…</script>: the two
   sequences the HTML parser treats specially. Both are escaped with a
   backslash, which is a no-op in a JavaScript string, template or regular
   expression (and a comment), the only places they can legally appear. */
function escapeScript(text) {
	return text.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

function build() {
	const manifest = require(path.join(ROOT, "js", "manifest.js"));
	let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
	const css = fs.readFileSync(path.join(ROOT, "css", "style.css"), "utf8");
	if (/<\/style/i.test(css)) throw new Error("css/style.css contains </style and cannot be inlined");

	const tag = /<script\b[^>]*\bsrc="js\/([^"]+)\.js"[^>]*><\/script>/g;
	const seen = [];
	html = html.replace(tag, (all, name) => {
		seen.push(name);
		const file = path.join(ROOT, "js", name + ".js");
		// data-src names the file a block came from, so a page error or a test can say.
		return '<script data-src="js/' + name + '.js">\n' +
			escapeScript(fs.readFileSync(file, "utf8")) + "\n</script>";
	});
	const want = manifest.page;
	if (seen.join(",") !== want.join(",")) {
		throw new Error("index.html loads [" + seen.join(", ") + "] but js/manifest.js lists [" +
			want.join(", ") + "]; they must agree");
	}

	const link = '<link rel="stylesheet" href="css/style.css">';
	if (html.indexOf(link) === -1) throw new Error("index.html has no " + link);
	html = html.replace(link, () => "<style>\n" + css + "\n</style>");
	// The manifest link would be a failed request from a disk.
	html = html.replace(/<link rel="manifest"[^>]*>\s*/, "");
	return { html, scripts: seen };
}

module.exports = { build, escapeScript };

if (require.main === module) {
	const i = process.argv.indexOf("--out");
	const out = path.resolve(i > 0 && process.argv[i + 1] ? process.argv[i + 1]
		: path.join(ROOT, "dist", "bbgm-draft-workshop.html"));
	const { html, scripts } = build();
	fs.mkdirSync(path.dirname(out), { recursive: true });
	fs.writeFileSync(out, html);
	console.log("wrote " + out + " (" + (Buffer.byteLength(html) / 1048576).toFixed(2) + " MB, " +
		scripts.length + " scripts and the stylesheet inlined)");
}
