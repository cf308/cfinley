const Anthropic = require('@anthropic-ai/sdk');
const { sql, ensureSchema } = require('../lib/_db');
const { getCurrentUser, hasApp } = require('../lib/_session');

const MODEL = 'claude-haiku-4-5';
const STAT_KEYS = ['health', 'happiness', 'smarts', 'looks'];
const BASE_STATS = { health: 80, happiness: 70, smarts: 50, looks: 50 };
const MAX_RELATIONSHIPS = 24;
const COLLEGE_TUITION = 40000;

const CHILD_NAMES = [
  'Avery', 'Riley', 'Jordan', 'Casey', 'Morgan', 'Quinn', 'Rowan', 'Elliot',
  'Sasha', 'Reese', 'Emerson', 'Dana', 'Finley', 'Harper', 'Marlowe', 'Sawyer',
];

const JOBS = [
  { title: 'Fast Food Worker', tier: 'none', minAge: 15, baseSalary: 18000 },
  { title: 'Retail Associate', tier: 'none', minAge: 16, baseSalary: 20000 },
  { title: 'Warehouse Worker', tier: 'none', minAge: 16, baseSalary: 24000 },
  { title: 'Dog Walker', tier: 'none', minAge: 14, baseSalary: 9000 },
  { title: 'Office Assistant', tier: 'highschool', minAge: 18, baseSalary: 30000 },
  { title: 'Sales Representative', tier: 'highschool', minAge: 18, baseSalary: 34000 },
  { title: 'Bartender', tier: 'highschool', minAge: 18, baseSalary: 28000 },
  { title: 'Electrician Apprentice', tier: 'highschool', minAge: 18, baseSalary: 38000 },
  { title: 'Software Engineer', tier: 'college', minAge: 21, baseSalary: 85000 },
  { title: 'Accountant', tier: 'college', minAge: 21, baseSalary: 62000 },
  { title: 'Teacher', tier: 'college', minAge: 21, baseSalary: 48000 },
  { title: 'Registered Nurse', tier: 'college', minAge: 21, baseSalary: 70000 },
  { title: 'Marketing Manager', tier: 'college', minAge: 21, baseSalary: 60000 },
  { title: 'Civil Engineer', tier: 'college', minAge: 21, baseSalary: 75000 },
  { title: 'Doctor', tier: 'elite', minAge: 26, baseSalary: 190000, minSmarts: 80 },
  { title: 'Lawyer', tier: 'elite', minAge: 25, baseSalary: 150000, minSmarts: 75 },
  { title: 'Investment Banker', tier: 'elite', minAge: 23, baseSalary: 140000, minSmarts: 70 },
];

const ASSET_CATALOG = {
  car: [
    { name: 'Used Sedan', price: 4000 },
    { name: 'Compact Hatchback', price: 9000 },
    { name: 'Midsize SUV', price: 22000 },
    { name: 'Luxury Sedan', price: 55000 },
    { name: 'Sports Car', price: 95000 },
  ],
  house: [
    { name: 'Studio Apartment', price: 60000 },
    { name: 'Starter Home', price: 150000 },
    { name: 'Suburban House', price: 320000 },
    { name: 'Luxury Condo', price: 600000 },
    { name: 'Estate', price: 1500000 },
  ],
};

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampStats(stats) {
  const out = { ...stats };
  for (const key of STAT_KEYS) out[key] = clamp(out[key], 0, 100);
  out.money = Math.round(out.money);
  return out;
}

function applyStatChanges(stats, changes) {
  const next = { ...stats };
  for (const key of STAT_KEYS) next[key] = next[key] + (Number(changes && changes[key]) || 0);
  next.money = next.money + (Number(changes && changes.money) || 0);
  return clampStats(next);
}

function stageLabel(age) {
  if (age <= 2) return 'infant';
  if (age <= 12) return 'child';
  if (age <= 17) return 'teenager';
  if (age <= 25) return 'young adult';
  if (age <= 60) return 'adult';
  return 'senior';
}

