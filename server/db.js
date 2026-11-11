import pg from 'pg';import {config} from './config.js';const {Pool}=pg;
export const pool=new Pool({connectionString:config.databaseUrl,ssl:config.databaseSsl?{rejectUnauthorized:config.databaseSslRejectUnauthorized}:false,max:config.databasePoolMax,idleTimeoutMillis:30000,connectionTimeoutMillis:10000});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function connectWithRetry(attempts=12){let last;for(let i=1;i<=attempts;i++){try{await pool.query('SELECT 1');console.log('PostgreSQL conectado');return}catch(e){last=e;console.error(`PostgreSQL no disponible (${i}/${attempts}): ${e.code||e.message}`);if(i<attempts)await sleep(Math.min(1500*i,8000));}}throw last;}
export async function tx(work){const c=await pool.connect();try{await c.query('BEGIN');const r=await work(c);await c.query('COMMIT');return r}catch(e){await c.query('ROLLBACK');throw e}finally{c.release();}}
