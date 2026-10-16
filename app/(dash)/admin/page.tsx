'use client';

import { useCallback, useEffect, useState } from 'react';

type User = { id: string; name: string; role: string; balanceCents: number; createdAt: number };
type Plan = { id: string; name: string; vcpu: number; ramMb: number; diskGb: number; hourlyRateCents: number; monthlyCapMin: number; bandwidthGb: number };
type Img = { id: string; name: string; status: string; failure: string | null; sha256: string; sizeBytes: number; updatedAt: number };
type Aud = { id: string; ts: number; actorName: string | null; action: string; target: string | null; detail: string | null };

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [imgs, setImgs] = useState<Img[]>([]);
  const [aud, setAud] = useState<Aud[]>([]);
  const [msg, setMsg] = useState('');
  const [newName, setNewName] = useState('');
  const [newPass, setNewPass] = useState('');
  const [topupUser, setTopupUser] = useState('');
  const [topupAmt, setTopupAmt] = useState('25');

  const load = useCallback(async () => {
    const r = await fetch('/api/admin', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      setUsers(j.users); setPlans(j.plans); setImgs(j.images); setAud(j.audit);
      setTopupUser((u) => u || (j.users[0]?.id ?? ''));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const post = async (body: object) => {
    const r = await fetch('/api/admin', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? 'done' : j.error ?? 'failed');
    void load();
  };

  return (
    <>
      <h1>admin</h1>
      <div className="sub">{msg && <span className="muted">{msg} · </span>}users, credits, images, plans, audit trail</div>

      <div className="card">
        <h3>credits</h3>
        <div className="row">
          <select value={topupUser} onChange={(e) => setTopupUser(e.target.value)} style={{ maxWidth: 190 }}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} (${(u.balanceCents / 100).toFixed(2)})</option>)}
          </select>
          <input style={{ width: 110 }} className="mono" value={topupAmt} onChange={(e) => setTopupAmt(e.target.value)} />
          <button className="primary" onClick={() => post({ op: 'topup', userId: topupUser, deltaCents: Math.round(parseFloat(topupAmt) * 100) })}>top up $</button>
        </div>
        <table style={{ marginTop: 14 }}>
          <thead><tr><th>name</th><th>role</th><th>balance</th><th>since</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.role}</td>
                <td className="mono">${(u.balanceCents / 100).toFixed(2)}</td>
                <td>{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 14 }}>
          <input style={{ width: 160 }} placeholder="username" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input style={{ width: 160 }} placeholder="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
          <button onClick={() => post({ op: 'createUser', name: newName, password: newPass })}>create user</button>
        </div>
      </div>

      <div className="card">
        <h3>images</h3>
        <table>
          <thead><tr><th>id</th><th>status</th><th>size</th><th>sha</th><th>updated</th><th /></tr></thead>
          <tbody>
            {imgs.map((i) => (
              <tr key={i.id}>
                <td>{i.name}</td>
                <td><span className={`badge ${i.status}`}>{i.status}</span>{i.failure ? <div className="copy">{i.failure}</div> : null}</td>
                <td className="mono">{(i.sizeBytes / 1024 / 1024).toFixed(0)}MB</td>
                <td className="mono">{i.sha256 ? `${i.sha256.slice(0, 12)}…` : '—'}</td>
                <td>{i.updatedAt ? new Date(i.updatedAt).toLocaleString() : '—'}</td>
                <td><button onClick={() => post({ op: 'syncImage', imageId: i.id })}>sync</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>plans</h3>
        <table>
          <thead><tr><th>name</th><th>vcpu</th><th>ram</th><th>disk</th><th>$/h</th><th>cap/h</th><th>bw GB/mo</th><th /></tr></thead>
          <tbody>
            {plans.map((p) => (
              <PlanRow key={p.id} plan={p} post={post} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>audit (last 50)</h3>
        <table>
          <thead><tr><th>when</th><th>actor</th><th>action</th><th>target</th><th>detail</th></tr></thead>
          <tbody>
            {aud.map((a) => (
              <tr key={a.id}>
                <td>{new Date(a.ts).toLocaleString()}</td>
                <td>{a.actorName ?? '—'}</td>
                <td>{a.action}</td>
                <td className="mono">{a.target ?? '—'}</td>
                <td className="copy">{a.detail ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PlanRow({ plan: p, post }: { plan: Plan; post: (b: object) => Promise<void> }) {
  const [bw, setBw] = useState(String(p.bandwidthGb ?? 0));
  useEffect(() => { setBw(String(p.bandwidthGb ?? 0)); }, [p.bandwidthGb]);
  return (
    <tr>
      <td>{p.name}</td><td>{p.vcpu}</td><td>{p.ramMb / 1024}GB</td><td>{p.diskGb}GB</td>
      <td className="mono">{(p.hourlyRateCents / 100).toFixed(2)}</td>
      <td className="mono">{Math.round(p.monthlyCapMin / 60)}h</td>
      <td>
        <input className="mono" style={{ width: 70 }} value={bw} onChange={(e) => setBw(e.target.value)} />
      </td>
      <td>
        <button onClick={() => {
          const v = parseFloat(bw);
          if (Number.isFinite(v) && v >= 0) void post({ op: 'setPlan', planId: p.id, bandwidthGb: v });
        }}>save</button>
      </td>
    </tr>
  );
}
