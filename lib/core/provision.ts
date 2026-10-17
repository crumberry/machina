import { getDb, rawDb } from '@/lib/db';
import { instances, plans, images, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { enqueue } from '@/lib/core/jobs';
import { newInstanceId, now } from '@/lib/core/util';
import { encrypt, randToken, randPassword } from '@/lib/core/crypto';
import { config } from '@/lib/config';
import { macFromId, IpAllocator } from '@/lib/core/driver';
import { logAudit } from '@/lib/services/audit';

export type ProvisionArgs = {
  userId: string;
  name: string;
  planId: string;
  imageId?: string;
  actorName?: string;
  actorRole?: string;
};

/** Shared provisioning entry point used by direct (admin) create and by
 *  request approval. Validates plan/image, budget, caps, uniqueness, IP
 *  allocation, inserts the instance row and enqueues the create job. */
export async function provisionInstance(a: ProvisionArgs): Promise<{ id: string; name: string; ip: string }> {
  const db = getDb();
  const [plan] = await db.select().from(plans).where(and(eq(plans.id, a.planId), eq(plans.active, 1)));
  if (!plan) throw new Error('plan invalid');

  const [dbUser] = await db.select().from(users).where(eq(users.id, a.userId));
  if (!dbUser) throw new Error('no user');

  let imageId = a.imageId ?? '';
  if (!dbUser.imagePickable && dbUser.assignedImageId) imageId = dbUser.assignedImageId;
  const [image] = await db.select().from(images).where(eq(images.id, imageId));
  if (!image || image.status !== 'ready') throw new Error('image not ready');

  if (dbUser.balanceCents < plan.hourlyRateCents) throw new Error('insufficient balance for 1h at plan rate');

  const rd = rawDb();
  const runningTotal = (rd.prepare(`select count(*) c from instances where status='running'`).get() as { c: number }).c;
  if (runningTotal >= config.limits.maxRunningTotal) throw new Error('host at capacity; try later');
  if (a.actorRole !== 'admin') {
    const mine = (rd.prepare(`select count(*) c from instances where user_id=? and status='running'`).get(a.userId) as { c: number }).c;
    if (mine >= config.limits.maxRunningPerUser) throw new Error(`running instance cap (${config.limits.maxRunningPerUser}) reached`);
  }
  const dupe = rd.prepare(`select 1 from instances where user_id=? and name=?`).get(a.userId, a.name);
  if (dupe) throw new Error('name already used');

  const taken = (rd.prepare(`select ip from instances where ip is not null`).all() as { ip: string }[]).map((r) => r.ip);
  const ip = new IpAllocator(taken).next();
  if (!ip) throw new Error('no free IP in range');

  const id = newInstanceId();
  const rootPassword = randPassword();
  const vncPass = randToken(4).slice(0, 8).replace(/[^a-zA-Z0-9]/g, 'x');
  await db.insert(instances).values({
    id,
    domainName: `${config.domainPrefix}${id.slice(3, 16)}`,
    userId: a.userId,
    planId: plan.id,
    imageId: image.id,
    name: a.name,
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
  await logAudit({ actorId: a.userId, actorName: a.actorName ?? a.userId, action: 'instance.create',
    target: id, detail: { name: a.name, planId: plan.id, imageId: image.id } });

  await enqueue({ type: 'instance.create', instanceId: id, userId: a.userId,
    payload: { planSnapshot: { vcpu: plan.vcpu, ramMb: plan.ramMb, diskGb: plan.diskGb } } });
  return { id, name: a.name, ip };
}