'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ThinkingOrb } from 'thinking-orbs';
import { BorderBeam } from 'border-beam';
import { useToast } from '@/app/ui/toast';
import { copyText } from '@/app/ui/clipboard';
import { loadStart, loadEnd } from '@/app/ui/loadbar';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

type Inst = {
  id: string; name: string; status: string; imageId: string; planId: string;
  ip: string; createdAt: number; activeJob: { type: string; status: string } | null;
  autoSuspended: number; rateHourlyCents: number;
};
type Plan = { id: string; name: string; vcpu: number; ramMb: number; diskGb: number; hourlyRateCents: number };
type Img = { id: string; name: string; status: string };
type Sample = { ts: number; running: number; weight: number };

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
  const [role, setRole] = useState('user');
  const [spark, setSpark] = useState<Record<string, Sample[]>>({});
  const [reqOpen, setReqOpen] = useState(false);
  const [reqName, setReqName] = useState('');
  const [reqPlan, setReqPlan] = useState('');
  const [reqNote, setReqNote] = useState('');

  const load = useCallback(async () => {
    const r = await fetch('/api/instances', { cache: 'no-store' });
    if (r.ok) {
      const j: Inst[] = await r.json();
      setInsts(j);
      for (const i of j) {
        fetch(`/api/instances/${i.id}/usage`, { cache: 'no-store' })
          .then((x) => (x.ok ? x.json() : []))
          .then((s) => setSpark((p) => ({ ...p, [i.id]: s })))
          .catch(() => {});
      }
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
      setReqPlan((o) => o || (j.plans[0]?.id ?? ''));
    }
    const s = await fetch('/api/auth/session', { cache: 'no-store' });
    if (s.ok) {
      const j = await s.json();
      setRole(j?.user?.role ?? 'user');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setInterval(() => void load(), 5000); return () => clearInterval(t); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); loadStart();
    const r = await fetch('/api/instances', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, planId, imageId }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { toast.ok(`provisioning ${j.name} — boots in ~60s`); setName(''); void load(); }
    else toast.err(j.error ?? 'create failed');
    loadEnd(); setBusy(false);
  }

  async function requestInstance(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); loadStart();
    const r = await fetch('/api/requests', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: reqName, planId: reqPlan, note: reqNote }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { toast.ok('request submitted — admin will review'); setReqOpen(false); setReqName(''); setReqNote(''); }
    else toast.err(j.error ?? 'request failed');
    loadEnd(); setBusy(false);
  }

  async function act(id: string, action: string) {
    setBusy(true); loadStart();
    const r = await fetch(`/api/instances/${id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) toast.ok(`${action}: ${j.status ?? 'ok'}`);
    else toast.err(j.error ?? `${action} failed`);
    loadEnd(); setBusy(false); void load();
  }

  const planById = (id: string) => plans.find((p) => p.id === id);
  const isAdmin = role === 'admin';

  return (
    <>
      <h1>instances</h1>
      <div className="sub">{isAdmin ? 'provision and manage VMs' : 'your VMs · request new ones from the admin'}</div>

      {isAdmin && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3>new instance</h3>
          <form onSubmit={create}>
            <div className="row">
              <input placeholder="name (a-z0-9-)" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 160 }} />
              <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.vcpu}v / {p.ramMb}MB / ${((p.hourlyRateCents ?? 0) / 100).toFixed(2)}/h</option>)}
              </select>
              {imgPickable ? (
                <select value={imageId} onChange={(e) => setImageId(e.target.value)}>
                  {imgs.filter((i) => i.status === 'ready').map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              ) : (
                <span className="muted" style={{ fontSize: 12 }}>image: {assignedImage ?? 'admin-assigned'}</span>
              )}
              <button className="primary" type="submit" disabled={busy || !name}>create</button>
            </div>
          </form>
        </div>
      )}

      {!isAdmin && (
        <div style={{ marginBottom: 20 }}>
          <button className="primary" onClick={() => setReqOpen((v) => !v)}>{reqOpen ? 'cancel' : 'request instance'}</button>
          {reqOpen && (
            <div className="card" style={{ marginTop: 12 }}>
              <h3>request a VM</h3>
              <form onSubmit={requestInstance}>
                <div className="row">
                  <input placeholder="name" value={reqName} onChange={(e) => setReqName(e.target.value)} style={{ minWidth: 160 }} />
                  <select value={reqPlan} onChange={(e) => setReqPlan(e.target.value)}>
                    {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.vcpu}v / {p.ramMb}MB</option>)}
                  </select>
                </div>
                <div style={{ marginTop: 10 }}>
                  <textarea placeholder="why you need it (optional)" value={reqNote} onChange={(e) => setReqNote(e.target.value)}
                    rows={2} style={{ width: '100%', resize: 'vertical' }} />
                </div>
                <div style={{ marginTop: 10 }}>
                  <button className="primary" type="submit" disabled={busy || !reqName}>submit request</button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        {insts.map((i) => {
          const p = planById(i.planId);
          const samples = spark[i.id] ?? [];
          const data = samples.map((s) => ({ v: s.running ? Math.max(1, s.weight * 100) : 0 }));
          return (
            <div key={i.id} className="card" style={{ padding: 14, position: 'relative', overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <Link href={`/instances/${i.id}`} style={{ fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}>{i.name}</Link>
                <span className={`status-dot ${i.status === 'running' ? 'running' : i.status === 'stopped' ? 'stopped' : 'provisioning'}`} />
              </div>
              <div className="muted mono" style={{ fontSize: 11, marginBottom: 8 }}>{i.ip} · {p?.name}</div>
              <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>{p?.vcpu} vCPU · {p?.ramMb} MB RAM · {p?.diskGb} GB</div>
              <div style={{ height: 46, marginBottom: 10 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
                    <defs>
                      <linearGradient id={`g-${i.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="v" stroke="var(--accent)" strokeWidth={1.5} fill={`url(#g-${i.id})`} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Link href={`/instances/${i.id}`} className="primary" style={{ padding: '4px 10px', fontSize: 12, textDecoration: 'none' }}>open</Link>
                {i.status === 'running' && <button onClick={() => act(i.id, 'stop')} disabled={busy} style={{ padding: '4px 10px', fontSize: 12 }}>stop</button>}
                {i.status === 'stopped' && <button onClick={() => act(i.id, 'start')} disabled={busy} style={{ padding: '4px 10px', fontSize: 12 }}>start</button>}
                {isAdmin && <button onClick={() => { if (confirm(`delete ${i.name}?`)) act(i.id, 'delete'); }} disabled={busy} style={{ padding: '4px 10px', fontSize: 12, color: 'var(--danger, #f87171)' }}>delete</button>}
              </div>
            </div>
          );
        })}
        {insts.length === 0 && <div className="muted">no VMs yet</div>}
      </div>
    </>
  );
}
