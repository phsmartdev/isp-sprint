/** Carrega a operação fictícia numa empresa: tsx src/db/opsDemoCli.ts <slug> [escala] */
import { createDb } from './client';
import * as s from './schema';
import { eq } from 'drizzle-orm';
import { loadOpsDemo } from '../services/opsDemo';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definido');
const [slug = 'yepnet', scale = '1'] = process.argv.slice(2);
const { db, pool } = createDb(url);
const t0 = Date.now();
const [t] = await db.select().from(s.tenants).where(eq(s.tenants.slug, slug));
if (!t) throw new Error(`empresa ${slug} não encontrada`);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia' }).format(new Date());
const r = await loadOpsDemo(db, t.id, { today, scale: Number(scale) });
console.log(JSON.stringify(r), `${((Date.now() - t0) / 1000).toFixed(1)}s`);
await pool.end();
