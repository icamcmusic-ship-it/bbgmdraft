#!/usr/bin/env node
/* Run one or more area suites (tools/tests/<name>.js) on their own.

   Usage: node tools/run-area.js notes fixes
          node tools/run-area.js tools/tests/notes.js

   Each area file exports `(ok, V)` and does not depend on anything tools/test.js
   sets up first, so it can run in its own process: that is what lets
   tools/test-parallel.js spread the suite over every core. Exit code is
   non-zero if any check fails. */
"use strict";

process.env.BBGM_STRICT_ROLES = "1";

const path = require("path");
const V = require("./validate.js");

V.loadEngine();

let checks = 0;
let failures = 0;
function ok(name, condition, detail) {
	checks++;
	if (condition) console.log("  ok   " + name);
	else {
		failures++;
		console.log("  FAIL " + name + (detail ? "\n         " + detail : ""));
	}
}

const names = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!names.length) {
	console.error("usage: node tools/run-area.js <area> [<area>...]");
	process.exit(2);
}
for (const n of names) {
	const file = /[\\/]/.test(n) || /\.js$/.test(n)
		? path.resolve(n) : path.join(__dirname, "tests", n + ".js");
	console.log("\n" + path.basename(file).replace(/\.js$/, "") + " (" +
		path.relative(process.cwd(), file) + ")");
	try {
		require(file)(ok, V);
	} catch (e) {
		ok(path.basename(file) + " runs", false, e && e.stack ? e.stack : String(e));
	}
}
console.log("\n" + (failures ? failures + " of " + checks + " checks failed"
	: "all " + checks + " checks passed"));
process.exit(failures ? 1 : 0);
