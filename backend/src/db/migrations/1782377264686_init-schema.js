/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  // Enable fuzzy search extension
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pg_trgm');

  // Users
  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    phone: { type: 'varchar(10)', notNull: true, unique: true },
    firebase_uid: { type: 'varchar(128)', unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    deleted_at: { type: 'timestamptz' },
  });

  // Family profiles
  pgm.createTable('family_profiles', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    name: { type: 'varchar(50)', notNull: true },
    date_of_birth: { type: 'date' },
    is_primary: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('family_profiles', 'unique_user_profile_name', 'UNIQUE(user_id, name)');

  // Prescriptions
  pgm.createTable('prescriptions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    profile_id: { type: 'uuid', notNull: true, references: 'family_profiles(id)', onDelete: 'CASCADE' },
    file_path: { type: 'varchar(512)', notNull: true },  // local path (R2 later)
    uploaded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // OCR extraction results
  pgm.createTable('extraction_results', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    prescription_id: { type: 'uuid', notNull: true, references: 'prescriptions(id)', onDelete: 'CASCADE' },
    drug_entries: { type: 'jsonb', notNull: true },
    confidence: { type: 'numeric(4,3)' },
    ocr_engine: { type: 'varchar(32)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // Canonical drugs (generic salt database)
  pgm.createTable('canonical_drugs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    salt_name: { type: 'varchar(256)', notNull: true },
    strength: { type: 'varchar(64)' },
    dosage_form: { type: 'varchar(64)' },
    schedule: { type: 'varchar(8)' },
  });

  // Drug brands (brand name → canonical drug mapping)
  pgm.createTable('drug_brands', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    canonical_drug_id: { type: 'uuid', notNull: true, references: 'canonical_drugs(id)' },
    brand_name: { type: 'varchar(256)', notNull: true },
    manufacturer: { type: 'varchar(256)' },
    source: { type: 'varchar(32)' },
  });
  pgm.addConstraint('drug_brands', 'unique_drug_brand', 'UNIQUE(canonical_drug_id, brand_name)');
  pgm.sql('CREATE INDEX idx_drug_brands_name_trgm ON drug_brands USING GIN (brand_name gin_trgm_ops)');

  // Price records
  pgm.createTable('price_records', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    canonical_drug_id: { type: 'uuid', notNull: true, references: 'canonical_drugs(id)' },
    platform_id: { type: 'varchar(32)', notNull: true },
    brand_name: { type: 'varchar(256)' },
    pack_size: { type: 'varchar(64)' },
    mrp_inr: { type: 'numeric(10,2)' },
    selling_price_inr: { type: 'numeric(10,2)' },
    in_stock: { type: 'boolean', notNull: true, default: false },
    delivery_eta_hours: { type: 'integer' },
    affiliate_url: { type: 'text' },
    scraped_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('price_records', ['canonical_drug_id', 'platform_id']);

  // Compare sessions
  pgm.createTable('compare_sessions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    extraction_result_id: { type: 'uuid', notNull: true, references: 'extraction_results(id)' },
    user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    profile_id: { type: 'uuid', references: 'family_profiles(id)', onDelete: 'SET NULL' },
    price_record_ids: { type: 'uuid[]' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // Reminders
  pgm.createTable('reminders', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    profile_id: { type: 'uuid', notNull: true, references: 'family_profiles(id)', onDelete: 'CASCADE' },
    drug_entry: { type: 'jsonb', notNull: true },
    start_time: { type: 'time', notNull: true },
    frequency_hours: { type: 'integer', notNull: true },
    end_date: { type: 'date', notNull: true },
    is_active: { type: 'boolean', notNull: true, default: true },
    completed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // Rx History view
  pgm.sql(`
    CREATE VIEW rx_history AS
      SELECT
        cs.id              AS session_id,
        p.id               AS prescription_id,
        p.profile_id,
        p.file_path,
        p.uploaded_at,
        er.id              AS extraction_result_id,
        er.drug_entries,
        er.created_at      AS extraction_created_at,
        cs.price_record_ids,
        cs.created_at      AS compared_at
      FROM compare_sessions cs
      JOIN extraction_results er ON er.id = cs.extraction_result_id
      JOIN prescriptions p ON p.id = er.prescription_id
  `);
};

export const down = (pgm) => {
  pgm.sql('DROP VIEW IF EXISTS rx_history');
  pgm.dropTable('reminders');
  pgm.dropTable('compare_sessions');
  pgm.dropTable('price_records');
  pgm.dropTable('drug_brands');
  pgm.dropTable('canonical_drugs');
  pgm.dropTable('extraction_results');
  pgm.dropTable('prescriptions');
  pgm.dropTable('family_profiles');
  pgm.dropTable('users');
  pgm.sql('DROP EXTENSION IF EXISTS pg_trgm');
};

