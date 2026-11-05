/* OUTBID — UI + peer-to-peer networking (host-authoritative over WebRTC via PeerJS). */
(function () {
  'use strict';
  const E = window.OutbidEngine;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const COLORS = ['#d64545', '#3b82c4', '#e0a526', '#8e5bd0', '#ee7f2d', '#1fb5b5', '#e056a0', '#e9e9e9'];
  const BOT_NAMES = ['Nash', 'Blotto', 'Vickrey', 'Selten', 'Schelling', 'Axelrod', 'Pareto', 'Kahneman'];
  const BOT_STYLES = ['mixed', 'cautious', 'bold'];
  const MAX_PLAYERS = 8;
  const REVEAL_MS = 6000;
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const PREFIX = 'outbid-';

  const S = { role: null, myId: null, snap: null, code: '', online: false, peer: null, hostConn: null, countdownEnd: 0 };
  let host = null; // only populated on the host
  let ui = { bidSig: '', myBid: 0, myLocked: null, timer: null };

  /* ---------- tiny helpers ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  function toast(msg, ms = 3000) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
  }
  function show(name) {
    for (const s of ['home', 'lobby', 'game']) $('#screen-' + s).classList.toggle('hidden', s !== name);
    $('#btn-leave').classList.toggle('hidden', name === 'home');
  }
  const myName = () => ($('#in-name').value.trim() || localStorage.getItem('outbid-name') || 'Player').slice(0, 14);
  const rememberName = () => { try { localStorage.setItem('outbid-name', $('#in-name').value.trim()); } catch (e) {} };
  const fmt = n => String(n);

  /* ---------- HOST ---------- */
  function newHost() {
    return { phase: 'lobby', config: { V: 100, X: 7, Y: 4 }, players: [], game: null, bids: {}, last: null, nextAt: 0, token: 0, seq: 0, nextTimer: null, conns: {} };
  }
  function freeColor() { return COLORS.find(c => !host.players.some(p => p.color === c)) || COLORS[0]; }
  function addPlayer(p) {
    const player = Object.assign({ color: freeColor(), bot: false, connected: true }, p);
    host.players.push(player);
    return player;
  }
  function addBot() {
    if (host.players.length >= MAX_PLAYERS) return toast('Room is full');
    const used = new Set(host.players.map(p => p.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || 'Bot' + host.seq;
    addPlayer({ id: 'b' + (++host.seq), name, bot: true, style: BOT_STYLES[host.seq % 3] });
    hostBroadcast();
  }
  function snapshot() {
    const g = host.game;
    return {
      phase: host.phase, code: S.code, online: S.online,
      config: g ? g.config : host.config,
      players: host.players.map(p => {
        const gp = g && g.players.find(x => x.id === p.id);
        return { id: p.id, name: p.name, color: p.color, bot: p.bot, connected: p.connected, volume: gp ? gp.volume : host.config.V, wins: gp ? gp.wins : 0 };
      }),
      round: g ? g.round : 0,
      locked: Object.keys(host.bids),
      last: host.last,
      history: g ? g.history : [],
      over: g ? g.over : false, winnerId: g ? g.winnerId : null, draw: g ? g.draw : false,
      analysis: g && g.over ? E.analyse(g) : null,
      nextIn: host.phase === 'reveal' ? Math.max(0, host.nextAt - Date.now()) : 0
    };
  }
  function hostBroadcast() {
    const snap = snapshot();
    for (const c of Object.values(host.conns)) if (c.open) c.send({ t: 'snap', snap });
    applySnap(snap);
  }
  function hostStart() {
    const cfg = readConfig();
    const err = E.validateConfig(cfg, host.players.length);
    $('#cfg-err').textContent = err || '';
    if (err) return;
    host.config = cfg;
    host.game = E.createGame(host.players, cfg);
    host.last = null;
    beginBidding();
  }
  function beginBidding() {
    host.phase = 'bidding'; host.bids = {}; host.token++;
    const token = host.token;
    for (const p of host.players.filter(p => p.bot)) {
      setTimeout(() => {
        if (host && host.phase === 'bidding' && host.token === token) {
          host.bids[p.id] = E.botBid(host.game, p.id, p.style);
          hostBroadcast(); checkAllLocked();
        }
      }, 800 + Math.random() * 2200);
    }
    hostBroadcast();
  }
  function hostOnBid(id, amount) {
    if (!host || host.phase !== 'bidding' || host.bids[id] !== undefined) return;
    const gp = host.game.players.find(p => p.id === id);
    if (!gp) return;
    host.bids[id] = E.clampBid(amount, gp.volume);
    hostBroadcast(); checkAllLocked();
  }
  function checkAllLocked() {
    if (host.phase !== 'bidding') return;
    if (host.players.every(p => !p.connected || host.bids[p.id] !== undefined)) reveal();
  }
  function reveal() {
    host.game = E.resolveRound(host.game, host.bids);
    const hr = host.game.history[host.game.history.length - 1];
    host.last = { round: hr.round, bids: hr.bids, winnerId: hr.winnerId };
    host.bids = {};
    if (host.game.over) { host.phase = 'over'; }
    else {
      host.phase = 'reveal'; host.nextAt = Date.now() + REVEAL_MS;
      clearTimeout(host.nextTimer); host.nextTimer = setTimeout(hostNext, REVEAL_MS);
    }
    hostBroadcast();
  }
  function hostNext() {
    if (!host || host.phase !== 'reveal') return;
    clearTimeout(host.nextTimer);
    beginBidding();
  }
  function hostRematch() {
    host.players = host.players.filter(p => p.connected);
    host.game = null; host.last = null; host.bids = {}; host.phase = 'lobby'; host.token++;
    hostBroadcast();
  }
  function readConfig() { return { V: +$('#cfg-V').value, X: +$('#cfg-X').value, Y: +$('#cfg-Y').value }; }

  function hostAccept(conn) {
    conn.on('data', m => {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'join') {
        if (host.phase !== 'lobby') { conn.send({ t: 'reject', reason: 'Game already in progress.' }); return setTimeout(() => conn.close(), 300); }
        if (host.players.length >= MAX_PLAYERS) { conn.send({ t: 'reject', reason: 'Room is full.' }); return setTimeout(() => conn.close(), 300); }
        const id = 'c' + (++host.seq);
        conn._pid = id; host.conns[id] = conn;
        addPlayer({ id, name: String(m.name || 'Player').slice(0, 14) });
        conn.send({ t: 'welcome', id });
        hostBroadcast();
      } else if (m.t === 'bid' && conn._pid) {
        hostOnBid(conn._pid, m.amount);
      }
    });
    const gone = () => {
      const id = conn._pid; if (!id || !host) return;
      delete host.conns[id];
      if (host.phase === 'lobby') host.players = host.players.filter(p => p.id !== id);
      else { const p = host.players.find(p => p.id === id); if (p) p.connected = false; }
      hostBroadcast();
      if (host.phase === 'bidding') checkAllLocked();
    };
    conn.on('close', gone); conn.on('error', gone);
  }

  function createRoom(online) {
    rememberName();
    host = newHost(); S.role = 'host'; S.online = online; S.myId = 'h';
    addPlayer({ id: 'h', name: myName() });
    if (!online) { S.code = ''; addBot(); addBot(); show('lobby'); hostBroadcast(); return; }
    if (!window.Peer) return toast('Could not load the networking library (are you online?)');
    const tryOpen = (attempt) => {
      const code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
      const peer = new Peer(PREFIX + code);
      peer.on('open', () => { S.peer = peer; S.code = code; show('lobby'); hostBroadcast(); });
      peer.on('connection', hostAccept);
      peer.on('error', err => {
        if (err.type === 'unavailable-id' && attempt < 5) { peer.destroy(); return tryOpen(attempt + 1); }
        toast('Network error: ' + (err.type || err.message));
        if (!S.peer) leave();
      });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
    };
    tryOpen(0);
  }

  /* ---------- CLIENT ---------- */
  function joinRoom(code) {
    code = code.trim().toUpperCase();
    if (code.length !== 5) return toast('Enter the 5-character room code');
    if (!window.Peer) return toast('Could not load the networking library (are you online?)');
    rememberName();
    S.role = 'client'; S.code = code; S.online = true;
    const peer = new Peer();
    S.peer = peer;
    const fail = msg => { toast(msg, 4000); leave(); };
    peer.on('error', err => fail(err.type === 'peer-unavailable' ? 'No room with that code.' : 'Network error: ' + (err.type || err.message)));
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true });
      S.hostConn = conn;
      const timeout = setTimeout(() => { if (!S.snap) fail('Could not reach the room.'); }, 12000);
      conn.on('open', () => conn.send({ t: 'join', name: myName() }));
      conn.on('data', m => {
        if (m.t === 'welcome') S.myId = m.id;
        else if (m.t === 'reject') fail(m.reason);
        else if (m.t === 'snap') { clearTimeout(timeout); applySnap(m.snap); }
      });
      conn.on('close', () => { if (S.role === 'client') { toast('Disconnected from host', 4000); leave(); } });
    });
  }
  function sendBid(amount) {
    if (S.role === 'host') hostOnBid('h', amount);
    else if (S.hostConn && S.hostConn.open) S.hostConn.send({ t: 'bid', amount });
  }

  function leave() {
    const role = S.role;
    S.role = null; S.myId = null; S.snap = null;
    if (host) { clearTimeout(host.nextTimer); host.token++; for (const c of Object.values(host.conns)) try { c.close(); } catch (e) {} }
    host = null;
    if (S.peer) { try { S.peer.destroy(); } catch (e) {} S.peer = null; }
    S.hostConn = null; S.code = '';
    clearInterval(ui.timer);
    ui = { bidSig: '', myBid: 0, myLocked: null, timer: null };
    $('#modal-over').classList.add('hidden');
    history.replaceState(null, '', location.pathname);
    show('home');
  }

  /* ---------- RENDER ---------- */
  function applySnap(snap) {
    S.snap = snap;
    if (snap.phase === 'reveal') S.countdownEnd = Date.now() + snap.nextIn;
    if (snap.phase === 'lobby') { show('lobby'); $('#modal-over').classList.add('hidden'); renderLobby(snap); }
    else { show('game'); renderGame(snap); }
  }
  const isHost = () => S.role === 'host';
  const pById = (snap, id) => snap.players.find(p => p.id === id);

  function renderLobby(snap) {
    $('#room-code').textContent = snap.online ? snap.code : 'SOLO';
    $('#btn-copy').classList.toggle('hidden', !snap.online);
    $('#pl-count').textContent = `(${snap.players.length}/${MAX_PLAYERS})`;
    const ul = $('#lobby-players'); ul.replaceChildren();
    for (const p of snap.players) {
      ul.append(h('li', { style: `--pc:${p.color}` },
        h('span', { class: 'grow' }, p.name, p.id === S.myId ? ' (you)' : ''),
        p.id === 'h' ? h('span', { class: 'tagpill' }, 'host') : null,
        p.bot ? h('span', { class: 'tagpill' }, 'bot') : null,
        isHost() && p.bot ? h('button', { title: 'Remove bot', onclick: () => { host.players = host.players.filter(x => x.id !== p.id); hostBroadcast(); } }, '×') : null));
    }
    $('#host-controls').classList.toggle('hidden', !isHost());
    $('#guest-wait').classList.toggle('hidden', isHost());
    const c = snap.config;
    for (const k of ['V', 'X', 'Y']) { const el = $('#cfg-' + k); if (document.activeElement !== el && isHost()) el.value = c[k]; }
    $('#cfg-summary').textContent = `${snap.players.length} players · ${c.V} volume each · ${c.X} max rounds · first to ${c.Y} wins`;
  }

  function renderGame(snap) {
    const cfg = snap.config;
    const me = pById(snap, S.myId);
    const bidding = snap.phase === 'bidding';
    const showLast = snap.last && (snap.phase === 'reveal' || snap.phase === 'over');
    const lastRoundNo = snap.last ? snap.last.round : 0;

    // round track
    const track = $('#track'); track.replaceChildren();
    for (let r = 1; r <= cfg.X; r++) {
      const hr = snap.history.find(x => x.round === r);
      const w = hr && hr.winnerId ? pById(snap, hr.winnerId) : null;
      const cur = !snap.over && ((bidding && r === snap.round) || (snap.phase === 'reveal' && r === snap.round));
      track.append(h('div', { class: 'tile' + (hr ? (w ? '' : ' tie') : ' future') + (cur ? ' now' : ''), title: hr ? (w ? `Won by ${w.name}` : 'No winner') : '' },
        h('span', {}, r), h('span', { class: 'pip', style: w ? `background:${w.color}` : '' })));
    }
    $('#goal').textContent = `First to ${cfg.Y} wins · ${cfg.X} rounds max · ${cfg.V} volume each`;

    // seats
    const seats = $('#seats'); seats.replaceChildren();
    for (const p of snap.players) {
      const bid = showLast ? snap.last.bids[p.id] : undefined;
      const lockedNow = bidding && snap.locked.includes(p.id);
      const isWin = showLast && snap.last.winnerId === p.id;
      const pips = Array.from({ length: cfg.Y }, (_, i) => h('i', { class: i < p.wins ? 'on' : '' }));
      let status = '';
      if (!p.connected) status = 'disconnected';
      else if (bidding) status = lockedNow ? 'bid locked' : 'thinking…';
      else if (isWin) status = 'won the round';
      const bidTxt = showLast ? fmt(bid) : lockedNow ? '✓' : '';
      seats.append(h('div', { class: 'seat' + (p.id === S.myId ? ' me' : '') + (isWin ? ' winner' : '') + (!p.connected ? ' out' : ''), style: `--pc:${p.color}` },
        h('div', { class: 'nm' }, p.name + (p.bot ? ' · bot' : '') + (p.id === S.myId ? ' (you)' : '')),
        h('div', { class: 'vol' }, h('b', {}, fmt(p.volume)), ' vol'),
        h('div', { class: 'bidval' + (isWin ? ' win' : '') }, bidTxt),
        h('div', { class: 'wins', title: `${p.wins}/${cfg.Y} wins` }, pips),
        h('div', { class: 'status' }, status)));
    }

    // centre banner
    const center = $('#center'); center.replaceChildren();
    clearInterval(ui.timer);
    if (bidding) {
      const waiting = snap.players.filter(p => p.connected && !snap.locked.includes(p.id)).length;
      center.append(h('span', { class: 'banner' }, `Round ${snap.round} of ${cfg.X} — place your bids `, h('b', {}, `(${waiting} still choosing)`)));
    } else if (snap.phase === 'reveal') {
      const w = snap.last.winnerId ? pById(snap, snap.last.winnerId) : null;
      const txt = w ? [h('b', {}, w.name), ` wins round ${lastRoundNo} with ${snap.last.bids[w.id]}`] : [h('b', {}, 'No winner'), ` in round ${lastRoundNo} — ${Object.values(snap.last.bids).some(b => b > 0) ? 'top bid was tied' : 'nobody bid'}`];
      const cd = h('b', {}, '');
      center.append(h('span', { class: 'banner' }, txt, ' · next round in ', cd, 's '), isHost() ? h('button', { class: 'btn', style: 'margin-left:10px;padding:6px 12px', onclick: hostNext }, 'Skip') : null);
      const tick = () => { cd.textContent = Math.max(0, Math.ceil((S.countdownEnd - Date.now()) / 1000)); };
      tick(); ui.timer = setInterval(tick, 250);
    }

    renderBidPanel(snap, me);
    renderLog(snap);
    if (snap.phase === 'over') renderOver(snap); else $('#modal-over').classList.add('hidden');
  }

  function renderBidPanel(snap, me) {
    const panel = $('#bidpanel');
    const active = snap.phase === 'bidding' && me && me.connected;
    panel.classList.toggle('hidden', !active);
    if (!active) { ui.bidSig = ''; return; }
    const locked = snap.locked.includes(S.myId);
    const sig = [snap.round, me.volume, locked ? 1 : 0].join('|');
    if (sig !== ui.bidSig) {
      ui.bidSig = sig;
      if (!locked) ui.myBid = 0;
      panel.replaceChildren();
      if (locked) {
        panel.append(h('div', { class: 'bid-big' }, fmt(ui.myLocked == null ? '✔' : ui.myLocked)), h('div', { class: 'waiting' }, 'Bid locked in. Waiting for the others…'));
      } else {
        ui.myLocked = null;
        const big = h('div', { class: 'bid-big', id: 'bid-big' }, '0');
        const range = h('input', { type: 'range', min: 0, max: me.volume, value: 0, step: 1, 'aria-label': 'Bid amount' });
        const set = v => { ui.myBid = E.clampBid(v, me.volume); range.value = ui.myBid; big.textContent = ui.myBid; left.textContent = me.volume - ui.myBid; };
        const left = h('b', {}, me.volume);
        range.addEventListener('input', () => set(range.value));
        const chip = (label, cls, fn) => h('button', { class: 'chipbtn ' + cls, onclick: () => set(fn(ui.myBid)) }, label);
        panel.append(
          big,
          h('div', { class: 'bid-sub' }, 'You hold ', h('b', {}, me.volume), ' volume · you would keep ', left),
          range,
          h('div', { class: 'chips' },
            chip('+1', 'c1', v => v + 1), chip('+5', 'c5', v => v + 5), chip('+10', 'c10', v => v + 10), chip('+25', 'c25', v => v + 25),
            chip('½', 'cm', () => Math.floor(me.volume / 2)), chip('All', 'cm', () => me.volume), chip('Clear', 'cm', () => 0)),
          h('div', { class: 'lockrow' }, h('button', { class: 'btn primary', onclick: () => { ui.myLocked = ui.myBid; sendBid(ui.myBid); } }, 'Lock in bid')));
      }
    }
  }

  function renderLog(snap) {
    const t = $('#log'); t.replaceChildren();
    if (!snap.history.length) { t.append(h('tr', {}, h('td', {}, 'No rounds played yet.'))); return; }
    t.append(h('tr', {}, h('th', {}, 'Round'), snap.players.map(p => h('th', { style: `color:${p.color}` }, p.name))));
    for (const r of snap.history) t.append(h('tr', {}, h('td', {}, r.round), snap.players.map(p => h('td', { class: r.winnerId === p.id ? 'w' : '' }, r.bids[p.id] ?? '–'))));
  }

  function renderOver(snap) {
    const w = snap.winnerId ? pById(snap, snap.winnerId) : null;
    $('#over-title').textContent = w ? `${w.name} wins.` : 'Draw.';
    $('#over-sub').textContent = w ? `${w.name} reached ${snap.config.Y} round wins in round ${snap.history.length}.` : `${snap.config.X} rounds passed without a winner.`;
    const A = snap.analysis;
    const t = $('#over-table'); t.replaceChildren(
      h('tr', {}, ['Player', 'Wins', 'Volume left', 'Total spent', 'Spent on lost rounds', 'Overpaid on wins*'].map(x => h('th', {}, x))),
      ...snap.players.map(p => h('tr', {}, h('td', { style: `color:${p.color};font-weight:800` }, p.name, p.id === S.myId ? ' (you)' : ''),
        h('td', {}, p.wins), h('td', {}, p.volume), h('td', {}, A[p.id].spent), h('td', {}, A[p.id].spentOnLosses), h('td', {}, A[p.id].wastedOnWins))),
      h('tr', {}, h('td', { colspan: 6, style: 'font-size:12px;color:var(--muted);text-align:left;white-space:normal' }, '*Volume bid beyond the minimum needed to win (second-highest bid + 1) — a measure of overbidding.')));
    const bySpent = [...snap.players].sort((a, b) => A[b.id].spent - A[a.id].spent)[0];
    const bySunk = [...snap.players].sort((a, b) => A[b.id].spentOnLosses - A[a.id].spentOnLosses)[0];
    $('#over-insight').textContent = `Biggest spender: ${bySpent.name} (${A[bySpent.id].spent} volume, ${bySpent.wins} wins). ` +
      (A[bySunk.id].spentOnLosses > 0 ? `Most volume sunk into rounds that were lost: ${bySunk.name} (${A[bySunk.id].spentOnLosses}). That's the all-pay auction at work.` : '');
    $('#btn-rematch').classList.toggle('hidden', !isHost());
    $('#modal-over').classList.remove('hidden');
  }

  /* ---------- wiring ---------- */
  function openModal(name) { $('#modal-' + name).classList.remove('hidden'); }
  $$('[data-modal]').forEach(b => b.addEventListener('click', () => openModal(b.dataset.modal)));
  $$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('.modal').classList.add('hidden')));
  $$('#modal-rules,#modal-science').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); }));
  $('#btn-create').onclick = () => createRoom(true);
  $('#btn-solo').onclick = () => createRoom(false);
  $('#btn-join').onclick = () => joinRoom($('#in-code').value);
  $('#in-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(e.target.value); });
  $('#btn-leave').onclick = () => { if (confirm('Leave this game?')) leave(); };
  $('#btn-over-leave').onclick = leave;
  $('#btn-addbot').onclick = addBot;
  $('#btn-start').onclick = hostStart;
  $('#btn-rematch').onclick = hostRematch;
  $('#btn-copy').onclick = async () => {
    const url = `${location.origin}${location.pathname}?room=${S.code}`;
    try { await navigator.clipboard.writeText(url); toast('Invite link copied'); } catch (e) { prompt('Copy this invite link:', url); }
  };
  for (const k of ['V', 'X', 'Y']) $('#cfg-' + k).addEventListener('input', () => { if (host) { host.config = readConfig(); $('#cfg-err').textContent = ''; hostBroadcast(); } });

  try { $('#in-name').value = localStorage.getItem('outbid-name') || ''; } catch (e) {}
  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) { $('#in-code').value = roomParam.toUpperCase().slice(0, 5); toast('Enter your name and press Join'); }

  // exposed for debugging/tests
  window.__outbid = { S, get host() { return host; } };
})();
