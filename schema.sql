-- Схема шард-воркера. Один такой воркер = одна D1 (~5GB) = один "склад" blob'ов.
-- Важно: D1 ограничивает размер одного значения в столбце (~1MB на текущий момент,
-- лимиты Cloudflare могут меняться — сверяйся с docs при деплое).
-- Поэтому видео/фото режем на чанки по 900KB, чтобы не упереться в лимит строки.

CREATE TABLE IF NOT EXISTS blob_meta (
  key         TEXT PRIMARY KEY,
  mime        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blob_chunks (
  key         TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  data        BLOB NOT NULL,
  PRIMARY KEY (key, chunk_index)
);
