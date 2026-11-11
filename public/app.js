const $=s=>document.querySelector(s); const $$=s=>[...document.querySelectorAll(s)];
let currentUser=null;
function showLogin(message=''){const s=$('#loginScreen');if(s)s.classList.remove('hidden');if($('#loginError'))$('#loginError').textContent=message||'';document.body.classList.add('loggedOut')}
function hideLogin(){const s=$('#loginScreen');if(s)s.classList.add('hidden');document.body.classList.remove('loggedOut')}
const api=async(u,o)=>{const r=await fetch(u,{credentials:'same-origin',...(o||{})});const j=await r.json().catch(()=>({}));if(r.status===401&&u!=='/api/auth/login'){showLogin('Tu sesión terminó. Ingresa nuevamente.');throw new Error(j.error||'Sesión no iniciada')}if(!r.ok)throw new Error(j.error||'Error');return j};
const money=n=>new Intl.NumberFormat('es-PE',{style:'currency',currency:'PEN'}).format(Number(n||0));
const num=n=>new Intl.NumberFormat('es-PE',{maximumFractionDigits:2}).format(Number(n||0));
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let lookups={warehouses:[],groups:[],families:[],cecos:[]}, productCache=[], peopleCache=[];

document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>show(b.dataset.page));
document.querySelectorAll('[data-quick-page]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.quickPage)));
function show(p){document.querySelectorAll('.page').forEach(x=>x.classList.add('hidden'));$('#'+p).classList.remove('hidden');document.querySelectorAll('nav button').forEach(x=>{const active=x.dataset.page===p;x.classList.toggle('active',active);if(active)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current')});$('#pageTitle').textContent=document.querySelector(`button[data-page="${p}"]`).textContent.replace(/^.\s*/, '').replace(/\s*\d+\s*$/,'');if(p==='dashboard'){loadDash();loadBudget()}if(p==='loans'){loadLoans();initLoanForm();loadLoanReport()}if(p==='materials')loadMaterials();if(p==='inventory'){loadInventory();loadAlerts()}if(p==='kits')loadKits();if(p==='people')loadPeople();if(p==='workerKardex')initWorkerKardex();if(p==='users')loadUsers();if(p==='data')loadData(1);if(p==='scanner')initScannerPage();if(p==='transfers')loadTransfers();if(p==='reconciliation')loadAlerts();if(p==='audit')loadAudit();if(p==='export'){loadResourcesReport();initAdvancedReports();if(currentUser&&['ADMIN','SUPERVISOR'].includes(currentUser.rol))loadSchedules();}}
function todayLocal(){const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,10)}
function setToday(input){if(input&&!input.value)input.value=todayLocal()}
function setDigitacion(form){const el=form?.querySelector('[name=fecha_digitacion]');if(el){el.value=todayLocal();el.readOnly=true;el.setAttribute('aria-readonly','true')}}

async function init(){
 const me=await fetch('/api/auth/me',{credentials:'same-origin'}).then(async r=>r.ok?r.json():null).catch(()=>null);
 if(!me){showLogin();return}
 currentUser=me.user; hideLogin(); $('#currentUser').textContent=`${currentUser.nombre} · ${currentUser.rol}`;const createWarehouseBtn=$('#openCreateWarehouse');if(createWarehouseBtn)createWarehouseBtn.style.display=['ADMIN','SUPERVISOR'].includes(currentUser.rol)?'':'none';
 const usersNav=document.querySelector('button[data-page="users"]'); if(usersNav)usersNav.style.display=currentUser.rol==='ADMIN'?'':'none';const auditNav=document.querySelector('button[data-page="audit"]');if(auditNav)auditNav.style.display=currentUser.rol==='ADMIN'?'':'none';if($('#scheduleReportsPanel'))$('#scheduleReportsPanel').style.display=['ADMIN','SUPERVISOR'].includes(currentUser.rol)?'':'none';
 await loadLookups();
 setToday(document.querySelector('#incomeForm [name=fecha_atencion]'));setToday(document.querySelector('#outflowForm [name=fecha_atencion]'));setDigitacion(document.querySelector('#incomeForm'));setDigitacion(document.querySelector('#outflowForm'));
 await Promise.all([loadDash(),loadPeople(),loadMaterials()]);
 addIssueRow();
 loadLoanAlertBadge();setInterval(()=>{if(!document.hidden)loadDash();},30000);setInterval(()=>{if(!document.hidden)loadLoanAlertBadge()},60000);
 setInterval(()=>{if(!document.hidden&&$('#outflow')&&!$('#outflow').classList.contains('hidden')) refreshIssueStocks();},30000);
}

async function loadLookups(){lookups=await api('/api/lookups');
 $('#incomeWh').innerHTML=lookups.warehouses.map(w=>`<option value="${esc(w.nombre)}">${esc(w.nombre)}</option>`).join('');
 $('#outWh').innerHTML=lookups.warehouses.map(w=>`<option value="${w.id}">${esc(w.nombre)}</option>`).join('');
 $('#adjustWh').innerHTML=lookups.warehouses.map(w=>`<option value="${esc(w.nombre)}">${esc(w.nombre)}</option>`).join('');
 $('#invWarehouse').innerHTML='<option value="">Todos los almacenes</option>'+lookups.warehouses.map(w=>`<option value="${w.id}">${esc(w.nombre)}</option>`).join('');
 $('#dataWarehouse').innerHTML='<option value="">Todos los almacenes</option>'+lookups.warehouses.map(w=>`<option value="${w.id}">${esc(w.nombre)}</option>`).join('');
 if($('#workerKardexWarehouse'))$('#workerKardexWarehouse').innerHTML='<option value="">Todos los almacenes</option>'+lookups.warehouses.map(w=>`<option value="${w.id}">${esc(w.nombre)}</option>`).join('');
  if($('#resourcesWarehouse'))$('#resourcesWarehouse').innerHTML='<option value="">Todos los almacenes</option>'+lookups.warehouses.map(w=>`<option value="${w.id}">${esc(w.nombre)}</option>`).join('');
 for(const id of ['dailyCostsWarehouse','materialKardexWarehouse','consumptionWarehouse','dailyCloseWarehouse'])if($('#'+id))$('#'+id).innerHTML='<option value="">Todos los almacenes</option>'+lookups.warehouses.map(w=>`<option value="${esc(w.id)}">${esc(w.nombre)}</option>`).join('');
 if($('#consumptionCeco'))$('#consumptionCeco').innerHTML='<option value="">Todos los centros de costo</option>'+lookups.cecos.map(c=>`<option value="${esc(c.id)}">${esc(c.codigo)} · ${esc(c.descripcion||'')}</option>`).join('');
 $('#matGroup').innerHTML='<option value="">Todos los grupos</option>'+lookups.groups.map(g=>`<option value="${esc(g.codigo)}">${esc(g.nombre)}</option>`).join('');
 $('#matFamily').innerHTML='<option value="">Todas las familias</option>'+lookups.families.map(f=>`<option value="${esc(f.codigo)}">${esc(f.nombre)}</option>`).join('');
 $('#outCeco').innerHTML='<option value="">Selecciona CeCo</option>'+lookups.cecos.map(c=>`<option value="${c.id}" data-cliente="${esc(c.minera||'')}" data-area="${esc(c.area||'')}">${esc(c.codigo)} · ${esc(c.descripcion||'')} · ${esc(c.area||'')}</option>`).join('');
 for(const id of ['dashboardWarehouse','budgetWarehouse','transferOrigin','transferDestination','reconWarehouse','policyWarehouse'])if($('#'+id))$('#'+id).innerHTML=(id==='dashboardWarehouse'?'<option value="">Todos los almacenes</option>':'')+lookups.warehouses.map(w=>`<option value="${esc(w.id)}">${esc(w.nombre)}</option>`).join('');
 if($('#stockAlertsReportWarehouse'))$('#stockAlertsReportWarehouse').innerHTML='<option value="">Todos los almacenes</option>'+lookups.warehouses.map(w=>`<option value="${esc(w.id)}">${esc(w.nombre)}</option>`).join('');
 if($('#scheduleWarehouse'))$('#scheduleWarehouse').innerHTML='<option value="">Todos los almacenes</option>'+lookups.warehouses.map(w=>`<option value="${esc(w.id)}">${esc(w.nombre)}</option>`).join('');
 if($('#kitsWarehouse'))$('#kitsWarehouse').innerHTML=lookups.warehouses.map(w=>`<option value="${esc(w.id)}">${esc(w.nombre)}</option>`).join('');
 for(const id of ['loanWarehouse','loanReportWarehouse'])if($('#'+id))$('#'+id).innerHTML=(id==='loanReportWarehouse'?'<option value="">Todos los almacenes</option>':'')+lookups.warehouses.map(w=>`<option value="${esc(w.id)}">${esc(w.nombre)}</option>`).join('');
 if($('#transferDestination')&&lookups.warehouses.length>1)$('#transferDestination').selectedIndex=1;
 const month=todayLocal().slice(0,7);if($('#budgetPeriod')&&!$('#budgetPeriod').value)$('#budgetPeriod').value=month;
 productCache=[];
}

async function loadDash(){try{const wh=$('#dashboardWarehouse')?.value||'';const d=await api('/api/dashboard'+(wh?'?warehouse='+encodeURIComponent(wh):''));$('#mCount').textContent=num(d.materials);$('#invValue').textContent=money(d.inventory_value);$('#outValue').textContent=money(d.month_out);$('#inValue').textContent=money(d.month_in);$('#outCount').textContent=`${num(d.month_out_count)} movimientos`;$('#inCount').textContent=`${num(d.month_in_count)} movimientos`;$('#negCount').textContent=num(d.negative_stock);$('#critCount').textContent=num(d.critical);$('#health').className=d.queryErrors?.length?'err':'ok';$('#lastSync').textContent=(d.queryErrors?.length?'Con errores en '+d.queryErrors.length+' consulta(s) · ':'Actualizado ')+new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});drawMonthly(d.monthly);drawGroups(d.groups);drawTop(d.top);drawDailyCosts(d.dailyCosts||[]);drawWarehouseCompare(d.warehouseCompare||[]);drawAnalysis(d);renderDashboardAlerts(d.alerts||[]);if(d.queryErrors?.length){$('#systemDiagnostics').innerHTML='<div class="alert danger"><b>El dashboard detectó consultas con error:</b><ul>'+d.queryErrors.map(x=>`<li>${esc(x.consulta)}: ${esc(x.error)}</li>`).join('')+'</ul></div>'}else if(currentUser&&['ADMIN','SUPERVISOR'].includes(currentUser.rol)){loadDiagnostics()}if($('#budgetPeriod')&&!$('#budgetPeriod').value)$('#budgetPeriod').value=todayLocal().slice(0,7);loadBudget()}catch(e){$('#health').className='err';$('#lastSync').textContent='Dashboard: '+e.message;if($('#systemDiagnostics'))$('#systemDiagnostics').innerHTML=`<div class="alert danger">No se pudo cargar el dashboard: ${esc(e.message)}</div>`}}
function drawMonthly(rows){const el=$('#monthlyChart');if(!rows?.length){el.innerHTML='<div class="empty">Sin movimientos</div>';return}const w=700,h=260,p=38,max=Math.max(1,...rows.flatMap(r=>[+r.ingreso,+r.salida]));const sx=(w-2*p)/(rows.length-1||1),sy=(h-2*p)/max;const poly=(key)=>rows.map((r,i)=>`${p+i*sx},${h-p-(+r[key])*sy}`).join(' ');let labels=rows.map((r,i)=>`<text x="${p+i*sx}" y="${h-12}" text-anchor="middle" font-size="10" fill="#6f7b85">${esc(r.mes.slice(5))}</text>`).join('');el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="${p}" y1="${p}" x2="${p}" y2="${h-p}" stroke="#dce2e7"/><line x1="${p}" y1="${h-p}" x2="${w-p}" y2="${h-p}" stroke="#dce2e7"/><polyline fill="none" stroke="#1769aa" stroke-width="3" points="${poly('ingreso')}"/><polyline fill="none" stroke="#a64b32" stroke-width="3" points="${poly('salida')}"/>${rows.map((r,i)=>`<circle cx="${p+i*sx}" cy="${h-p-(+r.ingreso)*sy}" r="4" fill="#1769aa"/><circle cx="${p+i*sx}" cy="${h-p-(+r.salida)*sy}" r="4" fill="#a64b32"/>`).join('')}${labels}<text x="${w-10}" y="18" text-anchor="end" font-size="10" fill="#1769aa">Ingresos</text><text x="${w-65}" y="18" text-anchor="end" font-size="10" fill="#a64b32">Salidas</text></svg>`}
function drawGroups(rows){const el=$('#groupChart');if(!rows?.length){el.innerHTML='<div class="empty">Sin valorización</div>';return}const max=Math.max(1,...rows.map(x=>+x.valor));el.innerHTML=rows.map(x=>`<div class="barrow"><span title="${esc(x.nombre)}">${esc(x.nombre).slice(0,22)}</span><div class="bartrack"><div class="barfill" style="width:${Math.max(2,(+x.valor/max)*100)}%"></div></div><b>${money(x.valor)}</b></div>`).join('')}
function drawDailyCosts(rows){
 const el=$('#dailyCostsChart');if(!el)return;if(!rows.length){el.innerHTML='<div class="empty">No hay salidas valorizadas en los últimos 14 días.</div>';return}
 const dates=[...new Set(rows.map(r=>r.fecha))].sort();const whTotals={};rows.forEach(r=>whTotals[r.almacen]=(whTotals[r.almacen]||0)+Number(r.valor||0));
 const whs=Object.entries(whTotals).sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0]);const colors=['#1769aa','#c56a36','#2f855a','#8a63b8','#d4a72c'];
 const values=dates.map(date=>whs.map(wh=>Number(rows.find(r=>r.fecha===date&&r.almacen===wh)?.valor||0)));const max=Math.max(1,...values.map(a=>a.reduce((s,v)=>s+v,0)));
 const w=760,h=280,p=36,innerW=w-2*p,innerH=h-2*p,bw=Math.max(7,innerW/dates.length*.58),step=innerW/dates.length;
 let bars='';values.forEach((arr,i)=>{let y=h-p;arr.forEach((v,j)=>{const bh=v/max*innerH;y-=bh;if(v>0)bars+=`<rect x="${p+i*step+(step-bw)/2}" y="${y}" width="${bw}" height="${bh}" fill="${colors[j]}" rx="2"><title>${esc(dates[i])} · ${esc(whs[j])}: ${money(v)}</title></rect>`})});
 const labels=dates.map((d,i)=>i%2===0||i===dates.length-1?`<text x="${p+i*step+step/2}" y="${h-10}" text-anchor="middle" font-size="10" fill="#6f7b85">${esc(d.slice(5))}</text>`:'').join('');
 const legend=whs.map((wh,i)=>`<span style="display:inline-flex;align-items:center;gap:5px;margin-right:12px;font-size:11px"><i style="display:inline-block;width:9px;height:9px;background:${colors[i]};border-radius:2px"></i>${esc(wh)}</span>`).join('');
 el.innerHTML=`<div style="margin-bottom:8px">${legend}</div><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="${p}" y1="${p}" x2="${p}" y2="${h-p}" stroke="#dce2e7"/><line x1="${p}" y1="${h-p}" x2="${w-p}" y2="${h-p}" stroke="#dce2e7"/>${bars}${labels}</svg>`;
}
function drawWarehouseCompare(rows){const el=$('#warehouseCompareChart');if(!el)return;if(!rows.length){el.innerHTML='<div class="empty">Sin salidas registradas este mes.</div>';return}const max=Math.max(1,...rows.map(x=>Number(x.valor||0)));el.innerHTML=rows.map(x=>`<div class="barrow"><span title="${esc(x.almacen)}">${esc(x.almacen).slice(0,22)}</span><div class="bartrack"><div class="barfill" style="width:${Math.max(Number(x.valor)>0?1:0,Number(x.valor||0)/max*100)}%"></div></div><b>${money(x.valor)}</b></div><small style="display:block;color:#7b8790;margin:-4px 0 5px 160px">${num(x.movimientos)} movimientos</small>`).join('')}
function drawTop(rows){$('#topConsumption').innerHTML=rows?.length?`<table><thead><tr><th>Material</th><th>Cantidad</th><th>Valor</th></tr></thead><tbody>${rows.map(x=>`<tr><td><b>${esc(x.codigo)}</b> ${esc(x.descripcion)}</td><td>${num(x.cantidad)}</td><td>${money(x.valor)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">Sin salidas en el mes</div>'}
function drawAnalysis(d){const a=[];if(d.negative_stock>0)a.push(`<div class="alert danger"><b> ${num(d.negative_stock)} materiales/almacenes con stock negativo.</b><br>Revisa ajustes y salidas históricas antes del cierre.</div>`);if(d.critical>0)a.push(`<div class="alert warn"><b>Stock crítico detectado.</b><br>${num(d.critical)} posiciones están por debajo del mínimo configurado.</div>`);if(d.month_out>0&&d.month_in===0)a.push(`<div class="alert warn"><b>Este mes hay consumo sin ingresos.</b><br>Considera revisar reposiciones y compras.</div>`);if(!a.length)a.push('<div class="alert good"><b>Operación estable.</b><br>No hay alertas críticas configuradas en este momento.</div>');a.push(`<div class="alert"><b>Valorización actual:</b> ${money(d.inventory_value)} · <b>Salidas:</b> ${money(d.month_out)} · <b>Ingresos:</b> ${money(d.month_in)}.</div>`);$('#analysis').innerHTML=a.join('')}

async function loadMaterials(){const body=$('#materialsBody');body.innerHTML='<tr><td colspan="9" class="empty">Cargando Maestro…</td></tr>';try{const q=encodeURIComponent($('#matSearch').value||'');const group=encodeURIComponent($('#matGroup').value||'');const family=encodeURIComponent($('#matFamily').value||'');const status=encodeURIComponent($('#matStatus').value||'');const a=await api(`/api/materials?search=${q}&group=${group}&family=${family}&status=${status}&limit=10000`);$('#matCountLabel').textContent=`${num(a.length)} materiales`;body.innerHTML=a.length?a.map(x=>`<tr onclick="showMaterial('${esc(x.codigo)}')"><td><b>${esc(x.codigo)}</b></td><td>${esc(x.descripcion)}</td><td>${esc(x.grupo||x.grupo_nombre||x.grupo_codigo||'')}</td><td>${esc(x.familia||x.familia_nombre||x.familia_codigo||'')}</td><td>${esc(x.unidad||'')}</td><td class="${Number(x.stock)<0?'dangertext':''}">${num(x.stock)}</td><td>${money(x.costo_promedio)}</td><td>${money(x.valor)}</td><td>${esc(x.ubicacion||'')}</td></tr>`).join(''):'<tr><td colspan="9" class="empty">No se encontraron materiales con los filtros elegidos.</td></tr>'}catch(e){$('#matCountLabel').textContent='No se pudo cargar';body.innerHTML=`<tr><td colspan="9" class="empty dangertext">Error al cargar el Maestro: ${esc(e.message)}</td></tr>`}}
async function showMaterial(code){const x=await api('/api/material/'+encodeURIComponent(code));alert(`${x.codigo} — ${x.descripcion}\n\nGrupo: ${x.grupo||'-'}\nFamilia: ${x.familia||'-'}\nUnidad: ${x.unidad||'-'}\n\nInventario:\n${x.inventario.map(i=>`${i.almacen}: ${num(i.stock)} ${x.unidad||''} · ${money(i.valor)}`).join('\n')}`)}

function openCreateWarehouse(){
 if(!currentUser||!['ADMIN','SUPERVISOR'].includes(currentUser.rol)){alert('Solo ADMIN o SUPERVISOR puede crear almacenes.');return}
 $('#createWarehouseStatus').textContent='El almacén nuevo comenzará vacío; luego podrás cargar materiales desde Maestro.';
 $('#createWarehouseName').value='';$('#createWarehouseCode').value='';$('#createWarehouseDialog').showModal();$('#createWarehouseName').focus();
}
$('#openCreateWarehouse')?.addEventListener('click',openCreateWarehouse);
$('#cancelCreateWarehouse')?.addEventListener('click',()=>$('#createWarehouseDialog').close());
$('#createWarehouseForm')?.addEventListener('submit',async e=>{
 e.preventDefault();
 const nombre=$('#createWarehouseName').value.trim();
 const codigo=$('#createWarehouseCode').value.trim();
 if(!nombre){alert('Escribe el nombre del almacén.');return}
 const button=$('#createWarehouseForm button[type="submit"]');button.disabled=true;button.textContent='Guardando…';
 try{
  const created=await api('/api/warehouses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nombre,codigo})});
  await loadLookups();
  const createdId=created.id;
  for(const id of ['invWarehouse','incomeWh','outWh','adjustWh','manualInvWarehouse','scannerWarehouse','loanWarehouse','loanReportWarehouse','dashboardWarehouse','budgetWarehouse','transferOrigin','transferDestination','reconWarehouse','policyWarehouse','clearWarehouseSelect','resourcesWarehouse','dailyCostsWarehouse','materialKardexWarehouse','consumptionWarehouse','dailyCloseWarehouse','stockAlertsReportWarehouse','scheduleWarehouse','workerKardexWarehouse','dataWarehouse']){
   const el=$('#'+id);if(!el)continue;
   const option=[...el.options].find(o=>o.textContent.trim().toLowerCase()===String(created.nombre||nombre).trim().toLowerCase());
   if(option)el.value=option.value;
  }
  $('#createWarehouseDialog').close();
  await Promise.all([loadInventory(),loadDash()]);
  alert(`Almacén «${created.nombre||nombre}» creado correctamente. Ya aparece en los selectores del sistema. Ahora puedes ingresar materiales desde Maestro.`);
 }catch(err){$('#createWarehouseStatus').textContent='No se pudo crear: '+err.message;alert('No se pudo crear el almacén: '+err.message)}
 finally{button.disabled=false;button.textContent='Guardar almacén'}
});

async function loadInventory(){const s=encodeURIComponent($('#invSearch').value||'');const wh=encodeURIComponent($('#invWarehouse').value||'');const status=encodeURIComponent($('#invStatus').value||'');const a=await api(`/api/materials?search=${s}&warehouse=${wh}&status=${status}&loaded_only=${wh?'1':'0'}&limit=1000`);const rows=a;$('#inventoryBody').innerHTML=rows.length?rows.map(x=>{const st=Number(x.stock)<0?['danger','NEGATIVO']:Number(x.stock_minimo)>0&&Number(x.stock)<=Number(x.stock_minimo)?['warn','CRÍTICO']:Number(x.stock)===0?['muted','SIN STOCK']:['ok','NORMAL'];return `<tr><td>${wh ? esc(lookups.warehouses.find(w=>String(w.id)===String(wh))?.nombre||'') : 'Todos'}</td><td><b>${esc(x.codigo)}</b></td><td>${esc(x.descripcion)}</td><td>${esc(x.unidad||'')}</td><td class="${st[0]==='danger'?'dangertext':''}">${num(x.stock)}</td><td>${num(x.stock_minimo)}</td><td>${money(x.costo_promedio)}</td><td>${money(x.valor)}</td><td><span class="status ${st[0]}">${st[1]}</span></td></tr>`}).join(''):'<tr><td colspan="9" class="empty">No hay registros</td></tr>';$('#invUnits').textContent=num(rows.reduce((s,x)=>s+Number(x.stock||0),0));$('#invTotal').textContent=money(rows.reduce((s,x)=>s+Number(x.valor||0),0));$('#invWithStock').textContent=num(rows.filter(x=>Number(x.stock)>0).length);$('#invZero').textContent=num(rows.filter(x=>Number(x.stock)===0).length);$('#inventoryUpdated').textContent='Actualizado '+new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}

async function loadPeople(){const s=encodeURIComponent($('#peopleSearch')?.value||'');const a=await api('/api/personnel?search='+s);peopleCache=a;$('#peopleBody').innerHTML=a.map(x=>`<tr><td><b>${esc(x.dni||'')}</b></td><td>${esc(x.nombre)}</td><td>${esc(x.cargo||'')}</td><td>${esc(x.cliente||'')}</td><td>${esc(x.area||'')}</td></tr>`).join('');$('#peopleList').innerHTML=a.map(x=>`<option value="${esc(x.dni)}">${esc(x.nombre)}</option>`).join('')}
$('#personForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/personnel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});e.target.reset();await loadPeople();alert('Personal guardado / actualizado')}catch(x){alert(x.message)}};
$('#peopleImportFile')?.addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file)return;
 const status=$('#peopleImportStatus');status.textContent='Leyendo archivo…';
 try{
  const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('No se pudo leer el archivo.'));reader.readAsDataURL(file)});
  status.textContent='Importando personal…';
  const result=await api('/api/personnel/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:file.name,fileBase64:dataUrl})});
  status.textContent=`Importación completada: ${num(result.total)} filas · ${num(result.insertados)} nuevos · ${num(result.actualizados)} actualizados`;
  await loadPeople();alert(`Personal importado correctamente.\nNuevos: ${result.insertados}\nActualizados por DNI: ${result.actualizados}\nTotal procesado: ${result.total}`);
 }catch(err){status.textContent='Error de importación';alert('No se pudo importar el personal: '+err.message)}finally{e.target.value=''}
});

function openClearWarehouse(){
 const select=$('#clearWarehouseSelect');
 select.innerHTML=lookups.warehouses.map(w=>`<option value="${esc(w.id)}">${esc(w.nombre)}</option>`).join('');
 const current=$('#invWarehouse')?.value||'';
 if(current)select.value=current;
 $('#clearWarehouseReason').value='';$('#clearWarehouseConfirm').value='';
 $('#clearWarehouseDialog').showModal();
}
$('#clearWarehouseForm')?.addEventListener('submit',async e=>{
 e.preventDefault();
 const almacen=$('#clearWarehouseSelect').value, motivo=$('#clearWarehouseReason').value.trim(), confirmacion=$('#clearWarehouseConfirm').value.trim();
 if(confirmacion.toUpperCase()!=='VACIAR')return alert('Escribe VACIAR para confirmar.');
 const name=$('#clearWarehouseSelect').selectedOptions[0]?.textContent||'el almacén seleccionado';
 if(!confirm(`¿Confirmas poner a cero el stock actual de ${name}?\n\nEl Maestro y el historial se conservarán. Esta acción no se puede deshacer automáticamente.`))return;
 try{
  const r=await api('/api/inventory/clear-warehouse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({almacen,confirmacion,motivo})});
  $('#clearWarehouseDialog').close();
  if($('#invWarehouse'))$('#invWarehouse').value=almacen;
  if($('#invStatus'))$('#invStatus').value='WITH_STOCK';
  await Promise.all([loadInventory(),loadDash(),loadMaterials(),loadData(1)]);
  alert(`Almacén regularizado: ${r.almacen}\nMateriales ajustados: ${r.posiciones_ajustadas}\nUnidades regularizadas: ${num(r.unidades_regularizadas)}\nValor regularizado: ${money(r.valor_regularizado)}\n\nEl historial se conserva y los nuevos ingresos volverán a aparecer en inventario.`);
 }catch(err){alert('No se pudo vaciar el almacén: '+err.message)}
});


function updatePlacaCodes(){
 const codes=$$('#issueItems tr').map(tr=>String(tr.dataset.codigo||'').trim()).filter(Boolean);
 const el=$('#outPlaca');
 if(el) el.value=[...new Set(codes)].join(', ');
}

/* Resolución común de materiales: código, código anterior o descripción. */
async function resolveProduct(value, warehouse=''){
 const t=String(value||'').trim(); if(!t)return null;
 try{
  return await api('/api/barcode/lookup?code='+encodeURIComponent(t)+'&warehouse='+encodeURIComponent(warehouse||$('#outWh')?.value||''));
 }catch(_){
  const rows=await api('/api/materials?search='+encodeURIComponent(t)+'&warehouse='+encodeURIComponent(warehouse||$('#outWh')?.value||'')+'&limit=30');
  return rows.find(x=>String(x.codigo).toLowerCase()===t.toLowerCase()||String(x.codigo_anterior||'').toLowerCase()===t.toLowerCase())||rows[0]||null;
 }
}
let scannerReader=null,scannerControls=null,scannerTorchOn=false,scannerLastCode='',scannerInitialized=false;let scannerMode='lookup',scannerLoadMaterial='',scannerLoadCodes=[],scannerLoadDescription='',scannerLoadCurrentStock=0,scannerLastAcceptedAt=0;
function initScannerPage(){
 if(scannerInitialized)return; scannerInitialized=true;
 const wh=$('#scannerWarehouse'); if(wh){wh.innerHTML=lookups.warehouses.map(w=>`<option value="${esc(w.id)}">${esc(w.nombre)}</option>`).join('');const selected=lookups.warehouses.find(w=>String(w.nombre).toUpperCase()==='PLANTA PILOTO');if(selected)wh.value=selected.id;}
 $('#scannerStart')?.addEventListener('click',startScanner);$('#scannerStop')?.addEventListener('click',stopScanner);$('#scannerTorch')?.addEventListener('click',toggleScannerTorch);
 $('#scannerMaterialSearch')?.addEventListener('input',e=>searchScannerMaterial(e.target.value));
 $('#scannerWarehouse')?.addEventListener('change',()=>{if(scannerMode==='load'&&scannerLoadMaterial)selectScannerMaterial(scannerLoadMaterial).catch(e=>console.error(e));});
 renderScannerMode();
}
function renderScannerMode(){const load=scannerMode==='load';$('#scannerModeLabel').textContent=load?'Carga física por material · escanea todos los códigos y guarda el conteo':'Consulta / salida · escanea un código y SILOG lo valida en el almacén';$('#scannerMaterialWrap')?.classList.toggle('hidden',!load);$('#scannerLoadSummary')?.classList.toggle('hidden',!load);if(load)renderScannerLoadSummary()}
async function searchScannerMaterial(text){const t=String(text||'').trim(),box=$('#scannerMaterialSuggestions');if(!box)return;if(t.length<2){box.classList.add('hidden');box.innerHTML='';return}try{const wh=$('#scannerWarehouse')?.value||'';const rows=await api('/api/materials/lookup?search='+encodeURIComponent(t)+'&warehouse='+encodeURIComponent(wh));box.innerHTML=rows.map(m=>`<button type="button" class="product-suggestion" data-code="${esc(m.codigo)}"><strong>${esc(m.descripcion)}</strong><small>${esc(m.codigo)} · ${esc(m.unidad||'—')} · Stock almacén: ${num(m.stock)}</small></button>`).join('')||'<div class="product-search-empty">No se encontró el material en el Maestro.</div>';box.classList.remove('hidden');box.querySelectorAll('button[data-code]').forEach(b=>b.addEventListener('mousedown',e=>{e.preventDefault();selectScannerMaterial(b.dataset.code)}))}catch(e){box.classList.add('hidden')}}
async function selectScannerMaterial(code){
 const m=await resolveProduct(code,$('#scannerWarehouse')?.value||'');
 if(!m)return alert('Material no encontrado en el Maestro.');
 scannerLoadMaterial=m.codigo;scannerLoadDescription=m.descripcion;scannerLoadCurrentStock=Number(m.stock||0);scannerLoadCodes=[];
 $('#scannerMaterialSearch').value=`${m.codigo} — ${m.descripcion}`;$('#scannerMaterialSearch').dataset.code=m.codigo;$('#scannerMaterialSuggestions').classList.add('hidden');
 $('#scannerLoadQuantity').value='0';renderScannerLoadSummary();$('#scannerStatus').textContent=`Material seleccionado: ${m.codigo} · ${m.descripcion}. Ingresa la cantidad física o escanea las unidades.`;
}
function openInventoryScanner(){scannerMode='load';scannerLoadMaterial='';scannerLoadDescription='';scannerLoadCodes=[];initScannerPage();const wh=$('#invWarehouse')?.value||(lookups.warehouses.find(w=>String(w.nombre).toUpperCase()==='PLANTA PILOTO')?.id||lookups.warehouses[0]?.id||'');$('#scannerWarehouse').value=wh;$('#scannerMaterialSearch').value='';$('#scannerLoadQuantity').value='0';show('scanner');renderScannerMode();$('#scannerStatus').textContent='Selecciona un material del Maestro. Puedes ingresar cantidad manualmente, escanear códigos o hacer ambas cosas.'}
function openScannerForOutflow(){scannerMode='outflow';scannerLoadMaterial='';scannerLoadCodes=[];initScannerPage();if($('#outWh')?.value)$('#scannerWarehouse').value=$('#outWh').value;show('scanner');renderScannerMode();$('#scannerStatus').textContent='Escanea un material con stock en el almacén seleccionado.'}
function renderScannerLoadSummary(){const box=$('#scannerLoadSummary');if(!box||scannerMode!=='load')return;const code=scannerLoadMaterial||'';const qty=Number($('#scannerLoadQuantity')?.value||0);box.innerHTML=`<div class="inventoryScanSummary"><div><span>Almacén</span><b>${esc($('#scannerWarehouse')?.selectedOptions?.[0]?.textContent||'—')}</b></div><div><span>Material del Maestro</span><b>${esc(code?`${code} — ${scannerLoadDescription}`:'Selecciona un material')}</b></div><div><span>Stock actual en este almacén</span><b>${num(scannerLoadCurrentStock)}</b></div><div><label class="scanQuantityLabel">Cantidad física a guardar<input id="scannerLoadQuantity" type="number" min="0" step="1" value="${Number.isFinite(qty)?qty:0}" ${code?'':'disabled'}></label></div><div><span>Códigos de barras asociados</span><b>${num(scannerLoadCodes.length)}</b></div><div><span>Último código leído</span><b>${esc(scannerLoadCodes.at(-1)||'No se escaneó ninguno')}</b></div><small>El código de barras es opcional. Si el producto no tiene código, escribe la cantidad y guarda. Cada lectura válida suma una unidad; códigos repetidos del mismo producto cuentan como lecturas, pero se guardan una sola vez como asociación.</small><button type="button" class="primary" ${code?'':'disabled'} onclick="saveScannerLoad()"> Guardar cantidad en este almacén</button><button type="button" class="secondary" onclick="clearScannerLoad()">Limpiar conteo</button></div>`;$('#scannerLoadQuantity')?.addEventListener('input',()=>{});}
function clearScannerLoad(){scannerLoadCodes=[];if($('#scannerLoadQuantity'))$('#scannerLoadQuantity').value='0';renderScannerLoadSummary();$('#scannerStatus').textContent='Conteo reiniciado. Puedes ingresar la cantidad manualmente o volver a escanear.'}
async function registerLoadScan(code){
 if(scannerMode!=='load')return false;
 if(!scannerLoadMaterial){$('#scannerStatus').textContent=' Selecciona primero el material del Maestro.';return false}
 const value=String(code||'').trim();if(!value)return false;
 try{
  const x=await api('/api/barcode/lookup?code='+encodeURIComponent(value)+'&warehouse='+encodeURIComponent($('#scannerWarehouse').value||''));
  if(String(x.codigo).toLowerCase()!==String(scannerLoadMaterial).toLowerCase())throw new Error(`El código pertenece a ${x.codigo} · ${x.descripcion}, no al material seleccionado ${scannerLoadMaterial}.`);
 }catch(e){
  if(String(e.message).includes('No existe un material')){
   try{await api('/api/barcodes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({barcode:value,material_code:scannerLoadMaterial,symbology:'SCANNED',is_primary:false})})}
   catch(err){$('#scannerStatus').textContent=' '+err.message;return false}
  }else{$('#scannerStatus').textContent=' '+e.message;return false}
 }
 if(!scannerLoadCodes.includes(value))scannerLoadCodes.push(value);
 const qtyEl=$('#scannerLoadQuantity');if(qtyEl)qtyEl.value=String(Math.max(0,Math.floor(Number(qtyEl.value||0))+1));
 navigator.vibrate?.(100);renderScannerLoadSummary();$('#scannerStatus').textContent=` Lectura ${value} aceptada · cantidad contada: ${$('#scannerLoadQuantity')?.value||'0'}`;return true;
}
async function processScannerManualCode(){const code=$('#scannerManualCode')?.value?.trim();if(!code)return;if(scannerMode==='load')await registerLoadScan(code);else await lookupScannedCode(code);$('#scannerManualCode').value=''}
async function saveScannerLoad(){
 const wh=$('#scannerWarehouse').value,material=scannerLoadMaterial,codes=[...scannerLoadCodes],qty=Number($('#scannerLoadQuantity')?.value);
 if(!wh||!material)return alert('Selecciona almacén y material del Maestro.');
 if(!Number.isFinite(qty)||qty<0||!Number.isInteger(qty))return alert('La cantidad física debe ser un entero de 0 o más.');
 if(!confirm(`Guardar ${qty} unidad(es) de ${material} en ${$('#scannerWarehouse').selectedOptions[0]?.textContent||'el almacén'}? Los demás almacenes no se modificarán.`))return;
 try{
  const r=await api('/api/inventory/load',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({warehouse:wh,material_code:material,cantidad_contada:qty,codes})});
  alert(`Inventario guardado correctamente\n${r.almacen}\n${r.codigo} — ${r.descripcion}\nCantidad: ${r.cantidad} ${r.unidad||''}\nCosto unitario: ${money(r.costo)}\nValor: ${money(r.valor)}\nCódigos asociados: ${r.codigos_asociados}`);
  scannerLoadCodes=[];scannerLoadCurrentStock=qty;$('#scannerLoadQuantity').value='0';renderScannerLoadSummary();await loadInventory();await loadMaterials();await loadDash();$('#scannerStatus').textContent=' Carga guardada. Puedes elegir otro material para continuar.';
 }catch(e){alert(e.message)}
}
async function startScanner(){
 initScannerPage(); const status=$('#scannerStatus');
 try{if(!window.ZXingBrowser)throw new Error('No se pudo cargar el motor de lectura. Revisa la conexión.');await stopScanner();const video=$('#scannerVideo');scannerReader=new ZXingBrowser.BrowserMultiFormatReader();scannerControls=await scannerReader.decodeFromVideoDevice(undefined,video,(result)=>{if(result){const code=String(result.getText()||'').trim(),now=Date.now();if(code&&code!==scannerLastCode){scannerLastCode=code;scannerLastAcceptedAt=now;if(scannerMode==='load')registerLoadScan(code);else lookupScannedCode(code);}}else{scannerLastCode='';}});status.textContent=' Cámara activa. Apunta al código de barras.';}
 catch(e){status.textContent=' '+(e.message||'No se pudo activar la cámara');alert('No se pudo activar la cámara. Permite el acceso a la cámara y usa HTTPS.');}
}
async function stopScanner(){try{scannerControls?.stop?.();}catch{}scannerControls=null;try{scannerReader?.reset?.();}catch{}scannerReader=null;const v=$('#scannerVideo');if(v?.srcObject){v.srcObject.getTracks().forEach(t=>t.stop());v.srcObject=null}scannerTorchOn=false;}
async function toggleScannerTorch(){const v=$('#scannerVideo');const track=v?.srcObject?.getVideoTracks?.()[0];if(!track)return alert('Activa primero la cámara.');const caps=track.getCapabilities?.();if(!caps?.torch)return alert('Este iPhone/navegador no expone el control de linterna.');scannerTorchOn=!scannerTorchOn;await track.applyConstraints({advanced:[{torch:scannerTorchOn}]});}
async function lookupScannedCode(code){
 const value=String(code||'').trim();if(!value)return;const wh=$('#scannerWarehouse')?.value||'';$('#scannerStatus').textContent=' Buscando '+value+'…';
 try{const x=await api('/api/barcode/lookup?code='+encodeURIComponent(value)+'&warehouse='+encodeURIComponent(wh)+(scannerMode==='outflow'?'&salida=1':''));const noCost=Number(x.costo_promedio||0)<=0;const controls=scannerMode==='outflow'?'<div class="alert good"><b> Código validado contra el almacén.</b> El material se agrega automáticamente a la salida.</div>':`<div class="inventoryCountBox"><label>Cantidad física contada en este almacén<input id="scannerCountQty" type="number" min="0" step="1" value="${Math.max(0,Math.floor(Number(x.stock||0)))}"></label><small>Esta cantidad reemplaza el stock del almacén seleccionado. No modifica los demás almacenes.</small></div><div class="scannerActions"><button type="button" class="primary" onclick="updateScannedInventory('${esc(x.codigo)}')"> Actualizar inventario</button><button type="button" class="secondary" onclick="addScannedToOutflow('${esc(x.codigo)}')"> Agregar a salida</button><button type="button" class="secondary" onclick="lookupScannedCode('${esc(x.codigo)}')"> Actualizar consulta</button></div>`;$('#scannerResult').className='scannerResult';$('#scannerResult').innerHTML=`<div class="scanCode">${esc(value)}</div><h3>${esc(x.descripcion)}</h3><div class="scanGrid"><div><span>Código</span><b>${esc(x.codigo)}</b></div><div><span>Anterior</span><b>${esc(x.codigo_anterior||'—')}</b></div><div><span>Unidad</span><b>${esc(x.unidad||'—')}</b></div><div><span>Stock en almacén</span><b class="${Number(x.stock)<0?'dangertext':''}">${num(x.stock)}</b></div><div><span>Costo unitario</span><b>${money(x.costo_promedio)}</b></div><div><span>Valor</span><b>${money(x.valor)}</b></div></div>${noCost?'<div class="alert"><b> Costo pendiente.</b> Este material no tiene costo valorizado.</div>':''}${controls}`;$('#scannerStatus').textContent=' Producto identificado: '+x.codigo;if(scannerMode==='outflow'){const added=await addScannedToOutflow(x.codigo,true);if(added)$('#scannerStatus').textContent=` ${x.codigo} agregado automáticamente a Salidas. Retira el código del cuadro para escanear el siguiente.`;} }
 catch(e){$('#scannerResult').className='scannerResult';$('#scannerResult').innerHTML=`<div class="alert danger"><b>No encontrado</b><br>${esc(e.message)}<br><small>Si este código físico es nuevo, puedes asociarlo a un material existente.</small></div><div class="scannerActions"><button type="button" class="secondary" onclick="associateScannedBarcode('${esc(value)}')"> Asociar a material</button></div>`;$('#scannerStatus').textContent='Código leído: '+value;}
}
async function updateScannedInventory(codigo){
 const wh=$('#scannerWarehouse')?.value||''; const qtyEl=$('#scannerCountQty'); const qty=Math.floor(Number(qtyEl?.value||0));
 if(!wh) return alert('Selecciona un almacén.');
 if(!Number.isFinite(qty)||qty<0) return alert('La cantidad contada debe ser 0 o mayor.');
 if(!confirm(`Actualizar el stock de ${codigo} a ${qty} unidades en el almacén seleccionado?`)) return;
 try{
  const r=await api('/api/inventory/count',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({codigo,almacen:wh,cantidad_contada:qty,observacion:'Conteo físico realizado desde escáner móvil'})});
  $('#scannerStatus').textContent=` Inventario actualizado: ${r.almacen} · ${r.codigo} · ${num(r.stock_contado)} unidades`;
  await lookupScannedCode(codigo);
  await loadInventory(); await loadDash();
 }catch(e){alert(e.message)}
}
async function associateScannedBarcode(barcode){
 const material=prompt('Escribe el código SILOG del material al que pertenece este código de barras:', '');
 if(!material)return;
 try{const r=await api('/api/barcodes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({barcode,material_code:material,is_primary:false})});alert('Código asociado correctamente: '+r.barcode);await lookupScannedCode(barcode);}catch(e){alert(e.message)}
}
async function addScannedToOutflow(codigo,stayScanner=false){if(!stayScanner){stopScanner();show('outflow')}const existing=$$('#issueItems tr').find(tr=>tr.dataset.codigo&&String(tr.dataset.codigo).toLowerCase()===String(codigo).toLowerCase());if(existing){const q=existing.querySelector('.issueQty'),next=Math.max(1,Math.floor(Number(q.value||1))+1),stock=Number(existing.dataset.stock||0);if(next>stock){const msg=`Stock insuficiente de ${codigo}. Disponible: ${num(stock)}; ya agregaste ${num(Number(q.value||1))}.`;if(stayScanner){$('#scannerStatus').textContent=' '+msg;return false}alert(msg);return false}q.value=next;recalcIssue();updatePlacaCodes();renderIssueWarning();return true;}let tr=$$('#issueItems tr').find(x=>!x.dataset.codigo&&!x.querySelector('.issueCode')?.value.trim());if(!tr){addIssueRow();tr=$$('#issueItems tr').at(-1)}await selectIssueProduct(tr,codigo);if(!tr.dataset.codigo)return false;if(stayScanner){const qty=Number(tr.querySelector('.issueQty').value||1),stock=Number(tr.dataset.stock||0);if(qty>stock){tr.remove();$('#scannerStatus').textContent=` Stock insuficiente de ${codigo}. Disponible: ${num(stock)}.`;return false}}return true;}
function hideProductSuggestions(tr){const box=tr?.querySelector('.product-suggestions');if(box){box.classList.add('hidden');box.innerHTML=''}}
function renderProductSuggestions(tr,rows,text){const box=tr.querySelector('.product-suggestions');if(!box)return;const q=String(text||'').trim();if(q.length<2){hideProductSuggestions(tr);return}const items=(rows||[]).slice(0,30);if(!items.length){box.innerHTML='<div class="product-search-empty">No se encontraron materiales. Prueba otra palabra o código.</div>';box.classList.remove('hidden');return}box.innerHTML=items.map(m=>`<button type="button" class="product-suggestion" data-code="${esc(m.codigo)}"><strong>${esc(m.descripcion)}</strong><small>Código: ${esc(m.codigo)}${m.codigo_anterior?' · Anterior: '+esc(m.codigo_anterior):''} · ${esc(m.unidad||'—')} · Stock: ${num(m.stock)} · Costo: ${money(m.costo_promedio)}</small></button>`).join('');box.classList.remove('hidden');box.querySelectorAll('.product-suggestion').forEach(btn=>btn.addEventListener('mousedown',e=>{e.preventDefault();selectIssueProduct(tr,btn.dataset.code)}))}
async function searchIssueProducts(tr,text){clearTimeout(tr._searchTimer);const t=String(text||'').trim();if(t.length<2){hideProductSuggestions(tr);return}tr._searchTimer=setTimeout(async()=>{try{const wh=$('#outWh')?.value||'';const rows=await api('/api/materials/lookup?search='+encodeURIComponent(t)+'&warehouse='+encodeURIComponent(wh));const available=rows.filter(m=>Number(m.stock||0)>0);renderProductSuggestions(tr,available,t);if(!available.length){const box=tr.querySelector('.product-suggestions');box.innerHTML='<div class="product-search-empty">No hay stock disponible de este material en el almacén seleccionado. Verifica Inventario por almacén.</div>';box.classList.remove('hidden')}}catch(e){const box=tr.querySelector('.product-suggestions');box.innerHTML=`<div class="product-search-empty">No se pudo consultar el inventario: ${esc(e.message)}</div>`;box.classList.remove('hidden')}},180)}
async function selectIssueProduct(tr,codigo){try{const wh=$('#outWh')?.value||'';const rows=await api('/api/materials/lookup?search='+encodeURIComponent(codigo)+'&warehouse='+encodeURIComponent(wh));const m=rows.find(x=>String(x.codigo).toLowerCase()===String(codigo).toLowerCase()&&Number(x.stock||0)>0);if(!m)throw new Error('El material no tiene stock disponible en el almacén seleccionado. Revisa el saldo en Inventario.');tr.dataset.codigo=m.codigo;tr.dataset.cost=Number(m.costo_promedio||0);tr.dataset.stock=Number(m.stock||0);tr.querySelector('.issueCode').value=m.descripcion;tr.querySelector('.issueCode').title=m.codigo;tr.querySelector('.issueUnit').textContent=m.unidad||'—';tr.querySelector('.issueStock').textContent=num(m.stock);const qty=tr.querySelector('.issueQty');qty.min='1';qty.step='1';qty.removeAttribute('max');if(Number(qty.value||1)<1)qty.value='1';tr.querySelector('.issueCost').textContent=money(m.costo_promedio);tr.classList.toggle('no-cost',Number(m.costo_promedio||0)<=0);hideProductSuggestions(tr);recalcIssue();updatePlacaCodes();renderIssueWarning()}catch(e){alert(e.message)}}
function addIssueRow(){const tr=document.createElement('tr');tr.innerHTML=`<td><div class="product-picker"><input class="issueCode" placeholder="Escribe nombre o código" autocomplete="off" spellcheck="false"><div class="product-suggestions hidden"></div></div></td><td class="issueUnit">—</td><td class="issueStock">—</td><td><input class="issueQty" type="number" min="1" step="1" value="1" required></td><td class="issueCost">S/ 0.00</td><td class="issueTotal">S/ 0.00</td><td><button type="button" class="secondary" onclick="this.closest('tr').remove();recalcIssue();updatePlacaCodes();renderIssueWarning()">×</button></td>`;$('#issueItems').appendChild(tr);const code=tr.querySelector('.issueCode');code.addEventListener('input',()=>{delete tr.dataset.codigo;delete tr.dataset.cost;tr.querySelector('.issueUnit').textContent='—';tr.querySelector('.issueStock').textContent='—';tr.querySelector('.issueCost').textContent='S/ 0.00';tr.classList.remove('no-cost');searchIssueProducts(tr,code.value);recalcIssue();updatePlacaCodes();renderIssueWarning()});code.addEventListener('keydown',e=>{if(e.key==='Escape')hideProductSuggestions(tr)});code.addEventListener('blur',()=>setTimeout(()=>hideProductSuggestions(tr),180));tr.querySelector('.issueQty').addEventListener('input',()=>{let v=Math.floor(Number(tr.querySelector('.issueQty').value||1));if(v<1)v=1;tr.querySelector('.issueQty').value=v;recalcIssue()});code.focus()}
function renderIssueWarning(){
 const box=$('#issueWarnings');
 if(!box) return;
 const rows=$$('#issueItems tr');
 const noCost=rows.filter(tr=>tr.dataset.codigo && Number(tr.dataset.cost||0)<=0);
 const invalid=rows.filter(tr=>tr.dataset.codigo && Number(tr.querySelector('.issueQty')?.value||0)<1);
 const parts=[];
 if(noCost.length) parts.push(`<div class="alert"><b> Costo pendiente:</b> ${noCost.length} material(es) seleccionado(s) no tienen costo valorizado. Puedes registrar la salida, pero quedará marcada para corrección.</div>`);
 if(invalid.length) parts.push(`<div class="alert"><b> Cantidad:</b> la cantidad debe ser 1 o mayor.</div>`);
 box.innerHTML=parts.join('');
}
function recalcIssue(){let total=0;$$('#issueItems tr').forEach(tr=>{const qty=Math.max(1,Math.floor(Number(tr.querySelector('.issueQty').value||1)));tr.querySelector('.issueQty').value=qty;const cost=Number(tr.dataset.cost||0);const val=qty*cost;tr.querySelector('.issueTotal').textContent=money(val);total+=val});$('#issueGrandTotal').textContent=money(total)}
async function refreshIssueStocks(){const rows=$$('#issueItems tr');for(const tr of rows)if(tr.dataset.codigo)await selectIssueProduct(tr,tr.dataset.codigo)}
$('#outDni').addEventListener('input',async()=>{const dni=$('#outDni').value.trim();if(dni.length<4)return;const a=await api('/api/personnel?search='+encodeURIComponent(dni));const p=a.find(x=>String(x.dni)===dni)||a[0];if(p){$('#outPerson').value=p.nombre||'';$('#outCliente').value='MINERA CHINALCO PERU S.A.A.';if(!$('#outArea').value)$('#outArea').value=p.area||''}});
$('#outCeco').addEventListener('change',()=>{const o=$('#outCeco').selectedOptions[0];if(o){$('#outCliente').value='MINERA CHINALCO PERU S.A.A.';if(!$('#outArea').value)$('#outArea').value=o.dataset.area||''}});
$('#outWh').addEventListener('change',()=>{const rows=$$('#issueItems tr');if(rows.some(tr=>tr.dataset.codigo)){if(!confirm('Cambiar de almacén limpiará los materiales seleccionados de la salida. ¿Continuar?'))return;$('#issueItems').innerHTML='';addIssueRow()}else refreshIssueStocks()});
$('#outflowForm').onsubmit=async e=>{e.preventDefault();try{const h=Object.fromEntries(new FormData(e.target));setDigitacion(e.target);h.items=$$('#issueItems tr').map(tr=>({codigo:tr.dataset.codigo,cantidad:Math.max(1,Math.floor(Number(tr.querySelector('.issueQty').value||1))),costo_unitario:Number(tr.dataset.cost||0)})).filter(x=>x.codigo);if(!h.items.length)throw new Error('Agrega materiales y selecciónalos del listado');if(h.items.some(x=>x.cantidad<1))throw new Error('La cantidad mínima es 1');h.cliente='MINERA CHINALCO PERU S.A.A.';const r=await api('/api/outflow',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(h)});alert(`Salida registrada: ${r.numero}`);$('#issueItems').innerHTML='';$('#outPlaca').value='';addIssueRow();await loadDash();await loadInventory();await loadData(1)}catch(x){alert(x.message)}};

$('#incomeCode').addEventListener('input',async()=>{const m=await resolveProduct($('#incomeCode').value);if(m){$('#incomeCode').value=m.codigo;$('#incomePreview').innerHTML=`<b>${esc(m.descripcion)}</b> · ${esc(m.unidad||'')} · Stock actual: ${num(m.stock)} · Costo promedio: ${money(m.costo_promedio)}`}});
$('#incomeForm').onsubmit=async e=>{e.preventDefault();try{const b=Object.fromEntries(new FormData(e.target));const m=await resolveProduct(b.codigo);if(!m)throw new Error('Producto no encontrado. Usa un código o nombre válido.');b.codigo=m.codigo;await api('/api/income',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});alert('Ingreso registrado correctamente');e.target.reset();setToday(e.target.querySelector('[name=fecha_atencion]'));setDigitacion(e.target);await loadDash();await loadInventory()}catch(x){alert(x.message)}};


function openManualInventoryEntry(){
 const dlg=$('#manualInventoryDialog'),wh=$('#manualInvWarehouse');
 wh.innerHTML=lookups.warehouses.map(w=>`<option value="${esc(w.nombre)}">${esc(w.nombre)}</option>`).join('');
 const current=$('#invWarehouse')?.value||'';
 if(current){const w=lookups.warehouses.find(x=>String(x.id)===String(current));if(w)wh.value=w.nombre;}
 $('#manualInvSearch').value='';$('#manualInvCode').value='';$('#manualInvQuantity').value='';$('#manualInvCost').value='';
 $('#manualInvSelected').textContent='Selecciona un material del Maestro.';$('#manualInvSuggestions').classList.add('hidden');$('#manualInvSuggestions').innerHTML='';
 dlg.showModal();$('#manualInvSearch').focus();
}
let manualInvSearchTimer=null;
$('#manualInvSearch').addEventListener('input',()=>{
 clearTimeout(manualInvSearchTimer);const text=$('#manualInvSearch').value.trim(),box=$('#manualInvSuggestions');
 $('#manualInvCode').value='';$('#manualInvSelected').textContent='Selecciona un material del Maestro.';
 if(text.length<2){box.classList.add('hidden');box.innerHTML='';return}
 manualInvSearchTimer=setTimeout(async()=>{
  try{
   const wh=$('#manualInvWarehouse').value||'';
   const rows=await api('/api/materials/lookup?search='+encodeURIComponent(text)+'&warehouse='+encodeURIComponent(wh));
   box.innerHTML=rows.map(m=>`<button type="button" class="product-suggestion" data-code="${esc(m.codigo)}"><strong>${esc(m.descripcion)}</strong><small>${esc(m.codigo)}${m.codigo_anterior?' · Anterior: '+esc(m.codigo_anterior):''} · ${esc(m.unidad||'—')} · Stock en almacén: ${num(m.stock)} · Costo: ${money(m.costo_promedio)}</small></button>`).join('')||'<div class="product-search-empty">No se encontró en el Maestro. Revisa el código o la descripción.</div>';
   box.classList.remove('hidden');
   box.querySelectorAll('button[data-code]').forEach(btn=>btn.addEventListener('mousedown',e=>{e.preventDefault();selectManualInventoryMaterial(btn.dataset.code)}));
  }catch(err){box.innerHTML=`<div class="product-search-empty">${esc(err.message)}</div>`;box.classList.remove('hidden')}
 },180);
});
async function selectManualInventoryMaterial(code){
 try{
  const wh=$('#manualInvWarehouse').value||'';
  const rows=await api('/api/materials/lookup?search='+encodeURIComponent(code)+'&warehouse='+encodeURIComponent(wh));
  const m=rows.find(x=>String(x.codigo).toLowerCase()===String(code).toLowerCase());
  if(!m)throw new Error('El material no existe en el Maestro.');
  $('#manualInvCode').value=m.codigo;$('#manualInvSearch').value=`${m.codigo} — ${m.descripcion}`;
  $('#manualInvSelected').innerHTML=`<b>${esc(m.codigo)} — ${esc(m.descripcion)}</b><br>Unidad: ${esc(m.unidad||'—')} · Stock actual en ${esc($('#manualInvWarehouse').selectedOptions[0]?.textContent||'almacén')}: <b>${num(m.stock)}</b><br>Costo actual: <b>${money(m.costo_promedio)}</b>`;
  $('#manualInvCost').value=Number(m.costo_promedio||0)>0?Number(m.costo_promedio):'';
  $('#manualInvSuggestions').classList.add('hidden');$('#manualInvQuantity').focus();
 }catch(e){alert(e.message)}
}
$('#manualInvWarehouse').addEventListener('change',()=>{if($('#manualInvCode').value)selectManualInventoryMaterial($('#manualInvCode').value);});
$('#manualInventoryForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const code=$('#manualInvCode').value,wh=$('#manualInvWarehouse').value,qty=Number($('#manualInvQuantity').value);
 if(!code)return alert('Primero selecciona un material de la lista del Maestro.');
 if(!wh)return alert('Selecciona el almacén destino.');
 if(!Number.isFinite(qty)||qty<=0)return alert('La cantidad a ingresar debe ser mayor que cero.');
 const body={codigo:code,almacen:wh,cantidad:qty,costo_unitario:$('#manualInvCost').value||0,documento:$('#manualInventoryForm [name=documento]').value,observacion:$('#manualInventoryForm [name=observacion]').value,fecha_atencion:todayLocal(),condicion:'INGRESO MANUAL'};
 if(!body.observacion.trim())return alert('Escribe una observación para dejar trazabilidad.');
 try{
  await api('/api/income',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  $('#manualInventoryDialog').close();alert(`Ingreso registrado: ${code} · ${qty} unidades en ${wh}.`);
  await loadInventory();await loadMaterials();await loadDash();await loadData(1);
 }catch(err){alert(err.message)}
});

function openAdjust(){$('#adjustDialog').showModal()}
$('#adjustForm').onsubmit=async e=>{e.preventDefault();try{const b=Object.fromEntries(new FormData(e.target));const m=await resolveProduct(b.codigo);if(!m)throw new Error('Producto no encontrado');b.codigo=m.codigo;await api('/api/inventory/adjust',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});$('#adjustDialog').close();alert('Ajuste registrado');await loadDash();await loadInventory()}catch(x){alert(x.message)}};

let workerKardexLastDni='';
function workerKardexParams(){
 const p=new URLSearchParams();
 for(const [id,key] of [['workerKardexDni','dni'],['workerKardexFrom','from'],['workerKardexTo','to'],['workerKardexWarehouse','warehouse']]){
  const v=$('#'+id)?.value?.trim()||'';if(v)p.set(key,v);
 }
 return p;
}
function initWorkerKardex(){
 if($('#workerKardexWarehouse')&&$('#workerKardexWarehouse').options.length<=1){
  $('#workerKardexWarehouse').innerHTML='<option value="">Todos los almacenes</option>'+lookups.warehouses.map(w=>`<option value="${w.id}">${esc(w.nombre)}</option>`).join('');
 }
}
async function loadWorkerKardex(){
 const dni=$('#workerKardexDni').value.trim();
 if(dni.replace(/\D/g,'').length<4){alert('Ingresa al menos 4 dígitos del DNI para consultar.');return}
 if($('#workerKardexFrom').value&&$('#workerKardexTo').value&&$('#workerKardexFrom').value>$('#workerKardexTo').value){alert('La fecha inicial no puede ser posterior a la fecha final.');return}
 const p=workerKardexParams();$('#workerKardexSummary').textContent='Consultando entregas...';$('#workerKardexBody').innerHTML='<tr><td colspan="14" class="empty">Consultando...</td></tr>';
 try{
  const d=await api('/api/worker-kardex?'+p.toString());workerKardexLastDni=dni;
  const w=d.worker||{};$('#workerKardexName').textContent=w.nombre||'No figura en Personal';
  $('#workerKardexCount').textContent=num(d.totals?.movimientos||0);$('#workerKardexUnits').textContent=num(d.totals?.cantidad||0);$('#workerKardexValue').textContent=money(d.totals?.valor||0);
  $('#workerKardexSummary').textContent=`DNI ${dni} · ${num(d.rows.length)} líneas de salida encontradas`;
  $('#workerKardexBody').innerHTML=d.rows.length?d.rows.map(r=>`<tr><td>${esc(r.fecha_atencion||'—')}</td><td>${esc(r.fecha_digitacion||'—')}</td><td>${esc(r.almacen||'—')}</td><td>${esc([r.documento,r.numero].filter(Boolean).join(' / ')||'—')}</td><td><b>${esc(r.codigo||'')}</b></td><td>${esc(r.material||'')}</td><td>${esc(r.unidad||'—')}</td><td>${num(r.cantidad)}</td><td>${money(r.costo_unitario)}</td><td><b>${money(r.valor_total)}</b></td><td>${esc([r.area,r.ceco].filter(Boolean).join(' / ')||'—')}</td><td>${esc(r.entregado||'—')}</td><td>${esc(r.autorizado||'—')}</td><td>${esc(r.usuario||'—')}</td></tr>`).join(''):'<tr><td colspan="14" class="empty">No hay salidas registradas para este DNI con los filtros elegidos.</td></tr>';
 }catch(e){$('#workerKardexSummary').textContent='No se pudo consultar: '+e.message;$('#workerKardexBody').innerHTML=`<tr><td colspan="14" class="empty">${esc(e.message)}</td></tr>`}
}
$('#workerKardexForm')?.addEventListener('submit',e=>{e.preventDefault();loadWorkerKardex()});
$('#workerKardexClear')?.addEventListener('click',()=>{['workerKardexDni','workerKardexFrom','workerKardexTo'].forEach(id=>$('#'+id).value='');$('#workerKardexWarehouse').value='';$('#workerKardexName').textContent='—';$('#workerKardexCount').textContent='—';$('#workerKardexUnits').textContent='—';$('#workerKardexValue').textContent='—';$('#workerKardexSummary').textContent='Ingresa un DNI para consultar.';$('#workerKardexBody').innerHTML='<tr><td colspan="14" class="empty">Ingresa el DNI y pulsa Consultar Kardex.</td></tr>';workerKardexLastDni=''});
function downloadWorkerKardex(format){const p=workerKardexParams();if(!p.get('dni')||p.get('dni').replace(/\D/g,'').length<4){alert('Ingresa al menos 4 dígitos del DNI y consulta primero.');return}window.location='/api/worker-kardex.'+format+'?'+p.toString()}
$('#workerKardexCsv')?.addEventListener('click',()=>downloadWorkerKardex('csv'));
$('#workerKardexXlsx')?.addEventListener('click',()=>downloadWorkerKardex('xlsx'));

async function loadUsers(){const s=encodeURIComponent($('#usersSearch')?.value||'');try{const a=await api('/api/users?search='+s);$('#usersBody').innerHTML=a.length?a.map(x=>`<tr><td><b>${esc(x.username)}</b></td><td>${esc(x.nombre)}</td><td>${esc(x.rol)}</td><td><span class="status ${x.activo?'ok':'muted'}">${x.activo?'ACTIVO':'INACTIVO'}</span></td><td><button class="secondary" onclick="toggleUser(${x.id},${!x.activo})">${x.activo?'Desactivar':'Activar'}</button></td></tr>`).join(''):'<tr><td colspan="5" class="empty">No hay usuarios</td></tr>'}catch(e){$('#usersBody').innerHTML=`<tr><td colspan="5" class="empty">Error: ${esc(e.message)}</td></tr>`}}
async function toggleUser(id,activo){try{await api('/api/users/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({activo})});await loadUsers()}catch(e){alert(e.message)}}
$('#userForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});e.target.reset();alert('Usuario creado / actualizado');await loadUsers()}catch(x){alert(x.message)}};

function initAdvancedReports(){
 const today=todayLocal();const monthAgo=new Date();monthAgo.setDate(monthAgo.getDate()-29);monthAgo.setMinutes(monthAgo.getMinutes()-monthAgo.getTimezoneOffset());const from=monthAgo.toISOString().slice(0,10);
 for(const id of ['dailyCostsFrom','materialKardexFrom','consumptionFrom'])if($('#'+id)&&!$('#'+id).value)$('#'+id).value=from;
 for(const id of ['dailyCostsTo','materialKardexTo','consumptionTo'])if($('#'+id)&&!$('#'+id).value)$('#'+id).value=today;
 if($('#dailyCloseDate')&&!$('#dailyCloseDate').value)$('#dailyCloseDate').value=today;
}
function advancedReportParams(type){
 const map={'daily-costs':[['dailyCostsFrom','from'],['dailyCostsTo','to'],['dailyCostsWarehouse','warehouse']],'material-kardex':[['materialKardexSearch','search'],['materialKardexFrom','from'],['materialKardexTo','to'],['materialKardexWarehouse','warehouse']],'consumption':[['consumptionFrom','from'],['consumptionTo','to'],['consumptionWarehouse','warehouse'],['consumptionCeco','ceco'],['consumptionDni','dni']],'daily-close':[['dailyCloseDate','to'],['dailyCloseWarehouse','warehouse']]};
 const p=new URLSearchParams();for(const [id,key] of map[type]||[]){const value=$('#'+id)?.value||'';if(value)p.set(key,value)}return p;
}
function downloadAdvancedReport(type,format){const p=advancedReportParams(type);if(type==='material-kardex'&&String(p.get('search')||'').trim().length<2){alert('Escribe al menos 2 caracteres del código o nombre del material.');return}if(type==='daily-close'&&!p.get('to')){alert('Selecciona la fecha del cierre.');return}window.location='/api/reports/'+type+'.'+format+'?'+p.toString()}
async function loadDailyCosts(){const p=advancedReportParams('daily-costs');$('#dailyCostsSummary').textContent='Consultando costos diarios...';try{const d=await api('/api/reports/daily-costs?'+p.toString());const rows=d.rows||[];$('#dailyCostsSummary').textContent=`${num(rows.length)} líneas · Total del período: ${money(d.grandTotal)} · Totales diarios agrupados por almacén: ${num((d.totals||[]).length)}`;$('#dailyCostsBody').innerHTML=rows.length?rows.map(r=>`<tr><td>${esc(r.fecha)}</td><td>${esc(r.almacen)}</td><td><b>${esc(r.codigo)}</b></td><td>${esc(r.material)}</td><td>${esc(r.unidad||'—')}</td><td>${num(r.cantidad)}</td><td>${money(r.costo_unitario)}</td><td><b>${money(r.valor_total)}</b></td><td>${num(r.movimientos)}</td></tr>`).join(''):'<tr><td colspan="9" class="empty">No hay salidas para este período y almacén.</td></tr>'}catch(e){$('#dailyCostsSummary').textContent='Error: '+e.message;$('#dailyCostsBody').innerHTML=`<tr><td colspan="9" class="empty">${esc(e.message)}</td></tr>`}}
async function loadMaterialKardex(){const p=advancedReportParams('material-kardex');$('#materialKardexSummary').textContent='Consultando Kardex...';try{const d=await api('/api/reports/material-kardex?'+p.toString());const rows=d.rows||[];$('#materialKardexSummary').textContent=`${num(d.totals?.movimientos||0)} movimientos · Cantidad movida: ${num(d.totals?.cantidad||0)} · Valor acumulado de movimientos: ${money(d.totals?.valor||0)}. El saldo después se calcula cronológicamente.`;$('#materialKardexBody').innerHTML=rows.length?rows.map(r=>`<tr><td>${esc(r.fecha)}</td><td>${esc(r.almacen)}</td><td><b>${esc(r.codigo)}</b></td><td>${esc(r.material)}</td><td>${esc(r.tipo)}</td><td>${num(r.cantidad)}</td><td class="${Number(r.variacion)<0?'dangertext':'goodtext'}">${num(r.variacion)}</td><td><b>${num(r.saldo_despues)}</b></td><td>${money(r.costo_unitario)}</td><td>${money(r.valor_total)}</td><td>${esc([r.documento,r.numero].filter(Boolean).join(' / ')||'—')}</td><td>${esc(r.usuario)}</td></tr>`).join(''):'<tr><td colspan="12" class="empty">No hay movimientos para ese material.</td></tr>'}catch(e){$('#materialKardexSummary').textContent='Error: '+e.message;$('#materialKardexBody').innerHTML=`<tr><td colspan="12" class="empty">${esc(e.message)}</td></tr>`}}
async function loadConsumption(){const p=advancedReportParams('consumption');$('#consumptionSummary').textContent='Consultando consumo...';try{const d=await api('/api/reports/consumption?'+p.toString());const rows=d.rows||[];$('#consumptionSummary').textContent=`${num(rows.length)} combinaciones trabajador/material · Cantidad total: ${num(d.totals?.cantidad||0)} · Valor total: ${money(d.totals?.valor||0)}`;$('#consumptionBody').innerHTML=rows.length?rows.map(r=>`<tr><td>${esc(r.dni||'—')}</td><td>${esc(r.trabajador)}</td><td>${esc(r.area||'—')}</td><td>${esc(r.ceco||'—')}</td><td>${esc(r.centro_costo||'—')}</td><td>${esc(r.almacen)}</td><td><b>${esc(r.codigo)}</b></td><td>${esc(r.material)}</td><td>${esc(r.unidad)}</td><td>${num(r.movimientos)}</td><td>${num(r.cantidad)}</td><td><b>${money(r.valor_total)}</b></td></tr>`).join(''):'<tr><td colspan="12" class="empty">No hay consumos para estos filtros.</td></tr>'}catch(e){$('#consumptionSummary').textContent='Error: '+e.message;$('#consumptionBody').innerHTML=`<tr><td colspan="12" class="empty">${esc(e.message)}</td></tr>`}}
async function loadDailyClose(){const p=advancedReportParams('daily-close');$('#dailyCloseSummary').textContent='Calculando stock a la fecha de corte...';try{const d=await api('/api/reports/daily-close?'+p.toString());const t=d.totals||{};$('#dailyCloseSummary').textContent=`Corte ${d.fecha} · Valor de stock: ${money(t.stockValor)} · Ingresos del día: ${money(t.ingresos)} · Salidas del día: ${money(t.salidas)} · Negativos: ${num(t.negativos)} · Críticos: ${num(t.criticos)}. Esta consulta es informativa y no ajusta el inventario.`;const rows=d.stocks||[];$('#dailyCloseBody').innerHTML=rows.length?rows.map(r=>`<tr><td>${esc(d.fecha)}</td><td>${esc(r.almacen)}</td><td><b>${esc(r.codigo)}</b></td><td>${esc(r.material)}</td><td>${esc(r.unidad)}</td><td class="${Number(r.stock)<0?'dangertext':''}">${num(r.stock)}</td><td>${num(r.minimo)}</td><td>${money(r.costo_unitario)}</td><td>${money(r.valor)}</td><td><span class="status ${r.estado==='NEGATIVO'?'danger':r.estado==='CRITICO'?'warn':'muted'}">${esc(r.estado)}</span></td></tr>`).join(''):'<tr><td colspan="10" class="empty">No hay posiciones de inventario con movimientos hasta esa fecha.</td></tr>'}catch(e){$('#dailyCloseSummary').textContent='Error: '+e.message;$('#dailyCloseBody').innerHTML=`<tr><td colspan="10" class="empty">${esc(e.message)}</td></tr>`}}
$('#dailyCostsForm')?.addEventListener('submit',e=>{e.preventDefault();loadDailyCosts()});$('#materialKardexForm')?.addEventListener('submit',e=>{e.preventDefault();loadMaterialKardex()});$('#consumptionForm')?.addEventListener('submit',e=>{e.preventDefault();loadConsumption()});$('#dailyCloseForm')?.addEventListener('submit',e=>{e.preventDefault();loadDailyClose()});
function printReportTable(bodyId,title){const body=$('#'+bodyId);if(!body)return;const table=body.closest('table');const w=window.open('','_blank','width=1100,height=800');if(!w){alert('Permite las ventanas emergentes para imprimir o guardar como PDF.');return}w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#17202a}h1{font-size:20px}table{border-collapse:collapse;width:100%;font-size:10px}th,td{border:1px solid #ddd;padding:6px;text-align:left}th{background:#eef2f5}@media print{body{padding:0}}</style></head><body><h1>${esc(title)}</h1><p>SILOG · Generado ${esc(new Date().toLocaleString('es-PE'))}</p><table>${table.querySelector('thead')?.outerHTML||''}<tbody>${body.innerHTML}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`);w.document.close()}

$('#exportForm').onsubmit=e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));window.location='/api/export-data?from='+d.from+'&to='+d.to};

