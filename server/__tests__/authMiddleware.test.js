import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';
import protectRoute from '../middleware/autMiddleware.js';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const buildAppWithProtected = () => {
  const app = express();
  app.get('/protected', protectRoute, (req, res) => res.json({ ok: true }));
  app.use((err, req, res, next) => {
    const status = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
    res.status(status).json({ message: err.message });
  });
  return app;
};

describe('auth middleware', () => {
  afterEach(() => jest.restoreAllMocks());

  test('passes with valid bearer token', async () => {
    jest.spyOn(jwt, 'verify').mockReturnValue({ id: 'u1' });
    jest.spyOn(User, 'findById').mockResolvedValue({ _id: 'u1' });

    await request(buildAppWithProtected())
      .get('/protected')
      .set('Authorization', 'Bearer token')
      .expect(200, { ok: true });
  });

  test('fails with invalid token', async () => {
    jest.spyOn(jwt, 'verify').mockImplementation(() => { throw new Error('bad'); });

    const res = await request(buildAppWithProtected())
      .get('/protected')
      .set('Authorization', 'Bearer token')
      .expect(401);

    expect(res.body).toEqual({ message: 'Not authorized, token failed.' });
  });

  test('fails with no token', async () => {
    const res = await request(buildAppWithProtected())
      .get('/protected')
      .expect(401);

    expect(res.body).toEqual({ message: 'No authorized,no token.' });
  });
});

