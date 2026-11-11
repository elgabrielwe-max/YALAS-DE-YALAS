# SILOG 1.8.0

Sistema Integral de Gestión Logística sobre Node.js + Express + PostgreSQL.

## Cambios principales
- Salidas con búsqueda inteligente de materiales por palabra clave, descripción o código.
- Cantidad de salida obligatoria: entero de 1 o más. La salida descuenta automáticamente del stock; la cantidad histórica mostrada en DATA es positiva.
- Al seleccionar un material se muestran unidad, stock y costo promedio.
- Alerta visual cuando un material no tiene costo valorizado (S/ 0.00); la salida puede registrarse para corregir el costo posteriormente.
- Cliente de salidas fijado a `MINERA CHINALCO PERU S.A.A.`.
- Área editable.
- Campo Placa / códigos de productos, autocompletado con los códigos de los materiales seleccionados.
- Dos fechas en ingresos y salidas: Fecha de atención (editable, solo fecha) y Fecha de digitación (bloqueada y fijada automáticamente al día real de registro en zona horaria America/Lima).
- DATA cargada muestra fecha de atención y fecha de digitación; la exportación mantiene el formato DATA operativo original.
- Dashboard con consultas tolerantes a errores y actualización periódica.
- Gestión de usuarios con roles: ADMIN, SUPERVISOR, ALMACEN, OPERADOR y CONSULTA.
- Migración automática de las nuevas columnas de fechas en PostgreSQL sin borrar datos existentes.

## Datos incluidos
El paquete conserva el seed generado desde el Excel original y permite sincronizarlo al PostgreSQL al iniciar:
- 7,454 materiales
- 2,812 movimientos históricos
- 310 movimientos de inventario inicial
- 351 personas
- 152 centros de costo

## Despliegue
No eliminar `.git`, no cambiar `DATABASE_URL` y no borrar PostgreSQL. Reemplazar el contenido del proyecto, hacer commit/push y dejar que Railway despliegue.


## Acceso inicial SILOG 1.1.12
Si la base no tiene usuarios, SILOG crea automáticamente el usuario inicial:
- Usuario: `admin`
- Contraseña temporal: `Admin1234!`
- Rol: `ADMIN`

Cambiar esta contraseña inmediatamente desde **Usuarios**. Los accesos usan sesiones HttpOnly y las operaciones quedan asociadas al usuario autenticado.


## 1.1.12
- Corrige la valorización del inventario inicial usando `data/initial_costs.json`, derivado de INV INICIAL y cruzado a los códigos nuevos de Maestra.
- Reconstruye saldos para que las salidas históricas descuenten correctamente el inventario inicial.


## SILOG 1.1.15
- Salidas: cantidad mínima 1 y sin máximo basado en stock.
- Costos: fallback robusto al costo del inventario inicial cuando el almacén no tiene costo promedio positivo.


## SILOG 1.3.0 — Inventario por almacén + escáner móvil

- Nuevo almacén automático: `PLANTA PILOTO`.
- El inventario se mantiene por combinación `almacén + material`.
- El escáner móvil identifica el material contra el Maestro cargado.
- El conteo físico desde el iPhone permite establecer el stock exacto del almacén seleccionado.
- Los demás almacenes no se modifican.
- Las diferencias de conteo quedan registradas como movimientos y en auditoría.


## SILOG 1.4.0 — Inventario por almacén y escáner iPhone
- Inventario separado por almacén.
- Materiales de Salidas filtrados únicamente por carga/stock del almacén seleccionado.
- Modo de carga física: seleccionar material del Maestro, escanear sus códigos y guardar el conteo.
- Asociación automática de códigos de barras nuevos al material seleccionado.
- Salidas por escaneo validadas contra el stock del almacén.
- Nuevo almacén PLANTA PILOTO asegurado durante la inicialización.


## SILOG 1.5.5 — Recuperación del Maestro y carga por almacén

