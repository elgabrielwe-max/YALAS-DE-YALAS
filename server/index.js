const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');
const XLSX = require('xlsx');
const helmet = require('helmet');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost') ? { rejectUnauthorized: false } : false,
  max: 10
});
const q = (text, params = []) => pool.query(text, params);
const COOKIE_NAME = 'silog_sid';
const SESSION_DAYS = 8;
function parseCookies(req){ const raw=req.headers.cookie||''; return Object.fromEntries(raw.split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return i<0?[x,'']:[decodeURIComponent(x.slice(0,i)),decodeURIComponent(x.slice(i+1))]})); }
function hashPassword(password, salt){ return crypto.scryptSync(String(password), String(salt), 64).toString('hex'); }
function safeEqualHex(a,b){ try{const aa=Buffer.from(a,'hex'),bb=Buffer.from(b,'hex');return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)}catch{return false} }
function setSessionCookie(res, token){ const secure=process.env.NODE_ENV==='production' || !!process.env.RAILWAY_ENVIRONMENT; res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS*86400}${secure?'; Secure':''}`); }
function clearSessionCookie(res){ const secure=process.env.NODE_ENV==='production' || !!process.env.RAILWAY_ENVIRONMENT; res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure?'; Secure':''}`); }
async function currentUser(req){ const token=parseCookies(req)[COOKIE_NAME]; if(!token) return null; const h=crypto.createHash('sha256').update(token).digest('hex'); const r=await q(`SELECT u.id,u.username,u.nombre,u.rol,u.activo FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.activo=true LIMIT 1`,[h]); return r.rowCount?r.rows[0]:null; }
async function requireAuth(req,res,next){ try{const u=await currentUser(req);if(!u)return res.status(401).json({error:'Sesión no iniciada'});req.user=u;next()}catch(e){res.status(500).json({error:e.message})} }
function requireRole(...roles){ return (req,res,next)=>roles.includes(req.user?.rol)?next():res.status(403).json({error:'No tienes permisos para esta operación'}) }
const n = v => Number(v || 0);
const clean = v => v === undefined || v === null ? null : String(v).trim() || null;
const money = v => Number(v || 0);
const limaToday = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima'}).format(new Date());
const chunks = (a, size = 300) => { const out=[]; for(let i=0;i<a.length;i+=size) out.push(a.slice(i,i+size)); return out; };
async function multiInsert(client, table, cols, rows, conflict=''){ if(!rows.length)return; for(const batch of chunks(rows)){ const params=[]; const values=batch.map(row=>{const marks=row.map((_,i)=>'$'+(params.length+i+1));params.push(...row);return '('+marks.join(',')+')'}).join(','); await client.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${values}${conflict}`,params); } }

function sourceKey(m, occurrence = 1) {
  const base = [m.tipo || m.movement_type, m.fecha, m.almacen, m.codigo, m.cantidad, m.documento, m.numero, m.dni, m.solicitante]
    .map(v => v == null ? '' : (v instanceof Date ? v.toISOString().slice(0,19) : String(v).slice(0,19))).join('|');
  return crypto.createHash('sha1').update(base).digest('hex') + ':' + occurrence;
}

async function ensureDefaultAdmin(){
  const r=await q("SELECT id FROM users WHERE lower(username)='admin' LIMIT 1");
  if(!r.rowCount){
    const password='Admin1234!';
    const hash=hashPassword(password,'admin');
    await q(`INSERT INTO users(username,nombre,rol,password_hash,activo) VALUES('admin','Administrador SILOG','ADMIN',$1,true)`,[hash]);
    console.log('SILOG usuario inicial creado: admin / Admin1234! (cámbialo inmediatamente)');
  }
}

async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
  await q(sql);
}


async function repairImportedExcelHistory(client, data) {
  const target = '2026-10-07-excel-crosswalk-v3-initial-costs';
  const cur = await client.query("SELECT value FROM app_settings WHERE key='excel_repair_version' LIMIT 1");
  if (cur.rowCount && cur.rows[0].value === target) return false;

  // The historical Excel ledger is rebuilt once from the corrected crosswalk.
  // Manual SILOG movements (source='SILOG') are preserved.
  await client.query("DELETE FROM inventory_movements WHERE COALESCE(source,'') IN ('IMPORT_EXCEL','EXCEL')");
  await client.query(
    `INSERT INTO app_settings(key,value) VALUES('excel_repair_version',$1)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [target]
  );
  return true;
}

async function syncSeed() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/seed.json'), 'utf8'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const excelRepair = await repairImportedExcelHistory(client, data);
    if (excelRepair) console.log('SILOG: reconstruyendo historial Excel con cruce INV INICIAL ↔ Maestra');

    await multiInsert(client,'material_groups',['codigo','nombre'],data.groups.map(g=>[g.codigo,g.nombre||g.codigo]),' ON CONFLICT(codigo) DO UPDATE SET nombre=EXCLUDED.nombre,activo=true');
    const groups = await client.query('SELECT id,codigo FROM material_groups');
    const gm = new Map(groups.rows.map(x => [x.codigo, x.id]));

    await multiInsert(client,'material_families',['grupo_id','codigo','nombre'],data.families.filter(f=>gm.has(f.grupo_codigo)).map(f=>[gm.get(f.grupo_codigo),f.codigo,f.nombre||f.codigo]),' ON CONFLICT(grupo_id,codigo) DO UPDATE SET nombre=EXCLUDED.nombre,activo=true');
    const fams = await client.query('SELECT id,grupo_id,codigo FROM material_families');
    const fm = new Map(fams.rows.map(x => [`${x.grupo_id}|${x.codigo}`, x.id]));

    await multiInsert(client,'materials',['codigo','codigo_anterior','grupo_id','familia_id','descripcion','unidad','subgrupo','moneda','activo'],data.materials.map(m=>[m.codigo,m.codigo_anterior,gm.get(m.grupo_codigo)||null,fm.get(`${gm.get(m.grupo_codigo)||''}|${m.familia_codigo}`)||null,m.descripcion||m.codigo,m.unidad,m.subgrupo,m.moneda||'SOL',true]),' ON CONFLICT(codigo) DO UPDATE SET codigo_anterior=EXCLUDED.codigo_anterior,grupo_id=EXCLUDED.grupo_id,familia_id=EXCLUDED.familia_id,descripcion=EXCLUDED.descripcion,unidad=EXCLUDED.unidad,subgrupo=EXCLUDED.subgrupo,moneda=EXCLUDED.moneda,activo=true,updated_at=now()');

    await multiInsert(client,'personnel',['dni','nombre','cargo','cliente','activo'],data.personnel.map(p=>[p.dni,p.nombre||p.dni,p.cargo,p.cliente,true]),' ON CONFLICT(dni) DO UPDATE SET nombre=EXCLUDED.nombre,cargo=EXCLUDED.cargo,cliente=EXCLUDED.cliente,activo=true,updated_at=now()');

    // Importación única del personal de Minera Chinalco desde el archivo entregado.
    // Se ejecuta una sola vez para no borrar un área que el usuario complete más adelante.
    const chinalcoVersion = 'chinalco-personnel-2026-09-14-v1';
    const chinalcoDone = await client.query("SELECT value FROM app_settings WHERE key='chinalco_personnel_import_version' LIMIT 1");
    let chinalcoImported = 0;
    if (!chinalcoDone.rowCount || chinalcoDone.rows[0].value !== chinalcoVersion) {
      const chinalcoPath = path.join(__dirname, '../data/chinalco_personnel.json');
      if (fs.existsSync(chinalcoPath)) {
        const chinalcoData = JSON.parse(fs.readFileSync(chinalcoPath, 'utf8'));
        const chinalcoPeople = (chinalcoData.people || []).filter(p => p.dni && p.nombre).map(p => [
          String(p.dni).trim(), String(p.nombre).trim(), p.cargo || null,
          'MINERA CHINALCO PERU S.A.A.', null, true
        ]);
        await multiInsert(client, 'personnel', ['dni','nombre','cargo','cliente','area','activo'], chinalcoPeople,
          ' ON CONFLICT(dni) DO UPDATE SET nombre=EXCLUDED.nombre,cargo=EXCLUDED.cargo,cliente=EXCLUDED.cliente,area=NULL,activo=true,updated_at=now()');
        chinalcoImported = chinalcoPeople.length;
        await client.query("INSERT INTO app_settings(key,value) VALUES('chinalco_personnel_import_version',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [chinalcoVersion]);
      }
    }
    await multiInsert(client,'cost_centers',['codigo','minera','area','descripcion','unidad','proyecto','contrato','codigo_sp2','contabilidad','activo'],data.cecos.map(c=>[c.codigo,c.minera,c.area,c.descripcion,c.unidad,c.proyecto,c.contrato,c.codigo_sp2,c.contabilidad,true]),' ON CONFLICT(codigo) DO UPDATE SET minera=EXCLUDED.minera,area=EXCLUDED.area,descripcion=EXCLUDED.descripcion,unidad=EXCLUDED.unidad,proyecto=EXCLUDED.proyecto,contrato=EXCLUDED.contrato,codigo_sp2=EXCLUDED.codigo_sp2,contabilidad=EXCLUDED.contabilidad,activo=true');
    for (const x of data.exchange_rates || []) if (x.precio != null) await client.query(`INSERT INTO exchange_rates(fecha,precio) VALUES($1,$2) ON CONFLICT(fecha) DO UPDATE SET precio=EXCLUDED.precio`, [String(x.fecha).slice(0,10),x.precio]);

    const warehouseNames = [...new Set([...data.movements.map(m => (m.almacen || 'MARH TUNEL').trim()).filter(Boolean), 'PLANTA PILOTO'])];
    for (const name of warehouseNames) { const code = name.toUpperCase().replace(/[^A-Z0-9]+/g,'_').slice(0,40); await client.query(`INSERT INTO warehouses(codigo,nombre) VALUES($1,$2) ON CONFLICT(nombre) DO UPDATE SET activo=true`, [code,name]); }

    // Backfill deterministic source keys for the Excel history already present in SILOG 1.0.x.
    const existing = await client.query(`SELECT v.id,v.movement_type,v.fecha,w.nombre almacen,m.codigo,v.cantidad,v.documento,v.numero,v.dni,v.solicitante
      FROM inventory_movements v JOIN materials m ON m.id=v.material_id JOIN warehouses w ON w.id=v.warehouse_id
      WHERE COALESCE(v.source,'')='IMPORT_EXCEL' AND v.source_key IS NULL ORDER BY v.id`);
    const seenExisting = new Map();
    for (const r of existing.rows) {
      const base = sourceKey({...r, tipo:r.movement_type}, 0).split(':')[0];
      const occ = (seenExisting.get(base) || 0) + 1; seenExisting.set(base,occ);
      await client.query('UPDATE inventory_movements SET source_key=$1 WHERE id=$2',[`${base}:${occ}`,r.id]);
    }

    const warehouses = await client.query('SELECT id,nombre FROM warehouses');
    const wm = new Map(warehouses.rows.map(x => [x.nombre.trim().toUpperCase(),x.id]));
    const mats = await client.query('SELECT id,codigo FROM materials');
    const mm = new Map(mats.rows.map(x => [x.codigo,x.id]));
    const ccs = await client.query('SELECT id,codigo FROM cost_centers');
    const cm = new Map(ccs.rows.map(x => [String(x.codigo),x.id]));

    // Import the real initial inventory from INV INICIAL, already translated to
    // the new Maestra codes. This is what gives each warehouse/material its
    // opening quantity and unit cost before applying historical OUT movements.
    const initialCosts = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/initial_costs.json'), 'utf8'));

    // Coste de referencia por material: promedio ponderado de INV INICIAL.
    // Se usa cuando el almacén seleccionado no tiene todavía un costo promedio positivo.
    const referenceAcc = new Map();
    for (const [key, x] of Object.entries(initialCosts)) {
      const codigo = String(x.codigo || key.split('|')[1] || '').trim();
      const qty = Math.max(0, n(x.cantidad_inicial));
      const cost = Math.max(0, n(x.costo_unitario));
      if (!codigo || !mm.has(codigo) || !(qty > 0) || !(cost > 0)) continue;
      const a = referenceAcc.get(codigo) || {qty:0,value:0};
      a.qty += qty;
      a.value += qty * cost;
      referenceAcc.set(codigo,a);
    }
    for (const [codigo,a] of referenceAcc.entries()) {
      const ref = a.qty > 0 ? a.value / a.qty : 0;
      await client.query('UPDATE materials SET costo_referencia=$1,updated_at=now() WHERE codigo=$2',[ref,codigo]);
    }

    for (const [key, x] of Object.entries(initialCosts)) {
      const whName = String(x.warehouse || key.split('|')[0] || '').trim();
      const codigo = String(x.codigo || key.split('|')[1] || '').trim();
      if (!whName || !codigo || !mm.has(codigo)) continue;
      let wid = wm.get(whName.toUpperCase());
      if (!wid) {
        const code = whName.toUpperCase().replace(/[^A-Z0-9]+/g,'_').slice(0,40);
        const wr = await client.query(`INSERT INTO warehouses(codigo,nombre) VALUES($1,$2) ON CONFLICT(nombre) DO UPDATE SET activo=true RETURNING id`, [code,whName]);
        wid = wr.rows[0]?.id;
        wm.set(whName.toUpperCase(), wid);
      }
      const qty = Math.max(0, n(x.cantidad_inicial));
      const cost = Math.max(0, n(x.costo_unitario));
      if (!(qty > 0)) continue;
      const sourceKey = `EXCEL_INITIAL|2026|${whName}|${codigo}`;
      const exists = await client.query('SELECT id FROM inventory_movements WHERE source_key=$1 LIMIT 1',[sourceKey]);
      if (exists.rowCount) {
        await client.query(`UPDATE inventory_movements SET cantidad=$1,costo_unitario=$2,valor=$3,warehouse_id=$4,material_id=$5,fecha='2026-01-01T00:00:00Z',fecha_atencion='2026-01-01',fecha_digitacion='2026-01-01' WHERE id=$6`,
          [qty,cost,qty*cost,wid,mm.get(codigo),exists.rows[0].id]);
      } else {
        await client.query(`INSERT INTO inventory_movements
          (movement_type,fecha,fecha_atencion,fecha_digitacion,warehouse_id,material_id,cantidad,costo_unitario,valor,moneda,documento,numero,condicion,observacion,source,source_key,created_by)
          VALUES('INITIAL','2026-01-01T00:00:00Z','2026-01-01','2026-01-01',$1,$2,$3,$4,$5,'SOL','INV INICIAL','INV-INICIAL-2026','INICIAL','Inventario inicial importado desde INV INICIAL','EXCEL_INITIAL',$6,'EXCEL')`,
          [wid,mm.get(codigo),qty,cost,qty*cost,sourceKey]);
      }
    }

    for (const m of data.movements) {
      if (!mm.has(m.codigo)) continue;
      const wid = wm.get((m.almacen || 'MARH TUNEL').trim().toUpperCase());
      if (!wid) continue;
      const sk = m.source_key;
      const existingMove = await client.query('SELECT id FROM inventory_movements WHERE source_key=$1 LIMIT 1',[sk]);
      const sourceDate = String(m.fecha || '').slice(0,10);
      const vals = [m.tipo,m.fecha,wid,mm.get(m.codigo),Math.abs(n(m.cantidad)),n(m.costo_unitario),n(m.valor),m.moneda||'SOL',m.documento,m.numero,m.condicion,cm.get(String(m.ceco))||null,m.cliente,m.area,m.placa,m.dni,m.solicitante,m.entregado,m.autorizado,null,'IMPORT_EXCEL',sk,'EXCEL',sourceDate,sourceDate];
      if (existingMove.rowCount) {
        await client.query(`UPDATE inventory_movements SET costo_unitario=$1,valor=$2,moneda=$3,condicion=$4,ceco_id=$5,cliente=$6,area=$7,placa=$8,dni=$9,solicitante=$10,entregado=$11,autorizado=$12,fecha_atencion=$13,fecha_digitacion=$14 WHERE id=$15`,
          [vals[5],vals[6],vals[7],vals[10],vals[11],vals[12],vals[13],vals[14],vals[15],vals[16],vals[17],vals[18],vals[23],vals[24],existingMove.rows[0].id]);
      } else {
        await client.query(`INSERT INTO inventory_movements
          (movement_type,fecha,fecha_atencion,fecha_digitacion,warehouse_id,material_id,cantidad,costo_unitario,valor,moneda,documento,numero,condicion,ceco_id,cliente,area,placa,dni,solicitante,entregado,autorizado,observacion,source,source_key,created_by)
          VALUES($1,$2,$24::date,$25::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`, vals);
      }
    }

    // Corregir salidas históricas que tenían PU=0 en Excel usando el costo de referencia.
    await client.query(`UPDATE inventory_movements v
      SET costo_unitario=m.costo_referencia, valor=v.cantidad*m.costo_referencia
      FROM materials m
      WHERE v.material_id=m.id
        AND v.movement_type='OUT'
        AND COALESCE(v.costo_unitario,0)=0
        AND COALESCE(m.costo_referencia,0)>0
        AND COALESCE(v.source,'') IN ('IMPORT_EXCEL','EXCEL')`);

    // Sincronizar posiciones que sí tienen movimientos, sin borrar saldos manuales existentes.
    // Antes se borraba toda la tabla al iniciar; eso podía hacer desaparecer inventario digitado
    // por versiones anteriores si el saldo no tenía su movimiento correspondiente.
    await client.query(`INSERT INTO inventory_balances(warehouse_id,material_id,cantidad,costo_promedio,valor)
      SELECT warehouse_id,material_id,
      SUM(CASE WHEN movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN cantidad ELSE -cantidad END),
      CASE WHEN SUM(CASE WHEN movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN cantidad ELSE 0 END)>0
        THEN SUM(CASE WHEN movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN valor ELSE 0 END) /
             NULLIF(SUM(CASE WHEN movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN cantidad ELSE 0 END),0)
        ELSE 0 END,
      SUM(CASE WHEN movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN valor ELSE -valor END)
      FROM inventory_movements WHERE warehouse_id IS NOT NULL AND material_id IS NOT NULL GROUP BY warehouse_id,material_id
      ON CONFLICT(warehouse_id,material_id) DO UPDATE SET
        cantidad=EXCLUDED.cantidad,
        costo_promedio=CASE WHEN EXCLUDED.costo_promedio>0 THEN EXCLUDED.costo_promedio ELSE inventory_balances.costo_promedio END,
        valor=EXCLUDED.valor,updated_at=now()`);

    await client.query(`INSERT INTO app_settings(key,value) VALUES('data_sync_version',$1)
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,[data.version]);
    await client.query('COMMIT');
    return {materials:data.materials.length,personnel:data.personnel.length,chinalco_personnel_imported:chinalcoImported,cecos:data.cecos.length,movements:data.movements.length};
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

async function ensureBalance(client, warehouseId, materialId) {
  const r = await client.query('SELECT * FROM inventory_balances WHERE warehouse_id=$1 AND material_id=$2 FOR UPDATE',[warehouseId,materialId]);
  // Reconstruye una posición faltante/desactualizada desde los movimientos sin borrar historial.
  const ledger = await client.query(`SELECT COUNT(*)::int movimientos,
      COALESCE(SUM(CASE WHEN movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN cantidad ELSE -cantidad END),0) cantidad,
      COALESCE(SUM(CASE WHEN movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN valor ELSE -valor END),0) valor,
      COALESCE(SUM(CASE WHEN movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN cantidad ELSE 0 END),0) entradas,
      COALESCE(SUM(CASE WHEN movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN valor ELSE 0 END),0) valor_entradas,
      COALESCE(MAX(CASE WHEN COALESCE(costo_unitario,0)>0 THEN costo_unitario END),0) costo
    FROM inventory_movements WHERE warehouse_id=$1 AND material_id=$2`,[warehouseId,materialId]);
  const l=ledger.rows[0];
  const qty=n(l.cantidad), avg=n(l.entradas)>0?n(l.valor_entradas)/n(l.entradas):n(l.costo);
  if (r.rowCount) {
    const b=r.rows[0];
    if (n(l.movimientos)>0 && Math.abs(n(b.cantidad)-qty)>0.0001) {
      const fixed=await client.query(`UPDATE inventory_balances SET cantidad=$1,costo_promedio=$2,valor=$3,updated_at=now()
        WHERE warehouse_id=$4 AND material_id=$5 RETURNING *`,[qty,avg||n(b.costo_promedio),qty*(avg||n(b.costo_promedio)),warehouseId,materialId]);
      return fixed.rows[0];
    }
    return b;
  }
  await client.query('INSERT INTO inventory_balances(warehouse_id,material_id,cantidad,costo_promedio,valor) VALUES($1,$2,$3,$4,$5) ON CONFLICT(warehouse_id,material_id) DO NOTHING',[warehouseId,materialId,qty,avg,qty*avg]);
  return (await client.query('SELECT * FROM inventory_balances WHERE warehouse_id=$1 AND material_id=$2 FOR UPDATE',[warehouseId,materialId])).rows[0];
}

async function recordMovement(body,type,user='WEB') {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const mat=await client.query('SELECT id,moneda,descripcion,unidad,costo_referencia FROM materials WHERE codigo=$1 AND activo=true',[body.codigo]);
    if(!mat.rowCount) throw new Error('Material no encontrado');
    const wh=await client.query("SELECT id,nombre FROM warehouses WHERE (id=CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE NULL END) OR nombre=$1 OR codigo=$1 LIMIT 1",[body.almacen]);
    if(!wh.rowCount) throw new Error('Almacén no encontrado');
    const qty=n(body.cantidad); if(!(qty>0)) throw new Error('La cantidad debe ser mayor que 0');
    const bal=await ensureBalance(client,wh.rows[0].id,mat.rows[0].id);
    let cost=n(body.costo_unitario);
    if(type==='OUT' && !cost) cost=n(bal.costo_promedio)||n(mat.rows[0].costo_referencia);
    if(type==='IN' && !cost) cost=n(bal.costo_promedio)||n(mat.rows[0].costo_referencia);
    if(type==='OUT' && n(bal.cantidad)<qty && body.permitir_stock_negativo!=='true') throw new Error(`Stock insuficiente. Disponible: ${bal.cantidad}`);
    const value=qty*cost;
    const atencion=body.fecha_atencion || (body.fecha ? String(body.fecha).slice(0,10) : limaToday());
    const digitacion=limaToday();
    const fechaTs=body.fecha || `${atencion}T12:00:00`;
    const ruc=String(body.proveedor_ruc||'').replace(/\D/g,'');
    if(ruc && ruc.length!==11) throw new Error('El RUC del proveedor debe tener 11 dígitos.');
    const ins=await client.query(`INSERT INTO inventory_movements(movement_type,fecha,fecha_atencion,fecha_digitacion,warehouse_id,material_id,cantidad,costo_unitario,valor,moneda,documento,numero,proveedor_ruc,proveedor,condicion,ceco_id,cliente,area,placa,dni,solicitante,entregado,autorizado,observacion,source,created_by)
      VALUES($1,$2,$3::date,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING id`,
      [type,fechaTs,atencion,digitacion,wh.rows[0].id,mat.rows[0].id,qty,cost,value,body.moneda||mat.rows[0].moneda||'SOL',body.documento,body.numero,ruc||null,body.proveedor||null,body.condicion,body.ceco_id||null,body.cliente,body.area,body.placa,body.dni,body.solicitante,body.entregado,body.autorizado,body.observacion,'SILOG',user]);
    const sign=type==='OUT' ? -1 : 1;
    const newQty=n(bal.cantidad)+sign*qty;
    const newValue=n(bal.valor)+sign*value;
    const newAvg=type==='OUT' ? n(bal.costo_promedio) : (newQty>0 ? ((n(bal.cantidad)*n(bal.costo_promedio)) + value) / newQty : cost);
    await client.query(`UPDATE inventory_balances SET cantidad=$1,costo_promedio=$2,valor=$3,updated_at=now() WHERE warehouse_id=$4 AND material_id=$5`,[newQty,newAvg,newValue,wh.rows[0].id,mat.rows[0].id]);
    await client.query('INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,$2,$3,$4,$5)',[user,type,'inventory_movement',String(ins.rows[0].id),JSON.stringify(body)]);
    await client.query('COMMIT'); return ins.rows[0].id;
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

async function recordIssue(body,user='WEB') {
  const items=Array.isArray(body.items)?body.items:[];
  if(!items.length) throw new Error('Agrega al menos un material a la salida');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const wh=await client.query("SELECT id,nombre FROM warehouses WHERE (id=CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE NULL END) OR nombre=$1 OR codigo=$1 LIMIT 1",[body.almacen]);
    if(!wh.rowCount) throw new Error('Almacén no encontrado');
    const count=await client.query(`SELECT count(*)::int n FROM inventory_movements WHERE movement_type='OUT' AND numero LIKE $1`,[`SAL-${new Date().getFullYear()}%`]);
    const numero=body.numero || `SAL-${new Date().getFullYear()}-${String(count.rows[0].n+1).padStart(5,'0')}`;
    for(const item of items){
      const mat=await client.query('SELECT id,moneda,unidad,costo_referencia FROM materials WHERE codigo=$1 AND activo=true',[item.codigo]);
      if(!mat.rowCount) throw new Error(`Material no encontrado: ${item.codigo}`);
      const bal=await ensureBalance(client,wh.rows[0].id,mat.rows[0].id);
      const qty=n(item.cantidad); if(!(qty>=1) || !Number.isInteger(qty)) throw new Error(`Cantidad inválida para ${item.codigo}: debe ser un número entero de 1 o más`);
      if(n(bal.cantidad)<qty) throw new Error(`Stock insuficiente para ${item.codigo} en ${wh.rows[0].nombre}. Disponible: ${bal.cantidad}`);
      const fallbackCost=await client.query(`SELECT MAX(v.costo_unitario) AS costo FROM inventory_movements v WHERE v.material_id=$1 AND v.movement_type='INITIAL' AND COALESCE(v.costo_unitario,0)>0`,[mat.rows[0].id]); const cost=n(bal.costo_promedio)||n(item.costo_unitario)||n(mat.rows[0].costo_referencia)||n(fallbackCost.rows[0]?.costo); const value=qty*cost;
      const atencion=body.fecha_atencion || (body.fecha ? String(body.fecha).slice(0,10) : limaToday());
      const digitacion=limaToday();
      const fechaTs=body.fecha || `${atencion}T12:00:00`;
      await client.query(`INSERT INTO inventory_movements(movement_type,fecha,fecha_atencion,fecha_digitacion,warehouse_id,material_id,cantidad,costo_unitario,valor,moneda,documento,numero,condicion,ceco_id,cliente,area,placa,dni,solicitante,entregado,autorizado,observacion,source,created_by)
        VALUES('OUT',$1,$2::date,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [fechaTs,atencion,digitacion,wh.rows[0].id,mat.rows[0].id,qty,cost,value,body.moneda||mat.rows[0].moneda||'SOL',body.documento||'V.SALIDA',numero,body.condicion||'SALIDA',body.ceco_id||null,'MINERA CHINALCO PERU S.A.A.',body.area,body.placa,body.dni,body.solicitante,body.entregado,body.autorizado,body.observacion,'SILOG',user]);
      const newQty=n(bal.cantidad)-qty; const newValue=n(bal.valor)-value;
      await client.query('UPDATE inventory_balances SET cantidad=$1,valor=$2,updated_at=now() WHERE warehouse_id=$3 AND material_id=$4',[newQty,newValue,wh.rows[0].id,mat.rows[0].id]);
    }
    await client.query('INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,$2,$3,$4,$5)',[user,'OUT','material_issue',numero,JSON.stringify(body)]);
    await client.query('COMMIT'); return {numero};
  } catch(e){await client.query('ROLLBACK');throw e} finally{client.release()}
}

