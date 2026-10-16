import { rawDb } from './index';

export const migrations: { version: string; sql: string }[] = [
  {
    version: '20261016_0001',
    sql: `
      create table if not exists users (
        id text primary key,
        name text not null,
        role text not null default 'user',
        password_hash text,
        balance_cents integer not null default 0,
        created_at integer not null
      );
      create unique index if not exists uniq_user_name on users(name);

      create table if not exists plans (
        id text primary key,
        name text not null,
        vcpu integer not null,
        ram_mb integer not null,
        disk_gb integer not null,
        hourly_rate_cents integer not null,
        monthly_cap_min integer not null default 720,
        active integer not null default 1
      );

      create table if not exists images (
        id text primary key,
        name text not null,
        distro text,
        version text,
        url text not null,
        sha256 text not null default '',
        sha256_url text not null default '',
        path text not null default '',
        status text not null default 'missing',
        failure text,
        size_bytes integer not null default 0,
        updated_at integer not null default 0
      );

      create table if not exists ssh_keys (
        id text primary key,
        user_id text not null,
        label text not null,
        pub_key text not null,
        created_at integer not null
      );
      create index if not exists ssh_keys_user_idx on ssh_keys(user_id);

      create table if not exists instances (
        id text primary key,
        domain_name text not null,
        user_id text not null,
        plan_id text not null,
        image_id text not null,
        name text not null,
        rate_hourly_cents integer not null default 0,
        monthly_cap_min integer not null default 720,
        status text not null default 'provisioning',
        mac text not null,
        ip text not null,
        vnc_socket text,
        vnc_pass text,
        root_pass_enc text,
        auto_suspended integer not null default 0,
        destroy_at integer,
        last_settle_at integer not null default 0,
        created_at integer not null,
        updated_at integer not null,
        notes text
      );
      create unique index if not exists uniq_user_instname on instances(user_id, name);
      create index if not exists idx_inst_domain on instances(domain_name);
      create index if not exists idx_inst_user on instances(user_id);

      create table if not exists jobs (
        id text primary key,
        type text not null,
        instance_id text,
        user_id text,
        payload text not null default '{}',
        status text not null default 'queued',
        attempts integer not null default 0,
        max_attempts integer not null default 3,
        log text not null default '',
        error text not null default '',
        run_after integer not null default 0,
        created_at integer not null,
        started_at integer,
        finished_at integer
      );
      create index if not exists jobs_status_idx on jobs(status);
      create index if not exists jobs_inst_idx on jobs(instance_id);

      create table if not exists usage (
        id text primary key,
        instance_id text not null,
        running integer not null,
        weight integer not null,
        ts integer not null
      );
      create index if not exists usage_inst_ts_idx on usage(instance_id, ts);

      create table if not exists ledger (
        id text primary key,
        user_id text not null,
        delta_cents integer not null,
        reason text not null,
        ref_type text,
        ref_id text,
        note text,
        created_at integer not null
      );
      create index if not exists ledger_user_ts_idx on ledger(user_id, created_at);

      create table if not exists audit (
        id text primary key,
        ts integer not null,
        actor_id text,
        actor_name text,
        action text not null,
        target text,
        detail text
      );
      create index if not exists audit_ts_idx on audit(ts);
    `,
  },
  {
    version: '20261016_0002',
    sql: `
      alter table plans add column bandwidth_gb real not null default 100;
      alter table instances add column bandwidth_gb real not null default 0;

      create table if not exists net_monthly (
        instance_id text not null,
        month text not null,
        rx_bytes integer not null default 0,
        tx_bytes integer not null default 0,
        rx_last integer not null default 0,
        tx_last integer not null default 0,
        throttled integer not null default 0,
        updated_at integer not null default 0,
        primary key (instance_id, month)
      );

      -- one-time backfill of plan allowances (versioned: runs once, never clobbers admin edits)
      update plans set bandwidth_gb = 100  where id = 'micro';
      update plans set bandwidth_gb = 250  where id = 'small';
      update plans set bandwidth_gb = 500  where id = 'medium';
      update plans set bandwidth_gb = 1000 where id = 'large';
      -- existing instances inherit their plan's allowance
      update instances set bandwidth_gb =
        (select bandwidth_gb from plans where plans.id = instances.plan_id)
        where bandwidth_gb = 0;
    `,
  },
];

export function initDb(): void {
  const db = rawDb();
  db.exec(`create table if not exists schema_migrations (version text primary key, applied_at integer not null)`);
  const applied = new Set(
    (db.prepare('select version from schema_migrations').all() as { version: string }[]).map((r) => r.version),
  );
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    db.exec(m.sql);
    db.prepare('insert into schema_migrations (version, applied_at) values (?, ?)').run(m.version, Date.now());
  }
}
