import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';

// Mock protected route middleware to pass through
await jest.unstable_mockModule('../Middleware/autMiddleware.js', () => ({
  default: (req, res, next) => next(),
}));

// Mock jsonwebtoken.sign to return a stable token
await jest.unstable_mockModule('jsonwebtoken', () => ({
  default: { sign: jest.fn(() => 'token') },
}));

// Mock User model methods
const userModelMock = {
  findOne: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
};
await jest.unstable_mockModule('../models/User.js', () => ({
  default: userModelMock,
}));

const userRoutes = (await import('../routes/userRoutes.js')).default;
const User = (await import('../models/User.js')).default;

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/users', userRoutes);
  app.use((err, req, res, next) => {
    const status = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
    res.status(status).json({ message: err.message });
  });
  return app;
};

describe('User routes', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('POST /api/users/login succeeds with valid credentials', async () => {
    const fakeUser = { _id: 'u1', name: 'Alice', email: 'a@a.com', isAdmin: false, createdAt: 'now', matchPasswords: jest.fn().mockResolvedValue(true) };
    User.findOne.mockResolvedValue(fakeUser);

    const res = await request(buildApp())
      .post('/api/users/login')
      .send({ email: 'a@a.com', password: 'pw' })
      .expect(200);

    expect(User.findOne).toHaveBeenCalledWith({ email: 'a@a.com' });
    expect(fakeUser.matchPasswords).toHaveBeenCalledWith('pw');
    expect(res.body).toMatchObject({ _id: 'u1', name: 'Alice', email: 'a@a.com', isAdmin: false, token: 'token' });
  });

  test('POST /api/users/login fails with invalid credentials', async () => {
    const fakeUser = { matchPasswords: jest.fn().mockResolvedValue(false) };
    User.findOne.mockResolvedValue(fakeUser);

    const res = await request(buildApp())
      .post('/api/users/login')
      .send({ email: 'a@a.com', password: 'bad' })
      .expect(401);

    expect(res.body).toEqual({ message: 'Invalid email or password' });
  });

  test('POST /api/users/register creates a new user', async () => {
    User.findOne.mockResolvedValue(null);
    const created = { _id: 'u2', name: 'Bob', email: 'b@b.com', isAdmin: false };
    User.create.mockResolvedValue(created);

    const res = await request(buildApp())
      .post('/api/users/register')
      .send({ name: 'Bob', email: 'b@b.com', password: 'pw' })
      .expect(201);

    expect(User.create).toHaveBeenCalledWith({ name: 'Bob', email: 'b@b.com', password: 'pw' });
    expect(res.body).toMatchObject({ _id: 'u2', name: 'Bob', email: 'b@b.com', isAdmin: false, token: 'token' });
  });

  test('POST /api/users/register handles invalid user creation', async () => {
    User.findOne.mockResolvedValue(null);
    User.create.mockResolvedValue(null);

    const res = await request(buildApp())
      .post('/api/users/register')
      .send({ name: 'X', email: 'x@x.com', password: 'pw' })
      .expect(500);

    expect(res.body).toEqual({ message: 'Invalid user data.' });
  });

  test('POST /api/users/register rejects duplicate email', async () => {
    User.findOne.mockResolvedValue({ _id: 'exists' });

    const res = await request(buildApp())
      .post('/api/users/register')
      .send({ name: 'Bob', email: 'b@b.com', password: 'pw' })
      .expect(400);

    expect(res.body).toEqual({ message: 'we already have an account with that email adress.' });
  });

  test('PUT /api/users/profile/:id updates profile', async () => {
    const userDoc = { _id: 'u1', name: 'Old', email: 'old@a.com', isAdmin: false, save: jest.fn().mockResolvedValue({ _id: 'u1', name: 'New', email: 'new@a.com', isAdmin: false, createdAt: 'now' }) };
    User.findById.mockResolvedValue(userDoc);

    const res = await request(buildApp())
      .put('/api/users/profile/u1')
      .send({ name: 'New', email: 'new@a.com' })
      .expect(200);

    expect(User.findById).toHaveBeenCalledWith('u1');
    expect(userDoc.save).toHaveBeenCalled();
    expect(res.body).toMatchObject({ _id: 'u1', name: 'New', email: 'new@a.com', isAdmin: false, token: 'token' });
  });

  test('PUT /api/users/profile/:id updates password when provided', async () => {
    const userDoc = { _id: 'u1', name: 'Old', email: 'old@a.com', isAdmin: false, save: jest.fn().mockResolvedValue({ _id: 'u1', name: 'Old', email: 'old@a.com', isAdmin: false, createdAt: 'now' }) };
    User.findById.mockResolvedValue(userDoc);

    await request(buildApp())
      .put('/api/users/profile/u1')
      .send({ password: 'newpw' })
      .expect(200);

    expect(userDoc.password).toBe('newpw');
    expect(userDoc.save).toHaveBeenCalled();
  });

  test('PUT /api/users/profile/:id returns 404 when not found', async () => {
    User.findById.mockResolvedValue(null);

    const res = await request(buildApp())
      .put('/api/users/profile/u1')
      .send({ name: 'New' })
      .expect(404);

    expect(res.body).toEqual({ message: 'User not found.' });
  });
});
