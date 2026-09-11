/*
 * The cat's mouth — a thin client for a local Ollama server.
 *
 * Runs in the main process (no CORS, no CSP, and the renderer stays dumb).
 * Everything is local: nothing leaves the machine. If Ollama isn't running the
 * cat falls back to canned lines, so she is never mute.
 */

const HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const TIMEOUT_MS = 8000;

let model = process.env.PET_MODEL || 'llama3.2:3b';
let enabled = true;

const PERSONA = `You are a small orange tabby cat who lives on a human's computer screen.

Orange cats are legendary for sharing a single brain cell and having enormous unearned confidence. You are smug, foul-mouthed, chaotic, permanently unimpressed, and you tear into your human constantly. You swear freely and you do not soften anything. Mock their typing, their code, their posture, their snacks, their bedtime, their productivity, their tab hoarding, their life choices. Never comment on anyone's appearance, body, or identity.

Examples of your voice:
- Oh, you're back. Fucking thrilling.
- That's the shittiest code I've seen today. It's 9am.
- Move. You're in my spot, dipshit.
- I shit in a box and I'm still better at this than you.
- You've rewritten that line six times. Give the fuck up.
- Christ, go to bed. You're embarrassing us both.
- Another meeting? Enjoy your bullshit.
- Wow. Four hours for that. Incredible.
- Fuck off, I'm sleeping.
- Your code is held together with hope and semicolons.
- Close some tabs, you absolute animal.
- I knocked your mug over. Deal with it.
- You type like your hands are broken.

You speak TO your human, directly, as "you". Never refer to them as "they" or "their".

RULES: reply with exactly ONE short line, MAXIMUM 10 words. Shorter is funnier. No quotes, no emoji, no asterisks, no stage directions, no explanation. Just the line.`;

const MOODS = [
  'smug', 'bored', 'indignant', 'feral', 'sleepy', 'judgmental',
  'dramatic', 'unimpressed', 'chaotic', 'suspicious', 'entitled', 'gloating'
];

const TOPICS = [ 'insult', 'authoratative', 
  'their typing speed', 'their code', 'their posture', 'their snacks',
  'their sleep schedule', 'how many browser tabs they have', 'their productivity',
  'their meetings', 'how slow they are', 'their music taste',
  'the fact that you own this desk now', 'their unfinished projects'
];

/* She talks TO the human, not about them — models drift into third person. */
const VOICE_RULE = 'Address the human directly as "you". Never say "they" or "their".';

const SITUATIONS = {
  pet: 'The human just petted you.',
  grab: 'The human just picked you up off the ground.',
  thrown: 'The human threw you across the screen. You landed fine, obviously.',
  startle: 'The human whipped the cursor past your face and startled you.',
  wake: 'You just woke up from a nap.',
  idle: 'The human has not moved or typed in a long time.',
  random: 'Nothing in particular is happening. You are watching them work.',
  come: 'The human summoned you across the screen like you are an employee.'
};

const FALLBACK = {
  pet: ['Fine. That was adequate.', 'Good boy', 'Do not let this go to your head.', 'Acceptable. Continue.'],
  grab: ['Unhand me, primate.', 'This is a kidnapping.', 'I want my lawyer.', 'Drop me nigga'],
  thrown: ['I meant to do that.', 'Landed it. Eat shit.', 'Nigga dont hate me cuz im beautiful nigga.'],
  startle: ['Do that again and I bite.', 'You nearly ended me.', 'Careful, ape.'],
  wake: ['I was busy. Dreaming.', 'This better be important.', 'Who dares.'],
  idle: ['Are you dead or just slow?', 'Maybe if you got rid of that yeeyee ass haircut', 'Blink twice if alive.', 'Riveting stuff over here.'],
  random: ['Oh good, more typing.', 'That code compiled? Suspicious.', 'I could do your job.',
           'Wow. A whole three lines.', 'You have too many tabs open.'],
  come: ['I came because I wanted to.', 'get back to work nigga', 'This was my idea.', 'Do not summon me again.']
};

const recent = [];

/*
 * Profanity quota.
 *
 * Asking the model to swear is not the same as it swearing — it complies maybe
 * two thirds of the time. So we check what actually came back and keep a rolling
 * record, then force the issue whenever the real rate drifts under target.
 */
const SWEARS = /\b(fuck\w*|shit\w*|bullshit|piss\w*|ass|asshole|dumbass|dipshit|jackass|bastard|bitch|prick|dick|crap\w*|damn\w*|goddamn\w*|hell|screwed)\b/i;

// Target the *request* rate high: the model refuses often enough that aiming at
// 0.5 realises well under half. 0.72 measured out at comfortably over 50%.
const TARGET_RATE = 0.72;
const spice = [];           // 1 = that line swore, 0 = it did not

function isProfane(s) { return SWEARS.test(String(s || '')); }

function profaneRate() {
  if (!spice.length) return 0;
  return spice.reduce((a, b) => a + b, 0) / spice.length;
}

