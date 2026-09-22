// Supabase Edge Function: purge-covers
// Called daily by pg_cron (see the accounts_sync migration) with `Authorization: Bearer <PURGE_COVERS_SECRET>`.
// Drains public.purge_cover_queue: deletes each queued covers/ object that no book_edits row still
// uses, then drops the queue rows. verify_jwt is off (config.toml); the shared secret is the gate.
// Logs carry only a request id and an outcome word.
// Deploy: Sean runs `supabase functions deploy purge-covers`. Subagents never deploy.
import { createClient } from 'jsr:@supabase/supabase-js@2.116.0';
import { bearerToken, orphanedPaths, safeEqual } from '../_shared/purgeCore.ts';

// Small batches keep the .in() filter URLs short; 200 x 50 drains 10,000 paths a run, the rest wait a day.
const BATCH = 50;
const MAX_BATCHES = 200;

Deno.serve(async (req) => {
  const reqId = crypto.randomUUID().slice(0, 8);
  const done = (outcome: string, status: number, body: unknown) => {
    console.log(JSON.stringify({ fn: 'purge-covers', reqId, outcome }));
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    if (req.method !== 'POST') return done('rejected', 405, { error: 'method_not_allowed' });
    const secret = Deno.env.get('PURGE_COVERS_SECRET') ?? '';
    if (!safeEqual(bearerToken(req.headers.get('Authorization')), secret)) return done('unauthorized', 401, { error: 'unauthorized' });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let removed = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const { data: queued, error } = await admin.from('purge_cover_queue').select('object_path').order('queued_at').limit(BATCH);
      if (error) return done('failed:queue', 500, { error: 'purge_failed' });
      const paths = (queued ?? []).map((q) => String(q.object_path));
      if (paths.length === 0) break;
      // Soft-deleted rows still count: they can be restored for 30 days, and hard-deleting them queues the path again.
      const { data: live, error: liveErr } = await admin.from('book_edits').select('cover_object').in('cover_object', paths);
      if (liveErr) return done('failed:lookup', 500, { error: 'purge_failed' });
      const orphans = orphanedPaths(paths, (live ?? []).map((r) => String(r.cover_object)));
      if (orphans.length) {
        const { error: rmErr } = await admin.storage.from('covers').remove(orphans);
        if (rmErr) return done('failed:storage', 500, { error: 'purge_failed' });
        removed += orphans.length;
      }
      const { error: delErr } = await admin.from('purge_cover_queue').delete().in('object_path', paths);
      if (delErr) return done('failed:dequeue', 500, { error: 'purge_failed' });
      if (paths.length < BATCH) break;
    }
    return done('purged', 200, { removed });
  } catch {
    return done('failed:unhandled', 500, { error: 'purge_failed' });
  }
});
