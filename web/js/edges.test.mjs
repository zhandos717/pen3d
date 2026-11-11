// Рёбра детали: у куба 12 рёбер; плоская грань, разбитая с Т-стыком, лишних линий не даёт.
// Запуск: make check-edges
import assert from 'assert';
import { featureEdges } from './edges.js';

const tris = list => new Float32Array(list.flat(2));
const count = pos => featureEdges(pos).length / 6;

// куб 0..1, по два треугольника на грань, нормали наружу
const P = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const quad = (a, b, c, d) => [[P[a], P[b], P[c]], [P[a], P[c], P[d]]];
const cube = [quad(0,3,2,1), quad(4,5,6,7), quad(0,1,5,4), quad(1,2,6,5), quad(2,3,7,6), quad(3,0,4,7)].flat();
assert.strictEqual(count(tris(cube)), 12, 'у куба 12 рёбер');

// квадрат: левая половина одним треугольником, правая — двумя с вершиной посреди общей
// стороны (Т-стык). EdgesGeometry нарисовал бы диагонали и стык; здесь — ничего
const flat = [
  [[0,0,0],[1,0,0],[0,1,0]],
  [[1,0,0],[1,.5,0],[0,1,0]], [[1,.5,0],[1,1,0],[0,1,0]],
];
assert.strictEqual(count(tris(flat)), 0, 'Т-стык на плоской грани не рисуется');
console.log('edges: ok');
