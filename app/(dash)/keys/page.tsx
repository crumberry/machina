'use client';

import { useCallback, useEffect, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import { useToast } from '@/app/ui/toast';

type Key = { id: string; label: string; pubKey: string; createdAt: number };

export default function KeysPage() {
  const toast = useToast();
  const [keys, setKeys] = useState<Key[]>([]);
  const [label, setLabel] = useState('');
  const [pubKey, setPubKey] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/keys', { cache: 'no-store' });
    if (r.ok) setKeys(await r.json());
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await fetch('/api/keys', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label, pubKey }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { toast.ok('key added'); setLabel(''); setPubKey(''); void load(); }
    else toast.err(j.error ?? 'failed');
    setBusy(false);
  }

  async function del(id: string) {
    const r = await fetch('/api/keys', {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (r.ok) toast.ok('key removed');
    else toast.err('remove failed');
    void load();
  }

  return (
    <>
      <h1>ssh keys</h1>
      <div className="sub">injected via cloud-init into new instances (not retroactive)</div>

      <div className="card">
        <h3>add key</h3>
        <form onSubmit={add}>
          <div className="row">
            <div style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="l">label</label>
              <input id="l" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="laptop" />
            </div>
            <div style={{ flex: 3, minWidth: 260 }}>
              <label htmlFor="k">public key</label>
              <input id="k" value={pubKey} onChange={(e) => setPubKey(e.target.value)} placeholder="ssh-ed25519 AAAA… me@host" className="mono" />
            </div>
            <button className="primary" type="submit" disabled={busy || !pubKey}>
              {busy ? (
                <span className="busybtn">
                  <ThinkingOrb state="composing" size={20} theme="dark" aria-label="adding" />
                  adding…
                </span>
              ) : 'add'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3>keys</h3>
        <table>
          <thead><tr><th>label</th><th>key</th><th>added</th><th /></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.label}</td>
                <td className="mono">{k.pubKey.slice(0, 60)}{k.pubKey.length > 60 ? '…' : ''}</td>
                <td>{new Date(k.createdAt).toLocaleDateString()}</td>
                <td><button className="danger" onClick={() => del(k.id)}>remove</button></td>
              </tr>
            ))}
            {keys.length === 0 && <tr><td colSpan={4} className="muted">no keys</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
