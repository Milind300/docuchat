import { describe, it, expect } from 'vitest';
import { readCredentials, MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH } from '../../src/utils/credentials.js';

const REQUIRED = { error: 'Email and password are required' };
const BAD_EMAIL = { error: 'Please enter a valid email address' };

describe('readCredentials', () => {
  it('accepts a normal email and password', () => {
    expect(readCredentials({ email: 'me@example.com', password: 'Password123' })).toEqual({
      email: 'me@example.com',
      password: 'Password123',
    });
  });

  it('trims and lowercases the email, but leaves the password exactly as typed', () => {
    expect(readCredentials({ email: '  Me@Example.COM ', password: ' keep my spaces ' })).toEqual({
      email: 'me@example.com',
      password: ' keep my spaces ',
    });
  });

  it('asks for both fields when the body is missing or empty', () => {
    for (const body of [undefined, null, {}]) expect(readCredentials(body)).toEqual(REQUIRED);
  });

  it('asks for both fields when one is blank', () => {
    expect(readCredentials({ email: '', password: 'Password123' })).toEqual(REQUIRED);
    expect(readCredentials({ email: '   ', password: 'Password123' })).toEqual(REQUIRED);
    expect(readCredentials({ email: 'me@example.com', password: '' })).toEqual(REQUIRED);
    expect(readCredentials({ email: 'me@example.com' })).toEqual(REQUIRED);
  });

  it('rejects anything that is not plain text (database operator injection)', () => {
    expect(readCredentials({ email: { $ne: null }, password: 'x' })).toEqual(REQUIRED);
    expect(readCredentials({ email: 'me@example.com', password: { $gt: '' } })).toEqual(REQUIRED);
    expect(readCredentials({ email: ['me@example.com'], password: 'x' })).toEqual(REQUIRED);
    expect(readCredentials({ email: 123, password: 456 })).toEqual(REQUIRED);
  });

  it('rejects badly formed emails', () => {
    for (const email of ['not-an-email', 'a@b', 'a b@example.com', '@example.com', 'me@', 'me@@example.com']) {
      expect(readCredentials({ email, password: 'Password123' })).toEqual(BAD_EMAIL);
    }
  });

  it('allows an email up to the length limit and rejects one over it', () => {
    const domain = '@example.com';
    const longest = 'a'.repeat(MAX_EMAIL_LENGTH - domain.length) + domain;
    expect(readCredentials({ email: longest, password: 'Password123' }).email).toBe(longest);
    expect(readCredentials({ email: 'a' + longest, password: 'Password123' })).toEqual(BAD_EMAIL);
  });

  it('allows a password up to 72 characters and rejects one over it', () => {
    expect(readCredentials({ email: 'me@example.com', password: 'a'.repeat(MAX_PASSWORD_LENGTH) }).password).toHaveLength(72);
    expect(readCredentials({ email: 'me@example.com', password: 'a'.repeat(MAX_PASSWORD_LENGTH + 1) })).toEqual({
      error: 'Password must be 72 characters or fewer',
    });
  });
});