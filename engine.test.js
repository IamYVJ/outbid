const assert = require('assert');
const E = require('./engine.js');

const P = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const cfg = { V: 100, X: 7, Y: 4 };

// example round from the rulebook
let s = E.createGame(P(3), cfg);
s = E.resolveRound(s, { p0: 30, p1: 45, p2: 20 });
assert.deepStrictEqual(s.players.map(p => p.volume), [70, 55, 80]);
assert.deepStrictEqual(s.players.map(p => p.wins), [0, 1, 0]);
assert.strictEqual(s.history[0].winnerId, 'p1');

// tie for top -> nobody wins, everyone still pays
s = E.resolveRound(s, { p0: 40, p1: 40, p2: 10 });
assert.strictEqual(s.history[1].winnerId, null);
assert.deepStrictEqual(s.players.map(p => p.volume), [30, 15, 70]);

// zero cannot win
let z = E.resolveRound(E.createGame(P(2), cfg), { p0: 0, p1: 0 });
assert.strictEqual(z.history[0].winnerId, null);

// over-bids are clamped to remaining volume; garbage -> 0
let c = E.resolveRound(E.createGame(P(2), cfg), { p0: 999, p1: 'abc' });
assert.strictEqual(c.players[0].volume, 0);
assert.strictEqual(c.history[0].bids.p1, 0);
assert.strictEqual(c.history[0].winnerId, 'p0');

// teaching example: 2 players, 3 rounds, need 2 wins
let t = E.createGame(P(2), { V: 100, X: 3, Y: 2 });
t = E.resolveRound(t, { p0: 70, p1: 20 });
t = E.resolveRound(t, { p0: 30, p1: 31 });
t = E.resolveRound(t, { p0: 0, p1: 31 });
assert.ok(t.over && t.winnerId === 'p1');

// first to Y wins immediately
let w = E.createGame(P(2), { V: 100, X: 5, Y: 1 });
w = E.resolveRound(w, { p0: 5, p1: 1 });
assert.ok(w.over && w.winnerId === 'p0' && !w.draw);

// draw when X rounds pass
let d = E.createGame(P(2), { V: 10, X: 2, Y: 2 });
d = E.resolveRound(d, { p0: 1, p1: 1 });
d = E.resolveRound(d, { p0: 1, p1: 1 });
assert.ok(d.over && d.draw && d.winnerId === null);
assert.throws(() => E.resolveRound(d, {}));

// config validation
assert.ok(E.validateConfig({ V: 100, X: 3, Y: 4 }, 2));
assert.ok(E.validateConfig({ V: 100, X: 3, Y: 2 }, 1));
assert.strictEqual(E.validateConfig({ V: 100, X: 3, Y: 2 }, 2), null);

// bots always bid legally across many random games
for (let g = 0; g < 500; g++) {
  let st = E.createGame(P(4), cfg);
  while (!st.over) {
    const bids = {};
    for (const p of st.players) {
      const b = E.botBid(st, p.id, ['cautious', 'mixed', 'bold'][g % 3]);
      assert.ok(Number.isInteger(b) && b >= 0 && b <= p.volume);
      bids[p.id] = b;
    }
    st = E.resolveRound(st, bids);
  }
}
console.log('engine tests passed');
