'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Blobatar } from '@blobatar/react';
import 'blobatar/motion.css';

export function TopNav({ name, role }: { name: string; role: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const links = [
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
      <span className="navuser" title={name}>
        <Blobatar name={name} size={26} animate="hover" />
        <span className="muted">{name}</span>
      </span>
      <button
        onClick={() => signOut({ callbackUrl: '/signin' }).then(() => router.push('/signin'))}
        style={{ padding: '4px 10px', fontSize: 13 }}
      >
        sign out
      </button>
    </>
  );
}
