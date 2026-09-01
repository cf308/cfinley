const Anthropic = require('@anthropic-ai/sdk');
const { sql, ensureSchema } = require('../lib/_db');
const { getCurrentUser, hasApp } = require('../lib/_session');

const MODEL = 'claude-haiku-4-5';
const STAT_KEYS = ['health', 'happiness', 'smarts', 'looks', 'money', 'relationships'];

const BASE_STATS = { health: 80, happiness: 70, smarts: 50, looks: 50, money: 0, relationships: 60 };

function clampStats(stats) {
  const out = { ...stats };
  for (const key of STAT_KEYS) {
    if (key === 'money') {
      out.money = Math.round(out.money);
      continue;
    }
    out[key] = Math.max(0, Math.min(100, Math.round(out[key])));
  }
  return out;
}

function applyStatChanges(stats, changes) {
  const next = { ...stats };
  for (const key of STAT_KEYS) {
    const delta = Number(changes && changes[key]) || 0;
    next[key] = next[key] + delta;
  }
  return clampStats(next);
}

function stageLabel(age) {
  if (age <= 4) return 'toddler';
  if (age <= 12) return 'child';
  if (age <= 17) return 'teenager';
  if (age <= 25) return 'young adult';
  if (age <= 60) return 'adult';
  return 'senior';
}

function extractJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  return JSON.parse(candidate);
}

async function generateEvent(client, character) {
  const recentHistory = character.history
    .slice(-4)
    .map((h) => `Age ${h.age}: ${h.narrative} You chose: "${h.choiceText}"`)
    .join('\n');

  const system = `You are the narrator for a single-player, AI-driven life simulation game (in the style of BitLife). Given a character's current age, stats, and recent history, invent the next life event and exactly 3 distinct choices for the player.

Rules:
- Keep the narrative to 1-3 sentences, second person ("You..."), grounded and varied (school, family, friendships, health, work once old enough, random luck, relationships, hobbies) and appropriate for the character's life stage.
- Each choice needs short button text (under 8 words) and a statChanges object with integer deltas for health, happiness, smarts, looks, money, relationships. Most deltas should be small (-15 to 15); money deltas can be larger (-3000 to 5000) for adult financial events. Use 0 for stats a choice doesn't affect.
- Choices should feel meaningfully different from each other (e.g. one safe, one risky, one unconventional).
- Respond with ONLY raw JSON, no markdown fences, matching exactly this shape:
{"narrative": "...", "choices": [{"text": "...", "statChanges": {"health": 0, "happiness": 0, "smarts": 0, "looks": 0, "money": 0, "relationships": 0}}, ...3 total]}`;

  const user = `Character: ${character.name}
Age: ${character.age} (${stageLabel(character.age)})
Current stats: ${JSON.stringify(character.stats)}
${recentHistory ? 'Recent history:\n' + recentHistory : 'This is the start of their life.'}

Generate the next event and 3 choices.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const parsed = extractJson(textBlock ? textBlock.text : '');

  if (!parsed || !parsed.narrative || !Array.isArray(parsed.choices) || parsed.choices.length !== 3) {
    throw new Error('malformed event from model');
  }

  return parsed;
}

function publicState(row) {
  return {
    name: row.name,
    age: row.age,
    stats: JSON.parse(row.stats),
    history: JSON.parse(row.history),
    alive: row.alive,
    pendingEvent: row.pending_choices ? JSON.parse(row.pending_choices) : null,
  };
}

module.exports = async (req, res) => {
  await ensureSchema();

  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  if (!hasApp(user, 'lifesim')) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  if (req.method === 'GET') {
    const { rows } = await sql`SELECT * FROM life_sim WHERE user_id = ${user.id}`;
    res.status(200).json({ life: rows[0] ? publicState(rows[0]) : null });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Life Sim is not configured.' });
    return;
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { action, choiceIndex, name } = req.body || {};

  if (action === 'start') {
    const character = {
      name: (name || 'Anonymous').toString().slice(0, 40) || 'Anonymous',
      age: 0,
      stats: BASE_STATS,
      history: [],
    };

    let event;
    try {
      event = await generateEvent(client, character);
    } catch (err) {
      res.status(502).json({ error: 'Unable to reach the story generator.' });
      return;
    }

    const statsJson = JSON.stringify(character.stats);
    const pendingJson = JSON.stringify(event);

    await sql`
      INSERT INTO life_sim (user_id, name, age, stats, history, pending_choices, alive, updated_at)
      VALUES (${user.id}, ${character.name}, 0, ${statsJson}, '[]', ${pendingJson}, true, now())
      ON CONFLICT (user_id) DO UPDATE SET
        name = ${character.name}, age = 0, stats = ${statsJson}, history = '[]',
        pending_choices = ${pendingJson}, alive = true, updated_at = now()
    `;

    const { rows } = await sql`SELECT * FROM life_sim WHERE user_id = ${user.id}`;
    res.status(200).json({ life: publicState(rows[0]) });
    return;
  }

  if (action === 'choose') {
    const { rows } = await sql`SELECT * FROM life_sim WHERE user_id = ${user.id}`;
    const row = rows[0];
    if (!row || !row.alive || !row.pending_choices) {
      res.status(400).json({ error: 'No life in progress.' });
      return;
    }

    const pending = JSON.parse(row.pending_choices);
    const idx = Number(choiceIndex);
    const chosen = pending.choices[idx];
    if (!Number.isInteger(idx) || !chosen) {
      res.status(400).json({ error: 'Invalid choice.' });
      return;
    }

    const stats = applyStatChanges(JSON.parse(row.stats), chosen.statChanges);
    const history = JSON.parse(row.history);
    const nextAge = row.age + 1;
    history.push({ age: nextAge, narrative: pending.narrative, choiceText: chosen.text });

    const character = { name: row.name, age: nextAge, stats, history };

    if (stats.health <= 0) {
      const statsJson = JSON.stringify(stats);
      const historyJson = JSON.stringify(history);
      await sql`
        UPDATE life_sim SET age = ${nextAge}, stats = ${statsJson}, history = ${historyJson},
          pending_choices = NULL, alive = false, updated_at = now()
        WHERE user_id = ${user.id}
      `;
      const { rows: updated } = await sql`SELECT * FROM life_sim WHERE user_id = ${user.id}`;
      res.status(200).json({ life: publicState(updated[0]) });
      return;
    }

    let event;
    try {
      event = await generateEvent(client, character);
    } catch (err) {
      res.status(502).json({ error: 'Unable to reach the story generator.' });
      return;
    }

    const statsJson = JSON.stringify(stats);
    const historyJson = JSON.stringify(history);
    const pendingJson = JSON.stringify(event);

    await sql`
      UPDATE life_sim SET age = ${nextAge}, stats = ${statsJson}, history = ${historyJson},
        pending_choices = ${pendingJson}, alive = true, updated_at = now()
      WHERE user_id = ${user.id}
    `;

    const { rows: updated } = await sql`SELECT * FROM life_sim WHERE user_id = ${user.id}`;
    res.status(200).json({ life: publicState(updated[0]) });
    return;
  }

  res.status(400).json({ error: 'Unknown action.' });
};
