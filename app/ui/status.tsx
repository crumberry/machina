'use client';

import { ThinkingOrb } from 'thinking-orbs';

/** Status cue: a real animated orb while work is in flight, a quiet dot when
 *  the state is settled. Replaces blinking circles for long operations. */
export function StatusCue({ status, size = 8, orbSize = 20 }: { status: string; size?: number; orbSize?: 20 | 32 | 64 }) {
  const live = status === 'provisioning' || status === 'queued' || status === 'downloading';
  if (live) {
    return (
      <span className="status-orb" title={status}>
        <ThinkingOrb state="working" size={orbSize} theme="dark" aria-label={status} />
      </span>
    );
  }
  return <span className={`status-dot ${status}`} style={{ width: size, height: size }} />;
}
