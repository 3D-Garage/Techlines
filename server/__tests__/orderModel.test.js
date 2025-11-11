import Order from '../models/Order.js';

describe('Order model', () => {
  test('validates required fields with shipping structure', () => {
    const order = new Order({
      user: '507f1f77bcf86cd799439011',
      username: 'Alice',
      email: 'a@a.com',
      orderItems: [{ name: 'A', qty: 1, image: 'img', price: 10, product_id: '507f1f77bcf86cd799439012' }],
      // Schema key is spelled schippingAddress
      schippingAddress: { adress: 'a', city: 'c', postalCode: 'p', country: 'co' },
    });
    const err = order.validateSync();
    expect(err).toBeUndefined();
  });

  test('fails validation when missing required fields', () => {
    const order = new Order({});
    const err = order.validateSync();
    expect(err).toBeDefined();
  });
});

