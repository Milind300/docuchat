// Checks the settings the app needs. Returns a list of problems.
// It never includes the value of a setting in a message, so secrets cannot leak into logs.

const PLACEHOLDERS = ['change-me', 'put-a-long-random', 'your-', 'at-least-32'];

function looksLikePlaceholder(value) {
  const v = value.toLowerCase();
  return PLACEHOLDERS.some((p) => v.includes(p));
}

export function findEnvProblems(env) {
  const problems = [];
  const get = (name) => (env[name] ?? '').trim();

  const mongo = get('MONGO_URI');
  if (!mongo) {
    problems.push('MONGO_URI is missing.');
  } else if (!mongo.startsWith('mongodb://') && !mongo.startsWith('mongodb+srv://')) {
    problems.push('MONGO_URI must start with mongodb:// or mongodb+srv://');
  }

  const jwt = get('JWT_SECRET');
  if (!jwt) {
    problems.push('JWT_SECRET is missing.');
  } else if (jwt.length < 32) {
    problems.push('JWT_SECRET is too short (it needs at least 32 characters).');
  } else if (looksLikePlaceholder(jwt)) {
    problems.push('JWT_SECRET is still a placeholder. Generate a real random one.');
  }

  const key = get('GEMINI_API_KEY');
  if (!key) {
    problems.push('GEMINI_API_KEY is missing.');
  } else if (looksLikePlaceholder(key)) {
    problems.push('GEMINI_API_KEY is still a placeholder.');
  }

  if (!get('GEMINI_MODEL')) problems.push('GEMINI_MODEL is missing.');
  if (!get('GEMINI_EMBED_MODEL')) problems.push('GEMINI_EMBED_MODEL is missing.');

  const port = get('PORT');
  if (port) {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      problems.push('PORT must be a whole number from 1 to 65535.');
    }
  }

  return problems;
}