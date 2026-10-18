import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { mkdirSync, existsSync } from 'fs';
import { storagePaths, config } from '@/lib/config';

const pexec = promisify(execFile);

async function virsh(args: string[], timeoutMs = 60_000): Promise<string> {
  const { stdout } = await pexec(config.virshBin, ['-c', config.virshUri, ...args], {
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.trim();
}

async function geniso(outPath: string, dir: string): Promise<void> {
  await pexec(config.genisoBin, [
    '-output', outPath,
    '-volid', 'cidata',
    '-joliet',
    '-rock',
    'user-data', 'meta-data', 'network-config',
  ], { cwd: dir, timeout: 30_000 });
}

// ---------------------------------------------------------------- networking

export function macFromId(id: string): string {
  // Deterministic, collision-safe for our scale: 52:54:00:XX:XX:XX from an
  // FNV-1a hash OF THE CHARACTER CODES.
  //
  // BUG THIS FIXES: the loop iterated `for (const c of id)` but never used `c`,
  // so the hash only depended on id.length. Every instance id has the same
  // length ('vm_' + 16 hex), so EVERY VM was handed the identical MAC. They
  // collided on the bridge, only one could take an address, and the rest hung
  // in systemd-networkd-wait-online until the SSH timeout killed provisioning.
  // Math.imul keeps the multiply in 32-bit; a plain `*` loses precision above
  // 2^53 and silently collides even sooner.
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  }
  h = (h ^ (id.length * 31)) >>> 0;
  const b2 = (h & 0xff).toString(16).padStart(2, '0');
  const b1 = ((h >> 8) & 0xff).toString(16).padStart(2, '0');
  const b0 = ((h >> 16) & 0xff).toString(16).padStart(2, '0');
  return `52:54:00:${b0}:${b1}:${b2}`;
}

/**
 * Allocate the lowest free IPv4 in config.ipRange that no row in `taken` uses.
 * Caller passes the set of IPs already claimed.
 */
export class IpAllocator {
  private taken: Set<string>;
  constructor(taken: string[]) {
    this.taken = new Set(taken);
  }
  next(): string | null {
    const [start, end] = config.ipRange.split('-').map((s) => s.trim());
    const s4 = start.split('.').map((n) => parseInt(n, 10));
    const e4 = end.split('.').map((n) => parseInt(n, 10));
    const toInt = (a: number[]) => ((a[0] << 24) | (a[1] << 16) | (a[2] << 8) | a[3]) >>> 0;
    let cur = toInt(s4);
    const stop = toInt(e4);
    const base = s4.slice(0, 3).join('.');
    while (cur <= stop) {
      const ip = `${base}.${cur & 0xff}`;
      if (!this.taken.has(ip)) return ip;
      const last = cur & 0xff;
      if (last === 255) return null;
      cur++;
    }
    return null;
  }
}

// ---------------------------------------------------------------- pools/nets

async function poolExists(name: string): Promise<boolean> {
  try { await virsh(['pool-info', name]); return true; } catch { return false; }
}

async function poolDefineDir(name: string, dir: string): Promise<void> {
  await virsh(['pool-define-as', name, 'dir', '--target', dir]);
}

async function netExists(name: string): Promise<boolean> {
  try { await virsh(['net-info', name]); return true; } catch { return false; }
}

async function ensureSetup(): Promise<void> {
  const sp = storagePaths();
  for (const d of [sp.root, sp.images, sp.vms, sp.seeds, sp.vnc, sp.tmp, sp.ssh, sp.serial]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
  await pexec('chmod', ['1777', sp.vnc]).catch(() => {});

  // Pools: two dir-type pools over the layout dirs.
  for (const [name, dir] of [
    [config.imagePool, sp.images],
    [config.vmsPool, sp.vms],
  ] as const) {
    try {
      if (!(await poolExists(name))) await poolDefineDir(name, dir);
      await virsh(['pool-start', name]).catch(() => {});
    } catch (e) {
      console.log(`[driver] pool ${name} ensure failed (non-fatal): ${(e as Error).message}`);
    }
  }

  // NAT network: gateway .1 (libvirtd dnsmasq), one /24.
  try {
    if (!(await netExists(config.network))) {
      const xml = `<network><name>${config.network}</name><forward mode='nat'><nat><port start='1024' end='65535'/></nat></forward><bridge name='${config.bridgeName}' stp='on' delay='0'/><ip address='${config.gateway}' netmask='255.255.255.0'><dhcp><range start='${config.ipRange.split('-')[0].trim()}' end='${config.ipRange.split('-')[1].trim()}'/></dhcp></ip></network>`;
      const tmp = `${sp.tmp}/net-${Date.now()}.xml`;
      await fs.writeFile(tmp, xml);
      try {
        await virsh(['net-define', tmp]);
      } finally {
        await fs.rm(tmp, { force: true }).catch(() => {});
      }
    }
    await virsh(['net-start', config.network]).catch(() => {});
  } catch (e) {
    console.log(`[driver] network ${config.network} ensure failed (non-fatal): ${(e as Error).message}`);
  }
}

/** Idempotent; safe on every boot; errors degrade to log warnings. */
export async function ensureSetupSafe(): Promise<void> {
  try {
    await ensureSetup();
  } catch (e) {
    console.log('[driver] ensureSetup failed (continuing degraded):', (e as Error).message);
  }
}

export async function ensureIpLease(mac: string, ip: string): Promise<void> {
  try {
    await virsh(['net-update', config.network, 'add', 'ip-dhcp-host', `<host mac='${mac}' ip='${ip}'/>`, '--config']);
  } catch (e) {
    // Not fatal: cloud-init sets a static IP anyway. DHCP entry is belt+braces.
    console.log(`[driver] dhcp lease update failed (non-fatal): ${(e as Error).message}`);
  }
}

export async function removeIpLease(mac: string): Promise<void> {
  try {
    await virsh(['net-update', config.network, 'delete', 'ip-dhcp-host', `<host mac='${mac}'/>`, '--config', '--live']);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- domains

export interface DomInfo {
  name: string;
  state: string;
  uuid: string;
}

export async function listDomains(): Promise<DomInfo[]> {
  const out = await virsh(['list', '--all']);
  const rows: DomInfo[] = [];
  for (const line of out.split('\n').slice(2)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/\s+/);
    if (parts.length < 3) continue;
    const name = parts[1];
    const state = parts.slice(2).join(' ');
    let uuid = '';
    try { uuid = (await virsh(['domuuid', name])).trim(); } catch { /* gone */ }
    rows.push({ name, state, uuid });
  }
  return rows;
}

export async function domState(name: string): Promise<string | null> {
  try {
    const out = await virsh(['domstate', name]);
    return out.trim();
  } catch {
    return null;
  }
}

export function domainXml(opts: {
  domainName: string;
  instanceId: string;
  vcpu: number;
  ramMb: number;
  /** Absolute path of the instance's qcow2 overlay disk. */
  diskVolPath: string;
  seedIsoPath: string;
  mac: string;
  vncSocket: string;
  vncPass: string;
  serialPath: string;
}): string {
  const { domainName, instanceId, vcpu, ramMb, diskVolPath, seedIsoPath, mac, vncSocket, vncPass, serialPath } = opts;
  return `<?xml version="1.0"?>
<domain type='kvm'>
  <name>${domainName}</name>
  <memory unit='MiB'>${ramMb}</memory>
  <currentMemory unit='MiB'>${ramMb}</currentMemory>
  <vcpu placement='static'>${vcpu}</vcpu>
  <metadata>
    <machina:instance xmlns:machina='https://machina.local/xmlns/machina/1.0'>${instanceId}</machina:instance>
  </metadata>
  <os>
    <type arch='x86_64' machine='q35'>hvm</type>
    <boot dev='hd'/>
    <boot dev='cdrom'/>
  </os>
  <features>
    <acpi/>
    <apic/>
  </features>
  <cpu mode='host-model'/>
  <clock offset='utc'/>
  <on_poweroff>destroy</on_poweroff>
  <on_reboot>restart</on_reboot>
  <on_crash>restart</on_crash>
  <devices>
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2' discard='unmap'/>
      <source file='${diskVolPath}'/>
      <target dev='vda' bus='virtio'/>
    </disk>
    <disk type='file' device='cdrom'>
      <driver name='qemu' type='raw'/>
      <source file='${seedIsoPath}'/>
      <target dev='sda' bus='sata'/>
      <readonly/>
    </disk>
    <interface type='network'>
      <mac address='${mac}'/>
      <source network='${config.network}'/>
      <model type='virtio'/>
    </interface>
    <serial type='file'>
      <source path='${serialPath}'/>
      <target port='0'/>
    </serial>
    <rng model='virtio'>
      <backend model='random'>/dev/urandom</backend>
    </rng>
    <console type='pty'/>
    <graphics type='vnc' socket='${vncSocket}' passwd='${vncPass}'/>
    <video>
      <model type='virtio'/>
    </video>
    <input type='tablet' bus='usb'/>
    <memballoon model='virtio'/>
  </devices>
</domain>`;
}

export async function defineDomain(xml: string): Promise<void> {
  const tmp = `${storagePaths().tmp}/define-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.xml`;
  await fs.writeFile(tmp, xml);
  try {
    await virsh(['define', tmp]);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

export async function startDomain(name: string): Promise<void> {
  await virsh(['start', name]);
}

export async function shutdownDomain(name: string): Promise<void> {
  await virsh(['shutdown', name]);
}

export async function rebootDomain(name: string): Promise<void> {
  await virsh(['reboot', name]);
}

export async function destroyDomain(name: string): Promise<void> {
  await virsh(['destroy', name]).catch(() => {});
}

export async function undefineDomain(name: string): Promise<void> {
  try {
    await virsh(['undefine', name, '--nvram']);
  } catch {
    /* already gone */
  }
}

export async function volResize(volName: string, newGb: number): Promise<void> {
  await virsh(['vol-resize', volName, '--pool', config.vmsPool, '--capacity', `${newGb}GiB`]);
}

// ------------------------------------------------------- interface stats/tune

export interface IfaceStat {
  domain: string;
  dev: string;
  rxBytes: number;
  txBytes: number;
}

/** One `domstats --interface` call for every domain; parsed per (domain, net.N). */
export async function domNetStats(): Promise<IfaceStat[]> {
  const out = await virsh(['domstats', '--interface']);
  const stats: IfaceStat[] = [];
  let domain = '';
  const byIdx = new Map<number, { dev: string; rx: number; tx: number }>();
  const flush = () => {
    for (const s of byIdx.values()) {
      if (s.dev) stats.push({ domain, dev: s.dev, rxBytes: s.rx, txBytes: s.tx });
    }
    byIdx.clear();
  };
  for (const line of out.split('\n')) {
    let m = /^Domain: '(.+)'/.exec(line.trim());
    if (m) { flush(); domain = m[1]; continue; }
    m = /^\s*net\.(\d+)\.(name|rx\.bytes|tx\.bytes)=(.+)$/.exec(line);
    if (!m || !domain) continue;
    const idx = parseInt(m[1], 10);
    const cur = byIdx.get(idx) ?? { dev: '', rx: 0, tx: 0 };
    if (m[2] === 'name') cur.dev = m[3].trim();
    else if (m[2] === 'rx.bytes') cur.rx = parseInt(m[3], 10) || 0;
    else cur.tx = parseInt(m[3], 10) || 0;
    byIdx.set(idx, cur);
  }
  flush();
  return stats;
}

/** Live interface throttle in KB/s. 0/0 clears the limit entirely. */
export async function tuneIface(domain: string, mac: string, inKb: number, outKb: number): Promise<void> {
  await virsh(['domiftune', domain, mac, '--live',
    '--inbound', String(inKb), '--outbound', String(outKb)]);
}

/** Current live averages, or null when the domain/iface is gone. */
export async function readIfaceTune(domain: string, mac: string): Promise<{ inAvg: number; outAvg: number } | null> {
  let out: string;
  try {
    out = await virsh(['domiftune', domain, mac, '--current']);
  } catch {
    return null;
  }
  const gi = (k: string): number => {
    const m = new RegExp(`^${k}:\\s*(\\d+)`, 'm').exec(out);
    return m ? parseInt(m[1], 10) : 0;
  };
  return { inAvg: gi('inbound\\.average'), outAvg: gi('outbound\\.average') };
}

export async function vmGenIdNameList(): Promise<string[]> {
  const doms = await listDomains();
  return doms.filter((d) => d.name.startsWith(config.domainPrefix)).map((d) => d.name);
}

export { virsh, geniso };