// Préstamos temporales: se descuenta stock al entregar y se repone con un movimiento IN al devolver.
function limaParts(value){const d=new Date(value);if(Number.isNaN(d.getTime()))return null;const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);const o=Object.fromEntries(parts.map(x=>[x.type,x.value]));return {date:`${o.year}-${o.month}-${o.day}`,hour:Number(o.hour),minute:Number(o.minute)};}
async function getLoanReportRows(filters={}){
 const from=filters.from||'',to=filters.to||'',warehouse=filters.warehouse||'',search=String(filters.search||'').trim();
 const r=await q(`SELECT l.id,l.numero,l.issued_at,l.due_at,l.returned_at,l.estado estado_guardado,l.dni,l.trabajador,l.observacion,l.created_by,l.evidence_data_url IS NOT NULL has_evidence,
 w.nombre almacen,m.codigo,m.descripcion material,m.unidad,li.cantidad,li.devuelto,(li.cantidad-li.devuelto) pendiente,li.costo_unitario,li.valor,
 ((li.cantidad-li.devuelto)*li.costo_unitario)::numeric(18,2) valor_pendiente,
 COALESCE((SELECT string_agg(u.nombre,' / ' ORDER BY u.nombre) FROM material_loan_supervisors ls JOIN users u ON u.id=ls.user_id WHERE ls.loan_id=l.id),'—') supervisores,
 CASE WHEN li.devuelto>=li.cantidad THEN 'DEVUELTO' WHEN l.due_at<now() THEN 'VENCIDO' WHEN li.devuelto>0 THEN 'PARCIAL' ELSE 'PENDIENTE' END estado
 FROM material_loans l JOIN warehouses w ON w.id=l.warehouse_id JOIN material_loan_items li ON li.loan_id=l.id JOIN materials m ON m.id=li.material_id
 WHERE ($1='' OR l.issued_at >= $1::date) AND ($2='' OR l.issued_at < ($2::date+interval '1 day')) AND ($3='' OR l.warehouse_id=CASE WHEN $3 ~ '^\\d+$' THEN $3::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$3 OR codigo=$3 LIMIT 1) END)
 AND ($4='' OR l.dni ILIKE '%'||$4||'%' OR l.trabajador ILIKE '%'||$4||'%' OR l.numero ILIKE '%'||$4||'%' OR m.codigo ILIKE '%'||$4||'%' OR m.descripcion ILIKE '%'||$4||'%')
 ORDER BY l.issued_at DESC,l.id DESC,li.id`,[from,to,warehouse,search]);
 return r.rows;
}
app.get('/api/loans/supervisors',requireAuth,async(req,res)=>{try{const r=await q("SELECT id,username,nombre,rol FROM users WHERE activo AND rol IN ('ADMIN','SUPERVISOR') ORDER BY CASE WHEN rol='SUPERVISOR' THEN 0 ELSE 1 END,nombre");res.json(r.rows)}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/loans/alerts',requireAuth,async(req,res)=>{try{
 const r=await q(`SELECT l.id,l.numero,l.dni,l.trabajador,l.issued_at,l.due_at,w.nombre almacen,
 COALESCE((SELECT string_agg(u.nombre,' / ' ORDER BY u.nombre) FROM material_loan_supervisors ls JOIN users u ON u.id=ls.user_id WHERE ls.loan_id=l.id),'—') supervisores,
 COUNT(li.id)::int lineas,SUM(li.cantidad-li.devuelto)::numeric cantidad_pendiente,SUM((li.cantidad-li.devuelto)*li.costo_unitario)::numeric valor_pendiente,
 CASE WHEN l.due_at<now() THEN 'VENCIDO' WHEN l.due_at<=now()+interval '60 minutes' THEN 'POR VENCER' ELSE 'VIGENTE' END alerta,
 EXTRACT(EPOCH FROM (now()-l.due_at))/3600 horas_retraso,
 l.evidence_data_url IS NOT NULL has_evidence
 FROM material_loans l JOIN warehouses w ON w.id=l.warehouse_id JOIN material_loan_items li ON li.loan_id=l.id
 WHERE l.estado IN ('PENDIENTE','PARCIAL') AND li.devuelto<li.cantidad
 GROUP BY l.id,w.nombre ORDER BY l.due_at ASC`);
 res.json({rows:r.rows,total:r.rows.length,vencidos:r.rows.filter(x=>x.alerta==='VENCIDO').length,porVencer:r.rows.filter(x=>x.alerta==='POR VENCER').length});
 }catch(e){res.status(500).json({error:e.message})}});
app.get('/api/loans',requireAuth,async(req,res)=>{try{const rows=await getLoanReportRows({from:req.query.from,to:req.query.to,warehouse:req.query.warehouse,search:req.query.search});res.json(rows)}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/loans/:id',requireAuth,async(req,res)=>{try{const loan=await q(`SELECT l.id,l.numero,l.warehouse_id,l.dni,l.trabajador,l.issued_at,l.due_at,l.returned_at,l.estado,l.observacion,l.evidence_data_url IS NOT NULL has_evidence,l.created_by,l.created_at,w.nombre almacen,COALESCE((SELECT string_agg(u.nombre,' / ' ORDER BY u.nombre) FROM material_loan_supervisors ls JOIN users u ON u.id=ls.user_id WHERE ls.loan_id=l.id),'—') supervisores FROM material_loans l JOIN warehouses w ON w.id=l.warehouse_id WHERE l.id=$1`,[req.params.id]);if(!loan.rowCount)return res.status(404).json({error:'Préstamo no encontrado'});const items=await q(`SELECT li.id item_id,li.cantidad,li.devuelto,(li.cantidad-li.devuelto) pendiente,li.costo_unitario,li.valor,li.barcode,m.codigo,m.descripcion material,m.unidad FROM material_loan_items li JOIN materials m ON m.id=li.material_id WHERE li.loan_id=$1 ORDER BY li.id`,[req.params.id]);res.json({loan:loan.rows[0],items:items.rows})}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/loans',requireAuth,requireRole('ADMIN','SUPERVISOR','ALMACEN','OPERADOR'),async(req,res)=>{
 const body=req.body||{};const items=Array.isArray(body.items)?body.items:[];const supervisorIds=[...new Set((Array.isArray(body.supervisor_ids)?body.supervisor_ids:[body.supervisor_id]).map(x=>Number(x)).filter(x=>Number.isInteger(x)&&x>0))];
 if(!clean(body.dni)||!clean(body.trabajador))return res.status(400).json({error:'Selecciona o ingresa el DNI y nombre del trabajador.'});
 if(!items.length)return res.status(400).json({error:'Agrega al menos un material al préstamo.'});
 if(!supervisorIds.length)return res.status(400).json({error:'Asigna al menos un supervisor responsable.'});
 const issued=new Date(body.issued_at),due=new Date(body.due_at),ip=limaParts(issued),dp=limaParts(due);
 if(!ip||!dp||!Number.isFinite(issued.getTime())||!Number.isFinite(due.getTime()))return res.status(400).json({error:'Indica fecha y hora válidas de entrega y devolución.'});
 if(ip.date!==dp.date)return res.status(400).json({error:'El préstamo debe corresponder a un solo día. Para otro día, registra una extensión autorizada.'});
 if(ip.hour<6||ip.hour>=18||dp.hour>18||(dp.hour===18&&dp.minute>0))return res.status(400).json({error:'El horario operativo es de 06:00 a 18:00. Registra la entrega y devolución dentro de ese rango.'});
 if(due<=issued)return res.status(400).json({error:'La hora límite de devolución debe ser posterior a la entrega.'});
 const evidence=String(body.evidence_data_url||'');if(evidence&&(!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(evidence)||evidence.length>5_500_000))return res.status(400).json({error:'La foto debe ser JPG, PNG o WEBP y pesar menos de 4 MB después de comprimirse.'});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const wh=await client.query("SELECT id,nombre FROM warehouses WHERE (id=CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE NULL END) OR nombre=$1 OR codigo=$1 LIMIT 1",[String(body.almacen||body.warehouse_id||'')]);if(!wh.rowCount)throw new Error('Selecciona un almacén válido.');
  const supervisors=await client.query("SELECT id,nombre,rol FROM users WHERE activo AND rol IN ('ADMIN','SUPERVISOR') AND id=ANY($1::bigint[])",[supervisorIds]);if(supervisors.rowCount!==supervisorIds.length)throw new Error('Uno o más supervisores no están activos o no tienen el rol autorizado.');
  const seq=await client.query("SELECT nextval('loan_number_seq')::text n");const numero=`PRE-${ip.date.slice(0,4)}-${String(seq.rows[0].n).padStart(6,'0')}`;
  const person=await client.query('SELECT nombre FROM personnel WHERE regexp_replace(COALESCE(dni,\'\'),\'\\D\',\'\',\'g\')=regexp_replace($1,\'\\D\',\'\',\'g\') AND activo LIMIT 1',[String(body.dni).trim()]);
  const worker=person.rows[0]?.nombre||String(body.trabajador).trim();
  const loan=await client.query(`INSERT INTO material_loans(numero,warehouse_id,dni,trabajador,issued_at,due_at,estado,observacion,evidence_data_url,evidence_filename,created_by)
   VALUES($1,$2,$3,$4,$5,$6,'PENDIENTE',$7,$8,$9,$10) RETURNING id,numero`,[numero,wh.rows[0].id,String(body.dni).trim(),worker,issued.toISOString(),due.toISOString(),clean(body.observacion),evidence||null,clean(body.evidence_filename),req.user.username]);
  for(const sid of supervisorIds)await client.query('INSERT INTO material_loan_supervisors(loan_id,user_id,assigned_by) VALUES($1,$2,$3)',[loan.rows[0].id,sid,req.user.username]);
  const merged=new Map();for(const item of items){const code=String(item.codigo||item.barcode||'').trim(),qty=n(item.cantidad);if(!code||!(qty>0))throw new Error('Cada material debe tener un código y una cantidad mayor que cero.');const mat=await client.query(`SELECT id,codigo,descripcion,unidad,moneda,costo_referencia FROM materials WHERE activo AND (upper(codigo)=upper($1) OR upper(COALESCE(codigo_anterior,''))=upper($1) OR id IN (SELECT material_id FROM material_barcodes WHERE barcode=$1 AND activo)) LIMIT 1`,[code]);if(!mat.rowCount)throw new Error(`No se encontró en el Maestro el material/código: ${code}`);const key=String(mat.rows[0].id);if(merged.has(key))merged.get(key).cantidad+=qty;else merged.set(key,{mat:mat.rows[0],cantidad:qty,barcode:item.barcode||code});}
  let total=0;
  for(const item of merged.values()){
   const mat=item.mat,bal=await ensureBalance(client,wh.rows[0].id,mat.id);const qty=item.cantidad;if(n(bal.cantidad)<qty)throw new Error(`Stock insuficiente para ${mat.codigo} en ${wh.rows[0].nombre}. Disponible: ${n(bal.cantidad)}`);
   const fallbackCost=await client.query("SELECT MAX(costo_unitario) costo FROM inventory_movements WHERE material_id=$1 AND movement_type='INITIAL' AND COALESCE(costo_unitario,0)>0",[mat.id]);const cost=n(bal.costo_promedio)||n(mat.costo_referencia)||n(fallbackCost.rows[0]?.costo);const value=qty*cost;total+=value;
   const li=await client.query('INSERT INTO material_loan_items(loan_id,material_id,cantidad,costo_unitario,valor,barcode) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[loan.rows[0].id,mat.id,qty,cost,value,item.barcode]);
   await client.query(`INSERT INTO inventory_movements(movement_type,fecha,fecha_atencion,fecha_digitacion,warehouse_id,material_id,cantidad,costo_unitario,valor,moneda,documento,numero,condicion,dni,solicitante,entregado,autorizado,observacion,source,created_by)
    VALUES('OUT',$1,$2::date,$3::date,$4,$5,$6,$7,$8,$9,'PRESTAMO TEMPORAL',$10,'PRESTAMO',$11,$12,$13,$14,$15,'SILOG_PRESTAMO',$16)`,[issued.toISOString(),ip.date,limaToday(),wh.rows[0].id,mat.id,qty,cost,value,mat.moneda||'SOL',numero,String(body.dni).trim(),worker,req.user.nombre,supervisors.rows.map(x=>x.nombre).join(' / '),clean(body.observacion),req.user.username]);
   const newQty=n(bal.cantidad)-qty,newValue=n(bal.valor)-value;await client.query('UPDATE inventory_balances SET cantidad=$1,valor=$2,updated_at=now() WHERE warehouse_id=$3 AND material_id=$4',[newQty,newValue,wh.rows[0].id,mat.id]);
  }
  await client.query('INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,$2,$3,$4,$5)',[req.user.username,'REGISTRAR_PRESTAMO','material_loan',String(loan.rows[0].id),JSON.stringify({numero,warehouse:wh.rows[0].nombre,dni:body.dni,supervisors:supervisors.rows.map(x=>x.nombre),total,evidence:!!evidence})]);
  await client.query('COMMIT');res.json({ok:true,id:loan.rows[0].id,numero,total,trabajador:worker});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});res.status(400).json({error:e.message})}finally{client.release()}
});
app.post('/api/loans/:id/extend',requireAuth,requireRole('ADMIN','SUPERVISOR'),async(req,res)=>{try{const id=Number(req.params.id),due=new Date(req.body.due_at),dp=limaParts(due),reason=clean(req.body.motivo);if(!Number.isInteger(id)||id<1||!Number.isFinite(due.getTime())||!dp||!reason)return res.status(400).json({error:'Indica un nuevo plazo válido y el motivo de la extensión.'});if(dp.hour<6||dp.hour>18||(dp.hour===18&&dp.minute>0))return res.status(400).json({error:'La nueva hora límite debe estar entre 06:00 y 18:00, hora de Lima.'});const client=await pool.connect();try{await client.query('BEGIN');const loan=await client.query('SELECT * FROM material_loans WHERE id=$1 FOR UPDATE',[id]);if(!loan.rowCount)throw new Error('Préstamo no encontrado.');if(['DEVUELTO','ANULADO'].includes(loan.rows[0].estado))throw new Error('No se puede extender un préstamo cerrado.');if(due<=new Date(loan.rows[0].due_at))throw new Error('El nuevo plazo debe ser posterior al plazo actual.');if(due.getTime()-new Date(loan.rows[0].due_at).getTime()>26*60*60*1000)throw new Error('La extensión no puede superar un día adicional.');await client.query('INSERT INTO material_loan_deadline_changes(loan_id,plazo_anterior,plazo_nuevo,motivo,autorizado_por) VALUES($1,$2,$3,$4,$5)',[id,loan.rows[0].due_at,due.toISOString(),reason,req.user.username]);await client.query('UPDATE material_loans SET due_at=$1,updated_at=now() WHERE id=$2',[due.toISOString(),id]);await client.query('INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,$2,$3,$4,$5)',[req.user.username,'EXTENDER_PLAZO_PRESTAMO','material_loan',String(id),JSON.stringify({numero:loan.rows[0].numero,anterior:loan.rows[0].due_at,nuevo:due.toISOString(),motivo:reason})]);await client.query('COMMIT');res.json({ok:true,numero:loan.rows[0].numero,due_at:due.toISOString()})}catch(e){await client.query('ROLLBACK').catch(()=>{});res.status(400).json({error:e.message})}finally{client.release()}}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/loans/:id/return',requireAuth,requireRole('ADMIN','SUPERVISOR','ALMACEN'),async(req,res)=>{
 const loanId=Number(req.params.id),items=Array.isArray(req.body.items)?req.body.items:[];if(!Number.isInteger(loanId)||loanId<1||!items.length)return res.status(400).json({error:'Selecciona el préstamo y las cantidades que se devuelven.'});
 const client=await pool.connect();try{
  await client.query('BEGIN');const loan=await client.query('SELECT l.*,w.nombre almacen FROM material_loans l JOIN warehouses w ON w.id=l.warehouse_id WHERE l.id=$1 FOR UPDATE',[loanId]);if(!loan.rowCount)throw new Error('Préstamo no encontrado.');if(loan.rows[0].estado==='DEVUELTO'||loan.rows[0].estado==='ANULADO')throw new Error('Este préstamo ya está cerrado.');
  let returned=0;
  for(const item of items){const itemId=Number(item.item_id),qty=n(item.cantidad);if(!Number.isInteger(itemId)||!(qty>0))continue;const row=await client.query(`SELECT li.*,m.codigo,m.descripcion,m.unidad,m.moneda FROM material_loan_items li JOIN materials m ON m.id=li.material_id WHERE li.id=$1 AND li.loan_id=$2 FOR UPDATE`,[itemId,loanId]);if(!row.rowCount)throw new Error('Uno de los materiales no pertenece a este préstamo.');const li=row.rows[0],pending=n(li.cantidad)-n(li.devuelto);if(qty>pending)throw new Error(`No puedes devolver ${qty} de ${li.codigo}: solo quedan ${pending} pendientes.`);
   const bal=await ensureBalance(client,loan.rows[0].warehouse_id,li.material_id);const value=qty*n(li.costo_unitario);const at=limaToday();const ts=new Date().toISOString();const condition=String(item.estado_material||'BUENO').toUpperCase();
   await client.query(`INSERT INTO inventory_movements(movement_type,fecha,fecha_atencion,fecha_digitacion,warehouse_id,material_id,cantidad,costo_unitario,valor,moneda,documento,numero,condicion,dni,solicitante,observacion,source,created_by)
    VALUES('IN',$1,$2::date,$2::date,$3,$4,$5,$6,$7,$8,'DEVOLUCION PRESTAMO',$9,'DEVOLUCION_PRESTAMO',$10,$11,$12,'SILOG_PRESTAMO',$13)`,[ts,at,loan.rows[0].warehouse_id,li.material_id,qty,li.costo_unitario,value,li.moneda||'SOL',loan.rows[0].numero,loan.rows[0].dni,loan.rows[0].trabajador,clean(req.body.observacion),req.user.username]);
   const newQty=n(bal.cantidad)+qty,newValue=n(bal.valor)+value,newAvg=newQty>0?newValue/newQty:n(li.costo_unitario);await client.query('UPDATE inventory_balances SET cantidad=$1,costo_promedio=$2,valor=$3,updated_at=now() WHERE warehouse_id=$4 AND material_id=$5',[newQty,newAvg,newValue,loan.rows[0].warehouse_id,li.material_id]);
   if(condition!=='BUENO'){
    const note=`Material devuelto en estado ${condition}; no se reincorpora al stock utilizable. ${clean(req.body.observacion)||''}`.trim();
    await client.query(`INSERT INTO inventory_movements(movement_type,fecha,fecha_atencion,fecha_digitacion,warehouse_id,material_id,cantidad,costo_unitario,valor,moneda,documento,numero,condicion,dni,solicitante,observacion,source,created_by)
     VALUES('OUT',$1,$2::date,$2::date,$3,$4,$5,$6,$7,$8,'BAJA POR PRESTAMO',$9,'PRESTAMO_DANADO',$10,$11,$12,'SILOG_PRESTAMO',$13)`,[ts,at,loan.rows[0].warehouse_id,li.material_id,qty,li.costo_unitario,value,li.moneda||'SOL',loan.rows[0].numero,loan.rows[0].dni,loan.rows[0].trabajador,note,req.user.username]);
    await client.query('UPDATE inventory_balances SET cantidad=cantidad-$1,valor=valor-$2,updated_at=now() WHERE warehouse_id=$3 AND material_id=$4',[qty,value,loan.rows[0].warehouse_id,li.material_id]);
   }
   await client.query('UPDATE material_loan_items SET devuelto=devuelto+$1 WHERE id=$2',[qty,itemId]);await client.query('INSERT INTO material_loan_returns(loan_id,loan_item_id,cantidad,estado_material,observacion,created_by) VALUES($1,$2,$3,$4,$5,$6)',[loanId,itemId,qty,condition,clean(req.body.observacion),req.user.username]);returned+=qty;
  }
  const status=await client.query('SELECT bool_and(devuelto>=cantidad) completo,bool_or(devuelto>0) parcial FROM material_loan_items WHERE loan_id=$1',[loanId]);const state=status.rows[0].completo?'DEVUELTO':'PARCIAL';await client.query('UPDATE material_loans SET estado=$1,returned_at=CASE WHEN $1=\'DEVUELTO\' THEN now() ELSE NULL END,updated_at=now() WHERE id=$2',[state,loanId]);
  await client.query('INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,$2,$3,$4,$5)',[req.user.username,'REGISTRAR_DEVOLUCION','material_loan',String(loanId),JSON.stringify({numero:loan.rows[0].numero,returned,state,observation:req.body.observacion})]);await client.query('COMMIT');res.json({ok:true,numero:loan.rows[0].numero,devuelto:returned,estado:state});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});res.status(400).json({error:e.message})}finally{client.release()}
});
app.get('/api/loans/:id/evidence',requireAuth,async(req,res)=>{try{const r=await q('SELECT evidence_data_url,evidence_filename FROM material_loans WHERE id=$1',[req.params.id]);if(!r.rowCount||!r.rows[0].evidence_data_url)return res.status(404).send('Este préstamo no tiene foto de evidencia.');const m=r.rows[0].evidence_data_url.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([\s\S]+)$/i);if(!m)return res.status(404).send('Evidencia no disponible.');res.setHeader('Content-Type',m[1].toLowerCase()==='image/jpg'?'image/jpeg':m[1].toLowerCase());res.setHeader('Content-Disposition',`inline; filename="${String(r.rows[0].evidence_filename||'evidencia-prestamo.jpg').replace(/["\r\n]/g,'') }"`);res.send(Buffer.from(m[2],'base64'))}catch(e){res.status(500).send(e.message)}});
app.get('/api/loans/report.csv',requireAuth,async(req,res)=>{try{const rows=await getLoanReportRows({from:req.query.from,to:req.query.to,warehouse:req.query.warehouse,search:req.query.search});reportCsv(res,'SILOG_reporte_prestamos',rows.map(r=>({'N.º préstamo':r.numero,'Fecha entrega':r.issued_at,'Fecha límite':r.due_at,'Devolución final':r.returned_at,'Almacén':r.almacen,'DNI':r.dni,'Trabajador':r.trabajador,'Supervisor(es)':r.supervisores,'Código':r.codigo,'Material':r.material,'Unidad':r.unidad,'Cantidad prestada':r.cantidad,'Cantidad devuelta':r.devuelto,'Cantidad pendiente':r.pendiente,'Costo unitario':r.costo_unitario,'Valor prestado':r.valor,'Valor pendiente':r.valor_pendiente,'Estado':r.estado,'Observación':r.observacion,'Usuario':r.created_by,'Tiene evidencia':r.has_evidence?'Sí':'No'})))}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/loans/report.xlsx',requireAuth,async(req,res)=>{try{const rows=await getLoanReportRows({from:req.query.from,to:req.query.to,warehouse:req.query.warehouse,search:req.query.search});const data=rows.map(r=>({'N.º préstamo':r.numero,'Fecha entrega':r.issued_at,'Fecha límite':r.due_at,'Devolución final':r.returned_at,'Almacén':r.almacen,'DNI':r.dni,'Trabajador':r.trabajador,'Supervisor(es)':r.supervisores,'Código':r.codigo,'Material':r.material,'Unidad':r.unidad,'Cantidad prestada':r.cantidad,'Cantidad devuelta':r.devuelto,'Cantidad pendiente':r.pendiente,'Costo unitario':r.costo_unitario,'Valor prestado':r.valor,'Valor pendiente':r.valor_pendiente,'Estado':r.estado,'Observación':r.observacion,'Usuario':r.created_by,'Tiene evidencia':r.has_evidence?'Sí':'No'}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),'Préstamos');const summary=XLSX.utils.aoa_to_sheet([['Reporte de préstamos SILOG'],['Registros',rows.length],['Valor prestado',rows.reduce((a,r)=>a+n(r.valor),0)],['Valor pendiente',rows.reduce((a,r)=>a+n(r.valor_pendiente),0)],['Préstamos vencidos',rows.filter(r=>r.estado==='VENCIDO').length]]);XLSX.utils.book_append_sheet(wb,summary,'Resumen');const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="SILOG_reporte_prestamos.xlsx"');res.send(buf)}catch(e){res.status(500).json({error:e.message})}});