- Corrige las variables de filtro de `/api/materials` que provocaban error en Maestro e Inventario.
- Conserva el Maestro sincronizado desde `data/seed.json`; no se requiere borrar ni recrear PostgreSQL.
- Inventario: selecciona almacén y filtra las posiciones cargadas en ese almacén. Para incorporar otro material, usa **Cargar por escaneo**, búscalo en el Maestro, escribe la cantidad física y guarda.
- El código de barras es opcional. Cuando se usa, puede asociarse al material elegido; varias lecturas del mismo código suman cantidad, pero la asociación del código se guarda una sola vez.
- Cada carga actualiza solo la combinación almacén + material, registra el movimiento de diferencia y genera auditoría.
- Salidas: la búsqueda muestra únicamente materiales con stock positivo en el almacén seleccionado. El escáner valida el almacén y agrega automáticamente el producto a la salida; el servidor rechaza cantidades superiores al stock.
- Se conserva el inventario de otros almacenes y el historial existente. No borres ni recrees la base de datos al desplegar esta versión.

### Despliegue recomendado
1. Haz una copia de seguridad de PostgreSQL en Railway.
2. Reemplaza los archivos del repositorio por esta versión, conservando la conexión `DATABASE_URL`.
3. Commit y Push a GitHub Desktop; espera el despliegue de Railway.
4. Verifica `/api/health`, Maestro de materiales, Inventario y Salidas.
5. En el navegador haz una recarga completa. En iPhone, cierra y vuelve a abrir SILOG para que se actualice la PWA.


## Reporte de últimos materiales agregados (1.5.4)
En **Descargar recursos** se incorporó un reporte basado en `inventory_movements` con filtros por fecha de registro, almacén, tipo y búsqueda. Muestra fecha/hora, usuario, almacén, código actual/anterior, descripción del Maestro, cantidad, unidad, costo unitario, valor total, origen, documento, observación y stock posterior. Permite exportar el resultado filtrado a CSV (compatible con Excel) o XLSX. Los endpoints son `/api/resources-report`, `/api/resources-report.csv` y `/api/resources-report.xlsx`; requieren sesión autenticada.


## Personal de Minera Chinalco (v1.5.4)

La primera puesta en marcha importa una sola vez el personal de la hoja `14-09-2026` del archivo de estatus entregado. Se cargan DNI, nombres, cargo y cliente `MINERA CHINALCO PERU S.A.A.`; el área queda vacía. La importación es idempotente y no vuelve a sobrescribir áreas que se completen posteriormente. El listado de Personal admite hasta 1000 registros y búsqueda por DNI, nombre, cargo o cliente.


## Kardex por trabajador (1.5.5)
- Nuevo apartado en navegación para consultar salidas por DNI, fechas y almacén.
- Muestra cantidades, costos, totales, documento, responsables y usuario de registro.
- Exporta CSV y Excel; requiere sesión iniciada.


## Kardex por trabajador (v1.5.5)
- Apartado Kardex por trabajador con búsqueda por DNI y filtros por fecha de atención y almacén.
- Detalle de salidas: material, código, cantidad, costo unitario, valor total, documento, área/CeCo, entregado, autorizado y usuario SILOG.
- Totales de líneas, unidades y valor entregado.
- Exportación a CSV y Excel.
- El reporte consulta movimientos OUT existentes; no altera saldos ni crea movimientos.


## SILOG 1.6.0 — Dashboard gerencial y reportes valorizados

Esta versión conserva el Maestro, el inventario por almacén, el escáner iPhone, las salidas, el Kardex por trabajador y los reportes anteriores. Añade: 

- Dashboard: costos diarios de salidas por almacén (últimos 14 días), comparativo de salidas valorizadas por almacén en el mes, evolución mensual, valor por grupo y top 10 de materiales por costo de consumo.
- Reporte de costos diarios: filtros de fechas y almacén, detalle por material, cantidad, costo unitario promedio y valor total; exportación CSV/Excel.
- Kardex valorizado por material: filtro por código/código anterior/descripción, rango de fechas y almacén; saldo acumulado por movimiento y exportación CSV/Excel.
- Consumo por trabajador y centro de costo: filtros por DNI, fecha, almacén y centro de costo; exportación CSV/Excel.
- Cierre diario: existencias calculadas a la fecha de corte, valor de referencia, stock negativo/crítico y resumen de ingresos/salidas del día; exportación CSV/Excel.
- Impresión de tablas para guardar como PDF desde el navegador.

