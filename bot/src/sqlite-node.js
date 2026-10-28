// db.q adapter for Node: node:sqlite (Node >= 22.5) or better-sqlite3.
export async function openDb(file = ":memory:") {
  let db;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(file);
  } catch {
    const { default: Database } = await import("better-sqlite3");
    db = new Database(file);
  }
  try { db.exec("PRAGMA journal_mode=WAL"); } catch {}
  return {
    raw: db,
    q(sql, ...params) {
      const st = db.prepare(sql);
      if (st.reader === false) { st.run(...params); return []; }
      if (st.reader === true) return st.all(...params);
      return /^\s*(SELECT|WITH|PRAGMA)/i.test(sql) ? st.all(...params) : (st.run(...params), []);
    },
  };
}
