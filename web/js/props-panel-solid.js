import { n as e, r as t, t as n } from "./solid-sokCiKQ8.js";
//#region solid/props-panel.js
var r = [
	"name",
	"hole",
	"keep",
	"vis",
	"color",
	"w",
	"d",
	"h",
	"x",
	"y",
	"z",
	"rot",
	"rx",
	"rz",
	"sides",
	"dia",
	"pitch",
	"shell",
	"openTop"
], i = (e) => document.getElementById(e);
e(() => {
	let [e, a] = t(null);
	n(() => {
		let t = e();
		if (i("props").hidden = !t, i("noprops").hidden = !!t, !t) return;
		for (let e of r) {
			let n = i("p-" + e);
			n && (e === "keep" ? n.checked = t.mode === "keep" : n.type === "checkbox" ? n.checked = t[e] : document.activeElement !== n && (n.value = t[e]));
		}
		i("p-sides-row").style.display = t.type === "poly" ? "" : "none";
		let n = t.type === "thread", a = [
			"box",
			"cyl",
			"poly"
		].includes(t.type) && !t.hole;
		i("p-shell-row").style.display = a ? "" : "none", i("p-open-row").style.display = a && t.shell > 0 ? "" : "none", i("p-dia-row").style.display = i("p-pitch-row").style.display = n ? "" : "none", i("p-w").disabled = i("p-d").disabled = n, i("p-round-row").style.display = t.type === "box" || t.type === "sketch" && "round" in t ? "" : "none", document.activeElement !== i("p-round") && (i("p-round").value = t.round || 0);
	}), window.__propsPanel = { update: (e) => a(e ? { ...e } : null) };
});
//#endregion
