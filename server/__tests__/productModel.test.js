import Product from '../models/Product.js';

describe('Product model validation', () => {
  test('applies defaults and validates with required fields present', () => {
    const doc = new Product({
      name: 'Item',
      image: '/img.png',
      brand: 'Brand',
      category: 'Category',
      description: 'Description',
      numberOfReviews: 0,
      // price, stock, rating, available, productIsNew have defaults
    });

    const err = doc.validateSync();
    expect(err).toBeUndefined();

    expect(doc.rating).toBe(0);
    expect(doc.price).toBe(0);
    expect(doc.stock).toBe(0);
    expect(doc.productIsNew).toBe(false);
    expect(doc.available).toBe(true);
  });

  test('fails validation when required fields are missing', () => {
    const doc = new Product({});
    const err = doc.validateSync();

    expect(err).toBeDefined();
    const missing = Object.keys(err.errors);

    expect(missing).toEqual(
      expect.arrayContaining(['name', 'image', 'brand', 'category', 'description', 'numberOfReviews'])
    );
  });
});

