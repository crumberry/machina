import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { json, err, guardMutation } from '@/lib/api';
import { getDb, rawDb } from '@/lib/db';
import { users, plans, images } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { now } from '@/lib/core/util';
import { newId } from '@/lib/core/crypto';
import { rateLimit } from '@/lib/core/crypto';
import { logAudit } from '@/lib/services/audit';

export async function GET() {
  const user = await requireUser();
  if (!user) return err('unauthorized', 401);
  const rd = rawDb();
  const rows = user.role === 'admin'
    ? rd.prepare(`select * from instance_requests order by created_at desc`).all()
    : rd.prepare(`select * from instance_requests where user_id=? order by created_at desc`).all(user.id);
  return json(rows);
}

export async function POST(req: NextRequest) {
  const g = guardMutation(req);
  if (g) return g;
  const user = await requireUser();
  if (!user) return err('unauthorized', 401);
  if (user.role === 'admin') return err('admins create directly via /api/instances', 400);
  if (!rateLimit(`req:${user.id}`, 5, 60 * 60_000)) return err('too many requests; slow down', 429);

  const body = (await req.json().catch(() => ({}))) as { name?: string; planId?: string; imageId?: string; note?: string };
  const name = (body.name ?? '').trim();
  if (!/^[a-z0-9-]{3,32}$/.test(name)) return err('name: 3-32 chars of a-z 0-9 -');
  const [plan] = await getDb().select().from(plans).where(eq(plans.id, body.planId ?? ''));
  if (!plan || !plan.active) return err('plan invalid', 400);

  // pending duplicate name check
  const rd = rawDb();
  const dupe = rd.prepare(`select 1 from instance_requests where user_id=? and name=? and status='pending'`).get(user.id, name);
  if (dupe) return err('a pending request with that name already exists', 409);

  const id = newId('req_');
  rawDb().prepare(`insert into instance_requests (id,user_id,name,plan_id,image_id,note,status,created_at) values (?,?,?,?,?,?,?,?)`).run(
    id, user.id, name, plan.id, body.imageId ?? null,
    (body.note ?? '').trim().slice(0, 280) || null, 'pending', now());
  await logAudit({ actorId: user.id, actorName: user.name, action: 'instance.request', target: id, detail: { name, planId: plan.id } });
  return json({ id, status: 'pending' }, 201);
}

export const dynamic = 'force-dynamic';
