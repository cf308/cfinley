const { sql, ensureSchema } = require('../lib/_db');
const { getCurrentUser, hasApp } = require('../lib/_session');

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const PAYOUTS = {
  straight: 35,
  red: 1,
  black: 1,
  odd: 1,
  even: 1,
  low: 1,
  high: 1,
  dozen1: 2,
  dozen2: 2,
  dozen3: 2,
};

function colorOf(n) {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

function betWins(bet, n) {
  switch (bet.type) {
    case 'straight':
      return n === bet.value;
    case 'red':
      return n !== 0 && RED_NUMBERS.has(n);
    case 'black':
      return n !== 0 && !RED_NUMBERS.has(n);
    case 'odd':
      return n !== 0 && n % 2 === 1;
    case 'even':
      return n !== 0 && n % 2 === 0;
    case 'low':
      return n >= 1 && n <= 18;
    case 'high':
      return n >= 19 && n <= 36;
    case 'dozen1':
      return n >= 1 && n <= 12;
    case 'dozen2':
      return n >= 13 && n <= 24;
    case 'dozen3':
      return n >= 25 && n <= 36;
    default:
      return false;
  }
}

function validateBet(bet) {
  if (!bet || typeof bet !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(PAYOUTS, bet.type)) return false;
  if (!Number.isInteger(bet.amount) || bet.amount <= 0) return false;
  if (bet.type === 'straight') {
    if (!Number.isInteger(bet.value) || bet.value < 0 || bet.value > 36) return false;
  }
  return true;
}

async function getBalance(userId) {
  const { rows } = await sql`SELECT balance FROM roulette_balances WHERE user_id = ${userId}`;
  if (rows[0]) return rows[0].balance;
  await sql`
    INSERT INTO roulette_balances (user_id, balance) VALUES (${userId}, 1000)
    ON CONFLICT (user_id) DO NOTHING
  `;
  return 1000;
}

module.exports = async (req, res) => {
  await ensureSchema();

  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  if (!hasApp(user, 'roulette')) {
    res.status(403).json({ error: 'You do not have access to this app.' });
    return;
  }

  if (req.method === 'GET') {
    const balance = await getBalance(user.id);
    res.status(200).json({ balance });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { action, bets } = req.body || {};
  if (action !== 'spin') {
    res.status(400).json({ error: 'Unknown action' });
    return;
  }

  if (!Array.isArray(bets) || bets.length === 0 || !bets.every(validateBet)) {
    res.status(400).json({ error: 'Invalid bets' });
    return;
  }

  const totalStake = bets.reduce((sum, b) => sum + b.amount, 0);
  const balance = await getBalance(user.id);
  if (totalStake > balance) {
    res.status(400).json({ error: 'That bet is more than your balance.' });
    return;
  }

  const number = Math.floor(Math.random() * 37); // 0-36
  const color = colorOf(number);

  let totalReturn = 0;
  const results = bets.map((bet) => {
    const won = betWins(bet, number);
    const payout = won ? bet.amount * (PAYOUTS[bet.type] + 1) : 0;
    totalReturn += payout;
    return { type: bet.type, value: bet.value ?? null, amount: bet.amount, won, payout };
  });

  const newBalance = balance - totalStake + totalReturn;

  await sql`
    INSERT INTO roulette_balances (user_id, balance, updated_at)
    VALUES (${user.id}, ${newBalance}, now())
    ON CONFLICT (user_id) DO UPDATE SET balance = ${newBalance}, updated_at = now()
  `;

  res.status(200).json({ number, color, results, balance: newBalance });
};
