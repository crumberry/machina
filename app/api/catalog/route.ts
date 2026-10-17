import { requireUser } from '@/lib/auth';
import { json, err } from '@/lib/api';
import { getDb } from '@/lib/db';
import { plans, images, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/** Session-visible catalog: active plans + images with sync status. */
export async function GET() {
  const user = await requireUser();
  if (!user) return err('unauthorized', 401);
  const db = getDb();
  const [u] = await db.select({ imagePickable: users.imagePickable, assignedImageId: users.assignedImageId }).from(users).where(eq(users.id, user.id));
  return json({
    plans: await db.select().from(plans).where(eq(plans.active, 1)),
    images: await db.select({ id: images.id, name: images.name, status: images.status }).from(images),
    imagePickable: u?.imagePickable ?? 1,
    assignedImageId: u?.assignedImageId ?? null,
  });
}
