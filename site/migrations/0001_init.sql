-- The site's database (Cloudflare D1). Applied with: npx wrangler d1 migrations apply marbach [--local | --remote]

-- content: the fixed documents (the nine pages, settings, layout), one JSON row each, in the shape of src/lib/schema.ts
CREATE TABLE singletons (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT
);

-- content: the lists (articles, talks, videos, testimonials)
CREATE TABLE entries (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  PRIMARY KEY (collection, id)
);

-- the previous version of every document, written on each save (restore from the admin)
CREATE TABLE revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,          -- 'singleton' | 'entry'
  ref TEXT NOT NULL,           -- 'home' | 'articles/regulation'
  data TEXT NOT NULL,
  at INTEGER NOT NULL,
  by TEXT
);
CREATE INDEX revisions_ref ON revisions (ref, id DESC);

-- the media library; the files themselves are in R2: media/<rel> (original) and m/<id>-<w>.webp (variants)
CREATE TABLE media (
  rel TEXT PRIMARY KEY,        -- path under /media/, e.g. 'photos/ofer-tedx-stage.jpg' (content refers to '/media/<rel>')
  id TEXT NOT NULL UNIQUE,
  w INTEGER NOT NULL,
  h INTEGER NOT NULL,
  variants TEXT NOT NULL,      -- JSON [{ w, src: '/m/<id>-<w>.webp' }]
  full TEXT NOT NULL,
  name TEXT,                   -- the file name as uploaded
  bytes INTEGER,
  created_at INTEGER NOT NULL DEFAULT 0,
  created_by TEXT
);

-- recommendations sent from /recommend/, waiting for Ofer's approval
CREATE TABLE submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  consent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'approved' | 'rejected'
  testimonial_id TEXT,
  ip_hash TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT
);
CREATE INDEX submissions_status ON submissions (status, created_at DESC);

-- the admin's users
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'editor',      -- 'admin' (also manages users) | 'editor' (all content)
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  pw_iter INTEGER NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);

-- sessions: only the SHA-256 of the cookie's token is stored
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  ua TEXT
);
CREATE INDEX sessions_user ON sessions (user_id);

-- failed logins and form submissions, per key ('login-ip:…', 'login-user:…', 'recommend:…')
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

-- 'version': bumped on every content change; the HTML cache is keyed by it
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO meta (key, value) VALUES ('version', '1');

-- rendered public pages, valid for one content version (emptied on every save)
CREATE TABLE html_cache (
  path TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  status INTEGER NOT NULL,
  ctype TEXT NOT NULL,
  body TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- unsaved changes shown in the admin's preview (deleted after an hour)
CREATE TABLE previews (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
