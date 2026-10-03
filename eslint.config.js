/* Lint for a codebase with no build step.

   Deliberately small: the rules that find real defects (a name that does not
   exist, a key written twice, a duplicate case) and none that argue about
   style. There is no package.json dependency: CI runs `npx eslint@9`, and this
   file needs no plugin. See tools/lint.js. */
"use strict";

const browserGlobals = {
	window: "readonly", self: "readonly", document: "readonly", navigator: "readonly",
	location: "readonly", localStorage: "readonly", sessionStorage: "readonly",
	indexedDB: "readonly", performance: "readonly", console: "readonly",
	setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly",
	clearInterval: "readonly", requestAnimationFrame: "readonly", fetch: "readonly",
	URL: "readonly", Blob: "readonly", Worker: "readonly", FileReader: "readonly",
	CompressionStream: "readonly", DecompressionStream: "readonly", Response: "readonly",
	Request: "readonly", Headers: "readonly", Event: "readonly", ErrorEvent: "readonly",
	CustomEvent: "readonly", MutationObserver: "readonly", ResizeObserver: "readonly",
	IntersectionObserver: "readonly", FormData: "readonly", File: "readonly",
	Option: "readonly", Image: "readonly", HTMLElement: "readonly", Node: "readonly",
	TextEncoder: "readonly", TextDecoder: "readonly", atob: "readonly", btoa: "readonly",
	alert: "readonly", confirm: "readonly", prompt: "readonly", caches: "readonly",
	clients: "readonly", importScripts: "readonly", addEventListener: "readonly",
	postMessage: "readonly", queueMicrotask: "readonly", structuredClone: "readonly",
	matchMedia: "readonly", getComputedStyle: "readonly", crypto: "readonly",
	AbortController: "readonly", DOMParser: "readonly", XMLSerializer: "readonly",
	Intl: "readonly", ClipboardItem: "readonly", MessageChannel: "readonly",
	BroadcastChannel: "readonly", SVGElement: "readonly", Element: "readonly",
	Audio: "readonly", screen: "readonly", history: "readonly", open: "readonly",
	print: "readonly", innerWidth: "readonly", innerHeight: "readonly",
	CSS: "readonly", DataTransfer: "readonly", ClipboardEvent: "readonly",
	MouseEvent: "readonly", HTMLAnchorElement: "readonly",
	// Read behind a `typeof process` guard in js/ratings.js (the Node harness sets it).
	process: "readonly",
};

const nodeGlobals = {
	require: "readonly", module: "writable", exports: "writable", process: "readonly",
	__dirname: "readonly", __filename: "readonly", Buffer: "readonly", global: "writable",
	console: "readonly", setTimeout: "readonly", clearTimeout: "readonly",
	setInterval: "readonly", clearInterval: "readonly", setImmediate: "readonly",
	URL: "readonly", performance: "readonly", structuredClone: "readonly",
	TextEncoder: "readonly", TextDecoder: "readonly", fetch: "readonly",
	AbortController: "readonly", queueMicrotask: "readonly",
};

const rules = {
	"no-undef": "error",
	"no-dupe-keys": "error",
	"no-dupe-args": "error",
	"no-duplicate-case": "error",
	"no-dupe-else-if": "error",
	"no-redeclare": "error",
	"no-unreachable": "error",
	"no-self-assign": "error",
	"no-unsafe-negation": "error",
	"no-const-assign": "error",
	"no-func-assign": "error",
	"no-import-assign": "error",
	"no-invalid-regexp": "error",
	"no-sparse-arrays": "error",
	"use-isnan": "error",
	"valid-typeof": "error",
	"getter-return": "error",
	"no-cond-assign": ["error", "except-parens"],
	"no-unsafe-finally": "error",
	"no-loss-of-precision": "error",
	"no-prototype-builtins": "off",
	// Dead variables, which is how a half-finished edit shows up. Arguments and
	// caught errors are left alone (a callback has to take them to take the next one).
	"no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
	"no-empty": ["error", { allowEmptyCatch: true }],
};

module.exports = [
	{ ignores: ["js/vendor/**", "node_modules/**", ".claude/**"] },
	{
		files: ["js/**/*.js"],
		languageOptions: { ecmaVersion: 2022, sourceType: "script", globals: browserGlobals },
		rules,
	},
	{
		files: ["js/manifest.js"],
		languageOptions: { ecmaVersion: 2022, sourceType: "script",
			globals: Object.assign({}, browserGlobals, { module: "writable" }) },
		rules,
	},
	{
		files: ["sw.js"],
		languageOptions: { ecmaVersion: 2022, sourceType: "script", globals: browserGlobals },
		rules,
	},
	{
		/* The smoke test passes functions to page.evaluate(), which run in the
		   page, so they see the browser's globals and the tool's own modules. */
		files: ["tools/uismoke.js"],
		languageOptions: { ecmaVersion: 2022, sourceType: "commonjs",
			globals: Object.assign({}, browserGlobals, nodeGlobals, {
				Engine: "readonly", BatchStats: "readonly", Config: "readonly", App: "readonly",
			}) },
		rules,
	},
	{
		files: ["tools/**/*.js", "eslint.config.js"],
		ignores: ["tools/uismoke.js"],
		languageOptions: { ecmaVersion: 2022, sourceType: "commonjs",
			globals: Object.assign({}, nodeGlobals, { window: "writable" }) },
		rules,
	},
];
