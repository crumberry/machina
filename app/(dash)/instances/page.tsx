'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ThinkingOrb } from 'thinking-orbs';
import { BorderBeam } from 'border-beam';
import { useToast } from '@/app/ui/toast';
import { copyText } from '@/app/ui/clipboard';
import { loadStart, loadEnd } from '@/app/ui/loadbar';

type Inst = {
  id: string; name: string; status: string; imageId: string; planId: string;
  ip: string; createdAt: number; activeJob: { type: string; status: string } | null;
  autoSuspended: number; rateHourlyCents: number;
};
type Plan = { id: string; name: string; vcpu: number; ramMb: number; diskGb: number; hourlyRateCents: number };
type Img = { id: string; name: string; status: string };

export default function InstancesPage() {
  const toast = useToast();
  const [insts, setInsts] = useState<Inst[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [imgs, setImgs] = useState<Img[]>([]);
  const [name, setName] = useState('');
  const [planId, setPlanId] = useState('');
  const [imageId, setImageId] = useState('');
  const [busy, setBusy] = useState(false);

  const [imgPickable, setImgPickable] = useState(true);
  const [assignedImage, setAssignedImage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/instances', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      setInsts(j);
      if (j[0]?.planId) void 0;
    }
    const a = await fetch('/api/catalog', { cache: 'no-store' });
    if (a.ok) {
      const j = await a.json();
      setPlans((o) => (o.length ? o : j.plans));
      setImgs(j.images);
      setImgPickable(!!j.imagePickable);
      setAssignedImage(j.assignedImageId ?? null);
      setPlanId((o) => o || (j.plans[0]?.id ?? ''));
      setImageId((o) => o || (j.images.find((x: Img) => x.status === 'ready')?.id ?? ''));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    loadStart();
    const r = await fetch('/api/instances', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, planId, imageId }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      toast.ok(`provisioning ${j.name} (${j.id.slice(0, 8)}…) — boots in ~60s`);
      setName('');
      void load();
    } else {
      toast.err(j.error ?? 'create failed');
    }
    loadEnd();
    setBusy(false);
  }

  async function act(id: string, action: string) {
    setBusy(true);
    loadStart();
    const r = await fetch(`/api/instances/${id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) toast.info(`${action} queued — watch the status badge`);
    else toast.err(j.error ?? `${action} failed`);
    loadEnd();
    setBusy(false);
    void load();
  }

  return (
    <>
      <h1>instances</h1>
      <div className="sub">libvirt VMs on the host; billed hourly from your balance</div>

      <BorderBeam size="line" colorVariant="ice" active={busy} strength={0.9} theme="dark">
        <div className="card">
          <h3>new instance</h3>
          <form onSubmit={create}>
            <div className="row">
              <div style={{ flex: 1, minWidth: 180 }}>
                <label htmlFor="n">name (lowercase, dash)</label>
                <input id="n" value={name} onChange={(e) => setName(e.target.value)} placeholder="dev-box"
                  pattern="[a-z0-9-]+" title="lowercase letters, digits, dashes" />
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label htmlFor="p">plan</label>
                <select id="p" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}: {p.vcpu}cpu/{p.ramMb / 1024}GB/{p.diskGb}GB — {(p.hourlyRateCents / 100).toFixed(2)}/h
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label htmlFor="i">image</label>
                {imgPickable ? (
                  <select id="i" value={imageId} onChange={(e) => setImageId(e.target.value)}>
                    {imgs.map((x) => (
                      <option key={x.id} value={x.id} disabled={x.status !== 'ready'}>
                        {x.name} ({x.status})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="muted" style={{ padding: '6px 0' }}>
                    assigned: {imgs.find((x) => x.id === assignedImage)?.name ?? assignedImage ?? 'none'}
                  </div>
                )}
              </div>
              <div>
                <button className="primary" type="submit" disabled={busy || !name || !planId || !imageId}>
                  {busy ? (
                    <span className="busybtn">
                      <ThinkingOrb state="composing" size={20} theme="dark" aria-label="creating" />
                      creating…
                    </span>
                  ) : 'create'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </BorderBeam>

      <div className="card">
        <h3>mine</h3>
        <table>
          <thead>
            <tr><th>name</th><th>status</th><th>ip</th><th>plan</th><th>rate</th><th style={{ width: 260 }}>actions</th></tr>
          </thead>
          <tbody>
            {insts.map((i) => (
              <tr key={i.id}>
                <td><Link href={`/instances/${i.id}`} style={{ color: 'var(--accent)' }}>{i.name}</Link></td>
                <td>
                  <span className={`badge ${i.status}`}>{i.status}</span>
                  {i.activeJob ? (
                    <span className="badge queued">
                      <ThinkingOrb state="working" size={20} theme="dark" aria-label="working" />
                      {i.activeJob.type.replace('instance.', '')}…
                    </span>
                  ) : null}
                  {i.autoSuspended ? <span className="badge suspended" title="auto-suspended: balance empty">auto</span> : null}
                </td>
                <td>
                  {i.ip
                    ? <span
                        data-copy
                        title={`${i.ip} — click to copy`}
                        className="mono"
                        onClick={() => void copyText(i.ip, toast.ok)}
                      >{i.ip}</span>
                    : <span className="copy">—</span>}
                </td>
                <td>{plans.find((p) => p.id === i.planId)?.name ?? i.planId}</td>
                <td className="mono">{(i.rateHourlyCents / 100).toFixed(2)}/h</td>
                <td>
                  <div className="soundboard">
                    <Link href={`/instances/${i.id}`}>open</Link>
                    {i.status === 'stopped' || i.status === 'suspended'
                      ? <button disabled={busy} onClick={() => act(i.id, 'start')}>start</button> : null}
                    {i.status === 'running'
                      ? <button disabled={busy} onClick={() => act(i.id, 'stop')}>stop</button> : null}
                    {i.status !== 'provisioning'
                      ? <button className="danger" disabled={busy} onClick={() => act(i.id, 'delete')}>delete</button> : null}
                  </div>
                </td>
              </tr>
            ))}
            {insts.length === 0 && <tr><td colSpan={6} className="empty">no instances yet — create your first above</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
