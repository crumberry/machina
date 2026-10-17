'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Blobatar } from '@blobatar/react';
import 'blobatar/motion.css';

export function TopNav({ name, role }: { name: string; role: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const links = [
    { href: '/home', label: 'home' },
    { href: '/instances', label: 'instances' },
    { href: '/keys', label: 'ssh keys' },
    { href: '/billing', label: 'billing' },
    ...(role === 'admin' ? [{ href: '/admin', label: 'admin' }] : []),
  ];
  return (
    <>
      <div className="brand">machina</div>
      <nav>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={pathname.startsWith(l.href) ? 'active' : ''}>
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="spacer" />
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu" aria-expanded={open}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: '1px solid var(--line)', borderRadius: 999, padding: '3px 10px 3px 4px', cursor: 'pointer' }}
        >
          <Blobatar name={name} size={22} animate="hover" />
          <span style={{ fontSize: 13 }}>{name}</span>
          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>▾</span>
        </button>
        {open && (
          <div
            role="menu"
            onClick={() => setOpen(false)}
            style={{
              position: 'absolute', right: 0, top: 'calc(100% + 6px)', minWidth: 180,
              background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8,
              padding: 6, boxShadow: '0 8px 24px rgba(0,0,0,.35)', zIndex: 50,
            }}
          >
            <Link href="/account" role="menuitem" style={{ display: 'block', padding: '8px 10px', borderRadius: 6, color: 'var(--text)' }}>account</Link>
            <Link href="/billing" role="menuitem" style={{ display: 'block', padding: '8px 10px', borderRadius: 6, color: 'var(--text)' }}>billing</Link>
            {role === 'admin' && <Link href="/admin" role="menuitem" style={{ display: 'block', padding: '8px 10px', borderRadius: 6, color: 'var(--text)' }}>admin</Link>}
            <div style={{ height: 1, background: 'var(--line)', margin: '6px 0' }} />
            <button
              role="menuitem"
              onClick={() => signOut({ callbackUrl: '/signin' }).then(() => router.push('/signin'))}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 6, background: 'transparent', color: 'var(--text-2)', border: 'none', cursor: 'pointer' }}
            >
              sign out
            </button>
          </div>
        )}
      </div>
    </>
  );
}
