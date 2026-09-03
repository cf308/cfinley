const { sql, ensureSchema } = require('../lib/_db');
const { getCurrentUser, hasApp } = require('../lib/_session');

const ROWS = 6;
const COLS = 7;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

function emptyBoard() {
  return new Array(ROWS * COLS).fill(0);
}

function randomCode() {
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

function checkWin(board, row, col, player) {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (const [dr, dc] of dirs) {
    let count = 1;
    let r = row + dr;
    let c = col + dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === player) {
      count++;
      r += dr;
      c += dc;
    }
    r = row - dr;
    c = col - dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === player) {
      count++;
      r -= dr;
      c -= dc;
    }
    if (count >= 4) return true;
  }
  return false;
}

async function loadGame(code) {
  const { rows } = await sql`SELECT * FROM connect4_games WHERE code = ${code}`;
  return rows[0] || null;
}

function publicState(game, userId) {
  const you = game.player1_id === userId ? 1 : game.player2_id === userId ? 2 : null;
  return {
    code: game.code,
    board: game.board,
    turn: game.turn,
    status: game.status,
    winner: game.winner,
    you,
    yourTurn: game.status === 'active' && game.turn === you,
    waitingForOpponent: game.status === 'waiting',
  };
}

module.exports = async (req, res) => {
  await ensureSchema();

  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  if (!hasApp(user, 'connect4')) {
    res.status(403).json({ error: 'You do not have access to this app.' });
    return;
  }

  if (req.method === 'GET') {
    const code = String(req.query.code || '').toUpperCase();
    if (!code) {
      res.status(400).json({ error: 'Missing code' });
      return;
    }
    const game = await loadGame(code);
    if (!game || (game.player1_id !== user.id && game.player2_id !== user.id)) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.status(200).json(publicState(game, user.id));
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { action } = req.body || {};

  if (action === 'create') {
    let code;
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = randomCode();
      const existing = await loadGame(candidate);
      if (!existing) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      res.status(500).json({ error: 'Could not allocate a room code, try again.' });
      return;
    }

    const board = emptyBoard();
    const inserted = await sql`
      INSERT INTO connect4_games (code, player1_id, board, turn, status)
      VALUES (${code}, ${user.id}, ${board}::int[], 1, 'waiting')
      RETURNING *
    `;
    res.status(201).json(publicState(inserted.rows[0], user.id));
    return;
  }

  if (action === 'join') {
    const code = String(req.body.code || '').toUpperCase();
    const game = await loadGame(code);
    if (!game) {
      res.status(404).json({ error: 'No game with that code.' });
      return;
    }
    if (game.player1_id === user.id) {
      res.status(200).json(publicState(game, user.id));
      return;
    }
    if (game.player2_id && game.player2_id !== user.id) {
      res.status(409).json({ error: 'That room is already full.' });
      return;
    }
    if (game.status !== 'waiting') {
      res.status(200).json(publicState(game, user.id));
      return;
    }

    const updated = await sql`
      UPDATE connect4_games
      SET player2_id = ${user.id}, status = 'active', updated_at = now()
      WHERE code = ${code}
      RETURNING *
    `;
    res.status(200).json(publicState(updated.rows[0], user.id));
    return;
  }

  if (action === 'move') {
    const code = String(req.body.code || '').toUpperCase();
    const column = Number(req.body.column);
    if (!Number.isInteger(column) || column < 0 || column >= COLS) {
      res.status(400).json({ error: 'Invalid column' });
      return;
    }

    const game = await loadGame(code);
    if (!game || (game.player1_id !== user.id && game.player2_id !== user.id)) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    if (game.status !== 'active') {
      res.status(400).json({ error: 'Game is not active.' });
      return;
    }
    const you = game.player1_id === user.id ? 1 : 2;
    if (game.turn !== you) {
      res.status(400).json({ error: "It's not your turn." });
      return;
    }

    const board = game.board.slice();
    let dropRow = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[r * COLS + column] === 0) {
        dropRow = r;
        break;
      }
    }
    if (dropRow === -1) {
      res.status(400).json({ error: 'That column is full.' });
      return;
    }

    board[dropRow * COLS + column] = you;

    let status = 'active';
    let winner = null;
    if (checkWin(board, dropRow, column, you)) {
      status = 'finished';
      winner = you;
    } else if (board.every((cell) => cell !== 0)) {
      status = 'finished';
      winner = 0; // draw
    }

    const nextTurn = you === 1 ? 2 : 1;
    const updated = await sql`
      UPDATE connect4_games
      SET board = ${board}::int[], turn = ${status === 'active' ? nextTurn : game.turn},
          status = ${status}, winner = ${winner}, updated_at = now()
      WHERE code = ${code}
      RETURNING *
    `;
    res.status(200).json(publicState(updated.rows[0], user.id));
    return;
  }

  res.status(400).json({ error: 'Unknown action' });
};