function resourcesReportParams(){
 const p=new URLSearchParams();
 for(const [id,key] of [['resourcesFrom','from'],['resourcesTo','to'],['resourcesWarehouse','warehouse'],['resourcesType','type'],['resourcesSearch','search']]){
  const value=$('#'+id)?.value||'';if(value)p.set(key,value);
 }
 p.set('limit','1000');return p;
}
async function loadResourcesReport(){
 if(!$('#resourcesReportBody'))return;
 $('#resourcesReportSummary').textContent='Consultando movimientos...';
 try{
  const p=resourcesReportParams(),d=await api('/api/resources-report?'+p.toString());
  const rows=d.rows||[];
  $('#resourcesReportSummary').textContent=`Mostrando ${num(rows.length)} de ${num(d.total)} registros · Ordenados por fecha y hora de registro, del más reciente al más antiguo.`;
  $('#resourcesReportBody').innerHTML=rows.length?rows.map(r=>`<tr>
   <td>${esc(formatReportDate(r.registrado_en))}</td><td>${esc(r.almacen)}</td>
   <td><b>${esc(r.codigo)}</b></td><td>${esc(r.codigo_anterior||'—')}</td>
   <td>${esc(r.material)}</td><td><span class="status ${['IN','INITIAL','TRANSFER_IN','ADJUSTMENT'].includes(r.tipo_movimiento)?'ok':r.tipo_movimiento==='OUT'?'warn':'muted'}">${esc(r.tipo_movimiento)}</span></td>
   <td>${num(r.cantidad)}</td><td>${esc(r.unidad||'—')}</td><td>${money(r.costo_unitario)}</td><td>${money(r.valor_total)}</td><td>${num(r.stock_despues)}</td><td>${esc(r.usuario||'SYSTEM')}</td>
   <td>${esc([r.documento,r.numero,r.observacion].filter(Boolean).join(' · ')||r.origen||'—')}</td>
  </tr>`).join(''):'<tr><td colspan="13" class="empty">No hay movimientos que coincidan con estos filtros.</td></tr>';
 }catch(e){$('#resourcesReportSummary').textContent='No se pudo cargar el reporte: '+e.message;$('#resourcesReportBody').innerHTML=`<tr><td colspan="13" class="empty">${esc(e.message)}</td></tr>`}
}
function formatReportDate(value){
 if(!value)return '—';const d=new Date(value);if(Number.isNaN(d.getTime()))return String(value);
 return d.toLocaleString('es-PE',{dateStyle:'short',timeStyle:'short',hour12:true});
}
$('#resourcesReportForm')?.addEventListener('submit',e=>{e.preventDefault();loadResourcesReport()});
$('#resourcesClear')?.addEventListener('click',()=>{['resourcesFrom','resourcesTo','resourcesSearch'].forEach(id=>$('#'+id).value='');$('#resourcesWarehouse').value='';$('#resourcesType').value='INCOMING';loadResourcesReport()});
function downloadResourcesFile(format){
 const p=resourcesReportParams();p.set('limit','1000');window.location='/api/resources-report.'+format+'?'+p.toString();
}
$('#resourcesCsv')?.addEventListener('click',()=>downloadResourcesFile('csv'));
$('#resourcesXlsx')?.addEventListener('click',()=>downloadResourcesFile('xlsx'));
function downloadReport(type){if(type==='inventory'){show('inventory')}else if(type==='movements'){show('export');$('#resourcesType').value='ALL';loadResourcesReport()}else show('export')}


