CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS material_groups (id BIGSERIAL PRIMARY KEY, codigo TEXT UNIQUE NOT NULL, nombre TEXT NOT NULL, activo BOOLEAN DEFAULT TRUE);
CREATE TABLE IF NOT EXISTS material_families (id BIGSERIAL PRIMARY KEY, grupo_id BIGINT REFERENCES material_groups(id), codigo TEXT NOT NULL, nombre TEXT NOT NULL, activo BOOLEAN DEFAULT TRUE, UNIQUE(grupo_id,codigo));
CREATE TABLE IF NOT EXISTS materials (
 id BIGSERIAL PRIMARY KEY, codigo TEXT UNIQUE NOT NULL, codigo_anterior TEXT, grupo_id BIGINT REFERENCES material_groups(id), familia_id BIGINT REFERENCES material_families(id),
 descripcion TEXT NOT NULL, unidad TEXT, subgrupo TEXT, moneda TEXT DEFAULT 'SOL', stock_minimo NUMERIC(18,4) DEFAULT 0, stock_maximo NUMERIC(18,4) DEFAULT 0,
 ubicacion TEXT, costo_referencia NUMERIC(18,6) DEFAULT 0, activo BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cost_centers (id BIGSERIAL PRIMARY KEY, codigo TEXT UNIQUE NOT NULL, minera TEXT, area TEXT, descripcion TEXT, unidad TEXT, proyecto TEXT, contrato TEXT, codigo_sp2 TEXT, contabilidad TEXT, activo BOOLEAN DEFAULT TRUE);
CREATE TABLE IF NOT EXISTS personnel (id BIGSERIAL PRIMARY KEY, dni TEXT UNIQUE, nombre TEXT NOT NULL, cargo TEXT, cliente TEXT, area TEXT, ceco_id BIGINT REFERENCES cost_centers(id), activo BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS warehouses (id BIGSERIAL PRIMARY KEY, codigo TEXT UNIQUE NOT NULL, nombre TEXT UNIQUE NOT NULL, activo BOOLEAN DEFAULT TRUE);
CREATE TABLE IF NOT EXISTS exchange_rates (fecha DATE PRIMARY KEY, precio NUMERIC(18,6));
CREATE TABLE IF NOT EXISTS inventory_balances (
 id BIGSERIAL PRIMARY KEY, warehouse_id BIGINT REFERENCES warehouses(id), material_id BIGINT REFERENCES materials(id), cantidad NUMERIC(18,4) DEFAULT 0,
 costo_promedio NUMERIC(18,6) DEFAULT 0, valor NUMERIC(18,2) DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT now(), UNIQUE(warehouse_id,material_id)
);
CREATE TABLE IF NOT EXISTS inventory_movements (
 id BIGSERIAL PRIMARY KEY, movement_type TEXT NOT NULL CHECK (movement_type IN ('INITIAL','IN','OUT','ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT')),
 fecha TIMESTAMPTZ NOT NULL, fecha_atencion DATE, fecha_digitacion DATE DEFAULT CURRENT_DATE, warehouse_id BIGINT REFERENCES warehouses(id), material_id BIGINT REFERENCES materials(id), cantidad NUMERIC(18,4) NOT NULL CHECK(cantidad >= 0),
 costo_unitario NUMERIC(18,6) DEFAULT 0, valor NUMERIC(18,2) DEFAULT 0, moneda TEXT DEFAULT 'SOL', documento TEXT, numero TEXT, proveedor_ruc TEXT, proveedor TEXT, condicion TEXT,
 ceco_id BIGINT REFERENCES cost_centers(id), cliente TEXT, area TEXT, placa TEXT, dni TEXT, solicitante TEXT, entregado TEXT, autorizado TEXT, observacion TEXT,
 source TEXT DEFAULT 'SILOG', source_key TEXT, created_by TEXT DEFAULT 'SYSTEM', created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
 id BIGSERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, nombre TEXT NOT NULL, rol TEXT NOT NULL DEFAULT 'OPERADOR' CHECK (rol IN ('ADMIN','SUPERVISOR','ALMACEN','OPERADOR','CONSULTA')), password_hash TEXT NOT NULL, activo BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_sessions (
 id BIGSERIAL PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), last_seen TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS material_requests (id BIGSERIAL PRIMARY KEY, fecha TIMESTAMPTZ DEFAULT now(), solicitante_id BIGINT REFERENCES personnel(id), ceco_id BIGINT REFERENCES cost_centers(id), warehouse_id BIGINT REFERENCES warehouses(id), estado TEXT DEFAULT 'PENDIENTE', observacion TEXT, created_by TEXT);
CREATE TABLE IF NOT EXISTS material_request_items (id BIGSERIAL PRIMARY KEY, request_id BIGINT REFERENCES material_requests(id) ON DELETE CASCADE, material_id BIGINT REFERENCES materials(id), cantidad NUMERIC(18,4) NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (id BIGSERIAL PRIMARY KEY, fecha TIMESTAMPTZ DEFAULT now(), usuario TEXT, accion TEXT, entidad TEXT, entidad_id TEXT, detalle JSONB);
CREATE TABLE IF NOT EXISTS material_barcodes (id BIGSERIAL PRIMARY KEY, material_id BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE, barcode TEXT NOT NULL UNIQUE, symbology TEXT DEFAULT 'UNKNOWN', is_primary BOOLEAN DEFAULT FALSE, activo BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now(), created_by TEXT);
CREATE INDEX IF NOT EXISTS idx_material_barcodes_material ON material_barcodes(material_id);
CREATE INDEX IF NOT EXISTS idx_material_barcodes_barcode ON material_barcodes(barcode);

DO $$ BEGIN
  IF to_regclass('public.materials') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='materials' AND column_name='ubicacion') THEN ALTER TABLE materials ADD COLUMN ubicacion TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='materials' AND column_name='costo_referencia') THEN ALTER TABLE materials ADD COLUMN costo_referencia NUMERIC(18,6) DEFAULT 0; END IF;
  END IF;
  IF to_regclass('public.personnel') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='personnel' AND column_name='area') THEN ALTER TABLE personnel ADD COLUMN area TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='personnel' AND column_name='ceco_id') THEN ALTER TABLE personnel ADD COLUMN ceco_id BIGINT; END IF;
  END IF;
  IF to_regclass('public.inventory_movements') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_movements' AND column_name='fecha_atencion') THEN ALTER TABLE inventory_movements ADD COLUMN fecha_atencion DATE; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_movements' AND column_name='fecha_digitacion') THEN ALTER TABLE inventory_movements ADD COLUMN fecha_digitacion DATE DEFAULT CURRENT_DATE; END IF;
    UPDATE inventory_movements SET fecha_atencion=fecha::date WHERE fecha_atencion IS NULL;
    UPDATE inventory_movements SET fecha_digitacion=fecha::date WHERE fecha_digitacion IS NULL;
    ALTER TABLE inventory_movements ALTER COLUMN fecha_atencion SET NOT NULL;
    ALTER TABLE inventory_movements ALTER COLUMN fecha_digitacion SET DEFAULT CURRENT_DATE;
  END IF;
  IF to_regclass('public.inventory_movements') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_movements' AND column_name='source_key') THEN ALTER TABLE inventory_movements ADD COLUMN source_key TEXT; END IF;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.inventory_movements') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_movements' AND column_name='proveedor_ruc') THEN ALTER TABLE inventory_movements ADD COLUMN proveedor_ruc TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_movements' AND column_name='proveedor') THEN ALTER TABLE inventory_movements ADD COLUMN proveedor TEXT; END IF;
    ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;
    ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_movement_type_check CHECK (movement_type IN ('INITIAL','IN','OUT','ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT','CLEAR'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_materials_desc ON materials USING gin (to_tsvector('spanish', coalesce(descripcion,'')));
CREATE INDEX IF NOT EXISTS idx_materials_group ON materials(grupo_id,familia_id);
CREATE INDEX IF NOT EXISTS idx_movements_fecha ON inventory_movements(fecha);
CREATE INDEX IF NOT EXISTS idx_movements_atencion ON inventory_movements(fecha_atencion);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_movements_material ON inventory_movements(material_id);
CREATE INDEX IF NOT EXISTS idx_movements_source_key ON inventory_movements(source_key);

CREATE TABLE IF NOT EXISTS inventory_scan_sessions (
 id UUID PRIMARY KEY,
 warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
 material_id BIGINT NOT NULL REFERENCES materials(id),
 scanned_count NUMERIC(18,4) NOT NULL DEFAULT 0,
 scanned_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
 created_by TEXT,
 created_at TIMESTAMPTZ DEFAULT now(),
 saved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_inventory_scan_sessions_wh_mat ON inventory_scan_sessions(warehouse_id,material_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_negative ON inventory_balances(cantidad) WHERE cantidad < 0;


-- Configuración de stock mínimo por almacén y presupuesto mensual.
CREATE TABLE IF NOT EXISTS warehouse_material_policies (
  id BIGSERIAL PRIMARY KEY,
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  material_id BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  stock_minimo NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  stock_maximo NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (stock_maximo >= 0),
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(warehouse_id, material_id)
);
CREATE INDEX IF NOT EXISTS idx_warehouse_material_policy_wh ON warehouse_material_policies(warehouse_id, stock_minimo);

CREATE TABLE IF NOT EXISTS warehouse_monthly_budgets (
  id BIGSERIAL PRIMARY KEY,
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  period DATE NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(warehouse_id, period)
);
CREATE INDEX IF NOT EXISTS idx_warehouse_monthly_budgets_period ON warehouse_monthly_budgets(period, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_fecha ON audit_log(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_usuario ON audit_log(usuario, fecha DESC);


CREATE TABLE IF NOT EXISTS report_schedules (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('daily-costs','stock-alerts','daily-close','consumption')),
  frequency TEXT NOT NULL DEFAULT 'DAILY' CHECK (frequency IN ('DAILY','WEEKLY')),
  day_of_week SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
  run_time TIME NOT NULL DEFAULT '07:00',
  warehouse_id BIGINT REFERENCES warehouses(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_date DATE,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_report_schedules_due ON report_schedules(active, run_time, last_run_date);

CREATE TABLE IF NOT EXISTS report_runs (
  id BIGSERIAL PRIMARY KEY,
  schedule_id BIGINT REFERENCES report_schedules(id) ON DELETE SET NULL,
  schedule_name TEXT NOT NULL,
  report_type TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT now(),
  period_start DATE,
  period_end DATE,
  row_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OK' CHECK (status IN ('OK','ERROR')),
  error TEXT,
  payload JSONB,
  created_by TEXT DEFAULT 'SCHEDULER'
);
CREATE INDEX IF NOT EXISTS idx_report_runs_schedule_date ON report_runs(schedule_id, generated_at DESC);

-- Préstamos temporales: el material sale del saldo mientras está prestado y vuelve al registrar la devolución.
CREATE SEQUENCE IF NOT EXISTS loan_number_seq;
CREATE TABLE IF NOT EXISTS material_loans (
 id BIGSERIAL PRIMARY KEY,
 numero TEXT UNIQUE NOT NULL,
 warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
 dni TEXT NOT NULL,
 trabajador TEXT NOT NULL,
 issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 due_at TIMESTAMPTZ NOT NULL,
 returned_at TIMESTAMPTZ,
 estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','PARCIAL','DEVUELTO','ANULADO')),
 observacion TEXT,
 evidence_data_url TEXT,
 evidence_filename TEXT,
 created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_material_loans_due ON material_loans(due_at,estado);
CREATE INDEX IF NOT EXISTS idx_material_loans_dni ON material_loans(dni,issued_at DESC);
CREATE TABLE IF NOT EXISTS material_loan_supervisors (
 loan_id BIGINT NOT NULL REFERENCES material_loans(id) ON DELETE CASCADE,
 user_id BIGINT NOT NULL REFERENCES users(id),
 assigned_by TEXT NOT NULL,
 PRIMARY KEY(loan_id,user_id)
);
CREATE TABLE IF NOT EXISTS material_loan_items (
 id BIGSERIAL PRIMARY KEY,
 loan_id BIGINT NOT NULL REFERENCES material_loans(id) ON DELETE CASCADE,
 material_id BIGINT NOT NULL REFERENCES materials(id),
 cantidad NUMERIC(18,4) NOT NULL CHECK(cantidad > 0),
 devuelto NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK(devuelto >= 0),
 costo_unitario NUMERIC(18,6) NOT NULL DEFAULT 0,
 valor NUMERIC(18,2) NOT NULL DEFAULT 0,
 barcode TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(devuelto <= cantidad)
);
CREATE INDEX IF NOT EXISTS idx_material_loan_items_loan ON material_loan_items(loan_id);
CREATE TABLE IF NOT EXISTS material_loan_returns (
 id BIGSERIAL PRIMARY KEY,
 loan_id BIGINT NOT NULL REFERENCES material_loans(id),
 loan_item_id BIGINT NOT NULL REFERENCES material_loan_items(id),
 cantidad NUMERIC(18,4) NOT NULL CHECK(cantidad > 0),
 returned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 estado_material TEXT DEFAULT 'BUENO',
 observacion TEXT,
 created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS material_loan_alerts_ack (
 loan_id BIGINT PRIMARY KEY REFERENCES material_loans(id) ON DELETE CASCADE,
 acknowledged_by TEXT NOT NULL,
 acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 note TEXT
);
CREATE TABLE IF NOT EXISTS material_loan_deadline_changes (
 id BIGSERIAL PRIMARY KEY,
 loan_id BIGINT NOT NULL REFERENCES material_loans(id) ON DELETE CASCADE,
 plazo_anterior TIMESTAMPTZ NOT NULL,
 plazo_nuevo TIMESTAMPTZ NOT NULL,
 motivo TEXT NOT NULL,
 autorizado_por TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loan_deadline_changes_loan ON material_loan_deadline_changes(loan_id,created_at DESC);


-- Módulo de kits logísticos. Tablas nuevas y no destructivas; no modifican el inventario previo.
CREATE TABLE IF NOT EXISTS kits (
 id BIGSERIAL PRIMARY KEY, codigo TEXT UNIQUE NOT NULL, nombre TEXT NOT NULL, descripcion TEXT,
 activo BOOLEAN NOT NULL DEFAULT TRUE, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kit_components (
 id BIGSERIAL PRIMARY KEY, kit_id BIGINT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
 material_id BIGINT NOT NULL REFERENCES materials(id), cantidad NUMERIC(18,4) NOT NULL CHECK(cantidad>0),
 UNIQUE(kit_id,material_id)
);
CREATE TABLE IF NOT EXISTS kit_balances (
 id BIGSERIAL PRIMARY KEY, kit_id BIGINT NOT NULL REFERENCES kits(id), warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
 cantidad NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK(cantidad>=0), costo_promedio NUMERIC(18,6) NOT NULL DEFAULT 0,
 valor NUMERIC(18,2) NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(kit_id,warehouse_id)
);
CREATE TABLE IF NOT EXISTS kit_movements (
 id BIGSERIAL PRIMARY KEY, kit_id BIGINT NOT NULL REFERENCES kits(id), warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
 tipo TEXT NOT NULL CHECK(tipo IN ('ARMADO','SALIDA','AJUSTE')), cantidad NUMERIC(18,4) NOT NULL CHECK(cantidad>0),
 costo_unitario NUMERIC(18,6) NOT NULL DEFAULT 0, valor NUMERIC(18,2) NOT NULL DEFAULT 0,
 observacion TEXT, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kit_balances_warehouse ON kit_balances(warehouse_id,kit_id);
CREATE INDEX IF NOT EXISTS idx_kit_movements_created ON kit_movements(created_at DESC);
