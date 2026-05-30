import { NextRequest, NextResponse } from 'next/server';

const LS_API = 'https://api.lemonsqueezy.com/v1';
const ADMIN_TOKEN = 'ef7b2a19-cc4d-4f8e-b3a1-9d2c0e5f8a3b'; // 임시, 배포 후 삭제

export async function GET(req: NextRequest) {
  if (req.headers.get('x-admin-token') !== ADMIN_TOKEN) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const key = process.env.LEMON_SQUEEZY_API_KEY!;
  const headers = { Authorization: `Bearer ${key}`, Accept: 'application/vnd.api+json' };

  const res = await fetch(`${LS_API}/variants?page[size]=50`, { headers });
  const data = await res.json();
  const variants = (data.data || []).map((v: any) => ({
    id: v.id,
    name: v.attributes.name,
    price: v.attributes.price,
    status: v.attributes.status,
  }));
  return NextResponse.json({ variants, v10: process.env.LEMON_SQUEEZY_VARIANT_PRO_10, v20: process.env.LEMON_SQUEEZY_VARIANT_PRO_20, v30: process.env.LEMON_SQUEEZY_VARIANT_PRO_30 });
}

export async function POST(req: NextRequest) {
  if (req.headers.get('x-admin-token') !== ADMIN_TOKEN) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const key = process.env.LEMON_SQUEEZY_API_KEY!;
  const headers = {
    Authorization: `Bearer ${key}`,
    Accept: 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
  };
  const { updates } = await req.json(); // [{ id, price_in_cents, name }]
  const results = [];
  for (const u of updates) {
    const r = await fetch(`${LS_API}/variants/${u.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ data: { type: 'variants', id: String(u.id), attributes: { price: u.price_in_cents, name: u.name } } }),
    });
    results.push({ id: u.id, status: r.status, body: await r.json() });
  }
  return NextResponse.json({ results });
}