// Préstamos temporales y devolución parcial/total.
let loanRowCounter=0,loanCurrentReturnId=null,loanInitDone=false,loanRefreshTimer=null;
function localDateTimeValue(d=new Date()){const x=new Date(d.getTime()-d.getTimezoneOffset()*60000);return x.toISOString().slice(0,16)}
function setLoanDefaults(){const issued=$('#loanIssuedAt'),due=$('#loanDueAt');if(!issued.value)issued.value=localDateTimeValue();if(!due.value){const d=new Date(issued.value||new Date());d.setHours(18,0,0,0);due.value=localDateTimeValue(d)}}
function updateLoanDeadline(){const v=$('#loanIssuedAt')?.value;if(!v)return;const d=new Date(v);d.setHours(18,0,0,0);$('#loanDueAt').value=localDateTimeValue(d)}
async function initLoanForm(){if(loanInitDone){setLoanDefaults();return}loanInitDone=true;setLoanDefaults();try{const users=await api('/api/loans/supervisors');$('#loanSupervisors').innerHTML=users.map(u=>`<option value="${esc(u.id)}">${esc(u.nombre)} · ${esc(u.rol)}</option>`).join('');if(!users.length)$('#loanFormStatus').textContent='No hay usuarios activos con rol ADMIN o SUPERVISOR. Crea o activa al menos uno en Usuarios.'}catch(e){$('#loanFormStatus').textContent='No se pudieron cargar los supervisores: '+e.message}if(!$('#loanItemsBody').children.length)addLoanItemRow();if(!loanRefreshTimer)loanRefreshTimer=setInterval(()=>{if(!document.hidden&&!$('#loans').classList.contains('hidden'))loadLoans()},60000)}
function addLoanItemRow(){const id=++loanRowCounter;const tr=document.createElement('tr');tr.dataset.loanRow=String(id);tr.innerHTML=`<td style="min-width:250px;position:relative"><input class="loan-material-search" autocomplete="off" placeholder="Escribe nombre o código" required><div class="product-suggestions hidden loan-material-suggestions"></div><small class="loan-material-meta muted">Selecciona un material del Maestro.</small></td><td class="loan-stock">—</td><td><input class="loan-qty" type="number" min="1" step="1" value="1" required style="width:90px"></td><td class="loan-cost">S/ 0.00</td><td class="loan-value">S/ 0.00</td><td><button type="button" class="secondary loan-remove">×</button></td>`;$('#loanItemsBody').appendChild(tr);const input=tr.querySelector('.loan-material-search'),suggest=tr.querySelector('.loan-material-suggestions');let timer=null;input.addEventListener('input',()=>{tr.dataset.code='';tr.dataset.stock='0';tr.dataset.cost='0';tr.querySelector('.loan-stock').textContent='—';tr.querySelector('.loan-cost').textContent='S/ 0.00';tr.querySelector('.loan-value').textContent='S/ 0.00';tr.querySelector('.loan-material-meta').textContent='Buscando en el Maestro…';clearTimeout(timer);const q=input.value.trim();if(q.length<2){suggest.classList.add('hidden');return}timer=setTimeout(async()=>{try{const wh=$('#loanWarehouse').value||'';const rows=await api(`/api/materials?search=${encodeURIComponent(q)}&warehouse=${encodeURIComponent(wh)}&loaded_only=1&limit=20`);suggest.innerHTML=rows.map(m=>`<button type="button" class="product-suggestion loan-material-choice" data-code="${esc(m.codigo)}" data-name="${esc(m.descripcion)}" data-unit="${esc(m.unidad||'')}" data-stock="${Number(m.stock||0)}" data-cost="${Number(m.costo_promedio||m.costo_referencia||0)}"><b>${esc(m.descripcion)}</b><small>${esc(m.codigo)} · Stock: ${num(m.stock)} · ${esc(m.unidad||'')}</small></button>`).join('')||'<div class="product-suggestion muted">No se encontraron materiales cargados en este almacén.</div>';suggest.classList.remove('hidden');suggest.querySelectorAll('.loan-material-choice').forEach(b=>b.onclick=()=>{tr.dataset.code=b.dataset.code;tr.dataset.stock=b.dataset.stock;tr.dataset.cost=b.dataset.cost;input.value=`${b.dataset.name} (${b.dataset.code})`;tr.querySelector('.loan-stock').textContent=num(b.dataset.stock);tr.querySelector('.loan-cost').textContent=money(b.dataset.cost);tr.querySelector('.loan-material-meta').textContent=`${b.dataset.code} · ${b.dataset.unit||'Sin unidad'}`;suggest.classList.add('hidden');calcLoanTotal()})}catch(e){suggest.innerHTML=`<div class="product-suggestion">${esc(e.message)}</div>`;suggest.classList.remove('hidden')}},250)});tr.querySelector('.loan-qty').addEventListener('input',calcLoanTotal);tr.querySelector('.loan-remove').onclick=()=>{tr.remove();calcLoanTotal()};}
function calcLoanTotal(){let total=0;$$('#loanItemsBody tr').forEach(tr=>{const value=Math.max(0,Number(tr.dataset.cost||0))*Math.max(0,Number(tr.querySelector('.loan-qty')?.value||0));tr.querySelector('.loan-value').textContent=money(value);total+=value});$('#loanTotal').textContent='Valor total: '+money(total)}
$('#loanAddItem')?.addEventListener('click',addLoanItemRow);
$('#loanIssuedAt')?.addEventListener('change',updateLoanDeadline);
$('#loanDni')?.addEventListener('change',async()=>{const dni=$('#loanDni').value.trim();let p=peopleCache.find(x=>String(x.dni||'').replace(/\D/g,'')===dni.replace(/\D/g,''));if(!p&&dni){try{const rows=await api('/api/personnel?search='+encodeURIComponent(dni));p=rows.find(x=>String(x.dni||'').replace(/\D/g,'')===dni.replace(/\D/g,''))}catch{}}if(p)$('#loanWorker').value=p.nombre||''});
$('#loanWarehouse')?.addEventListener('change',()=>{$$('#loanItemsBody tr').forEach(tr=>{tr.dataset.code='';tr.querySelector('.loan-material-search').value='';tr.querySelector('.loan-stock').textContent='—';tr.querySelector('.loan-material-meta').textContent='Almacén cambiado; vuelve a elegir el material.'});calcLoanTotal()});
async function fileToCompressedDataUrl(file){if(!file)return '';if(!file.type.startsWith('image/'))throw new Error('Selecciona un archivo de imagen.');const src=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('No se pudo leer la foto.'));r.readAsDataURL(file)});const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('No se pudo abrir la foto.'));i.src=src});const scale=Math.min(1,1600/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);let out=canvas.toDataURL('image/jpeg',0.78);if(out.length>5_000_000)out=canvas.toDataURL('image/jpeg',0.55);if(out.length>5_500_000)throw new Error('La foto sigue siendo muy pesada; toma otra con menor resolución.');return out}
$('#loanForm')?.addEventListener('submit',async e=>{e.preventDefault();const status=$('#loanFormStatus');try{const rows=$$('#loanItemsBody tr');const items=rows.map(tr=>({codigo:tr.dataset.code,cantidad:Number(tr.querySelector('.loan-qty').value),barcode:tr.dataset.code}));if(items.some(x=>!x.codigo))throw new Error('Selecciona un material del Maestro en cada fila.');if(items.some(x=>!(x.cantidad>=1)))throw new Error('Las cantidades deben ser 1 o más.');const photo=$('#loanEvidence').files?.[0];status.textContent=photo?'Comprimiendo evidencia y registrando préstamo…':'Registrando préstamo…';const evidence=photo?await fileToCompressedDataUrl(photo):'';const payload={almacen:$('#loanWarehouse').value,dni:$('#loanDni').value.trim(),trabajador:$('#loanWorker').value.trim(),issued_at:new Date($('#loanIssuedAt').value).toISOString(),due_at:new Date($('#loanDueAt').value).toISOString(),supervisor_ids:[...$('#loanSupervisors').selectedOptions].map(x=>Number(x.value)),observacion:$('#loanObservation').value.trim(),items,evidence_data_url:evidence,evidence_filename:photo?.name||''};const result=await api('/api/loans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});status.textContent=`Préstamo ${result.numero} registrado. Valor prestado: ${money(result.total)}. El stock se descontó temporalmente y se repondrá al registrar la devolución.`;$('#loanForm').reset();$('#loanItemsBody').innerHTML='';addLoanItemRow();setLoanDefaults();calcLoanTotal();await Promise.all([loadLoans(),loadLoanReport(),loadInventory(),loadDash(),loadLoanAlertBadge()]);alert(`Préstamo ${result.numero} registrado correctamente.`)}catch(err){status.textContent='No se registró el préstamo: '+err.message;alert('No se pudo registrar el préstamo: '+err.message)}});
async function loadLoanAlertBadge(){const badge=$('#loanNavBadge');if(!badge||!currentUser)return;try{const d=await api('/api/loans/alerts');const count=Number(d.vencidos||0)+Number(d.porVencer||0);badge.textContent=count?String(count):'';badge.classList.toggle('hidden',count===0);badge.classList.toggle('overdue',Number(d.vencidos||0)>0);badge.title=Number(d.vencidos||0)?`${d.vencidos} préstamo(s) vencido(s)`:count?`${count} préstamo(s) por vencer`: 'Sin préstamos próximos a vencer';const nav=document.querySelector('button[data-page="loans"]');if(nav)nav.setAttribute('aria-label',count?`Préstamos, ${count} alerta(s)`:'Préstamos');}catch{badge.classList.add('hidden')}}
async function loadLoans(){if(!$('#loanPendingBody'))return;try{const d=await api('/api/loans/alerts');const rows=d.rows||[];$('#loanPendingSummary').textContent=`${d.total} préstamo(s) abierto(s) · ${d.vencidos} vencido(s) · ${d.porVencer} por vencer. Los préstamos vencidos se mantienen en alerta hasta completar la devolución.`;const banner=$('#loanAlertBanner');if(d.vencidos){banner.classList.remove('hidden');banner.className='alert danger';banner.textContent=` ATENCIÓN: ${d.vencidos} préstamo(s) vencido(s) sin devolución completa. Revisa al trabajador y supervisor responsable.`}else if(d.porVencer){banner.classList.remove('hidden');banner.className='alert warn';banner.textContent=`Hay ${d.porVencer} préstamo(s) que vence(n) dentro de los próximos 60 minutos.`}else{banner.classList.add('hidden')}$('#loanPendingBody').innerHTML=rows.length?rows.map(r=>`<tr><td><span class="status ${r.alerta==='VENCIDO'?'danger':r.alerta==='POR VENCER'?'warn':'ok'}">${esc(r.alerta)}</span></td><td><b>${esc(r.numero)}</b></td><td>${esc(formatReportDate(r.issued_at))}</td><td>${esc(formatReportDate(r.due_at))}</td><td>${esc(r.almacen)}</td><td>${esc(r.dni)}<br>${esc(r.trabajador)}</td><td>${esc(r.supervisores)}</td><td>${num(r.cantidad_pendiente)} unidad(es) · ${num(r.lineas)} línea(s)</td><td><b>${money(r.valor_pendiente)}</b></td><td>${r.has_evidence?`<a href="/api/loans/${r.id}/evidence" target="_blank" rel="noopener">Ver foto</a>`:'—'}</td><td><button type="button" class="primary" onclick="openLoanReturn(${Number(r.id)})">Registrar devolución</button> <button type="button" class="secondary" onclick="openLoanExtend(${Number(r.id)})">Extender plazo</button></td></tr>`).join(''):'<tr><td colspan="11" class="empty">No hay préstamos pendientes de devolución. ¡Todo al día!</td></tr>'}catch(e){$('#loanPendingSummary').textContent='Error al consultar préstamos: '+e.message;$('#loanPendingBody').innerHTML=`<tr><td colspan="11" class="empty">${esc(e.message)}</td></tr>`}}
async function openLoanExtend(id){try{const d=await api('/api/loans/'+id);if(['DEVUELTO','ANULADO'].includes(d.loan.estado))throw new Error('El préstamo está cerrado.');$('#loanExtendHeading').textContent=`${d.loan.numero} · ${d.loan.trabajador} · plazo actual ${formatReportDate(d.loan.due_at)}`;const due=new Date(d.loan.due_at);due.setDate(due.getDate()+1);due.setHours(18,0,0,0);$('#loanExtendDueAt').value=localDateTimeValue(due);$('#loanExtendReason').value='';$('#loanExtendDialog').showModal();$('#loanExtendForm').dataset.loanId=String(id)}catch(e){alert('No se pudo preparar la extensión: '+e.message)}}
$('#loanExtendCancel')?.addEventListener('click',()=>$('#loanExtendDialog').close());
$('#loanExtendForm')?.addEventListener('submit',async e=>{e.preventDefault();const id=e.currentTarget.dataset.loanId;try{const r=await api(`/api/loans/${id}/extend`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({due_at:new Date($('#loanExtendDueAt').value).toISOString(),motivo:$('#loanExtendReason').value.trim()})});$('#loanExtendDialog').close();alert(`Plazo del préstamo ${r.numero} extendido con autorización registrada.`);await Promise.all([loadLoans(),loadLoanReport(),loadLoanAlertBadge()])}catch(err){alert('No se pudo extender el plazo: '+err.message)}});
async function openLoanReturn(id){try{const d=await api('/api/loans/'+id);loanCurrentReturnId=id;$('#loanReturnHeading').textContent=`${d.loan.numero} · ${d.loan.trabajador} · ${d.loan.almacen}`;const pending=d.items.filter(x=>Number(x.pendiente)>0);$('#loanReturnItems').innerHTML=`<div class="tablewrap"><table><thead><tr><th>Material</th><th>Pendiente</th><th>Cantidad que devuelve ahora</th><th>Estado del material</th></tr></thead><tbody>${pending.map(x=>`<tr data-loan-item="${x.item_id}"><td><b>${esc(x.codigo)}</b><br>${esc(x.material)}</td><td>${num(x.pendiente)} ${esc(x.unidad||'')}</td><td><input class="loan-return-qty" type="number" min="0" max="${Number(x.pendiente)}" step="0.0001" value="${Number(x.pendiente)}" style="width:120px"></td><td><select class="loan-return-condition"><option>BUENO</option><option>DAÑADO</option><option>INCOMPLETO</option></select></td></tr>`).join('')}</tbody></table></div>`;$('#loanReturnObservation').value='';$('#loanReturnDialog').showModal()}catch(e){alert('No se pudo abrir el préstamo: '+e.message)}}
$('#loanReturnCancel')?.addEventListener('click',()=>$('#loanReturnDialog').close());
$('#loanReturnForm')?.addEventListener('submit',async e=>{e.preventDefault();if(!loanCurrentReturnId)return;const items=$$('#loanReturnItems tr[data-loan-item]').map(tr=>({item_id:Number(tr.dataset.loanItem),cantidad:Number(tr.querySelector('.loan-return-qty').value||0),estado_material:tr.querySelector('.loan-return-condition').value})).filter(x=>x.cantidad>0);if(!items.length){alert('Ingresa al menos una cantidad devuelta.');return}try{const result=await api(`/api/loans/${loanCurrentReturnId}/return`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items,observacion:$('#loanReturnObservation').value.trim()})});$('#loanReturnDialog').close();alert(`Devolución registrada para ${result.numero}. Estado: ${result.estado}.`);await Promise.all([loadLoans(),loadLoanReport(),loadInventory(),loadDash(),loadLoanAlertBadge()]);loanCurrentReturnId=null}catch(err){alert('No se pudo registrar la devolución: '+err.message)}});
$('#loanRefresh')?.addEventListener('click',loadLoans);
function loanReportParams(){const p=new URLSearchParams();for(const [id,key] of [['loanReportFrom','from'],['loanReportTo','to'],['loanReportWarehouse','warehouse'],['loanReportSearch','search']]){const v=$('#'+id)?.value||'';if(v)p.set(key,v)}return p}
async function loadLoanReport(){if(!$('#loanReportBody'))return;try{const p=loanReportParams(),rows=await api('/api/loans?'+p.toString());$('#loanReportSummary').textContent=`${rows.length} línea(s) · Valor prestado: ${money(rows.reduce((s,r)=>s+Number(r.valor||0),0))} · Valor pendiente: ${money(rows.reduce((s,r)=>s+Number(r.valor_pendiente||0),0))} · Vencidos: ${rows.filter(r=>r.estado==='VENCIDO').length}. El valor pendiente es exposición temporal, no consumo definitivo.`;$('#loanReportBody').innerHTML=rows.length?rows.map(r=>`<tr><td><b>${esc(r.numero)}</b></td><td>${esc(formatReportDate(r.issued_at))}</td><td>${esc(formatReportDate(r.due_at))}</td><td>${esc(r.returned_at?formatReportDate(r.returned_at):'—')}</td><td>${esc(r.almacen)}</td><td>${esc(r.dni)}</td><td>${esc(r.trabajador)}</td><td>${esc(r.supervisores)}</td><td><b>${esc(r.codigo)}</b> · ${esc(r.material)}</td><td>${num(r.cantidad)}</td><td>${num(r.devuelto)}</td><td class="${Number(r.pendiente)>0?'dangertext':''}">${num(r.pendiente)}</td><td>${money(r.costo_unitario)}</td><td>${money(r.valor)}</td><td>${money(r.valor_pendiente)}</td><td><span class="status ${r.estado==='VENCIDO'?'danger':r.estado==='DEVUELTO'?'ok':r.estado==='PARCIAL'?'warn':'muted'}">${esc(r.estado)}</span></td></tr>`).join(''):'<tr><td colspan="16" class="empty">No hay préstamos que coincidan con los filtros.</td></tr>'}catch(e){$('#loanReportSummary').textContent='Error al cargar el reporte: '+e.message;$('#loanReportBody').innerHTML=`<tr><td colspan="16" class="empty">${esc(e.message)}</td></tr>`}}
$('#loanReportForm')?.addEventListener('submit',e=>{e.preventDefault();loadLoanReport()});
function downloadLoanReport(format){window.location='/api/loans/report.'+format+'?'+loanReportParams().toString()}
$('#loanReportCsv')?.addEventListener('click',()=>downloadLoanReport('csv'));$('#loanReportXlsx')?.addEventListener('click',()=>downloadLoanReport('xlsx'));$('#loanReportPrint')?.addEventListener('click',()=>printReportTable('loanReportBody','Reporte de préstamos y devoluciones'));

