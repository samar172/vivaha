-- Orders can now be raised from the office, not only from the customer portal.
-- The permission matrix is user-editable, so the defaults live in the table and
-- an existing database would never see a new permission unless it is inserted.
-- Only the two roles that book orders get it; anyone else the office wants to
-- grant it to can be ticked in Settings -> Roles & permissions.
INSERT INTO "RolePermission" ("role", "perm")
VALUES ('SUPER_ADMIN', 'order.create'), ('SALES_EXECUTIVE', 'order.create')
ON CONFLICT DO NOTHING;
