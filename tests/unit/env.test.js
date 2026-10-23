import { describe, it, expect } from 'vitest';
import { findEnvProblems } from '../../src/config/env.js';

const good = () => ({
   MONGO_URI: 'mongodb+srv://host.invalid/docuchat',
  JWT_SECRET: 'a'.repeat(32),
  GEMINI_API_KEY: 'AIzaSyExampleKeyForTestsOnly',
  GEMINI_MODEL: 'gemini-test-model',
  GEMINI_EMBED_MODEL: 'gemini-test-embed',
  PORT: '4000',
});

const withValue = (name, value) => ({ ...good(), [name]: value });
const without = (name) => {
  const env = good();
  delete env[name];
  return env;
};
const mentions = (problems, text) => problems.some((p) => p.includes(text));

describe('findEnvProblems', () => {
  it('finds no problems in good settings', () => {
    expect(findEnvProblems(good())).toEqual([]);
  });

  it('works without a PORT (it is optional)', () => {
    expect(findEnvProblems(without('PORT'))).toEqual([]);
    expect(findEnvProblems(withValue('PORT', ''))).toEqual([]);
  });

  it('flags a missing or blank required setting, naming it', () => {
    for (const name of ['MONGO_URI', 'JWT_SECRET', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_EMBED_MODEL']) {
      expect(mentions(findEnvProblems(without(name)), name)).toBe(true);
      expect(mentions(findEnvProblems(withValue(name, '   ')), name)).toBe(true);
    }
  });

  it('checks the database address starts correctly', () => {
    expect(findEnvProblems(withValue('MONGO_URI', 'mongodb://localhost:27017/docuchat'))).toEqual([]);
    expect(mentions(findEnvProblems(withValue('MONGO_URI', 'http://example.com')), 'MONGO_URI')).toBe(true);
  });

  it('rejects a short JWT secret', () => {
    expect(mentions(findEnvProblems(withValue('JWT_SECRET', 'a'.repeat(31))), 'too short')).toBe(true);
    expect(findEnvProblems(withValue('JWT_SECRET', 'a'.repeat(32)))).toEqual([]);
  });

  it('rejects placeholder secrets and keys', () => {
    const placeholderSecret = 'put-a-long-random-text-here-at-least-32-characters';
    expect(mentions(findEnvProblems(withValue('JWT_SECRET', placeholderSecret)), 'placeholder')).toBe(true);
    expect(mentions(findEnvProblems(withValue('JWT_SECRET', 'change-me-' + 'x'.repeat(30))), 'placeholder')).toBe(true);
    expect(mentions(findEnvProblems(withValue('GEMINI_API_KEY', 'your-gemini-key')), 'placeholder')).toBe(true);
  });

  it('validates the port when one is given', () => {
    for (const port of ['abc', '0', '70000', '3.5', '-1']) {
      expect(mentions(findEnvProblems(withValue('PORT', port)), 'PORT')).toBe(true);
    }
    for (const port of ['1', '4000', '65535']) {
      expect(findEnvProblems(withValue('PORT', port))).toEqual([]);
    }
  });

  it('reports every problem at once', () => {
    expect(findEnvProblems({}).length).toBeGreaterThanOrEqual(5);
  });

  it('never puts a setting\'s value into a message', () => {
    const secret = 'short-secret-value-xyz';
    const key = 'your-key-value-abc';
    const messages = findEnvProblems({ ...good(), JWT_SECRET: secret, GEMINI_API_KEY: key }).join(' ');
    expect(messages).not.toContain(secret);
    expect(messages).not.toContain(key);
  });
});