const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MAX_EMAIL_LENGTH = 254;
export const MAX_PASSWORD_LENGTH = 72; // bcrypt only uses the first 72 bytes

// Checks the shape of a login or register request.
// Returns { email, password } (cleaned), or { error } with a message for the user.
export function readCredentials(body) {
  const { email, password } = body ?? {};

  // Must be plain text (this also rejects objects like {"$ne": null})
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return { error: 'Email and password are required' };
  }

  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(cleanEmail)) {
    return { error: 'Please enter a valid email address' };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { error: `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer` };
  }
  return { email: cleanEmail, password };
}