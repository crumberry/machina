'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { ThinkingOrb } from 'thinking-orbs';

export default function SignInPage() {
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await signIn('credentials', { username: name, password: pass, redirect: false });
    if (res?.error) {
      setError('bad credentials');
      setAttempts((n) => n + 1);
      setBusy(false);
    } else {
      window.location.href = '/instances';
    }
  }

  return (
    <div className="layout" style={{ maxWidth: 380, marginTop: '16vh' }}>
      <h1 style={{ marginTop: 0 }}>machina</h1>
      <div className="sub">rent small VMs</div>
      <form className="card" onSubmit={submit}>
        <div style={{ marginBottom: 10 }}>
          <label htmlFor="u">username</label>
          <input id="u" value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label htmlFor="p">password</label>
          <input id="p" type="password" value={pass} onChange={(e) => setPass(e.target.value)}
            autoComplete="current-password" style={{ marginBottom: 0 }} />
        </div>
        {error && <div className="errbox shake" key={attempts} style={{ marginBottom: 12, marginTop: 14 }}>{error}</div>}
        <button className="primary" type="submit" disabled={busy || !name || !pass} style={{ width: '100%' }}>
          {busy
            ? <span className="busybtn"><ThinkingOrb state="connecting" size={20} theme="dark" aria-label="signing in" />signing in…</span>
            : 'sign in'}
        </button>
      </form>
    </div>
  );
}
