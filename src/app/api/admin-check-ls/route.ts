import { NextRequest, NextResponse } from 'next/server';
const ADMIN_TOKEN = 'ef7b2a19-cc4d-4f8e-b3a1-9d2c0e5f8a3b';
export async function GET(req: NextRequest) {
  if (req.headers.get('x-admin-token') !== ADMIN_TOKEN) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const key = process.env.LEMON_SQUEEZY_API_KEY!;
  const res = await fetch('https://api.lemonsqueezy.com/v1/variants?page[size]=50', {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/vnd.api+json' },
  });
  const data = await res.json();
  const variants = (data.data || []).filter((v: any) => ['1704407','1704429','1704432'].includes(v.id)).map((v: any) => ({
    id: v.id, name: v.attributes.name, price: v.attributes.price, status: v.attributes.status,
  }));
  return NextResponse.json({ variants });
}
