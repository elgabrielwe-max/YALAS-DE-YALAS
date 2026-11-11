# Roadmap SILOG

## Fase 1 — Fundación
Auth, roles, dashboard, PostgreSQL, Railway, maestro.

## Fase 2 — Inventario
Almacenes, ubicaciones, entradas, salidas, transferencias, kardex valorizado.

## Fase 3 — Abastecimiento
Solicitudes, aprobaciones, proveedores, cotizaciones, órdenes de compra y recepción.

## Fase 4 — Inteligencia
ABC, rotación, stock crítico, proyección, presupuesto, consumo por área/centro de costo y reportes Excel.

## Fase 5 — Operación móvil
QR, recepción/salida desde celular, conteos cíclicos y trazabilidad avanzada.


## Entregado en SILOG 1.7.0
- Filtro de Dashboard por almacén y visibilidad de errores de consulta.
- Diagnóstico de saldos vs. movimientos, posiciones sin costo y movimientos huérfanos.
- Transferencias transaccionales entre almacenes con auditoría.
- Conciliación física y políticas de stock mínimo/máximo por almacén.
- Reporte de inventario valorizado y alertas descargable.
- Presupuesto mensual por almacén.
- Programación diaria/semanal de reportes con ejecuciones almacenadas en PostgreSQL.
- Auditoría consultable para administradores.

Pendiente para una futura integración: envío de reportes por correo (requiere SMTP/servicio de correo configurado), prueba integral en la instancia productiva y validación contable de costos históricos.
