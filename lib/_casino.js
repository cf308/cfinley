const { sql } = require('./_db');

// Shared virtual chip wallet for every table game (Roulette, Blackjack, ...).
// Table name is a holdover from when Roulette was the only game using it.

async function getBalance(userId) {
  const { rows } = await sql`SELECT balance FROM roulette_balances WHERE user_id = ${userId}`;
  if (rows[0]) return rows[0].balance;
  await sql`
    INSERT INTO roulette_balances (user_id, balance) VALUES (${userId}, 1000)
    ON CONFLICT (user_id) DO NOTHING
  `;
  return 1000;
}

async function setBalance(userId, balance) {
  await sql`
    INSERT INTO roulette_balances (user_id, balance, updated_at) VALUES (${userId}, ${balance}, now())
    ON CONFLICT (user_id) DO UPDATE SET balance = ${balance}, updated_at = now()
  `;
}

module.exports = { getBalance, setBalance };
