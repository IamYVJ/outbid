/* OUTBID rules engine — pure logic, no DOM, no networking. Works in browser and Node. */
(function (root) {
  'use strict';

  function validateConfig(cfg, playerCount) {
    const V = Number(cfg.V), X = Number(cfg.X), Y = Number(cfg.Y);
    if (!Number.isInteger(V) || V < 1 || V > 10000) return 'Starting volume must be a whole number from 1 to 10000.';
    if (!Number.isInteger(X) || X < 1 || X > 50) return 'Maximum rounds must be from 1 to 50.';
    if (!Number.isInteger(Y) || Y < 1 || Y > X) return 'Target wins must be between 1 and the maximum rounds.';
    if (playerCount != null && playerCount < 2) return 'You need at least 2 players.';
    return null;
  }

  function createGame(players, cfg) {
    const err = validateConfig(cfg, players.length);
    if (err) throw new Error(err);
    return {
      config: { V: +cfg.V, X: +cfg.X, Y: +cfg.Y },
      players: players.map(p => ({ id: p.id, name: p.name, volume: +cfg.V, wins: 0 })),
      round: 1,
      history: [],      // [{round, bids:{id:n}, winnerId|null, volumes:{id:n} (after)}]
      over: false,
      winnerId: null,   // overall winner
      draw: false
    };
  }

  function clampBid(raw, volume) {
    let n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 0) n = 0;
    return Math.min(n, volume);
  }

  /** Highest bid > 0 that is held by exactly one player wins; any tie for the top → no winner. */
  function roundWinner(bids) {
    const entries = Object.entries(bids);
    let max = 0;
    for (const [, b] of entries) if (b > max) max = b;
    if (max <= 0) return null;
    const top = entries.filter(([, b]) => b === max);
    return top.length === 1 ? top[0][0] : null;
  }

  /** Resolve a round. `rawBids` is {playerId: amount}; missing/invalid bids become 0. Returns new state. */
  function resolveRound(state, rawBids) {
    if (state.over) throw new Error('Game is over');
    const s = JSON.parse(JSON.stringify(state));
    const bids = {};
    for (const p of s.players) bids[p.id] = clampBid(rawBids[p.id], p.volume);
    const winnerId = roundWinner(bids);
    for (const p of s.players) {
      p.volume -= bids[p.id];
      if (p.id === winnerId) p.wins += 1;
    }
    const volumes = {}, wins = {};
    for (const p of s.players) { volumes[p.id] = p.volume; wins[p.id] = p.wins; }
    s.history.push({ round: s.round, bids, winnerId, volumes, wins });

    const champ = s.players.find(p => p.wins >= s.config.Y);
    if (champ) { s.over = true; s.winnerId = champ.id; }
    else if (s.round >= s.config.X) { s.over = true; s.draw = true; }
    else s.round += 1;
    return s;
  }

  /** Per-player teaching stats after (or during) a game. */
  function analyse(state) {
    const out = {};
    for (const p of state.players) out[p.id] = { spent: 0, wonRounds: 0, wastedOnWins: 0, spentOnLosses: 0, leftover: p.volume };
    for (const h of state.history) {
      const sorted = Object.values(h.bids).sort((a, b) => b - a);
      for (const p of state.players) {
        const b = h.bids[p.id];
        const o = out[p.id];
        o.spent += b;
        if (h.winnerId === p.id) {
          o.wonRounds++;
          const second = sorted[1] || 0;
          o.wastedOnWins += Math.max(0, b - (second + 1)); // paid more than the minimum needed to win
        } else {
          o.spentOnLosses += b; // sunk volume that bought nothing
        }
      }
    }
    return out;
  }

  /** Bot strategy: spread budget over rounds still needed, with randomised (mixed) bids. */
  function botBid(state, id, style) {
    const me = state.players.find(p => p.id === id);
    if (!me || me.volume <= 0) return 0;
    const { X, Y } = state.config;
    const roundsLeft = X - state.round + 1;
    const needed = Math.max(1, Y - me.wins);
    const fair = me.volume / Math.max(needed, Math.min(roundsLeft, needed + 1));
    const rnd = Math.random();
    let bid;
    if (style === 'cautious') {
      bid = rnd < 0.45 ? 0 : fair * (0.3 + rnd * 0.7);
    } else if (style === 'bold') {
      bid = rnd < 0.15 ? 0 : fair * (0.8 + rnd * 0.9);
    } else { // mixed
      bid = rnd < 0.25 ? 0 : fair * (0.4 + rnd * 1.1);
    }
    return clampBid(Math.round(bid), me.volume);
  }

  const api = { validateConfig, createGame, clampBid, roundWinner, resolveRound, analyse, botBid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OutbidEngine = api;
})(typeof self !== 'undefined' ? self : this);
