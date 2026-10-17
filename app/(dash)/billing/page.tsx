'use client';

import { useCallback, useEffect, useState } from 'react';
import { relTime } from '@/app/ui/time';

type Ledger = {
  id: string; deltaCents: number; reason: string; note: string | null;
  refType: string | null; refId: string | null; createdAt: number;
};

export default function BillingPage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [cap, setCap] = useState<{ running: number; max: number } | null>(null);
  const load = useCallback(async () => {
    const r = await fetch('/api/billing', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      setBalance(j.balanceCents);
      setLedger(j.ledger);
      setCap(j.capacity);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <h1>billing</h1>
      <div className="sub">internal credits; admin tops up; hourly settle from your balance</div>
      <div className="card">
        <div className="grid3" style={{ alignItems: 'center' }}>
          <div>
            <div className="muted">balance</div>
            <div className="mono" style={{ fontSize: 30, fontWeight: 600 }}>
              {balance === null ? '…' : `$${(balance / 100).toFixed(2)}`}
            </div>
            {balance !== null && balance < 100
              ? <span className="badge suspended" title="auto-suspends when it hits zero">low balance</span>
              : null}
          </div>
          <div>
            <div className="muted">host capacity</div>
            <div>{cap ? <span className="mono">{cap.running}/{cap.max}</span> : '…'} <span className="copy">running</span></div>
          </div>
        </div>
      </div>
      <div className="card">
        <h3>ledger (last 50)</h3>
        <table>
          <thead><tr><th>when</th><th>reason</th><th>delta</th><th>note</th></tr></thead>
          <tbody>
            {ledger.map((l) => (
              <tr key={l.id}>
                <td title={new Date(l.createdAt).toLocaleString()}>{relTime(l.createdAt)}</td>
                <td>{l.reason}</td>
                <td className="mono" style={{ color: l.deltaCents >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
                  {l.deltaCents >= 0 ? '+' : ''}{(l.deltaCents / 100).toFixed(2)}
                </td>
                <td className="copy">{l.note ?? '—'}</td>
              </tr>
            ))}
            {ledger.length === 0 && <tr><td colSpan={4} className="empty">no movements yet</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
