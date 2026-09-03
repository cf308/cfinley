const { sql, ensureSchema } = require('../lib/_db');
const { getCurrentUser, hasApp } = require('../lib/_session');
const { getBalance, setBalance } = require('../lib/_casino');

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

function freshShuffledDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.r === 'A') {
      aces++;
      total += 11;
    } else if (c.r === 'K' || c.r === 'Q' || c.r === 'J') {
      total += 10;
    } else {
      total += Number(c.r);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function isBlackjack(hand) {
  return hand.length === 2 && handValue(hand) === 21;
}

function randomCode() {
  let out = '';
  for (let i = 0; i < 4; i++) out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return out;
}

async function loadGame(code) {
  const { rows } = await sql`SELECT * FROM blackjack_games WHERE code = ${code}`;
  return rows[0] || null;
}

async function publicState(game, userId) {
  const dealerHand = JSON.parse(game.dealer_hand);
  const visibleDealerHand = game.dealer_hidden ? dealerHand.slice(0, 1) : dealerHand;
  const you = game.player1_id === userId ? 1 : game.player2_id === userId ? 2 : null;
  const balance = await getBalance(userId);
  return {
    code: game.code,
    status: game.status,
    turn: game.turn,
    you,
    yourTurn: game.status === 'playing' && game.turn === 'player' + you,
    balance,
    dealerHidden: game.dealer_hidden,
    dealerHand: visibleDealerHand,
    dealerHiddenCount: game.dealer_hidden ? Math.max(dealerHand.length - 1, 0) : 0,
    dealerTotal: game.dealer_hidden ? null : handValue(dealerHand),
    player1: {
      present: Boolean(game.player1_id),
      hand: JSON.parse(game.player1_hand),
      total: handValue(JSON.parse(game.player1_hand)),
      bet: game.player1_bet,
      status: game.player1_status,
    },
    player2: {
      present: Boolean(game.player2_id),
      hand: JSON.parse(game.player2_hand),
      total: handValue(JSON.parse(game.player2_hand)),
      bet: game.player2_bet,
      status: game.player2_status,
    },
    lastResult: game.last_result ? JSON.parse(game.last_result) : null,
  };
}

function resolvePlayerOutcome(hand, status, bet, dealerHand) {
  if (status === 'bust') return { outcome: 'lose', payout: 0 };
  const playerTotal = handValue(hand);
  const playerBJ = isBlackjack(hand);
  const dealerTotal = handValue(dealerHand);
  const dealerBJ = isBlackjack(dealerHand);
  const dealerBusted = dealerTotal > 21;

  if (playerBJ && dealerBJ) return { outcome: 'push', payout: bet };
  if (playerBJ) return { outcome: 'blackjack', payout: Math.floor(bet * 2.5) };
  if (dealerBJ) return { outcome: 'lose', payout: 0 };
  if (dealerBusted) return { outcome: 'win', payout: bet * 2 };
  if (playerTotal > dealerTotal) return { outcome: 'win', payout: bet * 2 };
  if (playerTotal === dealerTotal) return { outcome: 'push', payout: bet };
  return { outcome: 'lose', payout: 0 };
}

async function playDealerAndResolve(game) {
  const deck = JSON.parse(game.deck);
  const dealerHand = JSON.parse(game.dealer_hand);
  const p1Hand = JSON.parse(game.player1_hand);
  const p2Hand = JSON.parse(game.player2_hand);

  const anyoneStillIn = game.player1_status !== 'bust' || game.player2_status !== 'bust';
  if (anyoneStillIn) {
    while (handValue(dealerHand) < 17) {
      dealerHand.push(deck.pop());
    }
  }

  const p1Result = resolvePlayerOutcome(p1Hand, game.player1_status, game.player1_bet, dealerHand);
  const p2Result = resolvePlayerOutcome(p2Hand, game.player2_status, game.player2_bet, dealerHand);

  const p1Balance = (await getBalance(game.player1_id)) + p1Result.payout;
  await setBalance(game.player1_id, p1Balance);
  const p2Balance = (await getBalance(game.player2_id)) + p2Result.payout;
  await setBalance(game.player2_id, p2Balance);

  const lastResult = {
    dealerTotal: handValue(dealerHand),
    player1: p1Result,
    player2: p2Result,
  };

  const updated = await sql`
    UPDATE blackjack_games
    SET deck = ${JSON.stringify(deck)}, dealer_hand = ${JSON.stringify(dealerHand)}, dealer_hidden = false,
        turn = NULL, status = 'round_over', last_result = ${JSON.stringify(lastResult)}, updated_at = now()
    WHERE code = ${game.code}
    RETURNING *
  `;
  return updated.rows[0];
}

async function advanceTurn(game) {
  if (game.turn === 'player1') {
    const updated = await sql`
      UPDATE blackjack_games SET turn = 'player2', updated_at = now() WHERE code = ${game.code} RETURNING *
    `;
    let next = updated.rows[0];
    if (next.player2_status !== 'playing') {
      next = await advanceTurn(next);
    }
    return next;
  }
  if (game.turn === 'player2') {
    return playDealerAndResolve(game);
  }
  return game;
}

module.exports = async (req, res) => {
  await ensureSchema();

  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  if (!hasApp(user, 'blackjack')) {
    res.status(403).json({ error: 'You do not have access to this app.' });
    return;
  }

  if (req.method === 'GET') {
    const code = String(req.query.code || '').toUpperCase();
    if (!code) {
      const balance = await getBalance(user.id);
      res.status(200).json({ balance });
      return;
    }
    const game = await loadGame(code);
    if (!game || (game.player1_id !== user.id && game.player2_id !== user.id)) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.status(200).json(await publicState(game, user.id));
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
      if (!(await loadGame(candidate))) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      res.status(500).json({ error: 'Could not allocate a room code, try again.' });
      return;
    }
    const inserted = await sql`
      INSERT INTO blackjack_games (code, player1_id, status)
      VALUES (${code}, ${user.id}, 'waiting')
      RETURNING *
    `;
    res.status(201).json(await publicState(inserted.rows[0], user.id));
    return;
  }

  if (action === 'join') {
    const code = String(req.body.code || '').toUpperCase();
    const game = await loadGame(code);
    if (!game) {
      res.status(404).json({ error: 'No table with that code.' });
      return;
    }
    if (game.player1_id === user.id || game.player2_id === user.id) {
      res.status(200).json(await publicState(game, user.id));
      return;
    }
    if (game.player2_id) {
      res.status(409).json({ error: 'That table is already full.' });
      return;
    }
    const updated = await sql`
      UPDATE blackjack_games SET player2_id = ${user.id}, status = 'betting', updated_at = now()
      WHERE code = ${code}
      RETURNING *
    `;
    res.status(200).json(await publicState(updated.rows[0], user.id));
    return;
  }

  if (action === 'bet') {
    const code = String(req.body.code || '').toUpperCase();
    const amount = Number(req.body.amount);
    const game = await loadGame(code);
    if (!game || (game.player1_id !== user.id && game.player2_id !== user.id)) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    if (game.status !== 'betting' && game.status !== 'round_over') {
      res.status(400).json({ error: 'Betting is closed for this round.' });
      return;
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      res.status(400).json({ error: 'Invalid bet amount.' });
      return;
    }
    const balance = await getBalance(user.id);
    if (amount > balance) {
      res.status(400).json({ error: 'That bet is more than your balance.' });
      return;
    }
    const you = game.player1_id === user.id ? 1 : 2;

    if (game.status === 'betting' && (you === 1 ? game.player1_bet : game.player2_bet) != null) {
      res.status(400).json({ error: 'You already placed a bet this round.' });
      return;
    }

    await setBalance(user.id, balance - amount);

    const startingNewRound = game.status === 'round_over';
    let row;
    if (startingNewRound) {
      row = (
        await sql`
          UPDATE blackjack_games
          SET status = 'betting', deck = '[]', player1_hand = '[]', player2_hand = '[]', dealer_hand = '[]',
              dealer_hidden = true, player1_bet = NULL, player2_bet = NULL, player1_status = NULL,
              player2_status = NULL, turn = NULL, last_result = NULL, updated_at = now()
          WHERE code = ${code}
          RETURNING *
        `
      ).rows[0];
    } else {
      row = game;
    }

    row = (
      you === 1
        ? await sql`UPDATE blackjack_games SET player1_bet = ${amount}, updated_at = now() WHERE code = ${code} RETURNING *`
        : await sql`UPDATE blackjack_games SET player2_bet = ${amount}, updated_at = now() WHERE code = ${code} RETURNING *`
    ).rows[0];

    const bothBetsIn = row.player1_bet != null && row.player2_bet != null;
    if (bothBetsIn) {
      const deck = freshShuffledDeck();
      const p1Hand = [deck.pop(), deck.pop()];
      const p2Hand = [deck.pop(), deck.pop()];
      const dealerHand = [deck.pop(), deck.pop()];

      const p1Status = isBlackjack(p1Hand) ? 'blackjack' : 'playing';
      const p2Status = isBlackjack(p2Hand) ? 'blackjack' : 'playing';
      const turn = p1Status === 'playing' ? 'player1' : p2Status === 'playing' ? 'player2' : 'dealer';

      row = (
        await sql`
          UPDATE blackjack_games
          SET deck = ${JSON.stringify(deck)}, player1_hand = ${JSON.stringify(p1Hand)},
              player2_hand = ${JSON.stringify(p2Hand)}, dealer_hand = ${JSON.stringify(dealerHand)},
              dealer_hidden = true, player1_status = ${p1Status}, player2_status = ${p2Status},
              turn = ${turn}, status = 'playing', updated_at = now()
          WHERE code = ${code}
          RETURNING *
        `
      ).rows[0];

      if (turn === 'dealer') {
        row = await playDealerAndResolve(row);
      }
    }

    res.status(200).json(await publicState(row, user.id));
    return;
  }

  if (action === 'hit' || action === 'stand') {
    const code = String(req.body.code || '').toUpperCase();
    const game = await loadGame(code);
    if (!game || (game.player1_id !== user.id && game.player2_id !== user.id)) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    if (game.status !== 'playing') {
      res.status(400).json({ error: 'No hand in progress.' });
      return;
    }
    const you = game.player1_id === user.id ? 1 : 2;
    if (game.turn !== 'player' + you) {
      res.status(400).json({ error: "It's not your turn." });
      return;
    }

    let row = game;
    if (action === 'hit') {
      const deck = JSON.parse(row.deck);
      const hand = JSON.parse(row[`player${you}_hand`]);
      hand.push(deck.pop());
      const total = handValue(hand);
      const status = total > 21 ? 'bust' : 'playing';
      row = (
        you === 1
          ? await sql`
              UPDATE blackjack_games
              SET deck = ${JSON.stringify(deck)}, player1_hand = ${JSON.stringify(hand)}, player1_status = ${status}, updated_at = now()
              WHERE code = ${code}
              RETURNING *
            `
          : await sql`
              UPDATE blackjack_games
              SET deck = ${JSON.stringify(deck)}, player2_hand = ${JSON.stringify(hand)}, player2_status = ${status}, updated_at = now()
              WHERE code = ${code}
              RETURNING *
            `
      ).rows[0];
      if (status === 'bust') {
        row = await advanceTurn(row);
      }
    } else {
      row = (
        you === 1
          ? await sql`UPDATE blackjack_games SET player1_status = 'stood', updated_at = now() WHERE code = ${code} RETURNING *`
          : await sql`UPDATE blackjack_games SET player2_status = 'stood', updated_at = now() WHERE code = ${code} RETURNING *`
      ).rows[0];
      row = await advanceTurn(row);
    }

    res.status(200).json(await publicState(row, user.id));
    return;
  }

  res.status(400).json({ error: 'Unknown action' });
};
