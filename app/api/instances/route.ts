import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { json, err } from '@/lib/api';
import { getDb, rawDb } from '@/lib/db';
import { instances, plans, images, users } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { enqueue } from '@/lib/core/jobs';
import { newInstanceId, now } from '@/lib/core/util';
import { encrypt, newId, randToken, randPassword } from '@/lib/core/crypto';
import { config } from '@/lib/config';
import { macFromId, IpAllocator } from '@/lib/core/driver';
import { logAudit } from '@/lib/services/audit';

export async function GET() {
  const user = await requireUser();
  if (!user) return err('unauthorized', 401);
  const db = getDb();
  const rows = user.role === 'admin'
    ? await db.select().from(instances).orderBy(desc(instances.createdAt))
    : await db.select().from(instances).where(eq(instances.userId, user.id)).orderBy(desc(instances.createdAt));
  const jobs = rawDb().prepare(`select instance_id, status, type from jobs
     where status in ('queued','running')`).all() as { instance_id: string; status: string; type: string }[];
  return json(rows.map((r) => ({
    ...r,
    rootPassEnc: undefined,
    vncPass: undefined,
    activeJob: jobs.find((j) => j.instance_id === r.id) ?? null,
  })));
}

/** Provision: validate + reserve (row, ip, plan copy) then enqueue create. */
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return err('unauthorized', 401);
  const body = (await req.json().catch(() => ({}))) as {
    name?: string; planId?: string; imageId?: string;
  };
  const name = (body.name ?? '').trim();
  if (!/^[a-z0-9-]{3,32}$/.test(name)) return err('name: 3-32 chars of a-z 0-9 -');

  const [plan] = await getDb().select().from(plans).where(and(eq(plans.id, body.planId ?? ''), eq(plans.active, 1)));
  if (!plan) return err('plan invalid', 400);
  const [image] = await getDb().select().from(images).where(eq(images.id, body.imageId ?? ''));
  if (!image || image.status !== 'ready') return err('image not ready', 400);

  const db = getDb();
  // budget guard: minimum 1 hour of runtime at plan rate
  const [u] = await db.select().from(users).where(eq(users.id, user.id));
  if (!u) return err('no user', 401);
  if (u.balanceCents < plan.hourlyRateCents) return err('insufficient balance for 1h at plan rate', 402);

  // global running cap
  const rd = rawDb();
  const runningTotal = (rd.prepare(`select count(*) c from instances where status='running'`).get() as { c: number }).c;
  if (runningTotal >= config.limits.maxRunningTotal) return err('host at capacity; try later', 503);
  if (user.role !== 'admin') {
    const mine = (rd.prepare(`select count(*) c from instances where user_id=? and status='running'`).get(user.id) as { c: number }).c;
    if (mine >= config.limits.maxRunningPerUser) return err(`running instance cap (${config.limits.maxRunningPerUser}) reached`, 402);
  }

  // unique (user_id, name)
  const dupe = rd.prepare(`select 1 from instances where user_id=? and name=?`).get(user.id, name);
  if (dupe) return err('name already used', 409);

  // ip allocation from the configured range
  const taken = (rd.prepare(`select ip from instances where ip is not null`).all() as { ip: string }[])
    .map((r) => r.ip);
  const ip = new IpAllocator(taken).next();
  if (!ip) return err('no free IP in range', 503);

  const id = newInstanceId();
  const rootPassword = randPassword();
  const vncPass = randToken(4).slice(0, 8).replace(/[^a-zA-Z0-9]/g, 'x'); // 8 chars hard cap (libvirt)
  await db.insert(instances).values({
    id,
    domainName: `${config.domainPrefix}${id.slice(3, 16)}`,
    userId: user.id,
    planId: plan.id,
    imageId: image.id,
    name,
    status: 'provisioning',
    mac: macFromId(id),
    ip,
    vncSocket: `${config.storageDir}/vnc/${id}.vnc`,
    vncPass,
    rootPassEnc: encrypt(rootPassword),
    rateHourlyCents: plan.hourlyRateCents,
    monthlyCapMin: plan.monthlyCapMin,
    bandwidthGb: plan.bandwidthGb ?? 0,
    createdAt: now(),
    updatedAt: now(),
  });
  await logAudit({ actorId: user.id, actorName: user.name, action: 'instance.create',
    target: id, detail: { name, planId: plan.id, imageId: image.id } });

  const jobId = await enqueue({ type: 'instance.create', instanceId: id, userId: user.id,
    payload: { planSnapshot: { vcpu: plan.vcpu, ramMb: plan.ramMb, diskGb: plan.diskGb } } });
  return json({ id, jobId, ip, name, status: 'provisioning' }, 201);
}

export const dynamic = 'force-dynamic';
