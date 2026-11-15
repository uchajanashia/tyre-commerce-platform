-- Register capabilities only. Do not grant new privileges to staff roles.
INSERT INTO "Permission" ("id", "key", "description") VALUES
  ('perm-orders-read', 'orders.read', 'Read order snapshots and totals'),
  ('perm-payments-read', 'payments.read', 'Read payment attempts without credentials'),
  ('perm-order-contacts-read', 'orders.contacts.read', 'Read audited order contact snapshots'),
  ('perm-inventory-read', 'inventory.read', 'Read catalog stock quantities')
ON CONFLICT ("key") DO NOTHING;
