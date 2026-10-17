'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Inst = {
  id: string; name: string; status: string; ip: string; mac: string;
  imageId: string; planId: string; rootPassword?: string;
  autoSuspended: number; rateHourlyCents: number; createdAt: number;
  bw?: { month: string; rxBytes: number; txBytes: number; quotaGb: number; throttled: boolean };
};

function fmtGb(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(2);
}
type Job = { id: string; type: string; status: string; error: string; createdAt: number };
type WsState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

function instanceIdFromPath(): string {
  if (typeof window === 'undefined') return '';
  return window.location.pathname.split('/')[2] ?? '';
}

export default function InstanceDetail() {
  const [inst, setInst] = useState<Inst | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [tab, setTab] = useState<'term' | 'vnc' | 'info'>('term');

  const load = useCallback(async (id: string) => {
    const r = await fetch(`/api/instances/${id}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      setInst(j);
      setJobs(j.jobs);
    } else {
      setMsg('instance gone');
    }
  }, []);

  useEffect(() => {
    const id = instanceIdFromPath();
    void load(id);
    const t = setInterval(() => void load(id), 5000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (action: string) => {
    setBusy(true);
    const id = instanceIdFromPath();
    const r = await fetch(`/api/instances/${id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `${action} queued` : j.error ?? 'failed');
    setBusy(false);
    void load(instanceIdFromPath());
  };

  if (!inst) return <h1>{msg || 'loading…'}</h1>;

  return (
    <>
      <h1>{inst.name}</h1>
      <div className="sub">
        instance <span className="mono">{inst.id}</span> · plan {inst.planId} · image {inst.imageId}
      </div>

      <div className="card">
        <div className="row">
          <span className={`badge ${inst.status}`}>{inst.status}</span>
          <span className="mono">{inst.ip}</span>
          <span className="muted">{(inst.rateHourlyCents / 100).toFixed(2)}/h</span>
          {inst.bw && inst.bw.quotaGb > 0
            ? <span className="mono muted">bw {fmtGb(inst.bw.rxBytes + inst.bw.txBytes)}/{inst.bw.quotaGb}GB</span>
            : null}
          {inst.bw?.throttled ? <span className="badge suspended">throttled (bandwidth)</span> : null}
          {inst.autoSuspended ? <span className="badge suspended">auto-suspended (balance)</span> : null}
          <div className="spacer" />
          {['running', 'suspended'].includes(inst.status)
            ? <button disabled={busy} onClick={() => act('stop')}>stop</button> : null}
          {['stopped', 'suspended', 'error'].includes(inst.status)
            ? <button disabled={busy} onClick={() => act('start')}>start</button> : null}
          {['stopped', 'suspended', 'running', 'error'].includes(inst.status)
            ? <button className="danger" disabled={busy} onClick={() => act('delete')}>delete</button> : null}
        </div>
        {msg && <div className="muted" style={{ marginTop: 8 }}>{msg}</div>}
      </div>

      <div className="row" style={{ margin: '18px 0 0' }}>
        {(['term', 'vnc', 'info'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={tab === t ? { borderColor: 'var(--accent)' } : undefined}>
            {t === 'term' ? 'terminal' : t === 'vnc' ? 'console (VNC)' : 'information'}
          </button>
        ))}
      </div>

      <div className="card">
        {tab === 'term' && (inst.status === 'running'
          ? <Terminal instanceId={inst.id} />
          : <div className="muted">terminal available when running</div>)}
        {tab === 'vnc' && (inst.status === 'running'
          ? <Console instanceId={inst.id} />
          : <div className="muted">console available when running</div>)}
        {tab === 'info' && (
          <div>
            <dl className="kv">
              <dt>root password</dt>
              <dd className="mono">
                {showPw
                  ? <span>{inst.rootPassword ?? '(hidden)'}</span>
                  : <button onClick={() => setShowPw(true)} style={{ padding: '2px 8px' }}>reveal</button>}
              </dd>
              <dt>mac</dt><dd className="mono">{inst.mac}</dd>
              <dt>created</dt><dd>{new Date(inst.createdAt).toLocaleString()}</dd>
            </dl>
            <h3 style={{ marginTop: 18 }}>recent jobs</h3>
            <table>
              <thead><tr><th>type</th><th>status</th><th>error</th><th>at</th></tr></thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>{j.type}</td>
                    <td><span className={`badge ${j.status}`}>{j.status}</span></td>
                    <td className="copy">{j.error || '—'}</td>
                    <td>{new Date(j.createdAt).toLocaleTimeString()}</td>
                  </tr>
                ))}
                {jobs.length === 0 && <tr><td colSpan={4} className="muted">none</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ terminal

function Terminal({ instanceId }: { instanceId: string }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const connRef = useRef<{ ws: WebSocket; dispose: () => void } | null>(null);
  const [state, setState] = useState<WsState>('idle');
  const [err, setErr] = useState('');

  const connect = useCallback(async () => {
    if (connRef.current) return;
    setState('connecting');
    setErr('');
    let term: import('@xterm/xterm').Terminal | null = null;
    try {
      const [{ Terminal }, { FitAddon }, xtermCss] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/xterm/css/xterm.css'),
      ]);
      void xtermCss;
      const tok = await (await fetch(`/api/instances/${instanceId}/ws-token`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'term' }),
      })).json();
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/api/instances/${instanceId}/terminal?token=${tok.token}`);
      ws.binaryType = 'arraybuffer'; // server streams stdout as binary frames

      term = new Terminal({ cursorBlink: true, fontFamily: '"JetBrains Mono", monospace', fontSize: 13 });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.onData((d) => ws.send(JSON.stringify({ t: 'i', d: btoa(unescape(encodeURIComponent(d))) })));
      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'r', c: cols, r: rows }));
      });
      const fitLater = () => { try { fit.fit(); } catch { /* not laid out yet */ } };
      window.addEventListener('resize', fitLater);

      ws.onopen = () => {
        const box = boxRef.current;
        if (!box || !term) return;
        box.innerHTML = '';
        term.open(box);
        fitLater();
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'r', c: term.cols, r: term.rows }));
        setState('open');
        connRef.current = {
          ws,
          dispose: () => { try { ws.close(); } catch {} try { term?.dispose(); } catch {} },
        };
      };
      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) { term?.write(new Uint8Array(ev.data)); return; }
        if (typeof ev.data === 'string') {
          try {
            const j = JSON.parse(ev.data) as { t: string; d?: string };
            if (j.t === 'e') { setErr(j.d ?? 'terminal error'); setState('error'); }
          } catch { /* ignore */ }
        }
      };
      ws.onclose = () => {
        if (state === 'open' || state === 'connecting') setState('closed');
        connRef.current = null;
        window.removeEventListener('resize', fitLater);
        term?.dispose();
      };
      ws.onerror = () => { setState('error'); setErr('websocket error'); };
    } catch (e) {
      setErr(String((e as Error).message));
      setState('error');
    }
  }, [instanceId, state]);

  useEffect(() => () => connRef.current?.dispose(), []);
  return (
    <div>
      <div className="row" style={{ marginBottom: 6 }}>
        <button onClick={() => void connect()} disabled={state === 'connecting' || state === 'open'}>connect</button>
        <span className="muted">{state}{err ? ` — ${err}` : ''}</span>
      </div>
      <div ref={boxRef} className="termwrap" />
    </div>
  );
}

// ------------------------------------------------------------------ console (RFB)

function Console({ instanceId }: { instanceId: string }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<{ disconnect: () => void } | null>(null);
  const [state, setState] = useState<WsState>('idle');
  const [err, setErr] = useState('');

  useEffect(() => () => rfbRef.current?.disconnect(), []);

  const connect = async () => {
    setState('connecting');
    setErr('');
    try {
      const [{ default: RFB }] = await Promise.all([import('@novnc/novnc/core/rfb.js')]);
      const tok = await (await fetch(`/api/instances/${instanceId}/ws-token`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'vnc' }),
      })).json();
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = `${proto}://${location.host}/api/instances/${instanceId}/console?token=${tok.token}`;
      const box = boxRef.current;
      if (!box) return;
      const rfb = new RFB(box, wsUrl, {});
      rfb.scaleViewport = true;
      rfb.addEventListener('disconnect', () => setState('closed'));
      rfb.addEventListener('connect', () => setState('open'));
      rfbRef.current = rfb as unknown as { disconnect: () => void };
    } catch (e) {
      setErr(String((e as Error).message));
      setState('error');
    }
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 6 }}>
        <button onClick={() => void connect()} disabled={state === 'connecting' || state === 'open'}>connect</button>
        <button onClick={() => { rfbRef.current?.disconnect(); rfbRef.current = null; }} disabled={state !== 'open'}>disconnect</button>
        <span className="muted">{state}{err ? ` — ${err}` : ''}</span>
      </div>
      <div ref={boxRef} className="consolwrap" />
    </div>
  );
}
