//#region node_modules/solid-js/dist/solid.js
var e = {
	context: void 0,
	registry: void 0,
	effects: void 0,
	done: !1,
	getContextId() {
		return t(this.context.count);
	},
	getNextContextId() {
		return t(this.context.count++);
	}
};
function t(t) {
	let n = String(t), r = n.length - 1;
	return e.context.id + (r ? String.fromCharCode(96 + r) : "") + n;
}
function n(t) {
	e.context = t;
}
var r = { equals: (e, t) => e === t }, i = null, a = j, o = 1, s = 2, c = {
	owned: null,
	cleanups: null,
	context: null,
	owner: null
}, l = null, u = null, d = null, f = null, p = null, m = 0;
function h(e, t) {
	let n = d, r = l, i = e.length === 0, a = t === void 0 ? r : t, o = i ? c : {
		owned: null,
		cleanups: null,
		context: a ? a.context : null,
		owner: a
	}, s = i ? e : () => e(() => v(() => F(o)));
	l = o, d = null;
	try {
		return k(s, !0);
	} finally {
		d = n, l = r;
	}
}
function g(e, t) {
	t = t ? Object.assign({}, r, t) : r;
	let n = {
		value: e,
		observers: null,
		observerSlots: null,
		comparator: t.equals || void 0
	};
	return [C.bind(n), (e) => (typeof e == "function" && (e = u && u.running && u.sources.has(n) ? e(n.tValue) : e(n.value)), w(n, e))];
}
function _(e, t, n) {
	a = M;
	let r = D(e, t, !1, o), i = S && x(S);
	i && (r.suspense = i), (!n || !n.render) && (r.user = !0), p ? p.push(r) : T(r);
}
function v(e) {
	if (d === null) return e();
	let t = d;
	d = null;
	try {
		return e();
	} finally {
		d = t;
	}
}
var [y, b] = /*@__PURE__*/ g(!1);
function x(e) {
	let t;
	return l && l.context && (t = l.context[e.id]) !== void 0 ? t : e.defaultValue;
}
var S;
function C() {
	let e = u && u.running;
	if (this.sources && (e ? this.tState : this.state)) {
		if ((e ? this.tState : this.state) === o) T(this);
		else {
			let e = f;
			f = null, k(() => N(this), !1), f = e;
		}
	}
	if (d) {
		let e = this.observers;
		if (!e || e[e.length - 1] !== d) {
			let t = e ? e.length : 0;
			d.sources ? (d.sources.push(this), d.sourceSlots.push(t)) : (d.sources = [this], d.sourceSlots = [t]), e ? (e.push(d), this.observerSlots.push(d.sources.length - 1)) : (this.observers = [d], this.observerSlots = [d.sources.length - 1]);
		}
	}
	return e && u.sources.has(this) ? this.tValue : this.value;
}
function w(e, t, n) {
	let r = u && u.running && u.sources.has(e) ? e.tValue : e.value;
	if (!e.comparator || !e.comparator(r, t)) {
		if (u) {
			let r = u.running;
			(r || !n && u.sources.has(e)) && (u.sources.add(e), e.tValue = t), r || (e.value = t);
		} else e.value = t;
		e.observers && e.observers.length && k(() => {
			for (let t = 0; t < e.observers.length; t += 1) {
				let n = e.observers[t], r = u && u.running;
				r && u.disposed.has(n) || ((r ? !n.tState : !n.state) && (n.pure ? f.push(n) : p.push(n), n.observers && P(n)), r ? n.tState = o : n.state = o);
			}
			if (f.length > 1e6) throw f = [], Error();
		}, !1);
	}
	return t;
}
function T(e) {
	if (!e.fn) return;
	F(e);
	let t = m;
	E(e, u && u.running && u.sources.has(e) ? e.tValue : e.value, t), u && !u.running && u.sources.has(e) && queueMicrotask(() => {
		k(() => {
			u && (u.running = !0), d = l = e, E(e, e.tValue, t), d = l = null;
		}, !1);
	});
}
function E(e, t, n) {
	let r, i = l, a = d;
	d = l = e;
	try {
		r = e.fn(t);
	} catch (t) {
		return e.pure && (u && u.running ? (e.tState = o, e.tOwned && e.tOwned.forEach(F), e.tOwned = void 0) : (e.state = o, e.owned && e.owned.forEach(F), e.owned = null)), e.updatedAt = n + 1, z(t);
	} finally {
		d = a, l = i;
	}
	(!e.updatedAt || e.updatedAt <= n) && (e.updatedAt != null && "observers" in e ? w(e, r, !0) : u && u.running && e.pure ? (u.sources.has(e) || (e.value = r), u.sources.add(e), e.tValue = r) : e.value = r, e.updatedAt = n);
}
function D(e, t, n, r = o, i) {
	let a = {
		fn: e,
		state: r,
		updatedAt: null,
		owned: null,
		sources: null,
		sourceSlots: null,
		cleanups: null,
		value: t,
		owner: l,
		context: l ? l.context : null,
		pure: n
	};
	return u && u.running && (a.state = 0, a.tState = r), l === null || l !== c && (u && u.running && l.pure ? l.tOwned ? l.tOwned.push(a) : l.tOwned = [a] : l.owned ? l.owned.push(a) : l.owned = [a]), a;
}
function O(e) {
	let t = u && u.running;
	if ((t ? e.tState : e.state) === 0) return;
	if ((t ? e.tState : e.state) === s) return N(e);
	if (e.suspense && v(e.suspense.inFallback)) return e.suspense.effects.push(e);
	let n = [e];
	for (; (e = e.owner) && (!e.updatedAt || e.updatedAt < m);) {
		if (t && u.disposed.has(e)) return;
		(t ? e.tState : e.state) && n.push(e);
	}
	for (let r = n.length - 1; r >= 0; r--) {
		if (e = n[r], t) {
			let t = e, i = n[r + 1];
			for (; (t = t.owner) && t !== i;) if (u.disposed.has(t)) return;
		}
		if ((t ? e.tState : e.state) === o) T(e);
		else if ((t ? e.tState : e.state) === s) {
			let t = f;
			f = null, k(() => N(e, n[0]), !1), f = t;
		}
	}
}
function k(e, t) {
	if (f) return e();
	let n = !1;
	t || (f = []), p ? n = !0 : p = [], m++;
	try {
		let t = e();
		return A(n), t;
	} catch (e) {
		n || (p = null), f = null, z(e);
	}
}
function A(e) {
	if (f &&= (j(f), null), e) return;
	let t;
	if (u) {
		if (!u.promises.size && !u.queue.size) {
			let e = u.sources, n = u.disposed;
			p.push.apply(p, u.effects), t = u.resolve;
			for (let e of p) "tState" in e && (e.state = e.tState), delete e.tState;
			u = null, k(() => {
				for (let e of n) F(e);
				for (let t of e) {
					if (t.value = t.tValue, t.owned) for (let e = 0, n = t.owned.length; e < n; e++) F(t.owned[e]);
					t.tOwned && (t.owned = t.tOwned), delete t.tValue, delete t.tOwned, t.tState = 0;
				}
				b(!1);
			}, !1);
		} else if (u.running) {
			u.running = !1, u.effects.push.apply(u.effects, p), p = null, b(!0);
			return;
		}
	}
	let n = p;
	p = null, n.length && k(() => a(n), !1), t && t();
}
function j(e) {
	for (let t = 0; t < e.length; t++) O(e[t]);
}
function M(t) {
	let r, i = 0;
	for (r = 0; r < t.length; r++) {
		let e = t[r];
		e.user ? t[i++] = e : O(e);
	}
	if (e.context) {
		if (e.count) {
			e.effects ||= [], e.effects.push(...t.slice(0, i));
			return;
		}
		n();
	}
	for (e.effects && (e.done || !e.count) && (t = [...e.effects, ...t], i += e.effects.length, delete e.effects), r = 0; r < i; r++) O(t[r]);
}
function N(e, t) {
	let n = u && u.running;
	n ? e.tState = 0 : e.state = 0;
	for (let r = 0; r < e.sources.length; r += 1) {
		let i = e.sources[r];
		if (i.sources) {
			let e = n ? i.tState : i.state;
			e === o ? i !== t && (!i.updatedAt || i.updatedAt < m) && O(i) : e === s && N(i, t);
		}
	}
}
function P(e) {
	let t = u && u.running;
	for (let n = 0; n < e.observers.length; n += 1) {
		let r = e.observers[n];
		(t ? !r.tState : !r.state) && (t ? r.tState = s : r.state = s, r.pure ? f.push(r) : p.push(r), r.observers && P(r));
	}
}
function F(e) {
	let t;
	if (e.sources) for (; e.sources.length;) {
		let t = e.sources.pop(), n = e.sourceSlots.pop(), r = t.observers;
		if (r && r.length) {
			let e = r.pop(), i = t.observerSlots.pop();
			n < r.length && (e.sourceSlots[i] = n, r[n] = e, t.observerSlots[n] = i);
		}
	}
	if (e.tOwned) {
		for (t = e.tOwned.length - 1; t >= 0; t--) F(e.tOwned[t]);
		delete e.tOwned;
	}
	if (u && u.running && e.pure) I(e, !0);
	else if (e.owned) {
		for (t = e.owned.length - 1; t >= 0; t--) F(e.owned[t]);
		e.owned = null;
	}
	if (e.cleanups) {
		for (t = e.cleanups.length - 1; t >= 0; t--) e.cleanups[t]();
		e.cleanups = null;
	}
	u && u.running ? e.tState = 0 : e.state = 0;
}
function I(e, t) {
	if (t || (e.tState = 0, u.disposed.add(e)), e.owned) for (let t = 0; t < e.owned.length; t++) I(e.owned[t]);
}
function L(e) {
	return e instanceof Error ? e : Error(typeof e == "string" ? e : "Unknown error", { cause: e });
}
function R(e, t, n) {
	try {
		for (let n of t) n(e);
	} catch (e) {
		z(e, n && n.owner || null);
	}
}
function z(e, t = l) {
	let n = i && t && t.context && t.context[i], r = L(e);
	if (!n) throw r;
	p ? p.push({
		fn() {
			R(r, n, t);
		},
		state: o
	}) : R(r, n, t);
}
//#endregion
export { h as n, g as r, _ as t };
