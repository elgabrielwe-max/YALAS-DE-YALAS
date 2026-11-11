# SILOG 1.5.2 — Escáner móvil iPhone

## Qué incluye
- Pantalla `📷 Escáner` dentro de SILOG.
- Cámara del iPhone para códigos 1D/2D mediante ZXing Browser.
- Consulta en tiempo real de material, código actual/anterior, unidad, stock y costo.
- Botón `Agregar a salida` integrado con el formulario de Salidas.
- Si se escanea el mismo producto ya agregado, aumenta la cantidad.
- Linterna cuando el navegador expone el control.
- Asociación de un código de barras físico a un material mediante permisos de ADMIN/SUPERVISOR/ALMACEN.
- PWA instalable desde Safari como acceso en pantalla de inicio.

## Uso en iPhone
1. Publicar esta versión en Railway usando HTTPS.
2. Abrir SILOG en Safari.
3. Iniciar sesión.
4. Entrar a `📷 Escáner`.
5. Elegir almacén y pulsar `Activar cámara`.
6. Dar permiso a Safari para usar la cámara.
7. Apuntar al código.
8. Revisar el material y pulsar `Agregar a salida` si corresponde.
9. Para instalarlo: Safari → Compartir → Añadir a pantalla de inicio.

## Importante
La primera carga necesita conexión para obtener el motor ZXing desde jsDelivr. Las consultas a PostgreSQL y las operaciones de inventario siguen pasando por la API autenticada de SILOG.


### Inventario por almacén (1.3.0)

Selecciona `PLANTA PILOTO` (o cualquier almacén), escanea el código y SILOG resuelve el nombre y datos desde `materials`. En la tarjeta del producto, indica la cantidad física contada y pulsa `Actualizar inventario`. El valor se aplica únicamente al almacén seleccionado; la diferencia se registra como ingreso/salida de conteo físico y queda auditada.


## Carga por almacén (1.5.0)
En Inventario, selecciona un almacén y pulsa Cargar por escaneo. Busca un material del Maestro, escribe la cantidad física y opcionalmente escanea uno o varios códigos. Guarda para actualizar solo ese almacén. En Salidas, selecciona el almacén y escanea; el material se agrega automáticamente si tiene stock suficiente.