app.post('/api/auth/login',async(req,res)=>{
  try{
    const username=clean(req.body.username)?.toLowerCase(); const password=String(req.body.password||'');
    if(!username||!password)return res.status(400).json({error:'Usuario y contraseña son obligatorios'});
    const r=await q('SELECT id,username,nombre,rol,activo,password_hash FROM users WHERE lower(username)=lower($1) LIMIT 1',[username]);
    if(!r.rowCount||!r.rows[0].activo)return res.status(401).json({error:'Usuario o contraseña incorrectos'});
    const u=r.rows[0]; if(!safeEqualHex(hashPassword(password,String(u.username).trim().toLowerCase()),u.password_hash))return res.status(401).json({error:'Usuario o contraseña incorrectos'});
    const token=crypto.randomBytes(32).toString('hex'); const h=crypto.createHash('sha256').update(token).digest('hex');
    await q('DELETE FROM auth_sessions WHERE expires_at<=now()');
    await q('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+make_interval(days=>$3))',[h,u.id,SESSION_DAYS]);
    setSessionCookie(res,token);
    res.json({user:{id:u.id,username:u.username,nombre:u.nombre,rol:u.rol}});
  }catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/auth/logout',async(req,res)=>{try{const token=parseCookies(req)[COOKIE_NAME];if(token){const h=crypto.createHash('sha256').update(token).digest('hex');await q('DELETE FROM auth_sessions WHERE token_hash=$1',[h])}clearSessionCookie(res);res.json({ok:true})}catch(e){clearSessionCookie(res);res.json({ok:true})}});
app.get('/api/auth/me',requireAuth,async(req,res)=>res.json({user:req.user}));

app.get('/api/health',async(req,res)=>{try{await q('SELECT 1');res.json({ok:true,service:'SILOG',version:'1.8.7-salidas-stock-visible'})}catch(e){res.status(503).json({ok:false,error:e.message})}});
app.use('/api',requireAuth);

app.get('/api/dashboard',async(req,res)=>{
  const queryErrors=[];
  try{
    let warehouse=String(req.query.warehouse||'').trim();
    if(warehouse){
      const wr=await q("SELECT id FROM warehouses WHERE (id=CASE WHEN $1 ~ '^\\d+$' THEN NULLIF($1,'')::bigint ELSE NULL END) OR nombre=$1 OR codigo=$1 LIMIT 1",[warehouse]);
      if(!wr.rowCount) return res.status(400).json({error:'El almacén seleccionado no existe.'});
      warehouse=String(wr.rows[0].id);
    }
    const safe=async(label,sql,params=[warehouse])=>{try{return (await q(sql,params)).rows}catch(e){queryErrors.push({consulta:label,error:e.message});console.error('Dashboard query '+label+':',e.message);return []}};
    const m=await safe('maestro','SELECT count(*)::int n FROM materials WHERE activo',[]);
    const inv=await safe('valor inventario',`SELECT COALESCE(sum(valor),0) valor FROM inventory_balances WHERE ($1='' OR warehouse_id=NULLIF($1,'')::bigint)`);
    const outs=await safe('salidas del mes',"SELECT COALESCE(sum(valor),0) valor,count(*)::int n FROM inventory_movements WHERE movement_type='OUT' AND COALESCE(condicion,'') NOT IN ('VACIADO_ALMACEN','PRESTAMO','DEVOLUCION_PRESTAMO') AND COALESCE(fecha_atencion,fecha::date)>=date_trunc('month',CURRENT_DATE)::date AND ($1='' OR warehouse_id=NULLIF($1,'')::bigint)");
    const ins=await safe('ingresos del mes',"SELECT COALESCE(sum(valor),0) valor,count(*)::int n FROM inventory_movements WHERE movement_type IN ('IN','INITIAL','TRANSFER_IN') AND COALESCE(condicion,'') NOT IN ('VACIADO_ALMACEN','PRESTAMO','DEVOLUCION_PRESTAMO') AND COALESCE(fecha_atencion,fecha::date)>=date_trunc('month',CURRENT_DATE)::date AND ($1='' OR warehouse_id=NULLIF($1,'')::bigint)");
    const neg=await safe('stock negativo',`SELECT count(*)::int n FROM inventory_balances WHERE cantidad<0 AND ($1='' OR warehouse_id=NULLIF($1,'')::bigint)`);
    const crit=await safe('stock crítico',`SELECT count(*)::int n FROM inventory_balances b JOIN materials m ON m.id=b.material_id LEFT JOIN warehouse_material_policies p ON p.warehouse_id=b.warehouse_id AND p.material_id=b.material_id WHERE COALESCE(p.stock_minimo,m.stock_minimo,0)>0 AND b.cantidad<=COALESCE(p.stock_minimo,m.stock_minimo,0) AND ($1='' OR b.warehouse_id=NULLIF($1,'')::bigint)`);
    const groups=await safe('valor por grupo',`SELECT COALESCE(g.nombre,'SIN GRUPO') nombre,round(sum(b.valor)::numeric,2) valor FROM inventory_balances b JOIN materials m ON m.id=b.material_id LEFT JOIN material_groups g ON g.id=m.grupo_id WHERE ($1='' OR b.warehouse_id=NULLIF($1,'')::bigint) GROUP BY g.nombre ORDER BY valor DESC LIMIT 8`);
    const monthly=await safe('evolución mensual',`SELECT to_char(months.mes,'YYYY-MM') mes,COALESCE(i.ingreso,0)::numeric ingreso,COALESCE(o.salida,0)::numeric salida
      FROM generate_series(date_trunc('month',CURRENT_DATE)-interval '5 months',date_trunc('month',CURRENT_DATE),interval '1 month') AS months(mes)
      LEFT JOIN (SELECT date_trunc('month',COALESCE(fecha_atencion,fecha::date)) mes,sum(valor) ingreso FROM inventory_movements WHERE movement_type IN ('IN','INITIAL','TRANSFER_IN') AND COALESCE(condicion,'') NOT IN ('VACIADO_ALMACEN','PRESTAMO','DEVOLUCION_PRESTAMO') AND ($1='' OR warehouse_id=NULLIF($1,'')::bigint) GROUP BY 1) i ON i.mes=months.mes
      LEFT JOIN (SELECT date_trunc('month',COALESCE(fecha_atencion,fecha::date)) mes,sum(valor) salida FROM inventory_movements WHERE movement_type='OUT' AND COALESCE(condicion,'') NOT IN ('VACIADO_ALMACEN','PRESTAMO','DEVOLUCION_PRESTAMO') AND ($1='' OR warehouse_id=NULLIF($1,'')::bigint) GROUP BY 1) o ON o.mes=months.mes ORDER BY months.mes`);
    const top=await safe('top consumo',`SELECT m.codigo,m.descripcion,round(sum(v.valor)::numeric,2) valor,sum(v.cantidad)::numeric cantidad FROM inventory_movements v JOIN materials m ON m.id=v.material_id WHERE v.movement_type='OUT' AND COALESCE(v.condicion,'') NOT IN ('VACIADO_ALMACEN','PRESTAMO','DEVOLUCION_PRESTAMO') AND COALESCE(v.fecha_atencion,v.fecha::date)>=date_trunc('month',CURRENT_DATE)::date AND ($1='' OR v.warehouse_id=NULLIF($1,'')::bigint) GROUP BY m.codigo,m.descripcion ORDER BY sum(v.valor) DESC LIMIT 10`);
    const dailyCosts=await safe('costos diarios',`SELECT to_char(d.dia,'YYYY-MM-DD') fecha,w.nombre almacen,COALESCE(sum(v.valor),0)::numeric valor
      FROM generate_series(CURRENT_DATE-13,CURRENT_DATE,interval '1 day') d(dia) CROSS JOIN warehouses w
      LEFT JOIN inventory_movements v ON COALESCE(v.fecha_atencion,v.fecha::date)=d.dia::date AND v.movement_type='OUT' AND COALESCE(v.condicion,'') NOT IN ('VACIADO_ALMACEN','PRESTAMO','DEVOLUCION_PRESTAMO') AND v.warehouse_id=w.id
      WHERE w.activo AND ($1='' OR w.id=NULLIF($1,'')::bigint) GROUP BY d.dia,w.nombre ORDER BY d.dia,w.nombre`);
    const warehouseCompare=await safe('comparativo por almacén',`SELECT w.nombre almacen,COALESCE(sum(v.valor),0)::numeric valor,count(v.id)::int movimientos
      FROM warehouses w LEFT JOIN inventory_movements v ON v.warehouse_id=w.id AND v.movement_type='OUT' AND COALESCE(v.condicion,'') NOT IN ('VACIADO_ALMACEN','PRESTAMO','DEVOLUCION_PRESTAMO') AND COALESCE(v.fecha_atencion,v.fecha::date)>=date_trunc('month',CURRENT_DATE)::date
      WHERE w.activo AND ($1='' OR w.id=NULLIF($1,'')::bigint) GROUP BY w.nombre ORDER BY valor DESC LIMIT 10`);
    const alerts=await safe('alertas',`SELECT w.nombre almacen,m.codigo,m.descripcion material,b.cantidad stock,COALESCE(p.stock_minimo,m.stock_minimo,0) minimo,COALESCE(b.costo_promedio,m.costo_referencia,0) costo,
      CASE WHEN b.cantidad<0 THEN 'NEGATIVO' WHEN COALESCE(p.stock_minimo,m.stock_minimo,0)>0 AND b.cantidad<=COALESCE(p.stock_minimo,m.stock_minimo,0) THEN 'CRITICO' WHEN b.cantidad>0 AND COALESCE(b.costo_promedio,m.costo_referencia,0)<=0 THEN 'SIN COSTO' END alerta
      FROM inventory_balances b JOIN warehouses w ON w.id=b.warehouse_id JOIN materials m ON m.id=b.material_id LEFT JOIN warehouse_material_policies p ON p.warehouse_id=b.warehouse_id AND p.material_id=b.material_id
      WHERE (b.cantidad<0 OR (COALESCE(p.stock_minimo,m.stock_minimo,0)>0 AND b.cantidad<=COALESCE(p.stock_minimo,m.stock_minimo,0)) OR (b.cantidad>0 AND COALESCE(b.costo_promedio,m.costo_referencia,0)<=0)) AND ($1='' OR b.warehouse_id=NULLIF($1,'')::bigint)
      ORDER BY CASE WHEN b.cantidad<0 THEN 0 WHEN b.cantidad<=COALESCE(p.stock_minimo,m.stock_minimo,0) THEN 1 ELSE 2 END,w.nombre,m.descripcion LIMIT 100`);
    const budget=await safe('presupuesto mensual',`SELECT w.id warehouse_id,w.nombre almacen,b.amount::numeric presupuesto,COALESCE(c.consumido,0)::numeric consumido
      FROM warehouses w LEFT JOIN warehouse_monthly_budgets b ON b.warehouse_id=w.id AND b.period=date_trunc('month',CURRENT_DATE)::date
      LEFT JOIN (SELECT warehouse_id,sum(valor) consumido FROM inventory_movements WHERE movement_type='OUT' AND COALESCE(condicion,'') NOT IN ('VACIADO_ALMACEN','PRESTAMO','DEVOLUCION_PRESTAMO') AND COALESCE(fecha_atencion,fecha::date)>=date_trunc('month',CURRENT_DATE)::date GROUP BY warehouse_id) c ON c.warehouse_id=w.id
      WHERE w.activo AND ($1='' OR w.id=NULLIF($1,'')::bigint) ORDER BY w.nombre`);
    res.json({materials:Number(m[0]?.n||0),inventory_value:Number(inv[0]?.valor||0),month_out:Number(outs[0]?.valor||0),month_out_count:Number(outs[0]?.n||0),month_in:Number(ins[0]?.valor||0),month_in_count:Number(ins[0]?.n||0),negative_stock:Number(neg[0]?.n||0),critical:Number(crit[0]?.n||0),groups,monthly,top,dailyCosts,warehouseCompare,alerts,budget,queryErrors,selectedWarehouse:warehouse});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/system/diagnostics',requireRole('ADMIN','SUPERVISOR'),async(req,res)=>{
  try{
    const counts=await q(`SELECT (SELECT count(*) FROM materials WHERE activo)::int materiales,(SELECT count(*) FROM personnel WHERE activo)::int personal,(SELECT count(*) FROM warehouses WHERE activo)::int almacenes,(SELECT count(*) FROM inventory_movements)::int movimientos,(SELECT count(*) FROM inventory_balances)::int posiciones`);
    const mismatches=await q(`WITH ledger AS (SELECT warehouse_id,material_id,SUM(CASE WHEN movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN cantidad ELSE -cantidad END) cantidad FROM inventory_movements GROUP BY warehouse_id,material_id)
      SELECT count(*)::int n FROM inventory_balances b FULL JOIN ledger l USING(warehouse_id,material_id) WHERE abs(COALESCE(b.cantidad,0)-COALESCE(l.cantidad,0))>0.0001`);
    const noCost=await q(`SELECT count(*)::int n FROM inventory_balances WHERE cantidad>0 AND COALESCE(costo_promedio,0)<=0`);
    const orphan=await q(`SELECT count(*)::int n FROM inventory_movements v LEFT JOIN materials m ON m.id=v.material_id LEFT JOIN warehouses w ON w.id=v.warehouse_id WHERE m.id IS NULL OR w.id IS NULL`);
    res.json({ok:Number(mismatches.rows[0].n)===0&&Number(orphan.rows[0].n)===0,counts:counts.rows[0],balancesDescuadrados:Number(mismatches.rows[0].n),materialesConStockSinCosto:Number(noCost.rows[0].n),movimientosHuérfanos:Number(orphan.rows[0].n)});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/lookups',async(req,res)=>{try{const [w,g,f,c]=await Promise.all([q('SELECT id,codigo,nombre FROM warehouses WHERE activo ORDER BY nombre'),q('SELECT id,codigo,nombre FROM material_groups WHERE activo ORDER BY nombre'),q('SELECT f.id,f.codigo,f.nombre,f.grupo_id,g.codigo grupo_codigo FROM material_families f JOIN material_groups g ON g.id=f.grupo_id WHERE f.activo ORDER BY f.nombre'),q('SELECT id,codigo,minera,area,descripcion,proyecto,contrato,codigo_sp2 FROM cost_centers WHERE activo ORDER BY codigo')]);res.json({warehouses:w.rows,groups:g.rows,families:f.rows,cecos:c.rows})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/materials/lookup',async(req,res)=>{
  const term=String(req.query.search||'').trim();
  const warehouse=String(req.query.warehouse||'').trim();
  if(term.length<1) return res.json([]);
  try{
    const r=await q(`SELECT m.id,m.codigo,m.codigo_anterior,m.descripcion,m.unidad,m.moneda,m.ubicacion,m.costo_referencia,
      COALESCE(b.cantidad,0) stock,COALESCE(NULLIF(b.costo_promedio,0),NULLIF(m.costo_referencia,0),0) costo_promedio,COALESCE(b.valor,0) valor,
      g.nombre grupo,f.nombre familia
      FROM materials m LEFT JOIN material_groups g ON g.id=m.grupo_id LEFT JOIN material_families f ON f.id=m.familia_id
      LEFT JOIN inventory_balances b ON b.material_id=m.id AND ($2='' OR b.warehouse_id=CASE WHEN $2~'^\\d+$' THEN $2::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$2 OR codigo=$2 LIMIT 1) END)
      WHERE m.activo AND (m.codigo ILIKE '%'||$1||'%' OR COALESCE(m.codigo_anterior,'') ILIKE '%'||$1||'%' OR m.descripcion ILIKE '%'||$1||'%'
        OR EXISTS(SELECT 1 FROM material_barcodes mb WHERE mb.material_id=m.id AND mb.activo AND mb.barcode ILIKE '%'||$1||'%'))
      ORDER BY CASE WHEN upper(m.codigo)=upper($1) THEN 0 WHEN upper(COALESCE(m.codigo_anterior,''))=upper($1) THEN 1 WHEN m.descripcion ILIKE $1||'%' THEN 2 ELSE 3 END,m.descripcion LIMIT 50`,[term,warehouse]);
    res.json(r.rows);
  }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/materials',async(req,res)=>{
  const s=(req.query.search||'').trim();
  const group=req.query.group||'';
  const family=req.query.family||'';
  const warehouse=req.query.warehouse||'';
  const status=req.query.status||'';
  const loadedOnly=req.query.loaded_only==='1' || req.query.loaded_only==='true';
  const positiveOnly=req.query.positive_only==='1' || req.query.positive_only==='true';
  const limit=Math.min(Math.max(Number(req.query.limit||200),1),10000);
  try{
    const params=[warehouse,group,family,s.toLowerCase()];
    const tokens=s.toLowerCase().split(/\s+/).filter(Boolean).slice(0,8);
    const tokenClauses=[];
    for(const token of tokens){
      params.push('%'+token+'%');
      const p='$'+params.length;
      tokenClauses.push(`(LOWER(m.codigo) LIKE ${p} OR LOWER(COALESCE(m.codigo_anterior,'')) LIKE ${p} OR LOWER(m.descripcion) LIKE ${p} OR LOWER(COALESCE(g.nombre,'')) LIKE ${p} OR LOWER(COALESCE(f.nombre,'')) LIKE ${p} OR EXISTS (SELECT 1 FROM material_barcodes mb WHERE mb.material_id=m.id AND mb.activo AND LOWER(mb.barcode) LIKE ${p}))`);
    }
    const searchClause=tokenClauses.length?tokenClauses.join(' AND '):'TRUE';
    params.push(limit);
    const limitParam='$'+params.length;
    const r=await q(`SELECT m.id,m.codigo,m.codigo_anterior,m.descripcion,m.unidad,m.moneda,CASE WHEN $1<>'' THEN COALESCE((SELECT p.stock_minimo FROM warehouse_material_policies p WHERE p.material_id=m.id AND p.warehouse_id=CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$1 OR codigo=$1 LIMIT 1) END),m.stock_minimo) ELSE m.stock_minimo END stock_minimo,CASE WHEN $1<>'' THEN COALESCE((SELECT p.stock_maximo FROM warehouse_material_policies p WHERE p.material_id=m.id AND p.warehouse_id=CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$1 OR codigo=$1 LIMIT 1) END),m.stock_maximo) ELSE m.stock_maximo END stock_maximo,m.ubicacion,m.costo_referencia,g.codigo grupo_codigo,g.nombre grupo,f.codigo familia_codigo,f.nombre familia,
      CASE WHEN EXISTS (SELECT 1 FROM inventory_balances bx WHERE bx.material_id=m.id AND ($1='' OR bx.warehouse_id = CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$1 OR codigo=$1 LIMIT 1) END))
        THEN COALESCE((SELECT SUM(bx.cantidad) FROM inventory_balances bx WHERE bx.material_id=m.id AND ($1='' OR bx.warehouse_id = CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$1 OR codigo=$1 LIMIT 1) END)),0)
        WHEN EXISTS (SELECT 1 FROM inventory_movements vx WHERE vx.material_id=m.id AND ($1='' OR vx.warehouse_id = CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$1 OR codigo=$1 LIMIT 1) END))
        THEN COALESCE((SELECT SUM(CASE WHEN vx.movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN vx.cantidad ELSE -vx.cantidad END) FROM inventory_movements vx WHERE vx.material_id=m.id AND ($1='' OR vx.warehouse_id = CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$1 OR codigo=$1 LIMIT 1) END)),0)
        ELSE 0 END stock,
      CASE WHEN EXISTS (SELECT 1 FROM inventory_balances bx WHERE bx.material_id=m.id AND ($1='' OR bx.warehouse_id = CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$1 OR codigo=$1 LIMIT 1) END))
        THEN COALESCE((SELECT SUM(bx.valor) FROM inventory_balances bx WHERE bx.material_id=m.id AND ($1='' OR bx.warehouse_id = CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$1 OR codigo=$1 LIMIT 1) END)),0)
        WHEN EXISTS (SELECT 1 FROM inventory_movements vx WHERE vx.material_id=m.id AND ($1='' OR vx.warehouse_id = CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$1 OR codigo=$1 LIMIT 1) END))
        THEN COALESCE((SELECT SUM(CASE WHEN vx.movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN vx.valor ELSE -vx.valor END) FROM inventory_movements vx WHERE vx.material_id=m.id AND ($1='' OR vx.warehouse_id = CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$1 OR codigo=$1 LIMIT 1) END)),0)
        ELSE 0 END valor,
      COALESCE(NULLIF(avg(CASE WHEN ($1='' OR b.warehouse_id = CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$1 OR codigo=$1 LIMIT 1) END) THEN NULLIF(b.costo_promedio,0) END),0),NULLIF(m.costo_referencia,0),NULLIF((SELECT MAX(v.costo_unitario) FROM inventory_movements v WHERE v.material_id=m.id AND v.movement_type='INITIAL' AND COALESCE(v.costo_unitario,0)>0),0),0) costo_promedio,
      CASE WHEN $4='' THEN 0 ELSE
        CASE WHEN LOWER(m.codigo) = $4 THEN 0 WHEN LOWER(COALESCE(m.codigo_anterior,'')) = $4 THEN 1 WHEN LOWER(m.descripcion) LIKE $4||'%' THEN 2 ELSE 3 END END AS relevance
      FROM materials m LEFT JOIN material_groups g ON g.id=m.grupo_id LEFT JOIN material_families f ON f.id=m.familia_id LEFT JOIN inventory_balances b ON b.material_id=m.id
      WHERE m.activo AND ${searchClause}
        AND ($2='' OR g.codigo=$2) AND ($3='' OR f.codigo=$3)
        AND (NOT ${loadedOnly}
          OR EXISTS (SELECT 1 FROM inventory_balances bx WHERE bx.material_id=m.id AND ($1='' OR bx.warehouse_id = CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$1 OR codigo=$1 LIMIT 1) END))
          OR EXISTS (SELECT 1 FROM inventory_movements vx WHERE vx.material_id=m.id AND ($1='' OR vx.warehouse_id = CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$1 OR codigo=$1 LIMIT 1) END)))
        AND (NOT ${positiveOnly}
          OR EXISTS (SELECT 1 FROM inventory_balances bx WHERE bx.material_id=m.id AND bx.cantidad>0 AND ($1='' OR bx.warehouse_id = CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$1 OR codigo=$1 LIMIT 1) END))
          OR EXISTS (SELECT 1 FROM inventory_movements vx WHERE vx.material_id=m.id AND ($1='' OR vx.warehouse_id = CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$1 OR codigo=$1 LIMIT 1) END) GROUP BY vx.material_id HAVING SUM(CASE WHEN vx.movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN vx.cantidad ELSE -vx.cantidad END)>0))
      GROUP BY m.id,g.codigo,g.nombre,f.codigo,f.nombre
      ORDER BY relevance,m.descripcion
      LIMIT ${limitParam}`,params);
    const rows=r.rows.filter(x=>!status || (status==='NEGATIVE'?n(x.stock)<0:status==='CRITICAL'?n(x.stock)>=0&&n(x.stock)<=n(x.stock_minimo)&&n(x.stock_minimo)>0:status==='WITH_STOCK'?n(x.stock)>0:status==='ZERO'?n(x.stock)===0:true));
    res.json(rows);
  }catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/materials',requireRole('ADMIN','SUPERVISOR'),async(req,res)=>{
  const client=await pool.connect();
  try{
    const code=clean(req.body.codigo)?.toUpperCase();
    const oldCode=clean(req.body.codigo_anterior);
    const description=clean(req.body.descripcion);
    const unit=(clean(req.body.unidad)||'UND').toUpperCase();
    const currency=(clean(req.body.moneda)||'SOL').toUpperCase();
    const groupCode=(clean(req.body.grupo_codigo)||'GEN').toUpperCase();
    const groupName=clean(req.body.grupo_nombre)||'GENERAL';
    const familyCode=(clean(req.body.familia_codigo)||'00').toUpperCase();
    const familyName=clean(req.body.familia_nombre)||'GENERAL';
    const cost=Number(req.body.costo_referencia||0);
    const location=clean(req.body.ubicacion);
    if(!code||!description) return res.status(400).json({error:'El código y la descripción son obligatorios.'});
    if(!Number.isFinite(cost)||cost<0) return res.status(400).json({error:'El costo debe ser cero o mayor.'});
    await client.query('BEGIN');
    const duplicate=await client.query("SELECT id FROM materials WHERE upper(codigo)=upper($1::text) OR (NULLIF($2::text,'') IS NOT NULL AND upper(COALESCE(codigo_anterior,''))=upper($2::text)) LIMIT 1",[code,oldCode]);
    if(duplicate.rowCount) throw new Error('El código o código anterior ya está registrado. Busca el material en el Maestro antes de crear otro.');
    const gr=await client.query(`INSERT INTO material_groups(codigo,nombre,activo) VALUES($1,$2,true) ON CONFLICT(codigo) DO UPDATE SET nombre=CASE WHEN material_groups.nombre='' THEN EXCLUDED.nombre ELSE material_groups.nombre END,activo=true RETURNING id`,[groupCode,groupName]);
    const fr=await client.query(`INSERT INTO material_families(grupo_id,codigo,nombre,activo) VALUES($1,$2,$3,true) ON CONFLICT(grupo_id,codigo) DO UPDATE SET nombre=CASE WHEN material_families.nombre='' THEN EXCLUDED.nombre ELSE material_families.nombre END,activo=true RETURNING id`,[gr.rows[0].id,familyCode,familyName]);
    const result=await client.query(`INSERT INTO materials(codigo,codigo_anterior,grupo_id,familia_id,descripcion,unidad,moneda,ubicacion,costo_referencia,activo,stock_minimo,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,0,now()) RETURNING id,codigo,codigo_anterior,descripcion,unidad,moneda,ubicacion,costo_referencia`,[code,oldCode,gr.rows[0].id,fr.rows[0].id,description,unit,currency,location,cost]);
    await client.query(`INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,'CREAR_MATERIAL','materials',$2,$3)`,[req.user.username,String(result.rows[0].id),JSON.stringify({codigo:code,descripcion:description})]);
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  }catch(e){await client.query('ROLLBACK');res.status(400).json({error:e.message})}finally{client.release()}
});

app.post('/api/inventory/load',requireRole('ADMIN','SUPERVISOR','ALMACEN'),async(req,res)=>{
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const warehouse=clean(req.body.warehouse);
    const material=clean(req.body.material_code);
    const counted=Number(req.body.cantidad_contada);
    const codes=[...new Set((Array.isArray(req.body.codes)?req.body.codes:[]).map(clean).filter(Boolean))];
    if(!warehouse||!material) throw new Error('Selecciona almacén y material del Maestro.');
    if(!Number.isFinite(counted)||counted<0) throw new Error('La cantidad debe ser 0 o mayor.');
    const wh=await client.query("SELECT id,nombre FROM warehouses WHERE (id=CASE WHEN $1~'^\\d+$' THEN $1::bigint ELSE NULL END) OR nombre=$1 OR codigo=$1 LIMIT 1",[warehouse]);
    if(!wh.rowCount) throw new Error('Almacén no encontrado.');
    const mat=await client.query('SELECT id,codigo,codigo_anterior,descripcion,unidad,moneda,costo_referencia FROM materials WHERE activo AND (codigo=$1 OR codigo_anterior=$1) LIMIT 1',[material]);
    if(!mat.rowCount) throw new Error('Material no encontrado en el Maestro. No se modificó el inventario.');
    for(const code of codes){
      const existing=await client.query('SELECT material_id FROM material_barcodes WHERE barcode=$1 AND activo LIMIT 1',[code]);
      if(existing.rowCount && Number(existing.rows[0].material_id)!==Number(mat.rows[0].id)) throw new Error(`El código de barras ${code} ya pertenece a otro material.`);
      if(!existing.rowCount) await client.query(`INSERT INTO material_barcodes(material_id,barcode,symbology,is_primary,created_by) VALUES($1,$2,'SCANNED',false,$3)`,[mat.rows[0].id,code,req.user.username]);
    }
    const bal=await ensureBalance(client,wh.rows[0].id,mat.rows[0].id);
    const current=n(bal.cantidad);
    const otherCost=await client.query(`SELECT COALESCE(MAX(NULLIF(costo_promedio,0)),0) costo FROM inventory_balances WHERE material_id=$1`,[mat.rows[0].id]);
    const initialCost=await client.query(`SELECT COALESCE(MAX(NULLIF(costo_unitario,0)),0) costo FROM inventory_movements WHERE material_id=$1 AND movement_type IN ('INITIAL','IN')`,[mat.rows[0].id]);
    const cost=n(bal.costo_promedio)||n(mat.rows[0].costo_referencia)||n(otherCost.rows[0]?.costo)||n(initialCost.rows[0]?.costo);
    const delta=counted-current;
    if(Math.abs(delta)>0.0000001){
      const type=delta>0?'IN':'OUT', qty=Math.abs(delta), value=qty*cost;
      await client.query(`INSERT INTO inventory_movements(movement_type,fecha,fecha_atencion,fecha_digitacion,warehouse_id,material_id,cantidad,costo_unitario,valor,moneda,documento,numero,condicion,observacion,source,created_by)
        VALUES($1,now(),CURRENT_DATE,CURRENT_DATE,$2,$3,$4,$5,$6,$7,$8,$9,'CARGA_INVENTARIO',$10,'SILOG',$11)`,
        [type,wh.rows[0].id,mat.rows[0].id,qty,cost,value,mat.rows[0].moneda||'SOL',`CARGA-${wh.rows[0].nombre}`,`INV-${Date.now()}`,`Carga de inventario: ${current} → ${counted}; códigos asociados: ${codes.length}`,req.user.username]);
    }
    await client.query(`UPDATE inventory_balances SET cantidad=$1,costo_promedio=$2,valor=$3,updated_at=now() WHERE warehouse_id=$4 AND material_id=$5`,
      [counted,cost,counted*cost,wh.rows[0].id,mat.rows[0].id]);
    await client.query(`INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,'CARGA_INVENTARIO_ALMACEN','INVENTORY_BALANCE',$2,$3)`,
      [req.user.username,`${wh.rows[0].id}:${mat.rows[0].id}`,JSON.stringify({almacen:wh.rows[0].nombre,codigo:mat.rows[0].codigo,descripcion:mat.rows[0].descripcion,stock_anterior:current,stock_contado:counted,codigos_asociados:codes})]);
    await client.query('COMMIT');
    res.json({ok:true,almacen:wh.rows[0].nombre,codigo:mat.rows[0].codigo,descripcion:mat.rows[0].descripcion,unidad:mat.rows[0].unidad,cantidad:counted,costo,valor:counted*cost,codigos_asociados:codes.length});
  }catch(e){await client.query('ROLLBACK');res.status(400).json({error:e.message})}finally{client.release()}
});

app.post('/api/inventory/scan-session/save',requireRole('ADMIN','SUPERVISOR','ALMACEN'),async(req,res)=>{
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const warehouse=clean(req.body.warehouse); const material=clean(req.body.material_code); const codes=Array.isArray(req.body.codes)?req.body.codes.map(clean).filter(Boolean):[];
    if(!warehouse||!material) throw new Error('Selecciona almacén y material.');
    const wh=await client.query("SELECT id,nombre FROM warehouses WHERE (id=CASE WHEN $1~'^\\d+$' THEN $1::bigint ELSE NULL END) OR nombre=$1 OR codigo=$1 LIMIT 1",[warehouse]);
    if(!wh.rowCount) throw new Error('Almacén no encontrado.');
    const mat=await client.query('SELECT id,codigo,descripcion,unidad,moneda,costo_referencia FROM materials WHERE activo AND (codigo=$1 OR codigo_anterior=$1) LIMIT 1',[material]);
    if(!mat.rowCount) throw new Error('Material no encontrado en el Maestro.');
    if(!codes.length) throw new Error('Escanea al menos un código para guardar la carga.');
    for(const code of codes){
      const existing=await client.query('SELECT material_id FROM material_barcodes WHERE barcode=$1 AND activo LIMIT 1',[code]);
      if(existing.rowCount && Number(existing.rows[0].material_id)!==Number(mat.rows[0].id)) throw new Error(`El código ${code} ya está asociado a otro material.`);
      if(!existing.rowCount) await client.query(`INSERT INTO material_barcodes(material_id,barcode,symbology,is_primary,created_by) VALUES($1,$2,'SCANNED',false,$3)`,[mat.rows[0].id,code,req.user.username]);
    }
    const bal=await ensureBalance(client,wh.rows[0].id,mat.rows[0].id);
    const counted=codes.length;
    const current=n(bal.cantidad); const cost=n(bal.costo_promedio)||n(mat.rows[0].costo_referencia);
    const delta=counted-current;
    if(Math.abs(delta)>0.0000001){
      const type=delta>0?'IN':'OUT', qty=Math.abs(delta), value=qty*cost;
      await client.query(`INSERT INTO inventory_movements(movement_type,fecha,fecha_atencion,fecha_digitacion,warehouse_id,material_id,cantidad,costo_unitario,valor,moneda,documento,condicion,observacion,source,created_by) VALUES($1,now(),CURRENT_DATE,CURRENT_DATE,$2,$3,$4,$5,$6,$7,$8,'CONTEO_BARRAS',$9,'SCANNER_IPHONE',$10)`,[type,wh.rows[0].id,mat.rows[0].id,qty,cost,value,mat.rows[0].moneda||'SOL',`CARGA-BARRAS-${wh.rows[0].nombre}`,`Conteo por escaneo: ${current} → ${counted}`,req.user.username]);
    }
    await client.query(`UPDATE inventory_balances SET cantidad=$1,costo_promedio=$2,valor=$3,updated_at=now() WHERE warehouse_id=$4 AND material_id=$5`,[counted,cost,counted*cost,wh.rows[0].id,mat.rows[0].id]);
    await client.query(`INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,'CARGA_INVENTARIO_BARRAS','INVENTORY_BALANCE',$2,$3)`,[req.user.username,`${wh.rows[0].id}:${mat.rows[0].id}`,JSON.stringify({almacen:wh.rows[0].nombre,codigo:mat.rows[0].codigo,descripcion:mat.rows[0].descripcion,cantidad_contada:counted,codigos:codes.length})]);
    await client.query('COMMIT'); res.json({ok:true,almacen:wh.rows[0].nombre,codigo:mat.rows[0].codigo,descripcion:mat.rows[0].descripcion,cantidad:counted,costo:cost,valor:counted*cost});
  }catch(e){await client.query('ROLLBACK');res.status(400).json({error:e.message})}finally{client.release()}
});

app.get('/api/barcode/lookup',async(req,res)=>{try{
  const code=clean(req.query.code);
  const warehouse=clean(req.query.warehouse)||'';
  const salida=req.query.salida==='1' || req.query.salida==='true';
  if(!code) return res.status(400).json({error:'Código de barras requerido'});
  const r=await q(`SELECT m.id,m.codigo,m.codigo_anterior,m.descripcion,m.unidad,m.moneda,m.ubicacion,m.costo_referencia,g.nombre grupo,f.nombre familia,
    COALESCE(sum(CASE WHEN $2='' OR b.warehouse_id=CASE WHEN $2~'^\\d+$' THEN $2::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$2 OR codigo=$2 LIMIT 1) END THEN b.cantidad ELSE 0 END),0) stock,
    COALESCE(sum(CASE WHEN $2='' OR b.warehouse_id=CASE WHEN $2~'^\\d+$' THEN $2::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$2 OR codigo=$2 LIMIT 1) END THEN b.valor ELSE 0 END),0) valor,
    COALESCE(NULLIF(avg(CASE WHEN $2='' OR b.warehouse_id=CASE WHEN $2~'^\\d+$' THEN $2::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$2 OR codigo=$2 LIMIT 1) END THEN NULLIF(b.costo_promedio,0) END),0),NULLIF(m.costo_referencia,0),0) costo_promedio,
    COALESCE((SELECT json_agg(json_build_object('almacen',w2.nombre,'stock',b2.cantidad,'costo',b2.costo_promedio,'valor',b2.valor) ORDER BY w2.nombre) FROM inventory_balances b2 JOIN warehouses w2 ON w2.id=b2.warehouse_id WHERE b2.material_id=m.id),'[]') inventario,
    EXISTS(SELECT 1 FROM inventory_balances bx WHERE bx.material_id=m.id AND bx.cantidad>0 AND ($2='' OR bx.warehouse_id=CASE WHEN $2~'^\\d+$' THEN $2::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$2 OR codigo=$2 LIMIT 1) END)) en_almacen
    FROM materials m LEFT JOIN material_groups g ON g.id=m.grupo_id LEFT JOIN material_families f ON f.id=m.familia_id LEFT JOIN inventory_balances b ON b.material_id=m.id
    WHERE m.activo AND (m.codigo=$1 OR COALESCE(m.codigo_anterior,'')=$1 OR EXISTS(SELECT 1 FROM material_barcodes mb WHERE mb.material_id=m.id AND mb.barcode=$1 AND mb.activo))
    GROUP BY m.id,g.nombre,f.nombre LIMIT 1`,[code,warehouse]);
  if(!r.rowCount) return res.status(404).json({error:`No existe un material asociado al código ${code}`});
  const x=r.rows[0];
  if(salida && (!x.en_almacen || Number(x.stock)<=0)) return res.status(409).json({error:`El material ${x.codigo} no tiene stock disponible en el almacén seleccionado.`});
  const bc=await q(`SELECT barcode,symbology,is_primary FROM material_barcodes WHERE material_id=$1 AND activo ORDER BY is_primary DESC,barcode`,[x.id]);
  res.json({...x,barcodes:bc.rows,scanned_code:code});
}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/barcodes',requireRole('ADMIN','SUPERVISOR','ALMACEN'),async(req,res)=>{try{
  const code=clean(req.body.barcode), material=clean(req.body.material_code), sym=clean(req.body.symbology)||'UNKNOWN';
  if(!code||!material) throw new Error('Código de barras y material son obligatorios');
  const m=await q('SELECT id FROM materials WHERE activo AND (codigo=$1 OR codigo_anterior=$1) LIMIT 1',[material]);
  if(!m.rowCount) throw new Error('Material no encontrado');
  const r=await q(`INSERT INTO material_barcodes(material_id,barcode,symbology,is_primary,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(barcode) DO UPDATE SET material_id=EXCLUDED.material_id,symbology=EXCLUDED.symbology,activo=true,created_by=EXCLUDED.created_by RETURNING id,barcode,symbology,is_primary`,[m.rows[0].id,code,sym,req.body.is_primary===true,req.user.username]);
  await q(`INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,'ASOCIAR_CODIGO_BARRAS','MATERIAL',$2,$3)`,[req.user.username,String(m.rows[0].id),JSON.stringify({barcode:code,symbology:sym,material})]);
  res.json(r.rows[0]);
}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/material/:codigo',async(req,res)=>{try{const r=await q(`SELECT m.*,g.nombre grupo,f.nombre familia,COALESCE(json_agg(json_build_object('almacen',w.nombre,'stock',b.cantidad,'costo',b.costo_promedio,'valor',b.valor) ORDER BY w.nombre) FILTER(WHERE w.id IS NOT NULL),'[]') inventario FROM materials m LEFT JOIN material_groups g ON g.id=m.grupo_id LEFT JOIN material_families f ON f.id=m.familia_id LEFT JOIN inventory_balances b ON b.material_id=m.id LEFT JOIN warehouses w ON w.id=b.warehouse_id WHERE m.codigo=$1 GROUP BY m.id,g.nombre,f.nombre`,[req.params.codigo]);if(!r.rowCount)return res.status(404).json({error:'Material no encontrado'});const mv=await q(`SELECT v.fecha,v.movement_type,v.documento,v.numero,v.cantidad,v.costo_unitario,v.valor,w.nombre almacen,v.dni,v.solicitante,v.observacion FROM inventory_movements v JOIN warehouses w ON w.id=v.warehouse_id WHERE v.material_id=$1 ORDER BY v.fecha DESC,v.id DESC LIMIT 200`,[r.rows[0].id]);res.json({...r.rows[0],movimientos:mv.rows})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/warehouses',async(req,res)=>{try{res.json((await q('SELECT * FROM warehouses WHERE activo ORDER BY nombre')).rows)}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/warehouses',requireRole('ADMIN','SUPERVISOR'),async(req,res)=>{try{const nombre=clean(req.body.nombre);if(!nombre)throw new Error('Nombre de almacén requerido');const codigo=clean(req.body.codigo)||nombre.toUpperCase().replace(/[^A-Z0-9]+/g,'_').slice(0,40);const r=await q(`INSERT INTO warehouses(codigo,nombre,activo) VALUES($1,$2,true) ON CONFLICT(nombre) DO UPDATE SET codigo=EXCLUDED.codigo,activo=true RETURNING *`,[codigo,nombre]);res.json(r.rows[0])}catch(e){res.status(400).json({error:e.message})}});
// Kits operativos: definición de componentes y existencias independientes por almacén.
app.get('/api/kits',async(req,res)=>{
 try{
  const warehouse=String(req.query.warehouse||'');
  const r=await q(`SELECT k.id,k.codigo,k.nombre,k.descripcion,COALESCE(kb.cantidad,0) cantidad,COALESCE(kb.valor,0) valor,
    COALESCE(json_agg(json_build_object('codigo',m.codigo,'descripcion',m.descripcion,'unidad',m.unidad,'cantidad',kc.cantidad) ORDER BY m.descripcion) FILTER(WHERE m.id IS NOT NULL),'[]') componentes
    FROM kits k LEFT JOIN kit_balances kb ON kb.kit_id=k.id AND ($1='' OR kb.warehouse_id=CASE WHEN $1~'^\\d+$' THEN $1::bigint ELSE (SELECT id FROM warehouses WHERE nombre=$1 OR codigo=$1 LIMIT 1) END)
    LEFT JOIN kit_components kc ON kc.kit_id=k.id LEFT JOIN materials m ON m.id=kc.material_id WHERE k.activo
    GROUP BY k.id,kb.cantidad,kb.valor ORDER BY k.nombre`,[warehouse]);
  res.json(r.rows);
 }catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/kits',requireRole('ADMIN','SUPERVISOR','ALMACEN'),async(req,res)=>{
 const client=await pool.connect();
 try{
  const codigo=clean(req.body.codigo)?.toUpperCase(), nombre=clean(req.body.nombre), descripcion=clean(req.body.descripcion);
  const components=Array.isArray(req.body.componentes)?req.body.componentes:[];
  if(!codigo||!nombre)throw new Error('Código y nombre del kit son obligatorios.');
  if(!components.length)throw new Error('Agrega al menos un material componente.');
  await client.query('BEGIN');
  const dupe=await client.query('SELECT id FROM kits WHERE upper(codigo)=upper($1)',[codigo]);if(dupe.rowCount)throw new Error('Ya existe un kit con ese código.');
  const kit=(await client.query('INSERT INTO kits(codigo,nombre,descripcion,created_by) VALUES($1,$2,$3,$4) RETURNING id,codigo,nombre,descripcion',[codigo,nombre,descripcion,req.user.username])).rows[0];
  const seen=new Set();
  for(const c of components){
   const code=clean(c.codigo)?.toUpperCase(),qty=Number(c.cantidad);
   if(!code||!Number.isFinite(qty)||qty<=0)throw new Error('Cada componente debe tener un código válido y cantidad mayor que cero.');
   if(seen.has(code))throw new Error(`El componente ${code} está repetido.`);seen.add(code);
   const mat=await client.query('SELECT id FROM materials WHERE activo AND upper(codigo)=upper($1) LIMIT 1',[code]);if(!mat.rowCount)throw new Error(`No existe el material ${code} en el Maestro.`);
   await client.query('INSERT INTO kit_components(kit_id,material_id,cantidad) VALUES($1,$2,$3)',[kit.id,mat.rows[0].id,qty]);
  }
  await client.query('INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,\'CREAR_KIT\',\'KIT\',$2,$3)',[req.user.username,String(kit.id),JSON.stringify({codigo,nombre,componentes:components})]);
  await client.query('COMMIT');res.status(201).json(kit);
 }catch(e){await client.query('ROLLBACK');res.status(400).json({error:e.message})}finally{client.release()}
});
app.post('/api/kits/:id/assemble',requireRole('ADMIN','SUPERVISOR','ALMACEN'),async(req,res)=>{
 const client=await pool.connect();
 try{
  const warehouse=clean(req.body.almacen),quantity=Number(req.body.cantidad);
  if(!warehouse)throw new Error('Selecciona el almacén donde se armará el kit.');
  if(!Number.isInteger(quantity)||quantity<1)throw new Error('La cantidad de kits debe ser un entero mayor que cero.');
  await client.query('BEGIN');
  const wh=await client.query("SELECT id,nombre FROM warehouses WHERE (id=CASE WHEN $1~'^\\d+$' THEN $1::bigint ELSE NULL END) OR nombre=$1 OR codigo=$1 LIMIT 1",[warehouse]);if(!wh.rowCount)throw new Error('Almacén no encontrado.');
  const kit=await client.query('SELECT * FROM kits WHERE id=$1 AND activo FOR UPDATE',[req.params.id]);if(!kit.rowCount)throw new Error('Kit no encontrado.');
  const components=(await client.query('SELECT kc.cantidad,m.id material_id,m.codigo,m.descripcion,m.unidad,m.moneda,m.costo_referencia FROM kit_components kc JOIN materials m ON m.id=kc.material_id WHERE kc.kit_id=$1 ORDER BY m.codigo',[kit.rows[0].id])).rows;
  if(!components.length)throw new Error('El kit no tiene componentes registrados.');
  let total=0;
  for(const c of components){
   const needed=Number(c.cantidad)*quantity,bal=await ensureBalance(client,wh.rows[0].id,c.material_id);
   if(Number(bal.cantidad)<needed)throw new Error(`Stock insuficiente para ${c.codigo} en ${wh.rows[0].nombre}. Disponible: ${bal.cantidad}; requerido: ${needed}.`);
   const cost=Number(bal.costo_promedio)||Number(c.costo_referencia)||0,value=needed*cost;total+=value;
   const ins=await client.query(`INSERT INTO inventory_movements(movement_type,fecha,fecha_atencion,fecha_digitacion,warehouse_id,material_id,cantidad,costo_unitario,valor,moneda,documento,numero,condicion,observacion,source,created_by)
    VALUES('OUT',now(),CURRENT_DATE,CURRENT_DATE,$1,$2,$3,$4,$5,$6,$7,$8,'ARMADO_KIT',$9,'SILOG_KIT',$10) RETURNING id`,[wh.rows[0].id,c.material_id,needed,cost,value,c.moneda||'SOL',`ARMADO KIT ${kit.rows[0].codigo}`,`KIT-${kit.rows[0].codigo}-${Date.now()}`,`Consumo de ${needed} unidades para armar ${quantity} kit(s) ${kit.rows[0].codigo}`,req.user.username]);
   await client.query('UPDATE inventory_balances SET cantidad=$1,valor=$2,updated_at=now() WHERE warehouse_id=$3 AND material_id=$4',[Number(bal.cantidad)-needed,Number(bal.valor)-value,wh.rows[0].id,c.material_id]);
  }
  await client.query(`INSERT INTO kit_balances(kit_id,warehouse_id,cantidad,costo_promedio,valor) VALUES($1,$2,$3,$4,$5) ON CONFLICT(kit_id,warehouse_id) DO UPDATE SET cantidad=kit_balances.cantidad+EXCLUDED.cantidad,valor=kit_balances.valor+EXCLUDED.valor,costo_promedio=CASE WHEN kit_balances.cantidad+EXCLUDED.cantidad>0 THEN (kit_balances.valor+EXCLUDED.valor)/(kit_balances.cantidad+EXCLUDED.cantidad) ELSE 0 END,updated_at=now()`,[kit.rows[0].id,wh.rows[0].id,quantity,total/quantity,total]);
  const mov=await client.query('INSERT INTO kit_movements(kit_id,warehouse_id,tipo,cantidad,costo_unitario,valor,observacion,created_by) VALUES($1,$2,\'ARMADO\',$3,$4,$5,$6,$7) RETURNING id',[kit.rows[0].id,wh.rows[0].id,quantity,total/quantity,total,clean(req.body.observacion),req.user.username]);
  await client.query('INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,\'ARMAR_KIT\',\'KIT\',$2,$3)',[req.user.username,String(kit.rows[0].id),JSON.stringify({almacen:wh.rows[0].nombre,cantidad:quantity,valor:total,movimiento:mov.rows[0].id})]);
  await client.query('COMMIT');res.json({ok:true,codigo:kit.rows[0].codigo,nombre:kit.rows[0].nombre,almacen:wh.rows[0].nombre,cantidad:quantity,valor:total});
 }catch(e){await client.query('ROLLBACK');res.status(400).json({error:e.message})}finally{client.release()}
});
app.post('/api/kits/:id/dispatch',requireRole('ADMIN','SUPERVISOR','ALMACEN','OPERADOR'),async(req,res)=>{
 const client=await pool.connect();try{
  const warehouse=clean(req.body.almacen),quantity=Number(req.body.cantidad);if(!Number.isInteger(quantity)||quantity<1)throw new Error('La cantidad debe ser un entero mayor que cero.');
  await client.query('BEGIN');const wh=await client.query("SELECT id,nombre FROM warehouses WHERE (id=CASE WHEN $1~'^\\d+$' THEN $1::bigint ELSE NULL END) OR nombre=$1 OR codigo=$1 LIMIT 1",[warehouse]);if(!wh.rowCount)throw new Error('Almacén no encontrado.');
  const kit=(await client.query('SELECT * FROM kits WHERE id=$1 AND activo FOR UPDATE',[req.params.id])).rows[0];if(!kit)throw new Error('Kit no encontrado.');
  const bal=await client.query('SELECT * FROM kit_balances WHERE kit_id=$1 AND warehouse_id=$2 FOR UPDATE',[kit.id,wh.rows[0].id]);if(!bal.rowCount||Number(bal.rows[0].cantidad)<quantity)throw new Error(`Stock de kits insuficiente en ${wh.rows[0].nombre}.`);
  const value=Number(bal.rows[0].costo_promedio)*quantity;await client.query('UPDATE kit_balances SET cantidad=cantidad-$1,valor=GREATEST(0,valor-$2),updated_at=now() WHERE kit_id=$3 AND warehouse_id=$4',[quantity,value,kit.id,wh.rows[0].id]);
  await client.query('INSERT INTO kit_movements(kit_id,warehouse_id,tipo,cantidad,costo_unitario,valor,observacion,created_by) VALUES($1,$2,\'SALIDA\',$3,$4,$5,$6,$7)',[kit.id,wh.rows[0].id,quantity,bal.rows[0].costo_promedio,value,clean(req.body.observacion),req.user.username]);
  await client.query('INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,\'SALIDA_KIT\',\'KIT\',$2,$3)',[req.user.username,String(kit.id),JSON.stringify({almacen:wh.rows[0].nombre,cantidad:quantity,valor:value})]);
  await client.query('COMMIT');res.json({ok:true,codigo:kit.codigo,almacen:wh.rows[0].nombre,cantidad:quantity,valor:value});
 }catch(e){await client.query('ROLLBACK');res.status(400).json({error:e.message})}finally{client.release()}
});

app.post('/api/inventory/count',requireRole('ADMIN','SUPERVISOR','ALMACEN'),async(req,res)=>{
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const codigo=clean(req.body.codigo); const almacen=clean(req.body.almacen); const counted=n(req.body.cantidad_contada);
    if(!codigo) throw new Error('Material no identificado');
    if(!(counted>=0) || !Number.isFinite(counted)) throw new Error('La cantidad contada debe ser 0 o mayor');
    const mat=await client.query(`SELECT id,codigo,descripcion,unidad,moneda,costo_referencia FROM materials WHERE activo AND (codigo=$1 OR codigo_anterior=$1 OR id IN (SELECT material_id FROM material_barcodes WHERE barcode=$1 AND activo)) LIMIT 1`,[codigo]);
    if(!mat.rowCount) throw new Error('Material no encontrado en el Maestro');
    const wh=await client.query("SELECT id,nombre FROM warehouses WHERE (id=CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE NULL END) OR nombre=$1 OR codigo=$1 LIMIT 1",[almacen]);
    if(!wh.rowCount) throw new Error('Almacén no encontrado');
    const bal=await ensureBalance(client,wh.rows[0].id,mat.rows[0].id);
    const current=n(bal.cantidad); const delta=counted-current; const fallback=await client.query(`SELECT COALESCE(MAX(NULLIF(costo_promedio,0)),0) costo FROM inventory_balances WHERE material_id=$1`,[mat.rows[0].id]); const cost=n(bal.costo_promedio)||n(mat.rows[0].costo_referencia)||n(fallback.rows[0]?.costo);
    let movementId=null;
    if(Math.abs(delta)>0.0000001){
      const type=delta>0?'IN':'OUT'; const qty=Math.abs(delta); const value=qty*cost;
      const ins=await client.query(`INSERT INTO inventory_movements(movement_type,fecha,fecha_atencion,fecha_digitacion,warehouse_id,material_id,cantidad,costo_unitario,valor,moneda,documento,condicion,observacion,source,created_by) VALUES($1,now(),CURRENT_DATE,CURRENT_DATE,$2,$3,$4,$5,$6,$7,$8,'CONTEO_FISICO',$9,'SILOG',$10) RETURNING id`,[type,wh.rows[0].id,mat.rows[0].id,qty,cost,value,mat.rows[0].moneda||'SOL',`CONTEO-${wh.rows[0].nombre}`,req.body.observacion||`Conteo físico: ${current} → ${counted}`,req.user.username]);
      movementId=ins.rows[0].id;
    }
    await client.query(`UPDATE inventory_balances SET cantidad=$1,costo_promedio=$2,valor=$3,updated_at=now() WHERE warehouse_id=$4 AND material_id=$5`,[counted,cost,counted*cost,wh.rows[0].id,mat.rows[0].id]);
    await client.query(`INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,'CONTEO_FISICO','INVENTORY_BALANCE',$2,$3)`,[req.user.username,`${wh.rows[0].id}:${mat.rows[0].id}`,JSON.stringify({almacen:wh.rows[0].nombre,codigo:mat.rows[0].codigo,descripcion:mat.rows[0].descripcion,stock_anterior:current,stock_contado:counted,diferencia:delta,movement_id:movementId})]);
    await client.query('COMMIT'); res.json({ok:true,movement_id:movementId,almacen:wh.rows[0].nombre,codigo:mat.rows[0].codigo,descripcion:mat.rows[0].descripcion,stock_anterior:current,stock_contado:counted,diferencia:delta,costo:cost,valor:counted*cost});
  }catch(e){await client.query('ROLLBACK');res.status(400).json({error:e.message})}finally{client.release()}
});
app.post('/api/inventory/clear-warehouse',requireRole('ADMIN','SUPERVISOR'),async(req,res)=>{
  const client=await pool.connect();
  try{
    const warehouse=clean(req.body.almacen), confirmation=String(req.body.confirmacion||'').trim().toUpperCase(), reason=clean(req.body.motivo);
    if(!warehouse)throw new Error('Selecciona el almacén que deseas vaciar.');
    if(confirmation!=='VACIAR')throw new Error('Para confirmar, escribe exactamente VACIAR.');
    if(!reason)throw new Error('Escribe el motivo del vaciado.');
    await client.query('BEGIN');
    const wh=(await client.query("SELECT id,nombre,codigo FROM warehouses WHERE (id=CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE NULL END) OR nombre=$1 OR codigo=$1 LIMIT 1 FOR UPDATE",[warehouse])).rows[0];
    if(!wh)throw new Error('Almacén no encontrado.');
    const balances=(await client.query(`SELECT b.material_id,b.cantidad,b.costo_promedio,m.codigo,m.descripcion FROM inventory_balances b JOIN materials m ON m.id=b.material_id WHERE b.warehouse_id=$1 FOR UPDATE`,[wh.id])).rows;
    let affected=0,units=0,value=0;
    for(const b of balances){
      const qty=Number(b.cantidad||0),cost=Number(b.costo_promedio||0);
      if(Math.abs(qty)>0.0000001){
        const type=qty>0?'CLEAR':'IN',movementQty=Math.abs(qty),movementValue=Math.abs(qty)*cost;
        await client.query(`INSERT INTO inventory_movements(movement_type,fecha,fecha_atencion,fecha_digitacion,warehouse_id,material_id,cantidad,costo_unitario,valor,moneda,documento,condicion,observacion,source,created_by)
          VALUES($1,now(),CURRENT_DATE,CURRENT_DATE,$2,$3,$4,$5,$6,'SOL',$7,'VACIADO_ALMACEN',$8,'SILOG',$9)`,[type,wh.id,b.material_id,movementQty,cost,movementValue,`VACIADO-${wh.codigo||wh.id}`,`${reason}. Stock anterior: ${qty}; saldo fijado en cero.`,req.user.username]);
        affected++;units+=Math.abs(qty);value+=movementValue;
      }
    }
    await client.query('UPDATE inventory_balances SET cantidad=0,valor=0,updated_at=now() WHERE warehouse_id=$1',[wh.id]);
    await client.query(`INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,'VACIAR_ALMACEN','WAREHOUSE',$2,$3)`,[req.user.username,String(wh.id),JSON.stringify({almacen:wh.nombre,motivo:reason,posiciones_ajustadas:affected,unidades_regularizadas:units,valor_regularizado:value})]);
    await client.query('COMMIT');res.json({ok:true,almacen:wh.nombre,posiciones_ajustadas:affected,unidades_regularizadas:units,valor_regularizado:value});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});res.status(400).json({error:e.message})}finally{client.release()}
});
app.post('/api/transfers',requireRole('ADMIN','SUPERVISOR','ALMACEN'),async(req,res)=>{
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const fromValue=clean(req.body.origen),toValue=clean(req.body.destino),codigo=clean(req.body.codigo),qty=Number(req.body.cantidad),reason=clean(req.body.observacion)||'Transferencia interna';
    if(!fromValue||!toValue||!codigo)throw new Error('Selecciona almacén de origen, destino y material.');
    if(!Number.isFinite(qty)||qty<=0)throw new Error('La cantidad debe ser mayor que cero.');
    const from=await client.query("SELECT id,nombre,codigo FROM warehouses WHERE (id=CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE NULL END) OR nombre=$1 OR codigo=$1 LIMIT 1 FOR UPDATE",[fromValue]);
    const to=await client.query("SELECT id,nombre,codigo FROM warehouses WHERE (id=CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE NULL END) OR nombre=$1 OR codigo=$1 LIMIT 1 FOR UPDATE",[toValue]);
    if(!from.rowCount||!to.rowCount)throw new Error('Almacén de origen o destino no encontrado.');
    if(String(from.rows[0].id)===String(to.rows[0].id))throw new Error('El almacén de origen y destino deben ser diferentes.');
    const mat=await client.query('SELECT id,codigo,descripcion,unidad,moneda,costo_referencia FROM materials WHERE activo AND (codigo=$1 OR codigo_anterior=$1) LIMIT 1',[codigo]);
    if(!mat.rowCount)throw new Error('Material no encontrado en el Maestro.');
    const src=await ensureBalance(client,from.rows[0].id,mat.rows[0].id);
    const dst=await ensureBalance(client,to.rows[0].id,mat.rows[0].id);
    if(Number(src.cantidad)<qty)throw new Error(`Stock insuficiente en ${from.rows[0].nombre}. Disponible: ${src.cantidad}.`);
    const cost=Number(src.costo_promedio)||Number(mat.rows[0].costo_referencia)||0;
    const value=Number((qty*cost).toFixed(2));
    const number='TRF-'+new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)+'-'+crypto.randomBytes(2).toString('hex').toUpperCase();
    const date=limaToday(),timestamp=`${date}T12:00:00`;
    for(const movement of [
      {type:'TRANSFER_OUT',warehouse:from.rows[0].id,condition:'TRANSFERENCIA_SALIDA'},
      {type:'TRANSFER_IN',warehouse:to.rows[0].id,condition:'TRANSFERENCIA_INGRESO'}
    ]){
      await client.query(`INSERT INTO inventory_movements(movement_type,fecha,fecha_atencion,fecha_digitacion,warehouse_id,material_id,cantidad,costo_unitario,valor,moneda,documento,numero,condicion,observacion,source,created_by)
        VALUES($1,$2,$3::date,$3::date,$4,$5,$6,$7,$8,$9,'TRANSFERENCIA',$10,$11,$12,'SILOG',$13)`,[movement.type,timestamp,date,movement.warehouse,mat.rows[0].id,qty,cost,value,mat.rows[0].moneda||'SOL',number,movement.condition,`${reason}. ${from.rows[0].nombre} → ${to.rows[0].nombre}`,req.user.username]);
    }
    const srcQty=Number(src.cantidad)-qty,srcValue=Number(src.valor)-value,dstQty=Number(dst.cantidad)+qty,dstValue=Number(dst.valor)+value;
    await client.query('UPDATE inventory_balances SET cantidad=$1,valor=$2,updated_at=now() WHERE warehouse_id=$3 AND material_id=$4',[srcQty,srcValue,from.rows[0].id,mat.rows[0].id]);
    const dstAvg=dstQty>0?((Number(dst.cantidad)*Number(dst.costo_promedio)+value)/dstQty):cost;
    await client.query('UPDATE inventory_balances SET cantidad=$1,costo_promedio=$2,valor=$3,updated_at=now() WHERE warehouse_id=$4 AND material_id=$5',[dstQty,dstAvg,dstValue,to.rows[0].id,mat.rows[0].id]);
    await client.query(`INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,'TRANSFERENCIA','INVENTORY_MOVEMENT',$2,$3)`,[req.user.username,number,JSON.stringify({origen:from.rows[0].nombre,destino:to.rows[0].nombre,codigo:mat.rows[0].codigo,cantidad:qty,costo_unitario:cost,valor:value,motivo:reason})]);
    await client.query('COMMIT');res.json({ok:true,numero,material:mat.rows[0].descripcion,codigo:mat.rows[0].codigo,cantidad:qty,origen:from.rows[0].nombre,destino:to.rows[0].nombre,costo_unitario:cost,valor:value});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});res.status(400).json({error:e.message})}finally{client.release()}
});
app.get('/api/transfers',async(req,res)=>{try{
  const rows=await q(`SELECT v.numero,MAX(v.fecha) fecha,MAX(v.created_by) usuario,MAX(v.observacion) observacion,MAX(m.codigo) codigo,MAX(m.descripcion) material,MAX(v.cantidad)::numeric cantidad,MAX(v.costo_unitario)::numeric costo_unitario,MAX(v.valor)::numeric valor,
    MAX(w.nombre) FILTER(WHERE v.movement_type='TRANSFER_OUT') origen,MAX(w.nombre) FILTER(WHERE v.movement_type='TRANSFER_IN') destino
    FROM inventory_movements v JOIN warehouses w ON w.id=v.warehouse_id JOIN materials m ON m.id=v.material_id WHERE v.movement_type IN ('TRANSFER_OUT','TRANSFER_IN') AND ($1='' OR v.numero ILIKE '%'||$1||'%' OR m.codigo ILIKE '%'||$1||'%' OR m.descripcion ILIKE '%'||$1||'%')
    GROUP BY v.numero ORDER BY MAX(v.fecha) DESC LIMIT 200`,[String(req.query.search||'').trim()]);res.json(rows.rows)
}catch(e){res.status(500).json({error:e.message})}});

