import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';

describe('User model', () => {
  test('validates required fields', () => {
    const user = new User({ name: 'A', email: 'a@a.com', password: 'x' });
    const err = user.validateSync();
    expect(err).toBeUndefined();
  });

  test('matchPasswords delegates to bcrypt.compare', async () => {
    const compareSpy = jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const user = new User({ name: 'A', email: 'a@a.com', password: 'hashed' });
    const ok = await user.matchPasswords('plain');
    expect(ok).toBe(true);
    expect(compareSpy).toHaveBeenCalledWith('plain', 'hashed');
  });
});