function extractJson(text) {
  const trimmed = (text || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

function newRelationship(name, type, closeness) {
  return { id: Math.random().toString(36).slice(2, 10), name, type, closeness: clamp(closeness, 0, 100), alive: true };
}

function findRelationship(relationships, id) {
  return relationships.find((r) => r.id === id);
}

function findRelationshipByName(relationships, name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  return relationships.find((r) => r.alive && r.name.toLowerCase() === lower) || null;
}

function careerLabel(career) {
  return career ? `${career.title} (earning $${career.salary.toLocaleString()}/yr)` : 'unemployed';
}

function educationLabel(edu) {
  if (edu.collegeStatus === 'graduated') return `college graduate${edu.major ? ' (' + edu.major + ')' : ''}`;
  if (edu.collegeStatus === 'enrolled') return `enrolled in college, ${edu.collegeYearsRemaining} year(s) left`;
  if (edu.highSchoolGraduated) return 'high school graduate';
  return 'in school';
}

function characterContext(character) {
  const relLines = character.relationships
    .filter((r) => r.alive)
    .map((r) => `${r.name} (${r.type}, closeness ${r.closeness}/100)`)
    .join('; ');

  return `Name: ${character.name}
Age: ${character.age} (${stageLabel(character.age)})
Stats: health ${character.stats.health}, happiness ${character.stats.happiness}, smarts ${character.stats.smarts}, looks ${character.stats.looks}, money $${character.stats.money.toLocaleString()}
Career: ${careerLabel(character.career)}
Education: ${educationLabel(character.education)}
Relationships: ${relLines || 'none yet'}
Assets: ${character.assets.length ? character.assets.map((a) => a.name).join(', ') : 'none'}`;
}

async function generateBirth(client, name) {
  const system = `You are the narrator for a single-player, AI-driven life simulation game (in the style of BitLife). A new character is being born. Invent their immediate family: a father, a mother, and 0-2 siblings (roll the dice on how many — most characters have 0 or 1). Write a short (1-2 sentence) birth announcement.

Respond with ONLY raw JSON, no markdown fences, matching exactly this shape:
{"narrative": "...", "father": {"name": "..."}, "mother": {"name": "..."}, "siblings": [{"name": "..."}]}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system,
    messages: [{ role: 'user', content: `The child's name is ${name}. Generate their birth and family.` }],
  });

  const block = response.content.find((b) => b.type === 'text');
  const parsed = extractJson(block ? block.text : '');
  if (!parsed || !parsed.narrative || !parsed.father || !parsed.mother || !Array.isArray(parsed.siblings)) {
    throw new Error('malformed birth response');
  }
  return parsed;
}