app.get('/api/inventory/policies',async(req,res)=>{try{
  const warehouse=String(req.query.warehouse||'').trim();
  const rows=await q(`SELECT w.id warehouse_id,w.nombre almacen,m.id material_id,m.codigo,m.descripcion,m.unidad,b.cantidad stock,COALESCE(p.stock_minimo,m.stock_minimo,0)::numeric stock_minimo,COALESCE(p.stock_maximo,m.stock_maximo,0)::numeric stock_maximo,COALESCE(b.costo_promedio,m.costo_referencia,0)::numeric costo
    FROM inventory_balances b JOIN warehouses w ON w.id=b.warehouse_id JOIN materials m ON m.id=b.material_id LEFT JOIN warehouse_material_policies p ON p.warehouse_id=b.warehouse_id AND p.material_id=b.material_id
    WHERE ($1='' OR w.id=NULLIF($1,'')::bigint) ORDER BY w.nombre,m.descripcion LIMIT 5000`,[warehouse]);res.json(rows.rows)
}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/inventory/policies',requireRole('ADMIN','SUPERVISOR','ALMACEN'),async(req,res)=>{try{
  const warehouse=clean(req.body.warehouse),code=clean(req.body.codigo),min=Number(req.body.stock_minimo),max=req.body.stock_maximo===''||req.body.stock_maximo==null?0:Number(req.body.stock_maximo);
  if(!warehouse||!code||!Number.isFinite(min)||min<0||!Number.isFinite(max)||max<0)throw new Error('Almacén, material y mínimos/máximos válidos son obligatorios.');
  const wh=await q("SELECT id FROM warehouses WHERE (id=CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE NULL END) OR nombre=$1 OR codigo=$1 LIMIT 1",[warehouse]);
  const mat=await q('SELECT id FROM materials WHERE activo AND (codigo=$1 OR codigo_anterior=$1) LIMIT 1',[code]);
  if(!wh.rowCount||!mat.rowCount)throw new Error('Almacén o material no encontrado.');
  if(max>0&&max<min)throw new Error('El stock máximo debe ser mayor o igual al mínimo.');
  const r=await q(`INSERT INTO warehouse_material_policies(warehouse_id,material_id,stock_minimo,stock_maximo,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(warehouse_id,material_id) DO UPDATE SET stock_minimo=EXCLUDED.stock_minimo,stock_maximo=EXCLUDED.stock_maximo,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,[wh.rows[0].id,mat.rows[0].id,min,max,req.user.username]);
  await q(`INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,'CONFIGURAR_STOCK_MINIMO','INVENTORY_POLICY',$2,$3)`,[req.user.username,`${wh.rows[0].id}:${mat.rows[0].id}`,JSON.stringify({stock_minimo:min,stock_maximo:max})]);res.json(r.rows[0]);
}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/alerts',async(req,res)=>{try{
  const warehouse=String(req.query.warehouse||'').trim();
  const rows=await q(`SELECT w.nombre almacen,m.codigo,m.descripcion material,m.unidad,b.cantidad::numeric stock,COALESCE(p.stock_minimo,m.stock_minimo,0)::numeric minimo,COALESCE(p.stock_maximo,m.stock_maximo,0)::numeric maximo,COALESCE(NULLIF(b.costo_promedio,0),m.costo_referencia,0)::numeric costo,
    CASE WHEN b.cantidad<0 THEN 'NEGATIVO' WHEN COALESCE(p.stock_minimo,m.stock_minimo,0)>0 AND b.cantidad<=COALESCE(p.stock_minimo,m.stock_minimo,0) THEN 'CRITICO' WHEN b.cantidad>0 AND COALESCE(NULLIF(b.costo_promedio,0),m.costo_referencia,0)<=0 THEN 'SIN_COSTO' WHEN COALESCE(p.stock_maximo,m.stock_maximo,0)>0 AND b.cantidad>COALESCE(p.stock_maximo,m.stock_maximo,0) THEN 'SOBRESTOCK' END alerta
    FROM inventory_balances b JOIN warehouses w ON w.id=b.warehouse_id JOIN materials m ON m.id=b.material_id LEFT JOIN warehouse_material_policies p ON p.warehouse_id=b.warehouse_id AND p.material_id=b.material_id
    WHERE (b.cantidad<0 OR (COALESCE(p.stock_minimo,m.stock_minimo,0)>0 AND b.cantidad<=COALESCE(p.stock_minimo,m.stock_minimo,0)) OR (b.cantidad>0 AND COALESCE(NULLIF(b.costo_promedio,0),m.costo_referencia,0)<=0) OR (COALESCE(p.stock_maximo,m.stock_maximo,0)>0 AND b.cantidad>COALESCE(p.stock_maximo,m.stock_maximo,0))) AND ($1='' OR w.id=NULLIF($1,'')::bigint)
    ORDER BY CASE WHEN b.cantidad<0 THEN 0 WHEN b.cantidad<=COALESCE(p.stock_minimo,m.stock_minimo,0) THEN 1 WHEN COALESCE(NULLIF(b.costo_promedio,0),m.costo_referencia,0)<=0 THEN 2 ELSE 3 END,w.nombre,m.descripcion LIMIT 1000`,[warehouse]);res.json(rows.rows)
}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/audit',requireRole('ADMIN'),async(req,res)=>{try{
  const search=String(req.query.search||'').trim();
  const rows=await q(`SELECT id,fecha,usuario,accion,entidad,entidad_id,detalle FROM audit_log WHERE ($1='' OR usuario ILIKE '%'||$1||'%' OR accion ILIKE '%'||$1||'%' OR entidad ILIKE '%'||$1||'%' OR entidad_id ILIKE '%'||$1||'%') ORDER BY fecha DESC,id DESC LIMIT 500`,[search]);res.json(rows.rows)
}catch(e){res.status(500).json({error:e.message})}});

app.get('/api/budgets',async(req,res)=>{try{
  const period=String(req.query.period||limaToday().slice(0,7));
  if(!/^\d{4}-\d{2}$/.test(period))throw new Error('Período inválido. Usa AAAA-MM.');
  const warehouse=String(req.query.warehouse||'').trim();
  const rows=await q(`SELECT w.id warehouse_id,w.nombre almacen,COALESCE(b.amount,0)::numeric presupuesto,COALESCE(c.consumido,0)::numeric consumido,
      CASE WHEN COALESCE(b.amount,0)>0 THEN round((COALESCE(c.consumido,0)/b.amount*100)::numeric,2) ELSE NULL END porcentaje
    FROM warehouses w LEFT JOIN warehouse_monthly_budgets b ON b.warehouse_id=w.id AND b.period=($1||'-01')::date
    LEFT JOIN (SELECT warehouse_id,SUM(valor) consumido FROM inventory_movements WHERE movement_type='OUT' AND COALESCE(condicion,'') NOT IN ('VACIADO_ALMACEN','PRESTAMO','DEVOLUCION_PRESTAMO') AND COALESCE(fecha_atencion,fecha::date)>=($1||'-01')::date AND COALESCE(fecha_atencion,fecha::date)<(($1||'-01')::date+interval '1 month') GROUP BY warehouse_id) c ON c.warehouse_id=w.id
    WHERE w.activo AND ($2='' OR w.id=NULLIF($2,'')::bigint) ORDER BY w.nombre`,[period,warehouse]);res.json({period,rows})
}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/budgets',requireRole('ADMIN','SUPERVISOR'),async(req,res)=>{try{
  const warehouse=clean(req.body.warehouse),period=String(req.body.period||''),amount=Number(req.body.amount);
  if(!warehouse||!/^\d{4}-\d{2}$/.test(period)||!Number.isFinite(amount)||amount<0)throw new Error('Almacén, período AAAA-MM y presupuesto no negativo son obligatorios.');
  const wh=await q("SELECT id FROM warehouses WHERE (id=CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE NULL END) OR nombre=$1 OR codigo=$1 LIMIT 1",[warehouse]);if(!wh.rowCount)throw new Error('Almacén no encontrado.');
  const r=await q(`INSERT INTO warehouse_monthly_budgets(warehouse_id,period,amount,created_by,updated_by) VALUES($1,($2||'-01')::date,$3,$4,$4) ON CONFLICT(warehouse_id,period) DO UPDATE SET amount=EXCLUDED.amount,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,[wh.rows[0].id,period,amount,req.user.username]);
  await q(`INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,'ACTUALIZAR_PRESUPUESTO','WAREHOUSE_BUDGET',$2,$3)`,[req.user.username,`${wh.rows[0].id}:${period}`,JSON.stringify({amount})]);res.json(r.rows[0])
}catch(e){res.status(400).json({error:e.message})}});

