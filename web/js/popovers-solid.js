import { n as e, r as t, t as n } from "./solid-sokCiKQ8.js";
//#region solid/popovers.js
var r = [
	["save-top", "save-menu"],
	["printer-top", "printer-menu"],
	["project-btn", "project-menu"]
];
function i(e, t) {
	if (!e.classList.contains("fixed")) return;
	let n = t.getBoundingClientRect(), r = window.innerHeight - n.bottom - 10, i = n.top - 10, a = r < 160 && i > r;
	e.style.left = n.left + "px", e.style.maxHeight = Math.max(120, a ? i : r) + "px", a ? (e.style.top = "", e.style.bottom = window.innerHeight - n.top + 6 + "px") : (e.style.bottom = "", e.style.top = n.bottom + 6 + "px");
}
e(() => {
	let [e, a] = t(null);
	n(() => {
		let t = e();
		for (let [e, n] of r) {
			let r = document.getElementById(n);
			if (!r) continue;
			let a = t === n;
			r.hidden = !a, a && i(r, document.getElementById(e));
		}
	});
	for (let [e, t] of r) {
		let n = document.getElementById(e), r = document.getElementById(t);
		n && r && (n.addEventListener("click", (e) => {
			e.stopPropagation(), a((e) => e === t ? null : t);
		}), r.addEventListener("click", (e) => e.stopPropagation()));
	}
	document.addEventListener("click", () => a(null)), document.addEventListener("keydown", (e) => {
		e.key === "Escape" && a(null);
	}), window.__popovers = { close: () => a(null) };
});
//#endregion
