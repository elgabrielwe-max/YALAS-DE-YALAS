import {pool} from './db.js';
export async function initSchema(){await pool.query(`
CREATE TABLE IF NOT EXISTS roles(id SERIAL PRIMARY KEY,name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,full_name TEXT NOT NULL,role_id INT REFERENCES roles(id),active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS material_groups(id SERIAL PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS material_families(id SERIAL PRIMARY KEY,group_id INT REFERENCES material_groups(id),code TEXT NOT NULL,name TEXT NOT NULL,UNIQUE(group_id,code));
CREATE TABLE IF NOT EXISTS units(id SERIAL PRIMARY KEY,code TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS materials(id BIGSERIAL PRIMARY KEY,old_code TEXT,code TEXT UNIQUE NOT NULL,group_id INT REFERENCES material_groups(id),family_id INT REFERENCES material_families(id),description TEXT NOT NULL,unit_id INT REFERENCES units(id),currency TEXT,legacy_group TEXT,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS warehouses(id SERIAL PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,active BOOLEAN DEFAULT TRUE);
CREATE TABLE IF NOT EXISTS locations(id SERIAL PRIMARY KEY,warehouse_id INT REFERENCES warehouses(id),code TEXT NOT NULL,name TEXT NOT NULL,UNIQUE(warehouse_id,code));
CREATE TABLE IF NOT EXISTS inventory_balances(material_id BIGINT REFERENCES materials(id),warehouse_id INT REFERENCES warehouses(id),quantity NUMERIC(18,3) NOT NULL DEFAULT 0,min_stock NUMERIC(18,3) NOT NULL DEFAULT 0,max_stock NUMERIC(18,3),reorder_point NUMERIC(18,3),PRIMARY KEY(material_id,warehouse_id));
CREATE TABLE IF NOT EXISTS inventory_movements(id BIGSERIAL PRIMARY KEY,material_id BIGINT REFERENCES materials(id),warehouse_id INT REFERENCES warehouses(id),movement_type TEXT NOT NULL CHECK(movement_type IN ('IN','OUT','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT')),quantity NUMERIC(18,3) NOT NULL CHECK(quantity>0),unit_cost NUMERIC(18,4),document_no TEXT,area TEXT,notes TEXT,created_by BIGINT REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS material_requests(id BIGSERIAL PRIMARY KEY,request_no TEXT UNIQUE NOT NULL,status TEXT NOT NULL DEFAULT 'DRAFT',requester_id BIGINT REFERENCES users(id),area TEXT,notes TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS material_request_items(id BIGSERIAL PRIMARY KEY,request_id BIGINT REFERENCES material_requests(id) ON DELETE CASCADE,material_id BIGINT REFERENCES materials(id),quantity NUMERIC(18,3) NOT NULL,notes TEXT);
CREATE TABLE IF NOT EXISTS suppliers(id SERIAL PRIMARY KEY,tax_id TEXT UNIQUE,name TEXT NOT NULL,contact TEXT,phone TEXT,email TEXT,active BOOLEAN DEFAULT TRUE,created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_log(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id),action TEXT NOT NULL,entity TEXT,entity_id TEXT,details JSONB,created_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_materials_description ON materials USING gin(to_tsvector('simple',description));
CREATE INDEX IF NOT EXISTS idx_movements_material_date ON inventory_movements(material_id,created_at);
INSERT INTO roles(name) VALUES('MASTER'),('ADMIN_LOGISTICO'),('ALMACEN'),('SOLICITANTE'),('APROBADOR'),('GERENCIA') ON CONFLICT DO NOTHING;
INSERT INTO warehouses(code,name) VALUES('CENTRAL','Almacén Central') ON CONFLICT DO NOTHING;
`);}