async function generateEvent(client, character) {
  const recentHistory = character.history
    .slice(-4)
    .map((h) => `Age ${h.age}: ${h.narrative} They chose: "${h.choiceText}"`)
    .join('\n');

  const system = `You are the narrator for a single-player, AI-driven life simulation game (in the style of BitLife). Given a character's current state, invent the next life event and exactly 3 distinct choices.

Rules:
- Keep the narrative to 1-3 sentences, second person ("You..."), grounded and varied (school, family, friendships, health, romance, work, random luck, minor trouble) and appropriate for the character's age and life stage.
- Each choice needs short button text (under 8 words) and a statChanges object with integer deltas for health, happiness, smarts, looks (small, -15 to 15) and money (can be larger, -3000 to 6000, for financially relevant events — 0 for most).
- Choices should feel meaningfully different (e.g. one safe, one risky, one unconventional).
- A choice MAY include relationshipEffects: an array of {"name": "<exact existing relationship name from the list given>", "delta": <-20 to 20>} — only reference names given in the character's relationships list, and only when the event is actually about that person. Omit if not relevant.
- A choice MAY include "achievementUnlocked": a short achievement name string (e.g. "Won a Talent Show") for a genuinely notable one-time moment. Omit (null) most of the time.
- Roughly 1 in 5 turns, if narratively natural, you may introduce exactly one brand new person via a top-level "newRelationship" field: {"name": "...", "type": "friend"|"sibling"|"pet"|"date", relevant only for the character's current age/context}. Use "date" for a new romantic interest once the character is a teenager or older. Otherwise set "newRelationship" to null.
- Do not reference a career, college, or assets the character does not currently have.
- Respond with ONLY raw JSON, no markdown fences, matching exactly this shape:
{"narrative": "...", "choices": [{"text": "...", "statChanges": {"health": 0, "happiness": 0, "smarts": 0, "looks": 0, "money": 0}, "relationshipEffects": [], "achievementUnlocked": null}, ...3 total], "newRelationship": null}`;

  const user = `${characterContext(character)}
${recentHistory ? '\nRecent history:\n' + recentHistory : '\nThis is the start of their life.'}

Generate the next event and 3 choices.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const block = response.content.find((b) => b.type === 'text');
  const parsed = extractJson(block ? block.text : '');
  if (!parsed || !parsed.narrative || !Array.isArray(parsed.choices) || parsed.choices.length !== 3) {
    throw new Error('malformed event response');
  }
  return parsed;
}

function checkAchievements(character) {
  const unlocked = new Set(character.achievements);
  const add = (name) => unlocked.add(name);

  if (character.career) add('First Job');
  if (character.assets.some((a) => a.type === 'house')) add('Homeowner');
  if (character.assets.some((a) => a.type === 'car')) add('Car Owner');
  if (character.relationships.some((r) => r.type === 'spouse' && r.alive)) add('Married');
  if (character.relationships.some((r) => r.type === 'child' && r.alive)) add('Parent');
  if (character.education.collegeStatus === 'graduated') add('College Graduate');
  if (character.stats.money >= 1000000) add('Millionaire');
  if (character.age >= 100) add('Centenarian');

  return Array.from(unlocked);
}

function loadCharacter(row) {
  return {
    name: row.name,
    age: row.age,
    stats: JSON.parse(row.stats),
    history: JSON.parse(row.history),
    alive: row.alive,
    relationships: JSON.parse(row.relationships),
    career: JSON.parse(row.career),
    education: JSON.parse(row.education),
    assets: JSON.parse(row.assets),
    achievements: JSON.parse(row.achievements),
    cooldowns: JSON.parse(row.cooldowns),
    causeOfDeath: row.cause_of_death,
    pendingEvent: row.pending_choices ? JSON.parse(row.pending_choices) : null,
  };
}

async function saveCharacter(userId, character) {
  await sql`
    UPDATE life_sim SET
      name = ${character.name},
      age = ${character.age},
      stats = ${JSON.stringify(character.stats)},
      history = ${JSON.stringify(character.history)},
      pending_choices = ${character.pendingEvent ? JSON.stringify(character.pendingEvent) : null},
      alive = ${character.alive},
      relationships = ${JSON.stringify(character.relationships)},
      career = ${JSON.stringify(character.career)},
      education = ${JSON.stringify(character.education)},
      assets = ${JSON.stringify(character.assets)},
      achievements = ${JSON.stringify(character.achievements)},
      cooldowns = ${JSON.stringify(character.cooldowns)},
      cause_of_death = ${character.causeOfDeath || null},
      updated_at = now()
    WHERE user_id = ${userId}
  `;
}

function publicState(character) {
  return character;
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
    res.status(200).json({ life: rows[0] ? publicState(loadCharacter(rows[0])) : null });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};

  if (body.action === 'start') {
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: 'Life Sim is not configured.' });
      return;
    }
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const name = (body.name || 'Anonymous').toString().trim().slice(0, 40) || 'Anonymous';

    let birth;
    try {
      birth = await generateBirth(client, name);
    } catch (err) {
      res.status(502).json({ error: 'Unable to reach the story generator.' });
      return;
    }

    const relationships = [
      newRelationship(birth.father.name, 'parent', randInt(55, 85)),
      newRelationship(birth.mother.name, 'parent', randInt(55, 85)),
      ...birth.siblings.slice(0, 2).map((s) => newRelationship(s.name, 'sibling', randInt(40, 75))),
    ];

    let character = {
      name,
      age: 0,
      stats: { ...BASE_STATS, money: 0 },
      history: [{ age: 0, narrative: birth.narrative, choiceText: 'Born.' }],
      alive: true,
      relationships,
      career: null,
      education: { highSchoolGraduated: false, collegeStatus: 'none', collegeYearsRemaining: 0, major: null },
      assets: [],
      achievements: [],
      cooldowns: {},
      causeOfDeath: null,
      pendingEvent: null,
    };

    let event;
    try {
      event = await generateEvent(client, character);
    } catch (err) {
      event = null;
    }
    character.pendingEvent = event;
    character.achievements = checkAchievements(character);

    await sql`
      INSERT INTO life_sim (user_id, name, age, stats, history, pending_choices, alive, relationships, career, education, assets, achievements, cooldowns, cause_of_death, updated_at)
      VALUES (${user.id}, ${character.name}, ${character.age}, ${JSON.stringify(character.stats)}, ${JSON.stringify(character.history)}, ${character.pendingEvent ? JSON.stringify(character.pendingEvent) : null}, true, ${JSON.stringify(character.relationships)}, ${JSON.stringify(character.career)}, ${JSON.stringify(character.education)}, ${JSON.stringify(character.assets)}, ${JSON.stringify(character.achievements)}, ${JSON.stringify(character.cooldowns)}, NULL, now())
      ON CONFLICT (user_id) DO UPDATE SET
        name = EXCLUDED.name, age = EXCLUDED.age, stats = EXCLUDED.stats, history = EXCLUDED.history,
        pending_choices = EXCLUDED.pending_choices, alive = true, relationships = EXCLUDED.relationships,
        career = EXCLUDED.career, education = EXCLUDED.education, assets = EXCLUDED.assets,
        achievements = EXCLUDED.achievements, cooldowns = EXCLUDED.cooldowns, cause_of_death = NULL, updated_at = now()
    `;

    res.status(200).json({ life: publicState(character) });
    return;
  }

  // Every action below requires an existing character.
  const { rows } = await sql`SELECT * FROM life_sim WHERE user_id = ${user.id}`;
  const row = rows[0];
  if (!row) {
    res.status(400).json({ error: 'No life in progress.' });
    return;
  }
  const character = loadCharacter(row);
  if (!character.alive && body.action !== 'restart') {
    res.status(400).json({ error: 'This life has ended. Start a new one.' });
    return;
  }

  if (body.action === 'choose') {
    if (!character.pendingEvent) {
      res.status(400).json({ error: 'No event to respond to.' });
      return;
    }
    const idx = Number(body.choiceIndex);
    const chosen = character.pendingEvent.choices[idx];
    if (!Number.isInteger(idx) || !chosen) {
      res.status(400).json({ error: 'Invalid choice.' });
      return;
    }

    character.stats = applyStatChanges(character.stats, chosen.statChanges);

    (chosen.relationshipEffects || []).forEach((effect) => {
      const rel = findRelationshipByName(character.relationships, effect.name);
      if (rel) rel.closeness = clamp(rel.closeness + (Number(effect.delta) || 0), 0, 100);
    });

    if (chosen.achievementUnlocked) {
      if (!character.achievements.includes(chosen.achievementUnlocked)) {
        character.achievements.push(chosen.achievementUnlocked);
      }
    }

    character.history.push({ age: character.age + 1, narrative: character.pendingEvent.narrative, choiceText: chosen.text });
    character.age += 1;

    if (character.pendingEvent.newRelationship && character.relationships.length < MAX_RELATIONSHIPS) {
      const nr = character.pendingEvent.newRelationship;
      if (nr && nr.name && nr.type) {
        character.relationships.push(newRelationship(nr.name, nr.type, randInt(35, 65)));
      }
    }

    // Mechanical yearly progression.
    if (character.age >= 18 && !character.education.highSchoolGraduated) {
      character.education.highSchoolGraduated = true;
    }
    if (character.education.collegeStatus === 'enrolled') {
      character.education.collegeYearsRemaining -= 1;
      if (character.education.collegeYearsRemaining <= 0) {
        character.education.collegeStatus = 'graduated';
        character.education.collegeYearsRemaining = 0;
        character.stats.smarts = clamp(character.stats.smarts + 10, 0, 100);
      }
    }
    if (character.career) {
      character.stats.money += character.career.salary;
    }
    if (character.age >= 18) {
      character.stats.money -= randInt(500, 2000);
    }
    character.stats = clampStats(character.stats);

    character.achievements = checkAchievements(character);
    character.pendingEvent = null;

    if (character.stats.health <= 0) {
      character.alive = false;
      character.causeOfDeath = character.history[character.history.length - 1].narrative;
      await saveCharacter(user.id, character);
      res.status(200).json({ life: publicState(character) });
      return;
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: 'Life Sim is not configured.' });
      return;
    }
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    try {
      character.pendingEvent = await generateEvent(client, character);
    } catch (err) {
      // Save progress even if the next event failed to generate; the client can retry.
      await saveCharacter(user.id, character);
      res.status(502).json({ error: 'Unable to reach the story generator. Your progress was saved — try again.' });
      return;
    }

    await saveCharacter(user.id, character);
    res.status(200).json({ life: publicState(character) });
    return;
  }

  if (body.action === 'retry_event') {
    if (character.pendingEvent) {
      res.status(200).json({ life: publicState(character) });
      return;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: 'Life Sim is not configured.' });
      return;
    }
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    try {
      character.pendingEvent = await generateEvent(client, character);
    } catch (err) {
      res.status(502).json({ error: 'Unable to reach the story generator. Try again.' });
      return;
    }
    await saveCharacter(user.id, character);
    res.status(200).json({ life: publicState(character) });
    return;
  }

  if (body.action === 'relationship_interact') {
    const rel = findRelationship(character.relationships, body.relationshipId);
    if (!rel || !rel.alive) {
      res.status(400).json({ error: 'Relationship not found.' });
      return;
    }

    switch (body.interactionType) {
      case 'spend_time':
        rel.closeness = clamp(rel.closeness + (Math.random() < 0.15 ? -randInt(2, 8) : randInt(5, 15)), 0, 100);
        break;
      case 'gift': {
        const cost = randInt(50, 200);
        if (character.stats.money < cost) {
          res.status(400).json({ error: `Not enough money (needs $${cost}).` });
          return;
        }
        character.stats.money -= cost;
        rel.closeness = clamp(rel.closeness + randInt(8, 20), 0, 100);
        break;
      }
      case 'compliment':
        rel.closeness = clamp(rel.closeness + randInt(3, 10), 0, 100);
        break;
      case 'argue':
        rel.closeness = clamp(rel.closeness - randInt(10, 25), 0, 100);
        break;
      case 'propose':
        if (character.age < 16) {
          res.status(400).json({ error: 'Too young.' });
          return;
        }
        if (!['date', 'friend'].includes(rel.type) || rel.closeness < 70) {
          res.status(400).json({ error: 'Not close enough yet.' });
          return;
        }
        if (character.relationships.some((r) => r.type === 'spouse' && r.alive)) {
          res.status(400).json({ error: 'Already married.' });
          return;
        }
        rel.type = 'spouse';
        break;
      case 'have_child': {
        if (!character.relationships.some((r) => r.type === 'spouse' && r.alive)) {
          res.status(400).json({ error: 'Get married first.' });
          return;
        }
        if (character.relationships.length >= MAX_RELATIONSHIPS) {
          res.status(400).json({ error: 'Family is full.' });
          return;
        }
        character.relationships.push(newRelationship(pick(CHILD_NAMES), 'child', 90));
        break;
      }
      case 'breakup':
        if (!['date', 'spouse'].includes(rel.type)) {
          res.status(400).json({ error: 'Not applicable.' });
          return;
        }
        rel.type = 'ex';
        break;
      default:
        res.status(400).json({ error: 'Unknown interaction.' });
        return;
    }

    character.achievements = checkAchievements(character);
    await saveCharacter(user.id, character);
    res.status(200).json({ life: publicState(character) });
    return;
  }

  if (body.action === 'career_action') {
    if (character.age < 14) {
      res.status(400).json({ error: 'Too young to work.' });
      return;
    }

    if (body.type === 'apply') {
      const eligible = JOBS.filter((job) => {
        if (character.age < job.minAge) return false;
        if (job.minSmarts && character.stats.smarts < job.minSmarts) return false;
        if (job.tier === 'highschool' && !character.education.highSchoolGraduated) return false;
        if (job.tier === 'college' && character.education.collegeStatus !== 'graduated') return false;
        if (job.tier === 'elite' && character.education.collegeStatus !== 'graduated') return false;
        return true;
      });
      if (eligible.length === 0) {
        res.status(400).json({ error: 'No jobs available to you yet.' });
        return;
      }
      const job = pick(eligible);
      const salary = Math.round((job.baseSalary * (0.85 + Math.random() * 0.3)) / 500) * 500;
      character.career = { title: job.title, salary, yearsEmployed: 0 };
    } else if (body.type === 'work_harder') {
      if (!character.career) {
        res.status(400).json({ error: 'You have no job.' });
        return;
      }
      if (character.cooldowns.work_harder === character.age) {
        res.status(400).json({ error: 'Already tried this year.' });
        return;
      }
      character.cooldowns.work_harder = character.age;
      if (Math.random() < 0.35) {
        character.career.salary = Math.round((character.career.salary * randInt(105, 125)) / 100 / 500) * 500;
        character.stats.happiness = clamp(character.stats.happiness + 5, 0, 100);
      } else {
        character.stats.happiness = clamp(character.stats.happiness - randInt(0, 5), 0, 100);
      }
    } else if (body.type === 'quit') {
      character.career = null;
    } else {
      res.status(400).json({ error: 'Unknown career action.' });
      return;
    }

    character.stats = clampStats(character.stats);
    character.achievements = checkAchievements(character);
    await saveCharacter(user.id, character);
    res.status(200).json({ life: publicState(character) });
    return;
  }

  if (body.action === 'asset_action') {
    const catalog = ASSET_CATALOG[body.assetType];
    if (!catalog) {
      res.status(400).json({ error: 'Unknown asset type.' });
      return;
    }

    if (body.type === 'buy') {
      const item = catalog[Number(body.tier)];
      if (!item) {
        res.status(400).json({ error: 'Unknown item.' });
        return;
      }
      if (character.stats.money < item.price) {
        res.status(400).json({ error: `Not enough money (needs $${item.price.toLocaleString()}).` });
        return;
      }
      character.stats.money -= item.price;
      character.assets.push({ id: Math.random().toString(36).slice(2, 10), type: body.assetType, name: item.name, price: item.price });
    } else if (body.type === 'sell') {
      const idx = character.assets.findIndex((a) => a.id === body.assetId);
      if (idx === -1) {
        res.status(400).json({ error: 'Asset not found.' });
        return;
      }
      const [sold] = character.assets.splice(idx, 1);
      character.stats.money += Math.round(sold.price * 0.6);
    } else {
      res.status(400).json({ error: 'Unknown asset action.' });
      return;
    }

    character.stats = clampStats(character.stats);
    character.achievements = checkAchievements(character);
    await saveCharacter(user.id, character);
    res.status(200).json({ life: publicState(character) });
    return;
  }

  if (body.action === 'activity') {
    if (character.cooldowns[body.type] === character.age) {
      res.status(400).json({ error: 'Already did that this year.' });
      return;
    }

    if (body.type === 'gym') {
      character.stats.health = clamp(character.stats.health + randInt(4, 10), 0, 100);
      character.stats.looks = clamp(character.stats.looks + randInt(2, 6), 0, 100);
    } else if (body.type === 'doctor') {
      const cost = 150;
      if (character.stats.money < cost) {
        res.status(400).json({ error: `Not enough money (needs $${cost}).` });
        return;
      }
      character.stats.money -= cost;
      character.stats.health = clamp(character.stats.health + randInt(8, 18), 0, 100);
    } else if (body.type === 'study') {
      character.stats.smarts = clamp(character.stats.smarts + randInt(3, 9), 0, 100);
      character.stats.happiness = clamp(character.stats.happiness - randInt(0, 3), 0, 100);
    } else {
      res.status(400).json({ error: 'Unknown activity.' });
      return;
    }

    character.cooldowns[body.type] = character.age;
    character.stats = clampStats(character.stats);
    await saveCharacter(user.id, character);
    res.status(200).json({ life: publicState(character) });
    return;
  }

  if (body.action === 'college_enroll') {
    if (character.age < 18) {
      res.status(400).json({ error: 'Too young for college.' });
      return;
    }
    if (character.education.collegeStatus !== 'none') {
      res.status(400).json({ error: 'Already enrolled or graduated.' });
      return;
    }
    if (character.stats.money < COLLEGE_TUITION) {
      res.status(400).json({ error: `Not enough money (needs $${COLLEGE_TUITION.toLocaleString()}).` });
      return;
    }
    character.stats.money -= COLLEGE_TUITION;
    character.education.collegeStatus = 'enrolled';
    character.education.collegeYearsRemaining = 4;
    character.education.major = (body.major || 'General Studies').toString().slice(0, 40);

    character.stats = clampStats(character.stats);
    await saveCharacter(user.id, character);
    res.status(200).json({ life: publicState(character) });
    return;
  }

  res.status(400).json({ error: 'Unknown action.' });
};
