# SILOG 1.8.0 — Préstamos temporales

## Flujo operativo

1. Abre **Préstamos** y selecciona el almacén.
2. Ingresa el DNI; si existe en Personal, SILOG completa el nombre.
3. Selecciona una o más personas con rol ADMIN o SUPERVISOR como responsables.
4. Define fecha/hora de entrega y límite de devolución. El flujo normal debe ser del mismo día, entre 06:00 y 18:00, hora de Lima.
5. Busca materiales por código o descripción. El listado se limita a materiales que tienen registro en el almacén seleccionado.
6. Opcionalmente toma/sube una foto; la aplicación la comprime antes de almacenarla en PostgreSQL.
7. Registra el préstamo. El stock se descuenta temporalmente y queda un movimiento de tipo OUT con condición PRESTAMO.
8. Al devolver, ingresa la cantidad de cada línea. Se permite devolución parcial.
9. Los artículos en estado BUENO se reincorporan al stock. Los devueltos como DAÑADO o INCOMPLETO se registran como devueltos pero no se reincorporan al stock utilizable; se registra la baja valorizada correspondiente.
10. Los préstamos vencidos generan alertas en el módulo y un contador en el menú. Las alertas se actualizan cada minuto mientras SILOG está abierto.

## Extensión excepcional

Solo ADMIN o SUPERVISOR puede extender un plazo. La extensión exige motivo, se limita a un día adicional y se registra en `material_loan_deadline_changes` y en `audit_log`.

## Reportes

El reporte del módulo permite filtrar por fechas, almacén y búsqueda, y descargar CSV o Excel. El valor prestado y el valor pendiente se reportan por separado. Los préstamos temporales y las devoluciones no se cuentan como consumo definitivo en el Dashboard ni en el reporte de costos diarios. Las bajas por material dañado/incompleto sí cuentan como costo.

## Tablas añadidas

- `material_loans`
- `material_loan_items`
- `material_loan_supervisors`
- `material_loan_returns`
- `material_loan_deadline_changes`

El esquema se aplica mediante `CREATE TABLE IF NOT EXISTS`; no se elimina ni recrea la base de datos.