async function getStockAlertsReport(warehouse=''){
  const rows=await q(`SELECT w.nombre almacen,m.codigo,m.codigo_anterior,m.descripcion material,COALESCE(m.unidad,'') unidad,b.cantidad::numeric stock,
      COALESCE(p.stock_minimo,m.stock_minimo,0)::numeric minimo,COALESCE(p.stock_maximo,m.stock_maximo,0)::numeric maximo,
      COALESCE(NULLIF(b.costo_promedio,0),m.costo_referencia,0)::numeric costo,(b.cantidad*COALESCE(NULLIF(b.costo_promedio,0),m.costo_referencia,0))::numeric valor,
      CASE WHEN b.cantidad<0 THEN 'NEGATIVO' WHEN COALESCE(p.stock_minimo,m.stock_minimo,0)>0 AND b.cantidad<=COALESCE(p.stock_minimo,m.stock_minimo,0) THEN 'CRITICO' WHEN b.cantidad>0 AND COALESCE(NULLIF(b.costo_promedio,0),m.costo_referencia,0)<=0 THEN 'SIN_COSTO' WHEN COALESCE(p.stock_maximo,m.stock_maximo,0)>0 AND b.cantidad>COALESCE(p.stock_maximo,m.stock_maximo,0) THEN 'SOBRESTOCK' ELSE 'NORMAL' END alerta
    FROM inventory_balances b JOIN warehouses w ON w.id=b.warehouse_id JOIN materials m ON m.id=b.material_id LEFT JOIN warehouse_material_policies p ON p.warehouse_id=b.warehouse_id AND p.material_id=b.material_id
    WHERE ($1='' OR b.warehouse_id=NULLIF($1,'')::bigint) ORDER BY CASE WHEN b.cantidad<0 THEN 0 WHEN COALESCE(p.stock_minimo,m.stock_minimo,0)>0 AND b.cantidad<=COALESCE(p.stock_minimo,m.stock_minimo,0) THEN 1 WHEN b.cantidad>0 AND COALESCE(NULLIF(b.costo_promedio,0),m.costo_referencia,0)<=0 THEN 2 ELSE 3 END,w.nombre,m.descripcion LIMIT 10000`,[warehouse]);
  return rows.rows;
}
app.get('/api/reports/stock-alerts',async(req,res)=>{try{res.json(await getStockAlertsReport(String(req.query.warehouse||'')))}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/reports/stock-alerts.csv',async(req,res)=>{try{const rows=await getStockAlertsReport(String(req.query.warehouse||''));reportCsv(res,'SILOG_alertas_inventario',rows.map(r=>({'Almacén':r.almacen,'Código':r.codigo,'Código anterior':r.codigo_anterior,'Material':r.material,'Unidad':r.unidad,'Stock':r.stock,'Mínimo':r.minimo,'Máximo':r.maximo,'Costo unitario':r.costo,'Valor':r.valor,'Alerta':r.alerta})));}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/reports/stock-alerts.xlsx',async(req,res)=>{try{const rows=await getStockAlertsReport(String(req.query.warehouse||''));reportXlsx(res,'SILOG_alertas_inventario',[['Inventario y alertas',rows.map(r=>({'Almacén':r.almacen,'Código':r.codigo,'Código anterior':r.codigo_anterior,'Material':r.material,'Unidad':r.unidad,'Stock':r.stock,'Mínimo':r.minimo,'Máximo':r.maximo,'Costo unitario':r.costo,'Valor':r.valor,'Alerta':r.alerta}))]]);}catch(e){res.status(500).json({error:e.message})}});

app.get('/api/report-schedules',requireRole('ADMIN','SUPERVISOR'),async(req,res)=>{try{
  const rows=await q(`SELECT s.id,s.name,s.report_type,s.frequency,s.day_of_week,to_char(s.run_time,'HH24:MI') run_time,s.warehouse_id,w.nombre almacen,s.active,s.last_run_date,s.created_by,s.created_at,
      (SELECT max(r.generated_at) FROM report_runs r WHERE r.schedule_id=s.id) ultima_ejecucion,
      (SELECT r.status FROM report_runs r WHERE r.schedule_id=s.id ORDER BY r.generated_at DESC LIMIT 1) ultimo_estado
    FROM report_schedules s LEFT JOIN warehouses w ON w.id=s.warehouse_id ORDER BY s.active DESC,s.name`);res.json(rows.rows)
}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/report-schedules',requireRole('ADMIN','SUPERVISOR'),async(req,res)=>{try{
  const name=clean(req.body.name),type=String(req.body.report_type||''),frequency=String(req.body.frequency||'DAILY'),day=req.body.day_of_week===''||req.body.day_of_week==null?null:Number(req.body.day_of_week),runTime=String(req.body.run_time||'07:00'),warehouse=req.body.warehouse?String(req.body.warehouse):null;
  if(!name||!['daily-costs','stock-alerts','daily-close','consumption'].includes(type))throw new Error('Nombre y tipo de reporte válidos son obligatorios.');
  if(!['DAILY','WEEKLY'].includes(frequency))throw new Error('Frecuencia no válida.');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(runTime))throw new Error('Hora inválida. Usa HH:MM en horario de Lima.');
  if(frequency==='WEEKLY'&&(!Number.isInteger(day)||day<0||day>6))throw new Error('Selecciona el día de la semana.');
  let warehouseId=null;if(warehouse){const wr=await q("SELECT id FROM warehouses WHERE (id=CASE WHEN $1 ~ '^\\d+$' THEN $1::bigint ELSE NULL END) OR nombre=$1 OR codigo=$1 LIMIT 1",[warehouse]);if(!wr.rowCount)throw new Error('Almacén no encontrado.');warehouseId=wr.rows[0].id;}
  const r=await q(`INSERT INTO report_schedules(name,report_type,frequency,day_of_week,run_time,warehouse_id,created_by) VALUES($1,$2,$3,$4,$5::time,$6,$7) RETURNING id,name,report_type,frequency,day_of_week,to_char(run_time,'HH24:MI') run_time,warehouse_id,active,created_at`,[name,type,frequency,frequency==='WEEKLY'?day:null,runTime,warehouseId,req.user.username]);
  await q(`INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,'CREAR_PROGRAMACION_REPORTE','REPORT_SCHEDULE',$2,$3)`,[req.user.username,String(r.rows[0].id),JSON.stringify(r.rows[0])]);res.json(r.rows[0]);
}catch(e){res.status(400).json({error:e.message})}});
app.patch('/api/report-schedules/:id',requireRole('ADMIN','SUPERVISOR'),async(req,res)=>{try{
  const active=req.body.active===true;const r=await q('UPDATE report_schedules SET active=$1,updated_at=now() WHERE id=$2 RETURNING id,name,active',[active,req.params.id]);if(!r.rowCount)throw new Error('Programación no encontrada.');await q(`INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,'CAMBIAR_PROGRAMACION_REPORTE','REPORT_SCHEDULE',$2,$3)`,[req.user.username,String(req.params.id),JSON.stringify({active})]);res.json(r.rows[0]);
}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/report-runs',requireRole('ADMIN','SUPERVISOR'),async(req,res)=>{try{const rows=await q(`SELECT id,schedule_id,schedule_name,report_type,generated_at,period_start,period_end,row_count,status,error,created_by FROM report_runs ORDER BY generated_at DESC LIMIT 200`);res.json(rows.rows)}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/report-runs/:id.:format',requireRole('ADMIN','SUPERVISOR'),async(req,res)=>{try{
  if(!['csv','xlsx'].includes(req.params.format))return res.status(400).json({error:'Formato no válido.'});
  const r=await q('SELECT * FROM report_runs WHERE id=$1',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Ejecución de reporte no encontrada.'});const run=r.rows[0];if(run.status!=='OK'||!run.payload)throw new Error(run.error||'La ejecución no contiene datos.');const p=run.payload;
  let rows=[];if(run.report_type==='daily-costs')rows=(p.rows||[]).map(x=>({'Fecha':x.fecha,'Almacén':x.almacen,'Código':x.codigo,'Material':x.material,'Unidad':x.unidad,'Cantidad':x.cantidad,'Costo unitario':x.costo_unitario,'Valor total':x.valor_total}));
  else if(run.report_type==='stock-alerts')rows=(p||[]).map(x=>({'Almacén':x.almacen,'Código':x.codigo,'Material':x.material,'Stock':x.stock,'Mínimo':x.minimo,'Máximo':x.maximo,'Costo':x.costo,'Valor':x.valor,'Alerta':x.alerta}));
  else if(run.report_type==='daily-close')rows=(p.stocks||[]).map(x=>({'Almacén':x.almacen,'Código':x.codigo,'Material':x.material,'Stock al cierre':x.stock,'Mínimo':x.minimo,'Costo unitario':x.costo_unitario,'Valor':x.valor,'Estado':x.estado}));
  else rows=(p.rows||[]).map(x=>({'DNI':x.dni,'Trabajador':x.trabajador,'Almacén':x.almacen,'Código':x.codigo,'Material':x.material,'Cantidad':x.cantidad,'Valor total':x.valor_total}));
  const filename=`SILOG_reporte_programado_${run.id}`;
  if(req.params.format==='csv')return reportCsv(res,filename,rows);
  reportXlsx(res,filename,[[run.schedule_name.slice(0,31),rows]]);
}catch(e){res.status(400).json({error:e.message})}});

app.get('/api/users',requireRole('ADMIN'),async(req,res)=>{try{const s=(req.query.search||'').trim();res.json((await q("SELECT id,username,nombre,rol,activo,created_at,updated_at FROM users WHERE ($1='' OR username ILIKE $2 OR nombre ILIKE $2) ORDER BY username LIMIT 200",[s,'%'+s+'%'])).rows)}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/users',requireRole('ADMIN'),async(req,res)=>{try{
  const username=clean(req.body.username)?.trim().toLowerCase(), nombre=clean(req.body.nombre), rol=clean(req.body.rol)||'OPERADOR', password=String(req.body.password||'');
  if(!username||!nombre||password.length<6) throw new Error('Usuario, nombre y contraseña de mínimo 6 caracteres son obligatorios');
  const cryptoHash=crypto.scryptSync(password,username,64).toString('hex');
  const r=await q(`INSERT INTO users(username,nombre,rol,password_hash,activo,updated_at) VALUES($1,$2,$3,$4,true,now()) ON CONFLICT(username) DO UPDATE SET nombre=EXCLUDED.nombre,rol=EXCLUDED.rol,password_hash=EXCLUDED.password_hash,activo=true,updated_at=now() RETURNING id,username,nombre,rol,activo`,[username,nombre,rol,cryptoHash]);
  res.json(r.rows[0]);
}catch(e){res.status(400).json({error:e.message})}});
app.patch('/api/users/:id',requireRole('ADMIN'),async(req,res)=>{try{const active=req.body.activo===true;const r=await q('UPDATE users SET activo=$1,updated_at=now() WHERE id=$2 RETURNING id,username,nombre,rol,activo',[active,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Usuario no encontrado'});res.json(r.rows[0])}catch(e){res.status(400).json({error:e.message})}});

app.get('/api/personnel',async(req,res)=>{try{const s=(req.query.search||'').trim();res.json((await q("SELECT * FROM personnel WHERE activo AND ($1='' OR dni ILIKE $2 OR nombre ILIKE $2 OR cargo ILIKE $2 OR cliente ILIKE $2) ORDER BY nombre LIMIT 1000",[s,'%'+s+'%'])).rows)}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/personnel/import',requireRole('ADMIN','SUPERVISOR'),async(req,res)=>{
  const client=await pool.connect();
  try{
    const base64=String(req.body.fileBase64||'').replace(/^data:.*?;base64,/,'');
    if(!base64)throw new Error('Selecciona un archivo Excel o CSV.');
    if(base64.length>24*1024*1024)throw new Error('El archivo es demasiado grande (máximo aproximado 18 MB).');
    const workbook=XLSX.read(base64,{type:'base64',cellDates:false});
    const normalizeHeader=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const aliases={dni:['DNI','DOCUMENTO','DOCUMENTODEIDENTIDAD','NUMERODOCUMENTO','NRODOCUMENTO','NUMDNI','IDENTIFICACION'],nombre:['NOMBRES','NOMBRE','NOMBRESYAPELLIDOS','APELLIDOSYNOMBRES','NOMBRECOMPLETO','TRABAJADOR','PERSONAL'],cargo:['CARGO','PUESTO','OCUPACION','FUNCION'],cliente:['CLIENTE','EMPRESA','RAZONSOCIAL'],area:['AREA','DEPARTAMENTO','SECCION']};
    const records=new Map(); let sheetsUsed=0;
    for(const sheetName of workbook.SheetNames){
      const matrix=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:false});
      let headerAt=-1,idx={};
      for(let i=0;i<Math.min(matrix.length,40);i++){
        const h=matrix[i].map(normalizeHeader); const found={};
        for(const [field,names] of Object.entries(aliases)){found[field]=h.findIndex(v=>names.includes(v));}
        if(found.dni>=0&&found.nombre>=0){headerAt=i;idx=found;break;}
      }
      if(headerAt<0)continue; sheetsUsed++;
      for(const row of matrix.slice(headerAt+1)){
        const val=k=>idx[k]>=0?String(row[idx[k]]??'').trim():'';
        let dni=val('dni').replace(/\.0$/,'').replace(/\s/g,'');
        const nombre=val('nombre').replace(/\\s+/g,' ').trim();
        if(!dni||!nombre||!/[0-9]/.test(dni))continue;
        if(dni.length>15)continue;
        records.set(dni,{dni,nombre,cargo:val('cargo'),cliente:val('cliente')||'MINERA CHINALCO PERU S.A.A.',area:val('area')});
      }
    }
    const rows=[...records.values()];
    if(!rows.length)throw new Error('No encontré filas válidas. El archivo debe incluir columnas DNI y NOMBRES (y opcionalmente CARGO, CLIENTE y AREA).');
    await client.query('BEGIN');
    const existing=(await client.query('SELECT dni FROM personnel WHERE dni=ANY($1::text[])', [rows.map(x=>x.dni)])).rows;
    const existingSet=new Set(existing.map(x=>x.dni)); let inserted=0,updated=0;
    for(const x of rows){
      await client.query(`INSERT INTO personnel(dni,nombre,cargo,cliente,area,activo,updated_at) VALUES($1,$2,$3,$4,$5,true,now()) ON CONFLICT(dni) DO UPDATE SET nombre=EXCLUDED.nombre,cargo=EXCLUDED.cargo,cliente=EXCLUDED.cliente,area=EXCLUDED.area,activo=true,updated_at=now()`,[x.dni,x.nombre,x.cargo||null,x.cliente,x.area||null]);
      if(existingSet.has(x.dni))updated++;else inserted++;
    }
    await client.query(`INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES($1,'IMPORTAR_PERSONAL','PERSONNEL',$2,$3)`,[req.user.username,String(rows.length),JSON.stringify({archivo:req.body.filename||'archivo',hojas:workbook.SheetNames.length,hojasConPersonal:sheetsUsed,insertados:inserted,actualizados:updated})]);
    await client.query('COMMIT');res.json({ok:true,total:rows.length,insertados:inserted,actualizados:updated,hojasConPersonal:sheetsUsed,archivo:req.body.filename||''});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});res.status(400).json({error:e.message})}finally{client.release()}
});
app.post('/api/personnel',requireRole('ADMIN','SUPERVISOR'),async(req,res)=>{try{const r=await q(`INSERT INTO personnel(dni,nombre,cargo,cliente,area,activo,updated_at) VALUES($1,$2,$3,$4,$5,true,now()) ON CONFLICT(dni) DO UPDATE SET nombre=EXCLUDED.nombre,cargo=EXCLUDED.cargo,cliente=EXCLUDED.cliente,area=EXCLUDED.area,activo=true,updated_at=now() RETURNING *`,[clean(req.body.dni),req.body.nombre,req.body.cargo,req.body.cliente,req.body.area]);res.json(r.rows[0])}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/cecos',async(req,res)=>{try{res.json((await q('SELECT * FROM cost_centers WHERE activo ORDER BY codigo')).rows)}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/data',async(req,res)=>{
  try{
    const page=Math.max(1,Number(req.query.page||1));
    const limit=Math.min(Math.max(Number(req.query.limit||100),25),250);
    const offset=(page-1)*limit;
    const from=req.query.from||'',to=req.query.to||'',search=(req.query.search||'').trim(),type=req.query.type||'',warehouse=req.query.warehouse||'',ceco=req.query.ceco||'',dni=(req.query.dni||'').trim();
    const whereCount=`WHERE ($1='' OR v.fecha::date >= $1::date) AND ($2='' OR v.fecha::date <= $2::date)
      AND ($3='' OR v.movement_type=$3) AND ($4='' OR v.warehouse_id=$4::bigint) AND ($5='' OR cc.codigo=$5)
      AND ($6='' OR v.dni ILIKE '%'||$6||'%' OR v.solicitante ILIKE '%'||$6||'%' OR m.codigo ILIKE '%'||$6||'%' OR m.descripcion ILIKE '%'||$6||'%' OR v.documento ILIKE '%'||$6||'%' OR v.numero ILIKE '%'||$6||'%')
      AND ($7='' OR v.dni ILIKE '%'||$7||'%')`;
    const whereRows=`WHERE ($1='' OR x.fecha::date >= $1::date) AND ($2='' OR x.fecha::date <= $2::date)
      AND ($3='' OR x.movement_type=$3) AND ($4='' OR x.warehouse_id=$4::bigint) AND ($5='' OR cc.codigo=$5)
      AND ($6='' OR x.dni ILIKE '%'||$6||'%' OR x.solicitante ILIKE '%'||$6||'%' OR m.codigo ILIKE '%'||$6||'%' OR m.descripcion ILIKE '%'||$6||'%' OR x.documento ILIKE '%'||$6||'%' OR x.numero ILIKE '%'||$6||'%')
      AND ($7='' OR x.dni ILIKE '%'||$7||'%')`;
    const base=`WITH x AS (
      SELECT v.*, SUM(CASE WHEN v.movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN v.cantidad ELSE -v.cantidad END)
      OVER(PARTITION BY v.warehouse_id,v.material_id ORDER BY v.fecha,v.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) stock_after
      FROM inventory_movements v
    ) SELECT x.id,EXTRACT(YEAR FROM x.fecha)::int "AÑO",w.nombre "ALMACEN",x.condicion "CONDICION",x.documento "DOC",x.numero "N°",COALESCE(x.fecha_atencion,x.fecha::date) "FECHA",x.fecha_digitacion "FECHA_DIGITACION",cc.codigo "CeCo",x.cliente "CLIENTE",x.area "AREA",x.placa "PLACA",m.codigo "CÓDIGO",x.cantidad "CANT",x.stock_after "STOCK",m.unidad "UND",m.descripcion "PRODUCTO",g.nombre "GRUPO",x.moneda "MON",x.costo_unitario "PU",x.valor "S/ Total",x.dni "DNI",x.solicitante "SOLICITANTE",x.entregado "ENTREGADO",x.autorizado "AUTORIZADO",x.movement_type "TIPO"
      FROM x JOIN materials m ON m.id=x.material_id JOIN warehouses w ON w.id=x.warehouse_id LEFT JOIN material_groups g ON g.id=m.grupo_id LEFT JOIN cost_centers cc ON cc.id=x.ceco_id `;
    const count=await q(`SELECT count(*)::int n FROM inventory_movements v JOIN materials m ON m.id=v.material_id JOIN warehouses w ON w.id=v.warehouse_id LEFT JOIN cost_centers cc ON cc.id=v.ceco_id ${whereCount}`,[from,to,type,warehouse,ceco,search,dni]);
    const rows=await q(`${base} ${whereRows} ORDER BY x.fecha DESC,x.id DESC LIMIT $8 OFFSET $9`,[from,to,type,warehouse,ceco,search,dni,limit,offset]);
    res.json({rows:rows.rows,total:count.rows[0].n,page,limit,pages:Math.max(1,Math.ceil(count.rows[0].n/limit))});
  }catch(e){res.status(500).json({error:e.message})}
});

function workerKardexFilters(req){
  const dni=String(req.query.dni||'').trim();
  const digits=dni.replace(/\D/g,'');
  if(digits.length<4)throw new Error('Ingresa al menos 4 dígitos del DNI.');
  const from=String(req.query.from||'').trim(),to=String(req.query.to||'').trim(),warehouse=String(req.query.warehouse||'').trim();
  if(from&&to&&from>to)throw new Error('La fecha inicial no puede ser posterior a la fecha final.');
  return {dni,digits,from,to,warehouse};
}
async function queryWorkerKardex(f){
  const r=await q(`SELECT v.id,
      COALESCE(v.fecha_atencion,v.fecha::date)::text AS fecha_atencion,
      v.fecha_digitacion::text AS fecha_digitacion,
      w.nombre AS almacen,m.codigo,m.descripcion AS material,m.unidad,
      COALESCE(v.cantidad,0)::numeric AS cantidad,
      COALESCE(v.costo_unitario,0)::numeric AS costo_unitario,
      COALESCE(v.valor,COALESCE(v.cantidad,0)*COALESCE(v.costo_unitario,0))::numeric AS valor_total,
      v.documento,v.numero,v.area,cc.codigo AS ceco,v.entregado,v.autorizado,
      v.solicitante,v.created_by AS usuario,v.observacion,v.dni,v.cliente
    FROM inventory_movements v
    JOIN materials m ON m.id=v.material_id
    JOIN warehouses w ON w.id=v.warehouse_id
    LEFT JOIN cost_centers cc ON cc.id=v.ceco_id
    WHERE v.movement_type='OUT'
      AND regexp_replace(COALESCE(v.dni,''),'[^0-9]','','g') LIKE '%'||$1||'%'
      AND ($2='' OR COALESCE(v.fecha_atencion,v.fecha::date)>=$2::date)
      AND ($3='' OR COALESCE(v.fecha_atencion,v.fecha::date)<=$3::date)
      AND ($4='' OR v.warehouse_id=NULLIF($4,'')::bigint)
    ORDER BY COALESCE(v.fecha_atencion,v.fecha::date) DESC,v.fecha DESC,v.id DESC LIMIT 5000`,[f.digits,f.from,f.to,f.warehouse]);
  const p=await q(`SELECT dni,nombre,cargo,cliente,area FROM personnel WHERE regexp_replace(COALESCE(dni,''),'[^0-9]','','g')=$1 AND activo=true LIMIT 1`,[f.digits]);
  const rows=r.rows.map(x=>({...x,cantidad:Number(x.cantidad||0),costo_unitario:Number(x.costo_unitario||0),valor_total:Number(x.valor_total||0)}));
  return {worker:p.rows[0]||null,rows,totals:{movimientos:rows.length,cantidad:rows.reduce((s,x)=>s+x.cantidad,0),valor:rows.reduce((s,x)=>s+x.valor_total,0)}};
}
app.get('/api/worker-kardex',requireAuth,async(req,res)=>{try{const f=workerKardexFilters(req);res.json(await queryWorkerKardex(f))}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/worker-kardex.csv',requireAuth,async(req,res)=>{try{const f=workerKardexFilters(req),d=await queryWorkerKardex(f);const data=d.rows.map(x=>({'DNI':x.dni,'TRABAJADOR':d.worker?.nombre||x.solicitante||'','FECHA ATENCION':x.fecha_atencion,'FECHA DIGITACION':x.fecha_digitacion,'ALMACEN':x.almacen,'DOCUMENTO':x.documento,'NUMERO':x.numero,'CODIGO':x.codigo,'MATERIAL':x.material,'UNIDAD':x.unidad,'CANTIDAD':x.cantidad,'COSTO UNITARIO':x.costo_unitario,'VALOR TOTAL':x.valor_total,'AREA':x.area,'CENTRO COSTO':x.ceco,'SOLICITANTE':x.solicitante,'ENTREGADO':x.entregado,'AUTORIZADO':x.autorizado,'USUARIO SILOG':x.usuario,'OBSERVACION':x.observacion}));const ws=XLSX.utils.json_to_sheet(data);const csv='\\ufeff'+XLSX.utils.sheet_to_csv(ws,{FS:';'});res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="kardex-trabajador-${f.digits}.csv"`);res.send(csv)}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/worker-kardex.xlsx',requireAuth,async(req,res)=>{try{const f=workerKardexFilters(req),d=await queryWorkerKardex(f);const data=d.rows.map(x=>({'DNI':x.dni,'TRABAJADOR':d.worker?.nombre||x.solicitante||'','FECHA ATENCION':x.fecha_atencion,'FECHA DIGITACION':x.fecha_digitacion,'ALMACEN':x.almacen,'DOCUMENTO':x.documento,'NUMERO':x.numero,'CODIGO':x.codigo,'MATERIAL':x.material,'UNIDAD':x.unidad,'CANTIDAD':x.cantidad,'COSTO UNITARIO':x.costo_unitario,'VALOR TOTAL':x.valor_total,'AREA':x.area,'CENTRO COSTO':x.ceco,'SOLICITANTE':x.solicitante,'ENTREGADO':x.entregado,'AUTORIZADO':x.autorizado,'USUARIO SILOG':x.usuario,'OBSERVACION':x.observacion}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),'Kardex trabajador');const summary=XLSX.utils.aoa_to_sheet([['DNI',f.digits],['Trabajador',d.worker?.nombre||'No figura en Personal'],['Movimientos',d.totals.movimientos],['Unidades entregadas',d.totals.cantidad],['Valor total (S/)',d.totals.valor]]);XLSX.utils.book_append_sheet(wb,summary,'Resumen');const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="kardex-trabajador-${f.digits}.xlsx"`);res.send(buf)}catch(e){res.status(400).json({error:e.message})}});

app.get('/api/movements',async(req,res)=>{try{const r=await q(`SELECT v.*,m.codigo,m.descripcion,w.nombre almacen,cc.codigo ceco FROM inventory_movements v JOIN materials m ON m.id=v.material_id JOIN warehouses w ON w.id=v.warehouse_id LEFT JOIN cost_centers cc ON cc.id=v.ceco_id WHERE ($1='' OR v.movement_type=$1) AND ($2='' OR v.fecha::date >= $2::date) AND ($3='' OR v.fecha::date <= $3::date) ORDER BY v.fecha DESC,v.id DESC LIMIT 1000`,[req.query.type||'',req.query.from||'',req.query.to||'']);res.json(r.rows)}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/income',requireRole('ADMIN','SUPERVISOR','ALMACEN','OPERADOR'),async(req,res)=>{try{res.json({id:await recordMovement(req.body,'IN',req.user.username)})}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/outflow',requireRole('ADMIN','SUPERVISOR','ALMACEN','OPERADOR'),async(req,res)=>{try{if(Array.isArray(req.body.items)) res.json(await recordIssue(req.body,req.user.username)); else res.json({id:await recordMovement(req.body,'OUT',req.user.username)})}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/inventory/adjust',requireRole('ADMIN','SUPERVISOR','ALMACEN'),async(req,res)=>{try{const body={...req.body,cantidad:Math.abs(n(req.body.cantidad))}; const direction=req.body.direccion==='SALIDA'?'OUT':'IN'; res.json({id:await recordMovement(body,direction,req.user.username)})}catch(e){res.status(400).json({error:e.message})}});

function resourcesReportFilters(req){
  return {
    from: String(req.query.from||'').trim(),
    to: String(req.query.to||'').trim(),
    warehouse: String(req.query.warehouse||'').trim(),
    search: String(req.query.search||'').trim(),
    type: String(req.query.type||'INCOMING').trim().toUpperCase(),
    limit: Math.min(1000,Math.max(1,Number.parseInt(req.query.limit||'250',10)||250))
  };
}
function resourcesReportWhere(f){
  return {
    sql:`WHERE ($1='' OR v.created_at::date >= NULLIF($1,'')::date)
      AND ($2='' OR v.created_at::date <= NULLIF($2,'')::date)
      AND ($3='' OR v.warehouse_id=NULLIF($3,'')::bigint)
      AND ($4='' OR v.movement_type=$4 OR ($4='INCOMING' AND v.movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') AND COALESCE(v.condicion,'') NOT IN ('VACIADO_ALMACEN','PRESTAMO','DEVOLUCION_PRESTAMO')))
      AND ($5='' OR m.codigo ILIKE '%'||$5||'%' OR COALESCE(m.codigo_anterior,'') ILIKE '%'||$5||'%' OR m.descripcion ILIKE '%'||$5||'%' OR w.nombre ILIKE '%'||$5||'%' OR COALESCE(v.documento,'') ILIKE '%'||$5||'%' OR COALESCE(v.proveedor_ruc,'') ILIKE '%'||$5||'%' OR COALESCE(v.proveedor,'') ILIKE '%'||$5||'%' OR COALESCE(v.created_by,'') ILIKE '%'||$5||'%' OR COALESCE(v.observacion,'') ILIKE '%'||$5||'%')`,
    params:[f.from,f.to,f.warehouse,f.type==='ALL'?'':f.type,f.search]
  };
}
async function getResourcesReport(req){
  const f=resourcesReportFilters(req),w=resourcesReportWhere(f);
  const result=await q(`WITH ledger AS (
    SELECT v.id, SUM(CASE WHEN v.movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN v.cantidad ELSE -v.cantidad END)
      OVER(PARTITION BY v.warehouse_id,v.material_id ORDER BY v.fecha,v.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) stock_after
    FROM inventory_movements v
  )
  SELECT v.id movimiento_id, v.fecha::date fecha_movimiento, v.created_at registrado_en,
    COALESCE(v.created_by,'SYSTEM') usuario, v.movement_type tipo_movimiento,
    w.nombre almacen, m.codigo, COALESCE(m.codigo_anterior,'') codigo_anterior,
    m.descripcion material, COALESCE(m.unidad,'') unidad, COALESCE(g.nombre,'SIN GRUPO') grupo,
    v.cantidad cantidad, COALESCE(v.costo_unitario,0) costo_unitario, COALESCE(v.valor,0) valor_total,
    COALESCE(v.moneda,'SOL') moneda, COALESCE(v.documento,'') documento, COALESCE(v.numero,'') numero, COALESCE(v.proveedor_ruc,'') proveedor_ruc, COALESCE(v.proveedor,'') proveedor,
    COALESCE(v.source,'SILOG') origen, COALESCE(v.observacion,'') observacion,
    COALESCE(ledger.stock_after,0) stock_despues
  FROM inventory_movements v
  JOIN materials m ON m.id=v.material_id
  JOIN warehouses w ON w.id=v.warehouse_id
  LEFT JOIN material_groups g ON g.id=m.grupo_id
  LEFT JOIN ledger ON ledger.id=v.id
  ${w.sql}
  ORDER BY v.created_at DESC,v.id DESC
  LIMIT ${f.limit}`,w.params);
  const count=await q(`SELECT count(*)::int total
    FROM inventory_movements v JOIN materials m ON m.id=v.material_id JOIN warehouses w ON w.id=v.warehouse_id
    ${w.sql}`,w.params);
  return {rows:result.rows,total:count.rows[0]?.total||0,filters:f};
}
function csvSafe(value){
  const s=value===null||value===undefined?'':String(value);
  return /^[=+\-@\t\r]/.test(s)?"'"+s:s;
}
function toCsv(rows){
  if(!rows.length)return '\uFEFF';
  const headers=[
    ['movimiento_id','ID movimiento'],['fecha_movimiento','Fecha movimiento'],['registrado_en','Fecha y hora de registro'],
    ['usuario','Usuario'],['tipo_movimiento','Tipo de movimiento'],['almacen','Almacén'],['codigo','Código'],
    ['codigo_anterior','Código anterior'],['material','Material'],['unidad','Unidad'],['grupo','Grupo'],
    ['cantidad','Cantidad ingresada/movida'],['costo_unitario','Costo unitario'],['valor_total','Valor total'],
    ['moneda','Moneda'],['documento','Documento'],['numero','Número'],['proveedor_ruc','RUC proveedor'],['proveedor','Proveedor'],['origen','Origen'],['observacion','Observación'],['stock_despues','Stock después']
  ];
  const cell=v=>`"${csvSafe(v).replace(/"/g,'""')}"`;
  return '\uFEFF'+[headers.map(x=>cell(x[1])).join(';'),...rows.map(r=>headers.map(([k])=>cell(r[k] instanceof Date?r[k].toISOString():r[k])).join(';'))].join('\r\n');
}
app.get('/api/resources-report',async(req,res)=>{
  try{const d=await getResourcesReport(req);res.json(d)}catch(e){console.error('Reporte de recursos:',e);res.status(500).json({error:'No se pudo generar el reporte de recursos: '+e.message})}
});
app.get('/api/resources-report.csv',async(req,res)=>{
  try{const d=await getResourcesReport(req);res.setHeader('Content-Disposition','attachment; filename="SILOG_ultimos_movimientos.csv"');res.type('text/csv; charset=utf-8');res.send(toCsv(d.rows))}catch(e){console.error('CSV de recursos:',e);res.status(500).json({error:'No se pudo exportar el CSV: '+e.message})}
});
app.get('/api/resources-report.xlsx',async(req,res)=>{
  try{
    const d=await getResourcesReport(req);
    const headers=['ID movimiento','Fecha movimiento','Fecha y hora de registro','Usuario','Tipo de movimiento','Almacén','Código','Código anterior','Material','Unidad','Grupo','Cantidad ingresada/movida','Costo unitario','Valor total','Moneda','Documento','Número','RUC proveedor','Proveedor','Origen','Observación','Stock después'];
    const keys=['movimiento_id','fecha_movimiento','registrado_en','usuario','tipo_movimiento','almacen','codigo','codigo_anterior','material','unidad','grupo','cantidad','costo_unitario','valor_total','moneda','documento','numero','proveedor_ruc','proveedor','origen','observacion','stock_despues'];
    const data=d.rows.map(r=>Object.fromEntries(keys.map((k,i)=>[headers[i],r[k] instanceof Date?r[k].toISOString():r[k]])));
    const ws=XLSX.utils.json_to_sheet(data,{header:headers});
    ws['!cols']=headers.map(h=>({wch:Math.min(34,Math.max(12,h.length+2))}));
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Últimos ingresos');
    const buffer=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
    res.setHeader('Content-Disposition','attachment; filename="SILOG_ultimos_materiales.xlsx"');
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.send(buffer);
  }catch(e){console.error('Excel de recursos:',e);res.status(500).json({error:'No se pudo exportar Excel: '+e.message})}
});

// Reportes gerenciales basados en movimientos reales. Todas las rutas quedan protegidas por requireAuth.
function reportDateFilters(req){
  const from=String(req.query.from||'').trim(),to=String(req.query.to||'').trim();
  if(from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))throw new Error('Fecha inicial inválida.');
  if(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to))throw new Error('Fecha final inválida.');
  if(from&&to&&from>to)throw new Error('La fecha inicial no puede ser posterior a la final.');
  return {from,to,warehouse:String(req.query.warehouse||'').trim(),search:String(req.query.search||'').trim(),ceco:String(req.query.ceco||'').trim(),dni:String(req.query.dni||'').replace(/[^0-9]/g,'')};
}
function reportCsv(res,filename,rows){
  const safe=v=>{const x=v===null||v===undefined?'':String(v);return '"'+(/^[=+@\-\t\r]/.test(x)?"'"+x:x).replace(/"/g,'""')+'"'};
  const keys=rows.length?Object.keys(rows[0]):[];
  res.setHeader('Content-Disposition',`attachment; filename="${filename}.csv"`);res.type('text/csv; charset=utf-8');
  res.send('\ufeff'+[keys.map(safe).join(';'),...rows.map(r=>keys.map(k=>safe(r[k] instanceof Date?r[k].toISOString():r[k])).join(';'))].join('\r\n'));
}
function reportXlsx(res,filename,sheets){
  const wb=XLSX.utils.book_new();
  for(const [name,rows] of sheets){const ws=XLSX.utils.json_to_sheet(rows);ws['!cols']=Object.keys(rows[0]||{}).map(h=>({wch:Math.min(36,Math.max(12,h.length+2))}));XLSX.utils.book_append_sheet(wb,ws,name.slice(0,31));}
  const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});res.setHeader('Content-Disposition',`attachment; filename="${filename}.xlsx"`);res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.send(buf);
}
async function getDailyCosts(f){
  const params=[f.from,f.to,f.warehouse];
  const rows=await q(`SELECT COALESCE(v.fecha_atencion,v.fecha::date)::text fecha,w.nombre almacen,m.codigo,m.descripcion material,COALESCE(m.unidad,'') unidad,
      SUM(v.cantidad)::numeric cantidad,CASE WHEN SUM(v.cantidad)>0 THEN (SUM(COALESCE(v.valor,0))/SUM(v.cantidad)) ELSE 0 END::numeric costo_unitario,
      SUM(COALESCE(v.valor,0))::numeric valor_total,COUNT(*)::int movimientos
    FROM inventory_movements v JOIN warehouses w ON w.id=v.warehouse_id JOIN materials m ON m.id=v.material_id
    WHERE v.movement_type='OUT' AND COALESCE(v.condicion,'') NOT IN ('VACIADO_ALMACEN','PRESTAMO','DEVOLUCION_PRESTAMO') AND ($1='' OR COALESCE(v.fecha_atencion,v.fecha::date)>=$1::date) AND ($2='' OR COALESCE(v.fecha_atencion,v.fecha::date)<=$2::date)
      AND ($3='' OR v.warehouse_id=NULLIF($3,'')::bigint)
    GROUP BY COALESCE(v.fecha_atencion,v.fecha::date),w.nombre,m.codigo,m.descripcion,m.unidad
    ORDER BY COALESCE(v.fecha_atencion,v.fecha::date) DESC,w.nombre,m.descripcion LIMIT 10000`,params);
  const totals=await q(`SELECT COALESCE(v.fecha_atencion,v.fecha::date)::text fecha,w.nombre almacen,SUM(COALESCE(v.valor,0))::numeric valor_total,COUNT(*)::int movimientos
    FROM inventory_movements v JOIN warehouses w ON w.id=v.warehouse_id WHERE v.movement_type='OUT' AND COALESCE(v.condicion,'') NOT IN ('VACIADO_ALMACEN','PRESTAMO','DEVOLUCION_PRESTAMO')
      AND ($1='' OR COALESCE(v.fecha_atencion,v.fecha::date)>=$1::date) AND ($2='' OR COALESCE(v.fecha_atencion,v.fecha::date)<=$2::date) AND ($3='' OR v.warehouse_id=NULLIF($3,'')::bigint)
    GROUP BY COALESCE(v.fecha_atencion,v.fecha::date),w.nombre ORDER BY COALESCE(v.fecha_atencion,v.fecha::date) DESC,w.nombre`,params);
  return {rows:rows.rows,totals:totals.rows,grandTotal:rows.rows.reduce((a,r)=>a+Number(r.valor_total||0),0),filters:f};
}
app.get('/api/reports/daily-costs',async(req,res)=>{try{res.json(await getDailyCosts(reportDateFilters(req)))}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/reports/daily-costs.csv',async(req,res)=>{try{const d=await getDailyCosts(reportDateFilters(req));reportCsv(res,'SILOG_costos_diarios',d.rows.map(r=>({'Fecha':r.fecha,'Almacén':r.almacen,'Código':r.codigo,'Material':r.material,'Unidad':r.unidad,'Cantidad salida':r.cantidad,'Costo unitario promedio':r.costo_unitario,'Costo total':r.valor_total,'Movimientos':r.movimientos})));}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/reports/daily-costs.xlsx',async(req,res)=>{try{const d=await getDailyCosts(reportDateFilters(req));reportXlsx(res,'SILOG_costos_diarios',[["Detalle",d.rows.map(r=>({'Fecha':r.fecha,'Almacén':r.almacen,'Código':r.codigo,'Material':r.material,'Unidad':r.unidad,'Cantidad salida':r.cantidad,'Costo unitario promedio':r.costo_unitario,'Costo total':r.valor_total,'Movimientos':r.movimientos}))],["Totales diarios",d.totals.map(r=>({'Fecha':r.fecha,'Almacén':r.almacen,'Costo total':r.valor_total,'Movimientos':r.movimientos}))]]);}catch(e){res.status(400).json({error:e.message})}});

async function getMaterialKardex(f){
  if(f.search.length<2)throw new Error('Escribe al menos 2 caracteres de código o nombre del material.');
  const rows=await q(`WITH ledger AS (
    SELECT v.id,v.fecha,v.fecha_atencion,v.fecha_digitacion,v.movement_type,v.warehouse_id,v.material_id,v.cantidad,v.costo_unitario,v.valor,v.moneda,v.documento,v.numero,v.created_by,v.observacion,
      CASE WHEN v.movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN v.cantidad ELSE -v.cantidad END delta,
      SUM(CASE WHEN v.movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN v.cantidad ELSE -v.cantidad END) OVER(PARTITION BY v.warehouse_id,v.material_id ORDER BY v.fecha,v.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) saldo
    FROM inventory_movements v
  ) SELECT COALESCE(l.fecha_atencion,l.fecha::date)::text fecha,l.fecha_digitacion::text digitacion,w.nombre almacen,m.codigo,m.descripcion material,COALESCE(m.unidad,'') unidad,l.movement_type tipo,
      l.cantidad::numeric cantidad,l.delta::numeric variacion,l.saldo::numeric saldo_despues,COALESCE(l.costo_unitario,0)::numeric costo_unitario,COALESCE(l.valor,0)::numeric valor_total,COALESCE(l.documento,'') documento,COALESCE(l.numero,'') numero,COALESCE(l.created_by,'SYSTEM') usuario,COALESCE(l.observacion,'') observacion
    FROM ledger l JOIN materials m ON m.id=l.material_id JOIN warehouses w ON w.id=l.warehouse_id
    WHERE (m.codigo ILIKE '%'||$1||'%' OR COALESCE(m.codigo_anterior,'') ILIKE '%'||$1||'%' OR m.descripcion ILIKE '%'||$1||'%')
      AND ($2='' OR l.warehouse_id=NULLIF($2,'')::bigint) AND ($3='' OR COALESCE(l.fecha_atencion,l.fecha::date)>=$3::date) AND ($4='' OR COALESCE(l.fecha_atencion,l.fecha::date)<=$4::date)
    ORDER BY COALESCE(l.fecha_atencion,l.fecha::date),l.fecha,l.id LIMIT 10000`,[f.search,f.warehouse,f.from,f.to]);
  return {rows:rows.rows,filters:f,totals:{movimientos:rows.rowCount,cantidad:rows.rows.reduce((a,r)=>a+Number(r.cantidad||0),0),valor:rows.rows.reduce((a,r)=>a+Number(r.valor_total||0),0)}};
}
app.get('/api/reports/material-kardex',async(req,res)=>{try{res.json(await getMaterialKardex(reportDateFilters(req)))}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/reports/material-kardex.csv',async(req,res)=>{try{const d=await getMaterialKardex(reportDateFilters(req));reportCsv(res,'SILOG_kardex_material',d.rows.map(r=>({'Fecha':r.fecha,'Digitación':r.digitacion,'Almacén':r.almacen,'Código':r.codigo,'Material':r.material,'Tipo':r.tipo,'Cantidad':r.cantidad,'Variación stock':r.variacion,'Saldo después':r.saldo_despues,'Unidad':r.unidad,'Costo unitario':r.costo_unitario,'Valor total':r.valor_total,'Documento':r.documento,'Número':r.numero,'Usuario':r.usuario,'Observación':r.observacion})));}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/reports/material-kardex.xlsx',async(req,res)=>{try{const d=await getMaterialKardex(reportDateFilters(req));reportXlsx(res,'SILOG_kardex_material',[["Kardex",d.rows.map(r=>({'Fecha':r.fecha,'Digitación':r.digitacion,'Almacén':r.almacen,'Código':r.codigo,'Material':r.material,'Tipo':r.tipo,'Cantidad':r.cantidad,'Variación stock':r.variacion,'Saldo después':r.saldo_despues,'Unidad':r.unidad,'Costo unitario':r.costo_unitario,'Valor total':r.valor_total,'Documento':r.documento,'Número':r.numero,'Usuario':r.usuario,'Observación':r.observacion}))],["Resumen",[{"Movimientos":d.totals.movimientos,"Cantidad total movimientos":d.totals.cantidad,"Valor total movimientos":d.totals.valor}]]]);}catch(e){res.status(400).json({error:e.message})}});

async function getConsumptionReport(f){
  const rows=await q(`SELECT regexp_replace(COALESCE(v.dni,''),'[^0-9]','','g') dni,COALESCE(p.nombre,v.solicitante,'SIN NOMBRE') trabajador,COALESCE(v.area,p.area,'') area,COALESCE(cc.codigo,'') ceco,COALESCE(cc.descripcion,'') centro_costo,w.nombre almacen,m.codigo,m.descripcion material,COALESCE(m.unidad,'') unidad,
      COUNT(*)::int movimientos,SUM(v.cantidad)::numeric cantidad,SUM(COALESCE(v.valor,v.cantidad*COALESCE(v.costo_unitario,0)))::numeric valor_total
    FROM inventory_movements v JOIN warehouses w ON w.id=v.warehouse_id JOIN materials m ON m.id=v.material_id LEFT JOIN personnel p ON regexp_replace(COALESCE(p.dni,''),'[^0-9]','','g')=regexp_replace(COALESCE(v.dni,''),'[^0-9]','','g') LEFT JOIN cost_centers cc ON cc.id=v.ceco_id
    WHERE v.movement_type='OUT' AND COALESCE(v.condicion,'') NOT IN ('VACIADO_ALMACEN','PRESTAMO','DEVOLUCION_PRESTAMO') AND ($1='' OR COALESCE(v.fecha_atencion,v.fecha::date)>=$1::date) AND ($2='' OR COALESCE(v.fecha_atencion,v.fecha::date)<=$2::date)
      AND ($3='' OR v.warehouse_id=NULLIF($3,'')::bigint) AND ($4='' OR v.ceco_id=NULLIF($4,'')::bigint) AND ($5='' OR regexp_replace(COALESCE(v.dni,''),'[^0-9]','','g') LIKE '%'||$5||'%')
    GROUP BY regexp_replace(COALESCE(v.dni,''),'[^0-9]','','g'),COALESCE(p.nombre,v.solicitante,'SIN NOMBRE'),COALESCE(v.area,p.area,''),COALESCE(cc.codigo,''),COALESCE(cc.descripcion,''),w.nombre,m.codigo,m.descripcion,m.unidad
    ORDER BY valor_total DESC,trabajador,almacen,m.descripcion LIMIT 10000`,[f.from,f.to,f.warehouse,f.ceco,f.dni]);
  return {rows:rows.rows,filters:f,totals:{lineas:rows.rowCount,cantidad:rows.rows.reduce((a,r)=>a+Number(r.cantidad||0),0),valor:rows.rows.reduce((a,r)=>a+Number(r.valor_total||0),0)}};
}
app.get('/api/reports/consumption',async(req,res)=>{try{res.json(await getConsumptionReport(reportDateFilters(req)))}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/reports/consumption.csv',async(req,res)=>{try{const d=await getConsumptionReport(reportDateFilters(req));reportCsv(res,'SILOG_consumo_trabajador_ceco',d.rows.map(r=>({'DNI':r.dni,'Trabajador':r.trabajador,'Área':r.area,'CeCo':r.ceco,'Centro de costo':r.centro_costo,'Almacén':r.almacen,'Código':r.codigo,'Material':r.material,'Unidad':r.unidad,'Movimientos':r.movimientos,'Cantidad':r.cantidad,'Valor total':r.valor_total})));}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/reports/consumption.xlsx',async(req,res)=>{try{const d=await getConsumptionReport(reportDateFilters(req));reportXlsx(res,'SILOG_consumo_trabajador_ceco',[["Consumo",d.rows.map(r=>({'DNI':r.dni,'Trabajador':r.trabajador,'Área':r.area,'CeCo':r.ceco,'Centro de costo':r.centro_costo,'Almacén':r.almacen,'Código':r.codigo,'Material':r.material,'Unidad':r.unidad,'Movimientos':r.movimientos,'Cantidad':r.cantidad,'Valor total':r.valor_total}))],["Resumen",[{"Líneas":d.totals.lineas,"Cantidad total":d.totals.cantidad,"Valor total":d.totals.valor}]]]);}catch(e){res.status(400).json({error:e.message})}});

async function getDailyClose(f){
  if(!f.to)throw new Error('Selecciona la fecha del cierre.');
  const movement=await q(`SELECT w.nombre almacen,v.movement_type tipo,COUNT(*)::int movimientos,SUM(v.cantidad)::numeric cantidad,SUM(COALESCE(v.valor,0))::numeric valor
    FROM inventory_movements v JOIN warehouses w ON w.id=v.warehouse_id WHERE COALESCE(v.fecha_atencion,v.fecha::date)=$1::date AND COALESCE(v.condicion,'') NOT IN ('VACIADO_ALMACEN','PRESTAMO','DEVOLUCION_PRESTAMO') AND ($2='' OR v.warehouse_id=NULLIF($2,'')::bigint)
    GROUP BY w.nombre,v.movement_type ORDER BY w.nombre,v.movement_type`,[f.to,f.warehouse]);
  const stocks=await q(`WITH ledger AS (SELECT v.id,v.warehouse_id,v.material_id,COALESCE(v.fecha_atencion,v.fecha::date) fecha,
      SUM(CASE WHEN v.movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN v.cantidad ELSE -v.cantidad END) OVER(PARTITION BY v.warehouse_id,v.material_id ORDER BY COALESCE(v.fecha_atencion,v.fecha::date),v.fecha,v.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) saldo
    FROM inventory_movements v WHERE COALESCE(v.fecha_atencion,v.fecha::date)<=$1::date),last_rows AS (SELECT DISTINCT ON (warehouse_id,material_id) warehouse_id,material_id,saldo FROM ledger ORDER BY warehouse_id,material_id,fecha DESC,id DESC)
    SELECT w.nombre almacen,m.codigo,m.descripcion material,COALESCE(m.unidad,'') unidad,lr.saldo::numeric stock,COALESCE(p.stock_minimo,m.stock_minimo,0)::numeric minimo,COALESCE(b.costo_promedio,m.costo_referencia,0)::numeric costo_unitario,(lr.saldo*COALESCE(NULLIF(b.costo_promedio,0),m.costo_referencia,0))::numeric valor,
      CASE WHEN lr.saldo<0 THEN 'NEGATIVO' WHEN COALESCE(p.stock_minimo,m.stock_minimo,0)>0 AND lr.saldo<=COALESCE(p.stock_minimo,m.stock_minimo,0) THEN 'CRITICO' WHEN lr.saldo=0 THEN 'SIN STOCK' ELSE 'NORMAL' END estado
    FROM last_rows lr JOIN warehouses w ON w.id=lr.warehouse_id JOIN materials m ON m.id=lr.material_id LEFT JOIN inventory_balances b ON b.warehouse_id=lr.warehouse_id AND b.material_id=lr.material_id LEFT JOIN warehouse_material_policies p ON p.warehouse_id=lr.warehouse_id AND p.material_id=lr.material_id
    WHERE ($2='' OR lr.warehouse_id=NULLIF($2,'')::bigint) ORDER BY w.nombre,m.descripcion LIMIT 10000`,[f.to,f.warehouse]);
  const totals={ingresos:movement.rows.filter(x=>['INITIAL','IN','TRANSFER_IN','ADJUSTMENT'].includes(x.tipo)).reduce((a,x)=>a+Number(x.valor||0),0),salidas:movement.rows.filter(x=>['OUT','TRANSFER_OUT'].includes(x.tipo)).reduce((a,x)=>a+Number(x.valor||0),0),stockValor:stocks.rows.reduce((a,x)=>a+Number(x.valor||0),0),negativos:stocks.rows.filter(x=>Number(x.stock)<0).length,criticos:stocks.rows.filter(x=>x.estado==='CRITICO').length};
  return {fecha:f.to,warehouse:f.warehouse,movimientos:movement.rows,stocks:stocks.rows,totals};
}
app.get('/api/reports/daily-close',async(req,res)=>{try{res.json(await getDailyClose(reportDateFilters(req)))}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/reports/daily-close.csv',async(req,res)=>{try{const d=await getDailyClose(reportDateFilters(req));reportCsv(res,'SILOG_cierre_diario',d.stocks.map(r=>({'Fecha de corte':d.fecha,'Almacén':r.almacen,'Código':r.codigo,'Material':r.material,'Unidad':r.unidad,'Stock al cierre':r.stock,'Mínimo':r.minimo,'Costo unitario':r.costo_unitario,'Valor':r.valor,'Estado':r.estado})));}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/reports/daily-close.xlsx',async(req,res)=>{try{const d=await getDailyClose(reportDateFilters(req));reportXlsx(res,'SILOG_cierre_diario',[["Stock al cierre",d.stocks.map(r=>({'Fecha de corte':d.fecha,'Almacén':r.almacen,'Código':r.codigo,'Material':r.material,'Unidad':r.unidad,'Stock al cierre':r.stock,'Mínimo':r.minimo,'Costo unitario':r.costo_unitario,'Valor':r.valor,'Estado':r.estado}))],["Movimientos del día",d.movimientos.map(r=>({'Almacén':r.almacen,'Tipo':r.tipo,'Movimientos':r.movimientos,'Cantidad':r.cantidad,'Valor':r.valor}))],["Resumen",[{"Fecha":d.fecha,"Valor de stock":d.totals.stockValor,"Valor ingresos del día":d.totals.ingresos,"Valor salidas del día":d.totals.salidas,"Posiciones negativas":d.totals.negativos,"Posiciones críticas":d.totals.criticos}]]]);}catch(e){res.status(400).json({error:e.message})}});

app.get('/api/export-data',async(req,res)=>{
  try{
    const from=req.query.from||'1900-01-01',to=req.query.to||'2999-12-31';
    const r=await q(`WITH x AS (SELECT v.*, SUM(CASE WHEN v.movement_type IN ('INITIAL','IN','TRANSFER_IN','ADJUSTMENT') THEN v.cantidad ELSE -v.cantidad END) OVER(PARTITION BY v.warehouse_id,v.material_id ORDER BY v.fecha,v.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) stock_after FROM inventory_movements v WHERE v.fecha::date BETWEEN $1::date AND $2::date)
      SELECT EXTRACT(YEAR FROM x.fecha)::int "AÑO",w.nombre "ALMACEN",x.condicion "CONDICION",x.documento "DOC",x.numero "N°",COALESCE(x.fecha_atencion,x.fecha::date) "FECHA",cc.codigo "CeCo",x.cliente "CLIENTE",x.area "AREA",x.placa "PLACA",m.codigo "CÓDIGO",x.cantidad "CANT",x.stock_after "STOCK",m.unidad "UND",m.descripcion "PRODUCTO",g.nombre "GRUPO",x.moneda "MON",x.costo_unitario "PU",x.valor "S/ Total",x.dni "DNI",x.solicitante "SOLICITANTE",x.entregado "ENTREGADO",x.autorizado "AUTORIZADO"
      FROM x JOIN materials m ON m.id=x.material_id JOIN warehouses w ON w.id=x.warehouse_id LEFT JOIN material_groups g ON g.id=m.grupo_id LEFT JOIN cost_centers cc ON cc.id=x.ceco_id ORDER BY x.fecha,x.id`,[from,to]);
    const headers=['AÑO','ALMACEN','CONDICION','DOC','N°','FECHA','CeCo','CLIENTE','AREA','PLACA','CÓDIGO','CANT','STOCK','UND','PRODUCTO','GRUPO','MON','PU','S/ Total','DNI','SOLICITANTE','ENTREGADO','AUTORIZADO'];
    const ws=XLSX.utils.json_to_sheet(r.rows,{header:headers});const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,ws,'DATA');
    const buf=XLSX.write(book,{type:'buffer',bookType:'xlsx'});res.setHeader('Content-Disposition',`attachment; filename="DATA_${from}_${to}.xlsx"`);res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.send(buf);
  }catch(e){res.status(500).json({error:e.message})}
});

async function runScheduledReports(){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  const today=`${parts.year}-${parts.month}-${parts.day}`,time=`${parts.hour}:${parts.minute}`,dow=new Date(`${today}T12:00:00Z`).getUTCDay();
  const due=await q(`SELECT id FROM report_schedules WHERE active AND to_char(run_time,'HH24:MI')<=$1 AND (last_run_date IS NULL OR last_run_date<$2::date) AND (frequency='DAILY' OR day_of_week=$3) ORDER BY id LIMIT 25`,[time,today,dow]);
  for(const item of due.rows){
    const client=await pool.connect();let schedule;
    try{
      await client.query('BEGIN');
      const claim=await client.query(`UPDATE report_schedules SET last_run_date=$2::date,updated_at=now() WHERE id=$1 AND active AND (last_run_date IS NULL OR last_run_date<$2::date) RETURNING *`,[item.id,today]);
      if(!claim.rowCount){await client.query('ROLLBACK');continue;}schedule=claim.rows[0];await client.query('COMMIT');
      const warehouse=schedule.warehouse_id?String(schedule.warehouse_id):'';let payload,rowCount=0,periodStart=today,periodEnd=today;
      const filters={from:today,to:today,warehouse,search:'',ceco:'',dni:''};
      if(schedule.report_type==='daily-costs'){payload=await getDailyCosts(filters);rowCount=payload.rows.length;}
      else if(schedule.report_type==='stock-alerts'){payload=await getStockAlertsReport(warehouse);rowCount=payload.length;periodStart=null;periodEnd=null;}
      else if(schedule.report_type==='daily-close'){payload=await getDailyClose({to:today,warehouse,from:'',search:'',ceco:'',dni:''});rowCount=payload.stocks.length;}
      else {payload=await getConsumptionReport(filters);rowCount=payload.rows.length;}
      await q(`INSERT INTO report_runs(schedule_id,schedule_name,report_type,generated_at,period_start,period_end,row_count,status,payload,created_by) VALUES($1,$2,$3,now(),$4::date,$5::date,$6,'OK',$7::jsonb,'SCHEDULER')`,[schedule.id,schedule.name,schedule.report_type,periodStart,periodEnd,rowCount,JSON.stringify(payload)]);
      await q(`INSERT INTO audit_log(usuario,accion,entidad,entidad_id,detalle) VALUES('SCHEDULER','EJECUTAR_REPORTE_PROGRAMADO','REPORT_SCHEDULE',$1,$2)`,[String(schedule.id),JSON.stringify({name:schedule.name,type:schedule.report_type,rows:rowCount,date:today})]);
    }catch(e){
      await client.query('ROLLBACK').catch(()=>{});
      if(schedule)await q(`INSERT INTO report_runs(schedule_id,schedule_name,report_type,generated_at,period_start,period_end,row_count,status,error,created_by) VALUES($1,$2,$3,now(),$4::date,$4::date,0,'ERROR',$5,'SCHEDULER')`,[schedule.id,schedule.name,schedule.report_type,today,e.message]).catch(err=>console.error('No se pudo guardar error de reporte programado:',err.message));
      console.error('Reporte programado falló:',e.message);
    }finally{client.release()}
  }
}

async function start(){await initSchema();await ensureDefaultAdmin();const s=await syncSeed();console.log('SILOG data sync:',s);const port=process.env.PORT||3000;app.listen(port,()=>console.log(`SILOG listening on ${port}`));setInterval(()=>runScheduledReports().catch(e=>console.error('Scheduler SILOG:',e.message)),60000);runScheduledReports().catch(e=>console.error('Scheduler SILOG:',e.message));}
start().catch(e=>{console.error('No se pudo iniciar SILOG:',e);process.exit(1)});
