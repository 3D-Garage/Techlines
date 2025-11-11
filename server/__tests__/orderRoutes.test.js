import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';

// Mock protected route middleware to pass through
await jest.unstable_mockModule('../middleware/autMiddleware.js', () => ({
  default: (req, res, next) => next(),
}));

let saveMock;
// Mock Order model as a constructor returning object with save
await jest.unstable_mockModule('../models/Order.js', () => ({
  default: jest.fn().mockImplementation((data) => ({
    ...data,
    _id: 'o1',
    save: saveMock,
  })),
}));

const orderRoutes = (await import('../routes/orderRoutes.js')).default;
const Order = (await import('../models/Order.js')).default;

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', orderRoutes);
  app.use((err, req, res, next) => {
    const status = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
    res.status(status).json({ message: err.message });
  });
  return app;
};

describe('Order routes', () => {
  beforeEach(() => {
    saveMock = jest.fn().mockResolvedValue({ _id: 'o1' });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('POST /api/orders validates empty orderItems', async () => {
    const res = await request(buildApp())
      .post('/api/orders')
      .send({ orderItems: [] })
      .expect(400);

    expect(res.body).toEqual({ message: 'No order items.' });
  });

  test('POST /api/orders creates order and returns 201', async () => {
    const payload = {
      orderItems: [{ name: 'A', qty: 1, image: 'img', price: 10, product_id: 'p1' }],
      shippingAddress: { adress: 'a', city: 'c', postalCode: 'p', country: 'co' },
      paymentMethod: 'card',
      shippingPrice: 0,
      totalPrice: 10,
      paymentDetails: { orderId: 'pid', payerId: 'payer' },
      userInfo: { _id: 'u1', name: 'Alice', email: 'a@a.com' },
    };

    const res = await request(buildApp()).post('/api/orders').send(payload).expect(201);

    expect(Order).toHaveBeenCalled();
    expect(saveMock).toHaveBeenCalled();
    expect(res.body).toEqual({ _id: 'o1' });
  });
});

