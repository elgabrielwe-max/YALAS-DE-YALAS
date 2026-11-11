const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('estructura SILOG y Maestro Excel incluidos', () => {
  assert.equal(fs.existsSync('server/index.js'), true);
  assert.equal(fs.existsSync('database/schema.sql'), true);
  assert.equal(fs.existsSync('data/CONSUMO_MATERIALES_2026.csv'), true);
  assert.equal(fs.existsSync('data/seed.json'), true);
  const seed = JSON.parse(fs.readFileSync(path.join('data', 'seed.json'), 'utf8'));
  assert.ok(seed.materials.length >= 7000, 'el Maestro completo debe estar incluido');
  assert.ok(seed.materials.some(m => m.codigo === 'PR2301' && /TAPON AUDITIVO DESCARTABLE/i.test(m.descripcion)));
});

test('correcciones de inventario por almacén presentes', () => {
  const server = fs.readFileSync(path.join('server', 'index.js'), 'utf8');
  const client = fs.readFileSync(path.join('public', 'app.js'), 'utf8');
  assert.match(server, /const loadedOnly=req\.query\.loaded_only/);
  assert.match(server, /const positiveOnly=req\.query\.positive_only/);
  assert.match(server, /app\.post\('\/api\/inventory\/load'/);
  assert.match(server, /Stock insuficiente para \$\{item\.codigo\} en \$\{wh\.rows\[0\]\.nombre\}/);
  assert.match(client, /\/api\/inventory\/load/);
  assert.match(client, /agregado automáticamente a Salidas/);
});


test('ingreso manual de inventario por Maestro y almacén disponible', () => {
  const html = fs.readFileSync(path.join('public', 'index.html'), 'utf8');
  const client = fs.readFileSync(path.join('public', 'app.js'), 'utf8');
  assert.match(html, /openManualInventoryEntry\(\)/);
  assert.match(html, /id="manualInventoryDialog"/);
  assert.match(html, /id="manualInvWarehouse"/);
  assert.match(client, /async function selectManualInventoryMaterial/);
  assert.match(client, /api\('\/api\/income'/);
  assert.match(html, /Guardar ingreso en este almacén/);
});


test('no se borran saldos digitados y el inventario se recupera desde movimientos', () => {
  const server = fs.readFileSync(path.join('server', 'index.js'), 'utf8');
  assert.doesNotMatch(server, /DELETE FROM inventory_balances/i);
  assert.match(server, /FROM inventory_movements WHERE warehouse_id=\$1 AND material_id=\$2/);
  assert.match(server, /EXISTS \(SELECT 1 FROM inventory_movements vx WHERE vx\.material_id=m\.id/);
  assert.match(server, /OR EXISTS \(SELECT 1 FROM inventory_movements vx WHERE vx\.material_id=m\.id/);
});


test('reporte de últimos materiales y exportación por almacén disponibles', () => {
  const server = fs.readFileSync(path.join('server', 'index.js'), 'utf8');
  const html = fs.readFileSync(path.join('public', 'index.html'), 'utf8');
  const client = fs.readFileSync(path.join('public', 'app.js'), 'utf8');
  assert.ok(server.includes("app.get('/api/resources-report'"));
  assert.ok(server.includes("app.get('/api/resources-report.csv'"));
  assert.ok(server.includes("app.get('/api/resources-report.xlsx'"));
  assert.match(server, /v\.created_by/);
  assert.match(server, /v\.costo_unitario/);
  assert.match(html, /id="resourcesReportForm"/);
  assert.match(html, /id="resourcesWarehouse"/);
  assert.match(html, /id="resourcesXlsx"/);
  assert.match(client, /async function loadResourcesReport/);
  assert.match(client, /\/api\/resources-report\?/);
});


test('Kardex por trabajador consulta por DNI, fechas y almacén y exporta CSV/Excel', () => {
  const server = fs.readFileSync(path.join('server', 'index.js'), 'utf8');
  const html = fs.readFileSync(path.join('public', 'index.html'), 'utf8');
  const client = fs.readFileSync(path.join('public', 'app.js'), 'utf8');
  assert.ok(server.includes("app.get('/api/worker-kardex'"));
  assert.ok(server.includes("app.get('/api/worker-kardex.csv'"));
  assert.ok(server.includes("app.get('/api/worker-kardex.xlsx'"));
  assert.match(server, /v\.movement_type='OUT'/);
  assert.match(server, /regexp_replace\(COALESCE\(v\.dni/);
  assert.match(server, /v\.fecha_atencion/);
  assert.match(html, /data-page="workerKardex"/);
  assert.match(html, /id="workerKardexForm"/);
  assert.match(html, /id="workerKardexDni"/);
  assert.match(client, /async function loadWorkerKardex/);
  assert.match(client, /\/api\/worker-kardex\?/);
});


test('reportes gerenciales funcionales por almacén, material, consumo y cierre', () => {
  const server = fs.readFileSync(path.join('server', 'index.js'), 'utf8');
  const html = fs.readFileSync(path.join('public', 'index.html'), 'utf8');
  const client = fs.readFileSync(path.join('public', 'app.js'), 'utf8');
  for (const route of ['/api/reports/daily-costs', '/api/reports/material-kardex', '/api/reports/consumption', '/api/reports/daily-close']) {
    assert.ok(server.includes(`app.get('${route}'`), `falta ruta ${route}`);
    assert.ok(server.includes(`app.get('${route}.csv'`), `falta CSV ${route}`);
    assert.ok(server.includes(`app.get('${route}.xlsx'`), `falta Excel ${route}`);
  }
  assert.match(server, /SUM\(COALESCE\(v\.valor,0\)\)::numeric valor_total/);
  assert.match(server, /OVER\(PARTITION BY v\.warehouse_id,v\.material_id ORDER BY v\.fecha,v\.id/);
  assert.match(html, /id="dailyCostsForm"/);
  assert.match(html, /id="materialKardexForm"/);
  assert.match(html, /id="consumptionForm"/);
  assert.match(html, /id="dailyCloseForm"/);
  assert.match(html, /id="dailyCostsChart"/);
  assert.match(client, /function drawDailyCosts/);
  assert.match(client, /function loadMaterialKardex/);
  assert.match(client, /function loadConsumption/);
  assert.match(client, /function loadDailyClose/);
});


test('SILOG 1.6.1 corrige dashboard y añade importación/vaciado auditables', () => {
  const server = fs.readFileSync(path.join('server', 'index.js'), 'utf8');
  const html = fs.readFileSync(path.join('public', 'index.html'), 'utf8');
  const client = fs.readFileSync(path.join('public', 'app.js'), 'utf8');
  const schema = fs.readFileSync(path.join('database', 'schema.sql'), 'utf8');
  assert.match(server, /AS months\(mes\)/);
  assert.match(server, /THEN COALESCE\(\(SELECT SUM\(bx\.cantidad\) FROM inventory_balances bx/);
  assert.match(server, /THEN COALESCE\(\(SELECT SUM\(bx\.valor\) FROM inventory_balances bx/);
  assert.match(server, /app\.post\('\/api\/inventory\/clear-warehouse'/);
  assert.match(schema, /movement_type IN \('INITIAL','IN','OUT','ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT','CLEAR'\)/);
  assert.match(server, /app\.post\('\/api\/personnel\/import'/);
  assert.match(server, /RUC del proveedor debe tener 11 dígitos/);
  assert.match(schema, /proveedor_ruc TEXT/);
  assert.match(html, /name="proveedor_ruc"/);
  assert.match(html, /peopleImportFile/);
  assert.match(html, /clearWarehouseDialog/);
  assert.match(client, /\/api\/personnel\/import/);
  assert.match(client, /\/api\/inventory\/clear-warehouse/);
});

test('SILOG 1.7.0 incluye transferencias transaccionales y conciliación de saldos', () => {
  const server = fs.readFileSync(path.join('server', 'index.js'), 'utf8');
  const html = fs.readFileSync(path.join('public', 'index.html'), 'utf8');
  const client = fs.readFileSync(path.join('public', 'app.js'), 'utf8');
  assert.match(server, /app\.post\('\/api\/transfers'/);
  assert.match(server, /'TRANSFER_OUT'/);
  assert.match(server, /'TRANSFER_IN'/);
  assert.match(server, /app\.get\('\/api\/system\/diagnostics'/);
  assert.match(server, /balancesDescuadrados/);
  assert.match(server, /app\.post\('\/api\/inventory\/count'/);
  assert.match(html, /id="transferForm"/);
  assert.match(html, /id="reconciliationForm"/);
  assert.match(client, /async function loadTransfers/);
  assert.match(html, /Registrar conciliación/);
});

test('SILOG 1.7.0 incluye políticas de stock, alertas, presupuesto y auditoría', () => {
  const server = fs.readFileSync(path.join('server', 'index.js'), 'utf8');
  const schema = fs.readFileSync(path.join('database', 'schema.sql'), 'utf8');
  const html = fs.readFileSync(path.join('public', 'index.html'), 'utf8');
  const client = fs.readFileSync(path.join('public', 'app.js'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS warehouse_material_policies/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS warehouse_monthly_budgets/);
  assert.match(server, /app\.post\('\/api\/inventory\/policies'/);
  assert.match(server, /app\.get\('\/api\/alerts'/);
  assert.match(server, /app\.get\('\/api\/reports\/stock-alerts\.xlsx'/);
  assert.match(server, /app\.post\('\/api\/budgets'/);
  assert.match(server, /app\.get\('\/api\/audit'/);
  assert.match(server, /app\.post\('\/api\/report-schedules'/);
  assert.match(server, /async function runScheduledReports/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS report_runs/);
  assert.match(html, /id="scheduleReportForm"/);
  assert.match(client, /async function loadSchedules/);
  assert.match(html, /id="budgetForm"/);
  assert.match(html, /id="stockAlertsReportForm"/);
  assert.match(html, /id="auditBody"/);
  assert.match(client, /async function loadDiagnostics/);
  assert.match(client, /async function loadStockAlertsReport/);
});

test('SILOG 1.8.0 incluye préstamos, supervisores, devoluciones parciales, alertas y evidencia', () => {
  const server = fs.readFileSync(path.join('server', 'index.js'), 'utf8');
  const html = fs.readFileSync(path.join('public', 'index.html'), 'utf8');
  const client = fs.readFileSync(path.join('public', 'app.js'), 'utf8');
  const schema = fs.readFileSync(path.join('database', 'schema.sql'), 'utf8');
  for (const route of ["'/api/loans'", "'/api/loans/alerts'", "'/api/loans/supervisors'", "'/api/loans/:id/return'", "'/api/loans/:id/extend'", "'/api/loans/report.csv'", "'/api/loans/report.xlsx'"]) assert.ok(server.includes(route), `falta ${route}`);
  for (const table of ['material_loans', 'material_loan_items', 'material_loan_supervisors', 'material_loan_returns', 'material_loan_deadline_changes']) assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(server, /SILOG_PRESTAMO/);
  assert.match(server, /PRESTAMO_DANADO/);
  assert.match(server, /06:00 a 18:00/);
  assert.match(html, /data-page="loans"/);
  assert.match(html, /id="loanEvidence"/);
  assert.match(html, /id="loanReportXlsx"/);
  assert.match(client, /async function loadLoans/);
  assert.match(client, /async function openLoanReturn/);
  assert.match(client, /async function openLoanExtend/);
  assert.match(client, /fileToCompressedDataUrl/);
});

test('préstamos están protegidos por sesión y permisos de rol', () => {
  const server = fs.readFileSync(path.join('server', 'index.js'), 'utf8');
  assert.match(server, /app\.post\('\/api\/loans',requireAuth,requireRole\('ADMIN','SUPERVISOR','ALMACEN','OPERADOR'\)/);
  assert.match(server, /app\.post\('\/api\/loans\/:id\/return',requireAuth,requireRole\('ADMIN','SUPERVISOR','ALMACEN'\)/);
  assert.match(server, /app\.post\('\/api\/loans\/:id\/extend',requireAuth,requireRole\('ADMIN','SUPERVISOR'\)/);
});

test('costos gerenciales separan préstamo temporal y devolución del consumo definitivo', () => {
  const server = fs.readFileSync(path.join('server', 'index.js'), 'utf8');
  assert.ok(server.includes("COALESCE(v.condicion,'') NOT IN ('VACIADO_ALMACEN','PRESTAMO','DEVOLUCION_PRESTAMO')"));
  assert.ok(server.includes("'PRESTAMO_DANADO'"));
});


test('Maestro muestra hasta 10000 materiales y permite registrar material nuevo', () => {
  const server = fs.readFileSync(path.join('server', 'index.js'), 'utf8');
  const client = fs.readFileSync(path.join('public', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join('public', 'index.html'), 'utf8');
  assert.match(server, /Number\(req\.query\.limit\|\|200\),1\),10000/);
  assert.match(server, /app\.post\('\/api\/materials',requireRole\('ADMIN','SUPERVISOR'\)/);
  assert.match(client, /limit=10000/);
  assert.match(html, /id="toggleNewMaterial"/);
  assert.match(html, /id="newMaterialForm"/);
  assert.match(client, /api\('\/api\/materials'/);
});

test('SILOG 1.8.4 incorpora diseño ERP y accesos rápidos sin quitar módulos', () => {
  const html = fs.readFileSync(path.join('public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join('public', 'styles.css'), 'utf8');
  const client = fs.readFileSync(path.join('public', 'app.js'), 'utf8');
  const server = fs.readFileSync(path.join('server', 'index.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(pkg.version, '1.8.7');
  assert.match(html, /class="quick-actions panel"/);
  for (const page of ['income', 'outflow', 'inventory', 'loans']) assert.match(html, new RegExp(`data-quick-page="${page}"`));
  assert.match(client, /querySelectorAll\('\[data-quick-page\]'\)/);
  assert.match(client, /aria-current/);
  assert.match(css, /SILOG 1\.8\.4 — sistema de diseño ERP empresarial/);
  assert.match(server, /version:'1\.8\.7-salidas-stock-visible'/);
  for (const page of ['materials', 'income', 'outflow', 'loans', 'scanner', 'inventory', 'transfers', 'reconciliation', 'data', 'people', 'workerKardex', 'users', 'export', 'audit']) {
    assert.match(html, new RegExp(`data-page="${page}"`), `falta el módulo ${page}`);
  }
});


test('registro de material define explícitamente el tipo del código anterior opcional', () => {
  const server = fs.readFileSync(path.join('server', 'index.js'), 'utf8');
  assert.match(server, /NULLIF\(\$2::text,''\) IS NOT NULL AND upper\(COALESCE\(codigo_anterior,''\)\)=upper\(\$2::text\)/);
  assert.match(server, /app\.post\('\/api\/materials',requireRole\('ADMIN','SUPERVISOR'\)/);
});


test('materiales nuevos del Maestro son buscables para ingreso aunque tengan stock cero',()=>{
 const server=fs.readFileSync(path.join('server','index.js'),'utf8');const client=fs.readFileSync(path.join('public','app.js'),'utf8');
 assert.match(server,/app\.get\('\/api\/materials\/lookup'/);assert.match(server,/WHERE m\.activo AND \(m\.codigo ILIKE/);
 assert.match(client,/\/api\/materials\/lookup\?search=/);assert.match(client,/function selectManualInventoryMaterial/);
});

test('módulo Kits con definición, armado por almacén y salida',()=>{
 const schema=fs.readFileSync(path.join('database','schema.sql'),'utf8');const server=fs.readFileSync(path.join('server','index.js'),'utf8');const html=fs.readFileSync(path.join('public','index.html'),'utf8');const client=fs.readFileSync(path.join('public','app.js'),'utf8');
 for(const table of ['kits','kit_components','kit_balances','kit_movements'])assert.match(schema,new RegExp('CREATE TABLE IF NOT EXISTS '+table));
 assert.match(server,/app\.post\('\/api\/kits\/\:id\/assemble'/);assert.match(server,/app\.post\('\/api\/kits\/\:id\/dispatch'/);assert.match(server,/Stock insuficiente para \$\{c\.codigo\}/);
 assert.match(html,/data-page="kits"/);assert.match(html,/id="kitCreateForm"/);assert.match(client,/async function loadKits/);assert.match(client,/function assembleKit/);
});


test('Salidas consulta materiales por almacén usando lookup y solo muestra stock positivo',()=>{
 const client=fs.readFileSync(path.join('public','app.js'),'utf8');
 assert.match(client,/async function searchIssueProducts[\s\S]*?api\('\/api\/materials\/lookup\?search=/);
 assert.match(client,/const available=rows\.filter\(m=>Number\(m\.stock\|\|0\)>0\)/);
 assert.match(client,/async function selectIssueProduct[\s\S]*?Number\(x\.stock\|\|0\)>0/);
 assert.match(client,/No se pudo consultar el inventario/);
});