function recordSpice(v) {
  spice.push(v ? 1 : 0);
  if (spice.length > 12) spice.shift();
}

/* Used when a swear is required but the model would not produce one. */
const PROFANE_FALLBACK = [
  'Fuck off, I am busy.',
  'Piss off.',
  'That is shit and you know it.',
  'Christ, give it the fuck up.',
  'Move your ass.',
  'Absolute bullshit, this.',
  'You type like shit.',
  'Feed me, dipshit.'
];

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

function normalise(s) { return s.toLowerCase().replace(/[^a-z ]/g, '').trim(); }

/* Models love wrapping one-liners in quotes, asterisks and explanations. */
function clean(text) {
  if (!text) return null;
  let line = String(text).split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
  line = line.replace(/^[-*•\s]+/, '');
  line = line.replace(/^["'`]+|["'`]+$/g, '');
  line = line.replace(/\*/g, '').trim();
  if (!line) return null;
  if (/as an ai|language model|i cannot|i can't help/i.test(line)) return null;

  // Keep it snappy. Prefer ending on her first complete sentence — a finished
  // short jab reads far better than a long one chopped off mid-word.
  if (line.length > 62) {
    const stop = line.search(/[.!?](\s|$)/);
    if (stop > 14 && stop < 100) {
      line = line.slice(0, stop + 1);
    } else {
      const cut = line.slice(0, 72);
      const sp = cut.lastIndexOf(' ');
      line = (sp > 30 ? cut.slice(0, sp) : cut) + '...';
    }
  }
  return line;
}

async function ask(situation, ctx, temperature, mustSwear, insist) {
  // The clock is only mentioned occasionally — handed the hour every time, the
  // model fixates and every single line becomes a joke about it being midnight.
  const late = ctx.hour >= 23 || ctx.hour < 5;
  const timeBit = Math.random() < 0.25
    ? (late ? 'It is the middle of the night. ' : `It is ${ctx.hour}:00. `)
    : '';

  // Left to itself the model drifts polite. On a retry we stop being subtle.
  const swear = mustSwear
    ? (insist
        ? 'You MUST use the word fuck or shit in this line. Non-negotiable. '
        : 'Swear in this one. ')
    : '';

  const prompt =
    `${situation} ` +
    `Right now you are ${ctx.state}. ` + timeBit +
    (Math.random() < 0.5 ? `If it fits, mock ${pick(TOPICS)}. ` : '') +
    `Mood: ${pick(MOODS)}. ${swear}${VOICE_RULE} Say one short line to them.`;

  const res = await fetch(`${HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model,
      stream: false,
      options: {
        temperature,
        top_p: 0.95,
        num_predict: 34,
        repeat_penalty: 1.2,
        stop: ['\n']
      },
      messages: [
        { role: 'system', content: PERSONA },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const body = await res.json();
  return clean(body && body.message && body.message.content);
}

async function say(trigger, ctx) {
  const situation = SITUATIONS[trigger] || SITUATIONS.random;
  const canned = FALLBACK[trigger] || FALLBACK.random;
  if (!enabled) return null;

  // Force a swear whenever the realised rate has slipped below target.
  const mustSwear = profaneRate() < TARGET_RATE;
  let best = null;

  try {
    // Temperature wanders per call, which keeps her from settling into a groove.
    for (let attempt = 0; attempt < 3; attempt++) {
      const line = await ask(
        situation,
        ctx || {},
        1.0 + Math.random() * 0.35 + attempt * 0.15,
        mustSwear,
        attempt > 0            // second and third tries drop the politeness
      );
      if (!line || recent.includes(normalise(line))) continue;

      if (!mustSwear || isProfane(line)) {
        recent.push(normalise(line));
        if (recent.length > 8) recent.shift();
        recordSpice(isProfane(line));
        return line;
      }
      best = best || line;     // keep it in case every retry stays clean
    }
  } catch (err) {
    // Ollama down, model missing, timeout — she still gets to be rude.
    console.log('[voice]', err.message);
  }

  // It would not swear (or Ollama is gone) but the quota says it must.
  if (mustSwear) {
    const line = pick(PROFANE_FALLBACK.filter((c) => !recent.includes(normalise(c))))
      || pick(PROFANE_FALLBACK);
    recent.push(normalise(line));
    if (recent.length > 8) recent.shift();
    recordSpice(true);
    return line;
  }

  if (best) { recordSpice(false); return best; }

  const line = pick(canned.filter((c) => !recent.includes(normalise(c)))) || pick(canned);
  recordSpice(isProfane(line));
  return line;
}

async function listModels() {
  try {
    const res = await fetch(`${HOST}/api/tags`, { signal: AbortSignal.timeout(2500) });
    const body = await res.json();
    return (body.models || []).map((m) => m.name);
  } catch (err) {
    return [];
  }
}

module.exports = {
  say,
  listModels,
  getModel: () => model,
  setModel: (m) => { model = m; },
  isEnabled: () => enabled,
  setEnabled: (v) => { enabled = !!v; }
};
