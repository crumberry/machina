'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import { copyText } from '@/app/ui/clipboard';
import { relTime } from '@/app/ui/time';
import { StatusCue } from '@/app/ui/status';
import { LogStream } from '@/app/ui/logstream';
import { SnapshotsPanel } from '@/app/ui/snapshots';
import { Ring, Orb, BarLoader } from '@/app/ui/loaders';

type Inst = {
  id: string; name: string; status: string; ip: string; mac: string;
  imageId: string; planId: string; rootPassword?: string;
  autoSuspended: number; rateHourlyCents: number; createdAt: number;
  bw?: { month: string; rxBytes: number; txBytes: number; quotaGb: number; throttled: boolean };
  step?: string;
  problem?: string | null;
  healCount?: number;
  logLines?: { t: number; m: string; kind: 'step' | 'ok' | 'err' | 'info' }[];
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
  const [tab, setTab] = useState<'term' | 'vnc' | 'snapshots' | 'info' | 'logs'>('term');

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
        <span className="mono">{inst.id}</span> · {inst.planId} · {inst.imageId}
      </div>

      <div className="card">
        <div className="row" style={{ gap: 14 }}>
          <span className={`badge ${inst.status}`}>
            {['provisioning', 'queued'].includes(inst.status) ? <StatusCue status={inst.status} /> : null}
            {inst.status}
          </span>
          {inst.ip
            ? <span
                data-copy
                title={`${inst.ip} — click to copy`}
                className="mono"
                onClick={() => void copyText(inst.ip, null)}
              >{inst.ip}</span>
            : null}
          <span className="mono" style={{ color: 'var(--accent)' }}>${(inst.rateHourlyCents / 100).toFixed(2)}/h</span>
          {inst.bw && inst.bw.quotaGb > 0
            ? <span className="mono muted">bw {fmtGb(inst.bw.rxBytes + inst.bw.txBytes)}/{inst.bw.quotaGb}GB</span>
            : null}
          {inst.bw?.throttled ? <span className="badge suspended">throttled</span> : null}
          {inst.autoSuspended ? <span className="badge suspended">auto-suspended</span> : null}
          <div className="spacer" />
          {['running', 'suspended'].includes(inst.status)
            ? <button disabled={busy} onClick={() => act('stop')}>stop</button> : null}
          {['stopped', 'suspended', 'error'].includes(inst.status)
            ? <button disabled={busy} onClick={() => act('start')}>start</button> : null}
          {['stopped', 'suspended', 'running', 'error'].includes(inst.status)
            ? <button className="danger" disabled={busy} onClick={() => act('delete')}>delete</button> : null}
        </div>
        {msg && <div className="muted" style={{ marginTop: 8 }}>{msg}</div>}
        {inst.status === 'provisioning' && inst.step && (
          <div className="busybtn" style={{ marginTop: 10, color: 'var(--text-2)', fontSize: 13 }}>
            <Orb state="weaving" size={20} label="provisioning" />
            {inst.step}…
          </div>
        )}
        {inst.status === 'provisioning' && <div style={{ marginTop: 10 }}><BarLoader label="provisioning" /></div>}
        {inst.problem && (
          <div className="errbox" style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <Orb state="solving" size={20} label="error" />
              <span>
                {inst.problem}
                {(inst.healCount ?? 0) > 0 && <span className="muted"> · auto-recovery attempt {inst.healCount} of 3</span>}
              </span>
            </span>
            <button onClick={() => act('retry')} disabled={busy} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              {busy ? <Ring size={11} /> : null} try again
            </button>
          </div>
        )}
      </div>

      <div className="tabs">
        {(['term', 'vnc', 'snapshots', 'info', 'logs'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? 'active' : ''}>
            {t === 'term' ? 'terminal' : t === 'vnc' ? 'console (VNC)' : t === 'snapshots' ? 'snapshots' : t === 'info' ? 'information' : 'activity'}
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
        {tab === 'snapshots' && (
          <SnapshotsPanel instanceId={inst.id} instanceStatus={inst.status} />
        )}
        {tab === 'logs' && (
          <LogStream lines={inst.logLines ?? []} live={inst.status === 'provisioning'} height={340} />
        )}
        {tab === 'info' && (
          <div>
            <dl className="kv">
              <dt>root password</dt>
              <dd className="mono" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {showPw ? (
                  <>
                    <span>{inst.rootPassword ?? '(hidden)'}</span>
                    {inst.rootPassword
                      ? <button onClick={() => void copyText(inst.rootPassword!, null)} style={{ padding: '2px 8px' }}>copy</button>
                      : null}
                  </>
                ) : (
                  <button onClick={() => setShowPw(true)} style={{ padding: '2px 8px' }}>reveal</button>
                )}
              </dd>
              <dt>mac</dt><dd className="mono">{inst.mac}</dd>
              <dt>created</dt><dd title={new Date(inst.createdAt).toLocaleString()}>{relTime(inst.createdAt)}</dd>
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
                    <td title={new Date(j.createdAt).toLocaleString()}>{relTime(j.createdAt)}</td>
                  </tr>
                ))}
                {jobs.length === 0 && <tr><td colSpan={4} className="empty">no jobs yet</td></tr>}
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

  // auto-connect once when the tab mounts — the terminal is the point of the page
  const autoRef = useRef(false);
  useEffect(() => {
    if (autoRef.current) return;
    autoRef.current = true;
    void connect();
  }, [connect]);

  return (
    <div>
      <div className="row" style={{ marginBottom: 6 }}>
        <button
          onClick={() => void connect()}
          disabled={state === 'connecting' || state === 'open'}
        >{state === 'connecting' ? 'connecting…' : 'connect'}</button>
        <span className="muted">{state}{err ? ` — ${err}` : ''}</span>
      </div>
      <div style={{ position: 'relative' }}>
        <div ref={boxRef} className="termwrap" />
        {state !== 'open' && (
          <div className="termhint">
            {state === 'connecting'
              ? <span className="busybtn"><ThinkingOrb state="connecting" size={20} theme="dark" aria-label="connecting" />connecting…</span>
              : state === 'error'
                ? <span style={{ color: 'var(--danger)' }}>{err || 'error'}</span>
                : state === 'closed'
                  ? 'disconnected — click connect to reopen'
                  : 'starting shell…'}
          </div>
        )}
      </div>
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

  // auto-connect once — same posture as the terminal tab
  useEffect(() => { void connect(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

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
      <div style={{ position: 'relative' }}>
        <div ref={boxRef} className="consolwrap" />
        {state !== 'open' && (
          <div className="termhint">
            {state === 'connecting'
              ? <span className="busybtn"><ThinkingOrb state="connecting" size={20} theme="dark" aria-label="connecting" />connecting…</span>
              : state === 'error'
                ? <span style={{ color: 'var(--danger)' }}>{err || 'error'}</span>
                : state === 'closed'
                  ? 'disconnected — click connect to reopen'
                  : 'starting console…'}
          </div>
        )}
      </div>
    </div>
  );
}