Los reportes consultan movimientos existentes y no modifican el inventario. Los cierres históricos reconstruyen cantidades desde el historial de movimientos; la valorización usa el costo promedio actual o costo de referencia guardado, porque el sistema no conserva una fotografía histórica del costo promedio por fecha. La verificación automatizada valida sintaxis y presencia de rutas/UI; antes de utilizarlo para cierre contable, confirma los resultados con tus datos reales de Railway.

### Instalación

1. Haz una copia de seguridad del repositorio y confirma que no modificarás `.git`.
2. Descomprime este paquete y copia el contenido al repositorio existente, conservando `.git`.
3. Revisa los cambios en GitHub Desktop, crea un commit y pulsa Push origin.
4. Espera el despliegue de Railway y valida `/api/health`.
5. Abre SILOG y fuerza una recarga (`Ctrl+F5`). No borres ni recrees PostgreSQL.


## SILOG 1.6.1 — correcciones operativas

- Corregida la consulta mensual del dashboard: la serie de meses se une correctamente con los agregados de ingresos y salidas.
- Los movimientos de vaciado/regularización quedan identificados con `condicion = VACIADO_ALMACEN` y no inflan los indicadores de consumo operativo.
- Ingreso de materiales: se captura RUC de proveedor (11 dígitos si se indica) y razón social.
- Personal: importación de XLSX/XLS/CSV con columnas DNI y NOMBRES; CARGO, CLIENTE y AREA son opcionales. Actualiza por DNI y registra auditoría.
- Inventario: vaciado controlado por almacén mediante movimientos de regularización; conserva Maestro e historial, y requiere escribir `VACIAR`.

La operación de vaciado es transaccional: si falla algún movimiento, se revierte todo el proceso. Nunca borra las filas históricas de movimientos.


## SILOG 1.8.0 — Control integral y diagnóstico

- Dashboard filtrable por almacén. Los errores de consultas se muestran en pantalla en lugar de ocultarse como gráficos vacíos.
- Diagnóstico de integridad: compara saldo en `inventory_balances` con el ledger de `inventory_movements`, cuenta stock positivo sin costo y movimientos huérfanos.
- Transferencias transaccionales entre almacenes: origen OUT y destino IN con mismo número de transferencia, costo transferido, actualización de ambos saldos y auditoría. Las transferencias no cuentan como consumo operativo.
- Conciliación física en pantalla dedicada y desde escáner: registra la diferencia mediante movimiento y auditoría.
- Política de stock mínimo/máximo por almacén y material, alertas de stock negativo, crítico, sin costo y sobrestock.
- Reporte descargable de inventario valorizado y alertas (CSV, XLSX e impresión/PDF).
- Presupuesto mensual por almacén, comparado con las salidas valorizadas del mes.
- Vista de auditoría para ADMIN.
- Programación diaria/semanal de reportes en horario America/Lima; los reportes se generan en el servidor, se guardan en PostgreSQL y se pueden descargar desde el historial en Excel/CSV. No envía correo hasta configurar SMTP.
- Migración aditiva: nuevas tablas de políticas por almacén y presupuestos mensuales. No se borran Maestro, saldos ni movimientos existentes.

### Validación recomendada tras el despliegue
1. Revisar `/api/health` y abrir Dashboard.
2. Verificar si `Estado de integridad de datos` informa saldos distintos al Kardex. Si hay diferencias, no usar el cierre como dato contable hasta reconciliar.
3. Hacer una transferencia de prueba con un material y cantidad pequeña entre dos almacenes con stock suficiente; comprobar origen, destino, Kardex y auditoría.
4. Registrar un mínimo por almacén y confirmar que la alerta aparece.
5. Guardar presupuesto mensual y comprobar consumo frente a presupuesto.
6. Exportar inventario valorizado y costos diarios; verificar las cifras contra registros conocidos.

Las pruebas automáticas de este paquete verifican sintaxis y contratos estáticos de rutas/UI. No sustituyen una prueba conectada a la instancia real de PostgreSQL de Railway.


