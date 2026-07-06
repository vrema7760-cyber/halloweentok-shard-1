/**
 * Shard Worker — "склад" бинарников (видео/фото).
 * Вызывается ТОЛЬКО главным воркером через service binding (env.SHARD_1 и т.д.),
 * поэтому наружу не торчит — но всё равно проверяем внутренний секрет на всякий случай.
 */

const CHUNK_SIZE = 900 * 1024; // 900KB, с запасом от лимита строки D1

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.headers.get('X-Internal-Secret') !== env.INTERNAL_SECRET) {
      return json({ error: 'forbidden' }, 403);
    }

    try {
      if (url.pathname === '/store' && request.method === 'POST') {
        return await handleStore(request, env);
      }
      if (url.pathname === '/fetch' && request.method === 'GET') {
        return await handleFetch(url, env);
      }
      if (url.pathname === '/delete' && request.method === 'POST') {
        return await handleDelete(request, env);
      }
      if (url.pathname === '/usage' && request.method === 'GET') {
        return await handleUsage(env);
      }
      return json({ error: 'not_found' }, 404);
    } catch (err) {
      return json({ error: 'internal_error', detail: String(err) }, 500);
    }
  },
};

async function handleStore(request, env) {
  const { key, mime, base64 } = await request.json();
  if (!key || !mime || !base64) return json({ error: 'bad_request' }, 400);

  const bytes = base64ToBytes(base64);
  const chunkCount = Math.ceil(bytes.length / CHUNK_SIZE);

  const stmts = [];
  for (let i = 0; i < chunkCount; i++) {
    const chunk = bytes.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    stmts.push(
      env.DB.prepare(
        'INSERT OR REPLACE INTO blob_chunks (key, chunk_index, data) VALUES (?, ?, ?)'
      ).bind(key, i, chunk)
    );
  }
  stmts.push(
    env.DB.prepare(
      'INSERT OR REPLACE INTO blob_meta (key, mime, size_bytes, chunk_count, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(key, mime, bytes.length, chunkCount, Date.now())
  );

  await env.DB.batch(stmts);
  return json({ ok: true, key, size_bytes: bytes.length });
}

async function handleFetch(url, env) {
  const key = url.searchParams.get('key');
  if (!key) return json({ error: 'bad_request' }, 400);

  const meta = await env.DB.prepare('SELECT * FROM blob_meta WHERE key = ?').bind(key).first();
  if (!meta) return json({ error: 'not_found' }, 404);

  const { results } = await env.DB.prepare(
    'SELECT chunk_index, data FROM blob_chunks WHERE key = ? ORDER BY chunk_index ASC'
  ).bind(key).all();

  const full = new Uint8Array(meta.size_bytes);
  let offset = 0;
  for (const row of results) {
    const chunkBytes = new Uint8Array(row.data);
    full.set(chunkBytes, offset);
    offset += chunkBytes.length;
  }

  return new Response(full, {
    headers: { 'Content-Type': meta.mime, 'Content-Length': String(meta.size_bytes) },
  });
}

async function handleDelete(request, env) {
  const { key } = await request.json();
  if (!key) return json({ error: 'bad_request' }, 400);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM blob_chunks WHERE key = ?').bind(key),
    env.DB.prepare('DELETE FROM blob_meta WHERE key = ?').bind(key),
  ]);
  return json({ ok: true });
}

async function handleUsage(env) {
  const row = await env.DB.prepare('SELECT COALESCE(SUM(size_bytes), 0) as total FROM blob_meta').first();
  return json({ used_bytes: row.total });
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
