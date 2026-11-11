# SILOG 1.5.4 — Reporte de últimos materiales agregados

## Qué incorpora
- Reporte en **Descargar recursos** basado en los movimientos realmente guardados.
- Filtros por fechas de registro, almacén, tipo de movimiento y búsqueda por código/descripción/usuario/documento.
- Columnas: fecha/hora, almacén, código actual/anterior, descripción del Maestro, tipo, cantidad, unidad, costo unitario, valor total, stock después, usuario, documento y observación.
- Descarga en Excel (`.xlsx`) o CSV con separador punto y coma y BOM UTF-8 para abrirlo en Excel.
- El reporte requiere sesión autenticada y no cambia los datos de inventario.

## Instalación
1. Conserva una copia de seguridad del repositorio.
2. Sustituye los archivos del proyecto por los de esta versión manteniendo `.git` en el repositorio local.
3. Ejecuta `npm test`.
4. Haz commit y push a GitHub para desplegar en Railway.
5. Entra a **Descargar recursos**, elige filtros y presiona **Consultar**.

No se requiere recrear ni borrar PostgreSQL.
