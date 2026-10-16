import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { json, err } from '@/lib/api';
import { getDb, rawDb } from '@/lib/db';
import { instances } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { enqueue } from '@/lib/core/jobs';
import { now } from '@/lib/core/util';
import { decrypt } from '@/lib/core/crypto';
import { bandState } from '@/lib/core/netmeter';
import { logAudit } from '@/lib/services/audit';

type Ctx = { params: Promise<{ id: string }> };

async function load(id: string, userId: string, role: string) {
  const [inst] = await getDb().select().from(instances).where(eq(instances.id, id));
  if (!inst) return [null, err('not found', 404)] as const;
  if (inst.userId !== userId && role !== 'admin') return [null, err('forbidden', 403)] as const;
  return [inst, null] as const;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return err('unauthorized', 401);
  const { id } = await ctx.params;
  const [inst, e] = await load(id, user.id, user.role);
  if (e) return e;
  const jobs = rawDb().prepare(`select * from jobs where instance_id=? order by created_at desc limit 10`).all(id);
  return json({
    ...inst,
    rootPassEnc: undefined,
    vnc_pass: undefined,
    rootPassword: inst.rootPassEnc ? decrypt(inst.rootPassEnc) : null, // owner/admin session only
    bw: bandState(inst.id, inst.bandwidthGb ?? 0),
    jobs,
  });
}

/** lifecycle actions: start | stop | delete */
export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return err('unauthorized', 401);
  const { id } = await ctx.params;
  const [inst, e] = await load(id, user.id, user.role);
  if (e) return e;
  const body = (await req.json().catch(() => ({}))) as { action?: string; force?: boolean };
  const action = body.action;
  if (action !== 'start' && action !== 'stop' && action !== 'delete') return err('unknown action');
  const status = inst.status;
  if (status === 'provisioning') return err('instance still provisioning', 409);
  const needsRunning = action === 'start' ? ['stopped', 'suspended', 'error'] : ['running', 'suspended', 'error'];
  if (action === 'start' && !needsRunning.includes(status)) return err(`cannot start from ${status}`, 409);
  if (action !== 'start' && !needsRunning.includes(status)) {
    if (action === 'delete' && ['stopped', 'suspended', 'error'].includes(status)) {
      // delete from stopped state is legitimate
    } else {
      return err(`cannot ${action} a ${status} instance`, 409);
    }
  }
  const active = rawDb().prepare(
    `select 1 from jobs where instance_id=? and status in ('queued','running')`,
  ).get(id);
  if (active) return err('a job is already in flight for this instance', 409);

  await logAudit({ actorId: user.id, actorName: user.name, action: `instance.${action}`, target: id });
  if (action === 'delete') {
    await enqueue({ type: 'instance.delete', instanceId: id, userId: inst.userId });
    return json({ ok: true, action, note: 'deleting: settle, destroy, cleanup' });
  }
  await enqueue({
    type: action === 'start' ? 'instance.start' : 'instance.stop',
    instanceId: id,
    userId: inst.userId,
    payload: { force: Boolean(body.force) },
  });
  return json({ ok: true, action });
}

export const dynamic = 'force-dynamic';
