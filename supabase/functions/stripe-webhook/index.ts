/**
 * DEPRECATED — Stripe webhook handler
 * 결제 시스템이 Lemon Squeezy로 교체되었습니다.
 * 활성 핸들러: supabase/functions/ls-webhook/index.ts
 */
// @ts-ignore Deno imports
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

serve(() => new Response('Deprecated: use ls-webhook', { status: 410 }));