## SILOG 1.8.0 — Préstamos temporales

- Módulo independiente para préstamos por trabajador, almacén y supervisores responsables.
- Ventana operativa de entrega/devolución de 06:00 a 18:00 (hora de Lima) y plazo de un solo día.
- Descuento temporal de stock al entregar y reposición al devolver; devoluciones parciales admitidas.
- Alertas por vencimiento y exportación de reporte de préstamos a CSV/Excel.
- Evidencia fotográfica opcional desde el celular, comprimida y guardada en PostgreSQL.
- Material devuelto en estado dañado/incompleto queda fuera del stock utilizable y genera un movimiento de baja valorizado.
- Las salidas por préstamo y las devoluciones no se cuentan como consumo definitivo en los costos gerenciales; las bajas por daño sí.


## SILOG 1.8.1 — Interfaz profesional

- Ajustes visuales consistentes para navegación, formularios, tablas, paneles, indicadores y ventanas de diálogo.
- Eliminación de iconografía emoji decorativa en etiquetas de navegación y acciones visibles para una presentación corporativa.
- Mejoras de enfoque accesible, estados deshabilitados, lectura numérica y adaptación a pantallas pequeñas.
- No introduce migraciones ni cambios de esquema de base de datos.


## SILOG 1.8.3 — Maestro completo
- El listado del Maestro permite consultar hasta 10,000 registros por consulta (la base incluida contiene 7,454 materiales).
- Se agregó el formulario **Registrar nuevo material**, disponible para ADMIN y SUPERVISOR.
- Los materiales nuevos se crean sin stock; para usarlos en Salidas primero se debe registrar su ingreso al almacén.
- La creación valida códigos duplicados y registra auditoría. No borra ni modifica los materiales existentes.


### SILOG 1.8.3 — Diseño ejecutivo

Renovación visual del dashboard con cabecera gráfica, jerarquía de indicadores, paleta corporativa, gráficos y barras con mayor contraste, paneles y navegación refinados, y ajustes responsive. No modifica la estructura de datos ni elimina registros.


## SILOG 1.8.4 — ERP empresarial
- Identidad visual empresarial más sobria: navegación, tablas, formularios, paneles, alertas y controles con jerarquía tipográfica y contraste consistentes.
- Dashboard con bloque de accesos rápidos para ingresos, salidas, inventario y préstamos, usando los módulos existentes.
- Indicador contextual de alertas de préstamos en el acceso rápido cuando hay alertas cargadas.
- Navegación activa expone `aria-current` para mejorar orientación y accesibilidad.
- No se agregan migraciones ni operaciones destructivas de base de datos; se mantienen los módulos y rutas existentes.

### Despliegue seguro
1. Realiza un respaldo de PostgreSQL en Railway.
2. Sube el contenido del ZIP a tu repositorio sin cambiar `DATABASE_URL`.
3. Espera el despliegue y comprueba `/api/health`, dashboard, Maestro, Ingresos, Salidas, Inventario y Préstamos.
4. Recarga el navegador completamente para actualizar CSS, JavaScript y PWA.


## SILOG 1.8.5 — Corrección de registro de materiales
- Corrige el error de PostgreSQL `could not determine data type of parameter $2` al validar el código anterior opcional, usando un tipo `text` explícito.
- No requiere migraciones ni cambios en la base de datos.
- Conserva el diseño ERP empresarial y las funciones incluidas en 1.8.4.


## Versión 1.8.7 — Catálogo para ingresos y Kits
- Se incorpora una búsqueda dedicada del Maestro que devuelve materiales activos incluso cuando no tienen stock en el almacén seleccionado.
- El módulo Kits permite definir kits con componentes del Maestro, armar unidades por almacén descontando los componentes con movimientos auditables y registrar salidas de kits existentes.
- El esquema agrega tablas de kits de forma no destructiva; no elimina materiales, almacenes, movimientos ni saldos previos.


## Corrección 1.8.7 — Salidas e inventario por almacén
La búsqueda de materiales en Salidas consulta el endpoint de inventario por almacén y muestra únicamente materiales con saldo positivo. Los errores de consulta ahora se muestran en pantalla en lugar de ocultarse.
