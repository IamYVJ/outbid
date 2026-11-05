# OUTBID

A game of strategy, scarcity and game theory. Simultaneous secret bids; highest unique bid wins the round, but **everyone pays what they bid**. First to Y wins within X rounds.

Peer-to-peer in the browser: the host creates a room, friends join with a 5-letter code or invite link. Connections are WebRTC via [PeerJS](https://peerjs.com) (public broker used only for the handshake). The host's browser is the authoritative referee; bids stay secret until everyone has locked in.

- **Create online room** → share the code/link.
- **Practice vs bots** works offline.
- Host can add bots (cautious / mixed / bold strategies) to any room and set V, X, Y.

## Files

- `engine.js` — pure rules engine (resolution, ties, draw, post-game analysis, bots)
- `app.js` — UI and host-authoritative networking
- `index.html`, `style.css` — felt-table UI, rules and "The Science" pages
