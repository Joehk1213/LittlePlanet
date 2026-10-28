'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationDirectory = path.join(__dirname, '..', 'supabase', 'migrations');
const idempotencyMigration = fs.readFileSync(
  path.join(migrationDirectory, '20261029000100_inventory_idempotency_deadline.sql'),
  'utf8'
);
const tieredCheckoutMigration = fs.readFileSync(
  path.join(migrationDirectory, '20261022000400_tiered_pricing_and_review_moderation.sql'),
  'utf8'
);

test('checkout migration adds phone-scoped idempotency and serializes repeated requests', () => {
  assert.match(idempotencyMigration, /ADD COLUMN IF NOT EXISTS idempotency_key text/i);
  assert.match(
    idempotencyMigration,
    /CREATE UNIQUE INDEX IF NOT EXISTS orders_phone_idem_key[\s\S]*?ON public\.orders \(customer_phone, idempotency_key\)[\s\S]*?WHERE idempotency_key IS NOT NULL/i
  );
  assert.match(idempotencyMigration, /pg_advisory_xact_lock/);
  assert.match(idempotencyMigration, /WHERE customer_phone = p_customer_phone[\s\S]*?AND idempotency_key = v_idempotency_key/);
  assert.match(idempotencyMigration, /public\.create_customer_order\([\s\S]*?p_shipping_address\s*\)/);
});

test('checkout keeps inventory locking and deadline checks in the existing transaction', () => {
  assert.match(tieredCheckoutMigration, /preorder_deadline <= now\(\)/);
  assert.match(tieredCheckoutMigration, /FOR UPDATE/);
  assert.match(
    tieredCheckoutMigration,
    /SET stock = p\.stock - \(v_item->>'quantity'\)::integer/
  );
  assert.match(idempotencyMigration, /preorder_deadline <= now\(\)/);
  assert.match(idempotencyMigration, /RAISE EXCEPTION 'PREORDER_DEADLINE_PASSED'/);
});

test('idempotent checkout RPC remains service-role-only', () => {
  assert.match(
    idempotencyMigration,
    /REVOKE ALL ON FUNCTION public\.create_customer_order\(text, jsonb, text, text, text, text\)[\s\S]*?FROM PUBLIC, anon, authenticated/
  );
  assert.match(
    idempotencyMigration,
    /GRANT EXECUTE ON FUNCTION public\.create_customer_order\(text, jsonb, text, text, text, text\)[\s\S]*?TO service_role/
  );
  assert.doesNotMatch(
    idempotencyMigration,
    /GRANT EXECUTE ON FUNCTION public\.create_customer_order\([^;]+ TO (?:anon|authenticated)/i
  );
});
