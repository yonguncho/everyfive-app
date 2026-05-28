import { test, expect } from '@playwright/test';

test.describe('v1.5: /api/word-image API 검증', () => {
  test('/api/word-image?word=apple → 200 + JSON with image_url field', async ({ request }) => {
    const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
    const res = await request.get(`${baseUrl}/api/word-image?word=apple`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('image_url');
    // image_url은 string 또는 null
    expect(typeof body.image_url === 'string' || body.image_url === null).toBe(true);
  });

  test('/api/word-image without word param → 400', async ({ request }) => {
    const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
    const res = await request.get(`${baseUrl}/api/word-image`);
    expect(res.status()).toBe(400);
  });

  test('/api/word-image with special chars → 400', async ({ request }) => {
    const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
    const res = await request.get(`${baseUrl}/api/word-image?word=${encodeURIComponent('<script>')}`);
    expect(res.status()).toBe(400);
  });
});
