import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';
import productRoutes from '../routes/productRoutes.js';
import Product from '../models/Product.js';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/products', productRoutes);
  // Error handler for async route errors to return JSON consistently in tests
  app.use((err, req, res, next) => {
    const status = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
    res.status(status).json({ message: err.message });
  });
  return app;
};

describe('Product routes', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('GET /api/products returns available products', async () => {
    const fakeProducts = [
      { _id: '1', name: 'Item A', available: true },
      { _id: '2', name: 'Item B', available: true },
    ];
    jest.spyOn(Product, 'find').mockResolvedValue(fakeProducts);

    const app = buildApp();
    const res = await request(app)
      .get('/api/products')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(res.body).toEqual(fakeProducts);
    expect(Product.find).toHaveBeenCalledWith({ available: true });
  });

  test('GET /api/products/:id returns a single product when found', async () => {
    const product = { _id: '123', name: 'Phone' };
    jest.spyOn(Product, 'findById').mockResolvedValue(product);

    const app = buildApp();
    const res = await request(app)
      .get('/api/products/123')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(res.body).toEqual(product);
    expect(Product.findById).toHaveBeenCalledWith('123');
  });

  test('GET /api/products/:id returns 404 JSON when not found', async () => {
    jest.spyOn(Product, 'findById').mockResolvedValue(null);

    const app = buildApp();
    const res = await request(app)
      .get('/api/products/not-found')
      .expect('Content-Type', /json/)
      .expect(404);

    expect(res.body).toEqual({ message: 'Product not found' });
  });
});
