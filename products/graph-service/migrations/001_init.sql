-- Material graph: typed nodes and typed edges.
CREATE TABLE IF NOT EXISTS nodes (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('Material', 'MaterialVersion', 'Package', 'Product', 'ProductBuild')),
  key        TEXT NOT NULL,
  props      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, key)
);

CREATE TABLE IF NOT EXISTS edges (
  from_id    BIGINT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  to_id      BIGINT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('depends_on', 'emitted_by', 'consumed_by')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (from_id, to_id, kind)
);

CREATE INDEX IF NOT EXISTS edges_to_idx ON edges (to_id, kind);
