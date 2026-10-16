import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api';
import { json, err } from '@/lib/api';
import { rawDb, getDb } from '@/lib/db';
import { users, plans, images, audit } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { grantCents } from '@/lib/core/metering';
import { newId, hashPassword } from '@/lib/core/crypto';
import { now } from '@/lib/core/util';
import { enqueue } from '@/lib/core/jobs';
import { logAudit } from '@/lib/services/audit';
import { syncState } from '@/lib/core/images';

export async function GET() {
  const g = await requireAdmin();
  if (!g[0]) return g[1];
  return json({
    users: await getDb().select({
      id: users.id, name: users.name, role: users.role,
      balanceCents: users.balanceCents, createdAt: users.createdAt,
    }).from(users).orderBy(desc(users.createdAt)),
    plans: await getDb().select().from(plans),
    images: await getDb().select().from(images),
    audit: await getDb().select().from(audit).orderBy(desc(audit.ts)).limit(50),
    syncing: [...syncState.keys()],
  });
}

export async function POST(req: NextRequest) {
  const g = await requireAdmin();
  if (!g[0]) return g[1];
  const admin = g[0];
  const body = (await req.json().catch(() => ({}))) as {
    op?: string; userId?: string; deltaCents?: number;
    name?: string; password?: string; role?: string;
    planId?: string; vcpu?: number; ramMb?: number; diskGb?: number; hourlyRateCents?: number; monthlyCapMin?: number; bandwidthGb?: number;
    imageId?: string;
  };
  switch (body.op) {
    case 'topup': {
      if (!body.userId || typeof body.deltaCents !== 'number' || !Number.isInteger(body.deltaCents)) {
        return err('userId and integer deltaCents required');
      }
      grantCents(body.userId, body.deltaCents, `admin top-up by ${admin.name}`);
      await logAudit({ actorId: admin.id, actorName: admin.name, action: 'admin.topup',
        target: body.userId, detail: { deltaCents: body.deltaCents } });
      return json({ ok: true });
    }
    case 'createUser': {
      const name = (body.name ?? '').trim();
      if (!/^[a-z0-9-]{3,32}$/.test(name)) return err('name: 3-32 chars of a-z 0-9 -');
      if (!body.password || body.password.length < 6) return err('password min 6 chars');
      if (rawDb().prepare(`select 1 from users where name=?`).get(name)) return err('name taken', 409);
      rawDb().prepare(`insert into users (id,name,role,password_hash,balance_cents,created_at) values (?,?,?,?,0,?)`)
        .run(newId('usr_'), name, body.role === 'admin' ? 'admin' : 'user', hashPassword(body.password), now());
      await logAudit({ actorId: admin.id, actorName: admin.name, action: 'admin.createUser', target: name });
      return json({ ok: true }, 201);
    }
    case 'setPlan': {
      if (!body.planId) return err('planId required');
      const p = await getDb().select().from(plans).where(eq(plans.id, body.planId));
      if (!p[0]) return err('plan not found', 404);
      await getDb().update(plans).set({
        vcpu: body.vcpu ?? p[0].vcpu,
        ramMb: body.ramMb ?? p[0].ramMb,
        diskGb: body.diskGb ?? p[0].diskGb,
        hourlyRateCents: body.hourlyRateCents ?? p[0].hourlyRateCents,
        monthlyCapMin: body.monthlyCapMin ?? p[0].monthlyCapMin,
        bandwidthGb: body.bandwidthGb ?? p[0].bandwidthGb,
      }).where(eq(plans.id, body.planId));
      await logAudit({ actorId: admin.id, actorName: admin.name, action: 'admin.setPlan', target: body.planId });
      return json({ ok: true });
    }
    case 'syncImage': {
      if (!body.imageId) return err('imageId required');
      await enqueue({ type: 'image.sync', payload: { imageId: body.imageId } });
      await logAudit({ actorId: admin.id, actorName: admin.name, action: 'admin.imageSync', target: body.imageId });
      return json({ ok: true, note: 'sync job queued' });
    }
    default:
      return err('unknown op');
  }
}