$('#toggleNewMaterial')?.addEventListener('click',()=>{$('#newMaterialPanel').classList.toggle('hidden');if(!$('#newMaterialPanel').classList.contains('hidden'))$('#newMaterialForm [name=codigo]').focus()});
$('#cancelNewMaterial')?.addEventListener('click',()=>{$('#newMaterialPanel').classList.add('hidden');$('#newMaterialForm').reset();$('#newMaterialForm [name=unidad]').value='UND';$('#newMaterialForm [name=moneda]').value='SOL';$('#newMaterialForm [name=grupo_codigo]').value='GEN';$('#newMaterialForm [name=grupo_nombre]').value='GENERAL';$('#newMaterialForm [name=familia_codigo]').value='00';$('#newMaterialForm [name=familia_nombre]').value='GENERAL';$('#newMaterialForm [name=costo_referencia]').value='0'});
async function loadKits(){
 const warehouse=$('#kitsWarehouse')?.value||'';const body=$('#kitsBody');if(!body)return;
 body.innerHTML='<tr><td colspan="6" class="empty">Consultando kits…</td></tr>';
 try{const rows=await api('/api/kits?warehouse='+encodeURIComponent(warehouse));body.innerHTML=rows.length?rows.map(k=>`<tr><td><b>${esc(k.codigo)}</b></td><td>${esc(k.nombre)}<small class="muted">${esc(k.descripcion||'')}</small></td><td>${(k.componentes||[]).map(c=>`${esc(c.codigo)} · ${esc(c.descripcion)} × ${num(c.cantidad)}`).join('<br>')||'—'}</td><td><b>${num(k.cantidad)}</b></td><td>${money(k.valor)}</td><td><div class="kit-actions"><label>Armar<input type="number" min="1" step="1" value="1" id="kit-assemble-${k.id}"></label><button type="button" class="primary" onclick="assembleKit(${Number(k.id)})">Armar</button><label>Entregar<input type="number" min="1" step="1" value="1" id="kit-dispatch-${k.id}"></label><button type="button" class="secondary" onclick="dispatchKit(${Number(k.id)})">Salida</button></div></td></tr>`).join(''):'<tr><td colspan="6" class="empty">No hay kits registrados. Crea una definición arriba.</td></tr>';
 }catch(e){body.innerHTML=`<tr><td colspan="6" class="empty dangertext">No se pudieron cargar los kits: ${esc(e.message)}</td></tr>`}
}
async function assembleKit(id){const cantidad=Number($('#kit-assemble-'+id)?.value||0),almacen=$('#kitsWarehouse')?.value||'';if(!almacen)return alert('Selecciona un almacén.');if(!Number.isInteger(cantidad)||cantidad<1)return alert('La cantidad debe ser un entero mayor que cero.');if(!confirm(`¿Armar ${cantidad} kit(s) en el almacén seleccionado? Se descontarán sus componentes del stock.`))return;try{const r=await api(`/api/kits/${id}/assemble`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({almacen,cantidad})});alert(`Kit armado: ${r.codigo} · ${r.cantidad} unidad(es) · ${r.almacen}\nValor: ${money(r.valor)}`);await Promise.all([loadKits(),loadInventory(),loadMaterials(),loadDash(),loadData(1)])}catch(e){alert('No se pudo armar el kit: '+e.message)}}
async function dispatchKit(id){const cantidad=Number($('#kit-dispatch-'+id)?.value||0),almacen=$('#kitsWarehouse')?.value||'';if(!almacen)return alert('Selecciona un almacén.');if(!Number.isInteger(cantidad)||cantidad<1)return alert('La cantidad debe ser un entero mayor que cero.');if(!confirm(`¿Registrar salida de ${cantidad} kit(s) del almacén seleccionado?`))return;try{const r=await api(`/api/kits/${id}/dispatch`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({almacen,cantidad,observacion:'Salida de kit desde módulo Kits'})});alert(`Salida registrada: ${r.codigo} · ${r.cantidad} · ${r.almacen}`);await Promise.all([loadKits(),loadDash()])}catch(e){alert('No se pudo registrar la salida: '+e.message)}}
$('#kitCreateForm')?.addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;const data=Object.fromEntries(new FormData(form));const components=[];for(const line of String(data.componentes||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean)){const parts=line.split(/[;,\t]/).map(x=>x.trim());if(parts.length<2||!parts[0]||!Number.isFinite(Number(parts[1]))||Number(parts[1])<=0){alert(`Línea de componente inválida: ${line}. Usa CODIGO; CANTIDAD.`);return}components.push({codigo:parts[0],cantidad:Number(parts[1])})}try{const r=await api('/api/kits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({codigo:data.codigo,nombre:data.nombre,descripcion:data.descripcion,componentes:components})});$('#kitCreateStatus').textContent=`Kit ${r.codigo} registrado con ${components.length} componente(s). Selecciona almacén y usa “Armar” para convertir componentes en kits disponibles.`;form.reset();await loadKits()}catch(err){$('#kitCreateStatus').textContent='No se pudo registrar el kit: '+err.message;alert(err.message)}});
$('#refreshKits')?.addEventListener('click',loadKits);

$('#newMaterialForm')?.addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;const payload=Object.fromEntries(new FormData(form));for(const k of ['codigo','codigo_anterior','descripcion','unidad','grupo_codigo','grupo_nombre','familia_codigo','familia_nombre','moneda','ubicacion'])payload[k]=String(payload[k]||'').trim();try{const r=await api('/api/materials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});alert(`Material ${r.codigo} registrado en el Maestro. Ahora puedes ingresar stock desde Inventario.`);form.reset();$('#newMaterialPanel').classList.add('hidden');await loadLookups();$('#matSearch').value=r.codigo;$('#matGroup').value='';$('#matFamily').value='';$('#matStatus').value='';await loadMaterials()}catch(err){alert('No se pudo registrar el material: '+err.message)}});
$('#loginForm').onsubmit=async e=>{e.preventDefault();$('#loginError').textContent='';const b=Object.fromEntries(new FormData(e.target));try{const r=await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});currentUser=r.user;hideLogin();$('#currentUser').textContent=`${currentUser.nombre} · ${currentUser.rol}`;const usersNav=document.querySelector('button[data-page="users"]');if(usersNav)usersNav.style.display=currentUser.rol==='ADMIN'?'':'none';const auditNav=document.querySelector('button[data-page="audit"]');if(auditNav)auditNav.style.display=currentUser.rol==='ADMIN'?'':'none';if($('#scheduleReportsPanel'))$('#scheduleReportsPanel').style.display=['ADMIN','SUPERVISOR'].includes(currentUser.rol)?'':'none';e.target.reset();await loadLookups();setToday(document.querySelector('#incomeForm [name=fecha_atencion]'));setDigitacion(document.querySelector('#incomeForm'));setToday(document.querySelector('#outflowForm [name=fecha_atencion]'));setDigitacion(document.querySelector('#outflowForm'));await Promise.all([loadDash(),loadPeople(),loadMaterials()]);if(!$('#issueItems tr').length)addIssueRow();const quickLoanStatus=$('#quickLoanStatus');if(quickLoanStatus){const badge=$('#loanNavBadge');quickLoanStatus.textContent=badge&&!badge.classList.contains('hidden')?`${badge.textContent} alerta(s) pendiente(s)`:'Control de préstamos'}}catch(err){$('#loginError').textContent=err.message||'No fue posible iniciar sesión'}};
$('#logoutBtn').onclick=async()=>{try{await api('/api/auth/logout',{method:'POST'})}finally{currentUser=null;showLogin();document.querySelectorAll('.page').forEach(x=>x.classList.add('hidden'));$('#dashboard')?.classList.remove('hidden')}};

init().catch(e=>{console.error(e);$('#health').className='err'});

let dataPage=1;
async function loadData(page=1){dataPage=page;const p=new URLSearchParams({page:String(page),limit:'100'});for(const [id,key] of [['dataSearch','search'],['dataFrom','from'],['dataTo','to'],['dataType','type'],['dataWarehouse','warehouse'],['dataDni','dni']]){const v=$('#'+id)?.value||'';if(v)p.set(key,v)}try{const d=await api('/api/data?'+p.toString());$('#dataTotal').textContent=num(d.total);$('#dataPageInfo').textContent=`Página ${d.page} de ${d.pages}`;$('#dataPager').textContent=`${num((d.page-1)*d.limit+1)}–${num(Math.min(d.page*d.limit,d.total))} de ${num(d.total)}`;$('#dataBody').innerHTML=d.rows.length?d.rows.map(r=>`<tr><td>${esc(r.AÑO)}</td><td>${esc(r.ALMACEN)}</td><td>${esc(r.CONDICION)}</td><td>${esc(r.DOC)}</td><td>${esc(r['N°'])}</td><td>${esc(r.FECHA)}</td><td>${esc(r.FECHA_DIGITACION)}</td><td>${esc(r.CeCo)}</td><td>${esc(r.CLIENTE)}</td><td>${esc(r.AREA)}</td><td>${esc(r.PLACA)}</td><td><b>${esc(r['CÓDIGO'])}</b></td><td class="${r.CANT<0?'dangertext':''}">${num(r.CANT)}</td><td>${num(r.STOCK)}</td><td>${esc(r.UND)}</td><td>${esc(r.PRODUCTO)}</td><td>${esc(r.GRUPO)}</td><td>${esc(r.MON)}</td><td>${money(r.PU)}</td><td>${money(r['S/ Total'])}</td><td>${esc(r.DNI)}</td><td>${esc(r.SOLICITANTE)}</td><td>${esc(r.ENTREGADO)}</td><td>${esc(r.AUTORIZADO)}</td><td><span class="status ${r.TIPO==='OUT'?'warn':r.TIPO==='INITIAL'?'muted':'ok'}">${esc(r.TIPO)}</span></td></tr>`).join(''):'<tr><td colspan="25" class="empty">No se encontraron registros</td></tr>';}catch(e){$('#dataBody').innerHTML=`<tr><td colspan="25" class="empty">Error: ${esc(e.message)}</td></tr>`}}
function changeDataPage(delta){const pages=Math.max(1,Math.ceil(Number($('#dataTotal').textContent.replace(/[^0-9]/g,'')||0)/100));const next=dataPage+delta;if(next>=1&&next<=pages)loadData(next)}
function clearDataFilters(){['dataSearch','dataFrom','dataTo','dataDni'].forEach(id=>$('#'+id).value='');$('#dataType').value='';$('#dataWarehouse').value='';loadData(1)}

// SILOG 1.7.0 — operaciones avanzadas y validación cruzada
$('#dashboardWarehouse')?.addEventListener('change',()=>loadDash());
$('#budgetPeriod')?.addEventListener('change',()=>loadBudget());
$('#budgetWarehouse')?.addEventListener('change',()=>loadBudget());
$('#budgetForm')?.addEventListener('submit',async e=>{
 e.preventDefault();
 try{
  const payload={period:$('#budgetPeriod').value,warehouse:$('#budgetWarehouse').value,amount:Number($('#budgetAmount').value)};
  await api('/api/budgets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  $('#budgetSummary').textContent='Presupuesto guardado. Se actualizó la comparación con las salidas registradas.';
  await loadBudget();await loadDash();
 }catch(err){$('#budgetSummary').textContent='No se pudo guardar el presupuesto: '+err.message;alert(err.message)}
});
async function loadBudget(){
 if(!$('#budgetBody')||!$('#budgetPeriod'))return;
 const period=$('#budgetPeriod').value||todayLocal().slice(0,7),warehouse=$('#budgetWarehouse')?.value||'';
 try{
  const d=await api('/api/budgets?period='+encodeURIComponent(period));
  const rows=d.rows||[];
  $('#budgetBody').innerHTML=rows.length?rows.map(r=>{const budget=Number(r.presupuesto||0),spent=Number(r.consumido||0),pct=budget>0?spent/budget*100:null;return `<tr><td>${esc(r.almacen)}</td><td>${money(budget)}</td><td>${money(spent)}</td><td class="${budget-spent<0?'dangertext':''}">${money(budget-spent)}</td><td>${pct===null?'<span class="status muted">Sin presupuesto</span>':`<span class="status ${pct>=100?'danger':pct>=80?'warn':'ok'}">${num(pct)}%</span>`}</td></tr>`}).join(''):'<tr><td colspan="5" class="empty">No hay almacenes configurados.</td></tr>';
  $('#budgetSummary').textContent=`Período ${period}. El consumo se calcula con las salidas valorizadas reales; transferencias y vaciados no se cuentan como consumo.`;
  const selected=rows.find(r=>String(r.warehouse_id)===String(warehouse));if(selected&&document.activeElement!==$('#budgetAmount'))$('#budgetAmount').value=Number(selected.presupuesto||0);
 }catch(e){$('#budgetSummary').textContent='No se pudo consultar el presupuesto: '+e.message;$('#budgetBody').innerHTML=`<tr><td colspan="5" class="empty">${esc(e.message)}</td></tr>`}
}
function renderDashboardAlerts(rows){
 const el=$('#dashboardAlerts');if(!el)return;
 el.innerHTML=rows.length?`<table><thead><tr><th>Almacén</th><th>Código</th><th>Material</th><th>Stock</th><th>Mínimo</th><th>Alerta</th></tr></thead><tbody>${rows.slice(0,15).map(r=>`<tr><td>${esc(r.almacen)}</td><td><b>${esc(r.codigo)}</b></td><td>${esc(r.material)}</td><td class="${Number(r.stock)<0?'dangertext':''}">${num(r.stock)}</td><td>${num(r.minimo)}</td><td><span class="status ${r.alerta==='NEGATIVO'?'danger':r.alerta==='CRITICO'?'warn':'muted'}">${esc(r.alerta)}</span></td></tr>`).join('')}</tbody></table>`:'<div class="alert good">No se detectan alertas en las posiciones de inventario registradas.</div>';
}
async function loadDiagnostics(){
 const el=$('#systemDiagnostics');if(!el||!currentUser||!['ADMIN','SUPERVISOR'].includes(currentUser.rol))return;
 try{const d=await api('/api/system/diagnostics');const c=d.counts||{};el.innerHTML=`<div class="cards four"><div><span>Materiales</span><strong>${num(c.materiales)}</strong></div><div><span>Movimientos</span><strong>${num(c.movimientos)}</strong></div><div><span>Posiciones</span><strong>${num(c.posiciones)}</strong></div><div><span>Personal</span><strong>${num(c.personal)}</strong></div></div><div class="alert ${d.ok?'good':'danger'}"><b>${d.ok?'Integridad básica correcta':'Se detectaron diferencias que requieren revisión'}</b><br>Almacenes: ${num(c.almacenes)} · Saldos distintos al Kardex: ${num(d.balancesDescuadrados)} · Stock positivo sin costo: ${num(d.materialesConStockSinCosto)} · Movimientos huérfanos: ${num(d.movimientosHuérfanos)}</div>`}
 catch(e){el.innerHTML=`<div class="alert">Diagnóstico no disponible para este rol o por un error: ${esc(e.message)}</div>`}
}
async function loadAlerts(){
 const warehouse=$('#reconciliation')&&!$('#reconciliation').classList.contains('hidden')?($('#reconWarehouse')?.value||''):($('#inventory')&&!$('#inventory').classList.contains('hidden')?($('#invWarehouse')?.value||''):($('#dashboardWarehouse')?.value||''));
 try{const rows=await api('/api/alerts'+(warehouse?'?warehouse='+encodeURIComponent(warehouse):''));
  const body=$('#alertsBody');if(body)body.innerHTML=rows.length?rows.map(r=>`<tr><td>${esc(r.almacen)}</td><td><b>${esc(r.codigo)}</b></td><td>${esc(r.material)}</td><td class="${Number(r.stock)<0?'dangertext':''}">${num(r.stock)}</td><td>${num(r.minimo)}</td><td>${num(r.maximo)}</td><td>${money(r.costo)}</td><td><span class="status ${r.alerta==='NEGATIVO'?'danger':r.alerta==='CRITICO'?'warn':'muted'}">${esc(r.alerta)}</span></td></tr>`).join(''):'<tr><td colspan="8" class="empty">No hay alertas para el filtro actual.</td></tr>';
 }catch(e){if($('#alertsBody'))$('#alertsBody').innerHTML=`<tr><td colspan="8" class="empty">${esc(e.message)}</td></tr>`}
}
$('#invWarehouse')?.addEventListener('change',()=>{loadInventory();loadAlerts()});
$('#reconWarehouse')?.addEventListener('change',()=>{if($('#reconMaterialCode').value)selectReconciliationMaterial($('#reconMaterialCode').value);loadAlerts()});
$('#reconMaterialSearch')?.addEventListener('input',async e=>{
 const text=e.target.value.trim(),box=$('#reconSuggestions');$('#reconMaterialCode').value='';$('#reconCurrentStock').value='—';
 if(text.length<2){box.classList.add('hidden');box.innerHTML='';return}
 try{const rows=await api('/api/materials?search='+encodeURIComponent(text)+'&warehouse='+encodeURIComponent($('#reconWarehouse').value||'')+'&limit=25');box.innerHTML=rows.length?rows.slice(0,20).map(m=>`<button type="button" class="product-suggestion" data-code="${esc(m.codigo)}"><strong>${esc(m.descripcion)}</strong><small>${esc(m.codigo)} · Stock: ${num(m.stock)} · ${esc(m.unidad||'')}</small></button>`).join(''):'<div class="product-search-empty">No se encontró en el Maestro.</div>';box.classList.remove('hidden');box.querySelectorAll('[data-code]').forEach(b=>b.addEventListener('mousedown',ev=>{ev.preventDefault();selectReconciliationMaterial(b.dataset.code)}))}
 catch(err){box.classList.add('hidden')}
});
async function selectReconciliationMaterial(code){
 try{const wh=$('#reconWarehouse').value;const rows=await api('/api/materials?search='+encodeURIComponent(code)+'&warehouse='+encodeURIComponent(wh)+'&limit=20');const m=rows.find(x=>String(x.codigo).toLowerCase()===String(code).toLowerCase()||String(x.codigo_anterior||'').toLowerCase()===String(code).toLowerCase())||rows[0];if(!m)throw new Error('Material no encontrado');$('#reconMaterialCode').value=m.codigo;$('#reconMaterialSearch').value=`${m.codigo} — ${m.descripcion}`;$('#reconCurrentStock').value=num(m.stock);$('#reconCounted').value=String(Number(m.stock||0));$('#reconSuggestions').classList.add('hidden')}
 catch(e){$('#reconResult').textContent=e.message}
}
$('#reconciliationForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const codigo=$('#reconMaterialCode').value,almacen=$('#reconWarehouse').value,cantidad_contada=Number($('#reconCounted').value),observacion=$('#reconReason').value.trim();
 if(!codigo)return alert('Selecciona el material desde las sugerencias del Maestro.');
 if(!Number.isFinite(cantidad_contada)||cantidad_contada<0)return alert('La cantidad física debe ser 0 o mayor.');
 if(!confirm(`¿Registrar el conteo físico de ${codigo} con ${cantidad_contada} unidades?`))return;
 try{const r=await api('/api/inventory/count',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({codigo,almacen,cantidad_contada,observacion})});$('#reconResult').textContent=`Conciliación registrada: ${r.codigo} · ${r.almacen} · antes ${num(r.stock_anterior)} · contado ${num(r.stock_contado)} · diferencia ${num(r.diferencia)}.`;$('#reconCurrentStock').value=num(r.stock_contado);await Promise.all([loadAlerts(),loadDash(),loadInventory()])}
 catch(err){$('#reconResult').textContent='No se pudo registrar: '+err.message}
});
$('#policyForm')?.addEventListener('submit',async e=>{e.preventDefault();try{const r=await api('/api/inventory/policies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({warehouse:$('#policyWarehouse').value,codigo:$('#policyCode').value.trim(),stock_minimo:$('#policyMinimum').value,stock_maximo:$('#policyMaximum').value})});$('#policyStatus').textContent='Política guardada para el almacén y material seleccionados.';await Promise.all([loadAlerts(),loadDash(),loadInventory()])}catch(err){$('#policyStatus').textContent='Error: '+err.message;alert(err.message)}});
$('#transferForm')?.addEventListener('submit',async e=>{
 e.preventDefault();try{const m=await resolveProduct($('#transferCode').value,$('#transferOrigin').value);if(!m)throw new Error('Material no encontrado. Usa un código del Maestro.');const payload={origen:$('#transferOrigin').value,destino:$('#transferDestination').value,codigo:m.codigo,cantidad:Number($('#transferQuantity').value),observacion:$('#transferObservation').value.trim()};const r=await api('/api/transfers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});$('#transferStatus').textContent=`Transferencia ${r.numero} registrada: ${r.cantidad} ${m.unidad||''} de ${r.origen} a ${r.destino}. Valor transferido ${money(r.valor)}.`;$('#transferForm').reset();await Promise.all([loadTransfers(),loadDash(),loadInventory(),loadAlerts()])}
 catch(err){$('#transferStatus').textContent='No se registró la transferencia: '+err.message;alert(err.message)}
});
async function loadTransfers(){
 if(!$('#transfersBody'))return;const search=$('#transferSearch')?.value||'';
 try{const rows=await api('/api/transfers?search='+encodeURIComponent(search));$('#transfersBody').innerHTML=rows.length?rows.map(r=>`<tr><td>${esc(formatReportDate(r.fecha))}</td><td><b>${esc(r.numero)}</b></td><td>${esc(r.origen||'—')}</td><td>${esc(r.destino||'—')}</td><td>${esc(r.codigo||'')}</td><td>${esc(r.material||'')}</td><td>${num(r.cantidad)}</td><td>${money(r.costo_unitario)}</td><td>${money(r.valor)}</td><td>${esc(r.usuario||'')}</td></tr>`).join(''):'<tr><td colspan="10" class="empty">No hay transferencias registradas.</td></tr>'}
 catch(e){$('#transfersBody').innerHTML=`<tr><td colspan="10" class="empty">${esc(e.message)}</td></tr>`}
}
async function loadAudit(){if(!$('#auditBody'))return;try{const rows=await api('/api/audit?search='+encodeURIComponent($('#auditSearch')?.value||''));$('#auditBody').innerHTML=rows.length?rows.map(r=>`<tr><td>${esc(formatReportDate(r.fecha))}</td><td>${esc(r.usuario||'')}</td><td>${esc(r.accion||'')}</td><td>${esc(r.entidad||'')}</td><td>${esc(r.entidad_id||'')}</td><td><code>${esc(JSON.stringify(r.detalle||{}))}</code></td></tr>`).join(''):'<tr><td colspan="6" class="empty">No hay eventos de auditoría.</td></tr>'}catch(e){$('#auditBody').innerHTML=`<tr><td colspan="6" class="empty">${esc(e.message)}</td></tr>`}}
async function loadStockAlertsReport(){
 if(!$('#stockAlertsReportBody'))return;
 const warehouse=$('#stockAlertsReportWarehouse')?.value||'';
 $('#stockAlertsReportSummary').textContent='Consultando inventario y políticas de stock…';
 try{const rows=await api('/api/reports/stock-alerts'+(warehouse?'?warehouse='+encodeURIComponent(warehouse):''));$('#stockAlertsReportSummary').textContent=`${num(rows.length)} posiciones de inventario consultadas. El valor se calcula con stock por costo promedio o costo de referencia.`;$('#stockAlertsReportBody').innerHTML=rows.length?rows.map(r=>`<tr><td>${esc(r.almacen)}</td><td><b>${esc(r.codigo)}</b></td><td>${esc(r.material)}</td><td>${esc(r.unidad||'—')}</td><td class="${Number(r.stock)<0?'dangertext':''}">${num(r.stock)}</td><td>${num(r.minimo)}</td><td>${num(r.maximo)}</td><td>${money(r.costo)}</td><td>${money(r.valor)}</td><td><span class="status ${r.alerta==='NEGATIVO'?'danger':r.alerta==='CRITICO'?'warn':'muted'}">${esc(r.alerta)}</span></td></tr>`).join(''):'<tr><td colspan="10" class="empty">No hay posiciones registradas para este filtro.</td></tr>'}
 catch(e){$('#stockAlertsReportSummary').textContent='Error al consultar: '+e.message;$('#stockAlertsReportBody').innerHTML=`<tr><td colspan="10" class="empty">${esc(e.message)}</td></tr>`}
}
function downloadStockAlertsReport(format){const wh=$('#stockAlertsReportWarehouse')?.value||'';window.location='/api/reports/stock-alerts.'+format+(wh?'?warehouse='+encodeURIComponent(wh):'')}
$('#stockAlertsReportForm')?.addEventListener('submit',e=>{e.preventDefault();loadStockAlertsReport()});
$('#stockAlertsReportWarehouse')?.addEventListener('change',()=>loadStockAlertsReport());
$('#auditSearch')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();loadAudit()}});

$('#scheduleFrequency')?.addEventListener('change',()=>$('#scheduleDayWrap')?.classList.toggle('hidden',$('#scheduleFrequency').value!=='WEEKLY'));
async function loadSchedules(){
 if(!$('#schedulesBody'))return;
 try{
  const [schedules,runs]=await Promise.all([api('/api/report-schedules'),api('/api/report-runs')]);
  const labels={'daily-costs':'Costos diarios','stock-alerts':'Inventario y alertas','daily-close':'Cierre diario','consumption':'Consumo por trabajador/CeCo'};
  const days=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  $('#schedulesBody').innerHTML=schedules.length?schedules.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(labels[s.report_type]||s.report_type)}</td><td>${s.frequency==='WEEKLY'?'Semanal · '+days[Number(s.day_of_week)||0]:'Diario'}</td><td>${esc(s.run_time)}</td><td>${esc(s.almacen||'Todos')}</td><td><span class="status ${s.active?'ok':'muted'}">${s.active?'ACTIVO':'PAUSADO'}</span></td><td>${esc(s.ultima_ejecucion?formatReportDate(s.ultima_ejecucion):'Pendiente')}</td><td>${esc(s.ultimo_estado||'Pendiente')}</td><td><button type="button" class="secondary" onclick="toggleReportSchedule(${Number(s.id)},${s.active?'false':'true'})">${s.active?'Pausar':'Activar'}</button></td></tr>`).join(''):'<tr><td colspan="9" class="empty">No hay programaciones creadas.</td></tr>';
  $('#reportRunsBody').innerHTML=runs.length?runs.map(r=>`<tr><td>${esc(formatReportDate(r.generated_at))}</td><td>${esc(r.schedule_name)}</td><td>${esc(labels[r.report_type]||r.report_type)}</td><td>${num(r.row_count)}</td><td><span class="status ${r.status==='OK'?'ok':'danger'}">${esc(r.status)}</span></td><td>${esc(r.error||'—')}</td><td>${r.status==='OK'?`<button type="button" class="secondary" onclick="downloadScheduledRun(${Number(r.id)},'xlsx')">Excel</button> <button type="button" class="secondary" onclick="downloadScheduledRun(${Number(r.id)},'csv')">CSV</button>`:'—'}</td></tr>`).join(''):'<tr><td colspan="7" class="empty">Todavía no hay ejecuciones.</td></tr>';
  $('#scheduleStatus').textContent=`${schedules.length} programaciones · ${runs.length} ejecuciones recientes. Horario de referencia: America/Lima.`;
 }catch(e){$('#scheduleStatus').textContent='No se pudo consultar programación: '+e.message}
}
$('#scheduleReportForm')?.addEventListener('submit',async e=>{
 e.preventDefault();try{
  const body={name:$('#scheduleName').value.trim(),report_type:$('#scheduleType').value,frequency:$('#scheduleFrequency').value,day_of_week:$('#scheduleFrequency').value==='WEEKLY'?Number($('#scheduleDay').value):null,run_time:$('#scheduleTime').value,warehouse:$('#scheduleWarehouse').value||null};
  await api('/api/report-schedules',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});$('#scheduleStatus').textContent='Programación guardada. Se ejecutará automáticamente en el horario elegido.';$('#scheduleName').value='';await loadSchedules();
 }catch(err){$('#scheduleStatus').textContent='No se pudo guardar: '+err.message;alert(err.message)}
});
async function toggleReportSchedule(id,active){try{await api('/api/report-schedules/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({active})});await loadSchedules()}catch(e){alert(e.message)}}
function downloadScheduledRun(id,format){window.location='/api/report-runs/'+id+'.'+format}
