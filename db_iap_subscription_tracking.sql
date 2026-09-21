-- Add store-subscription tracking columns to packages_payments.
--
-- Why this is needed:
--   * Renewals: App Store / Play renewals arrive via the App Store Server
--     Notification endpoint (and Play RTDN). To credit a renewal we must be
--     able to find the user from the store's stable identifier. That identifier
--     is `original_transaction_id` (iOS) / the subscription's purchase token
--     (Android) - NOT our internal payment_id.
--   * Expiry: getUserPackage currently derives expiry as
--     payment_date + period_num. For store subscriptions the authoritative
--     expiry comes from the store, so we store it.
--   * Idempotency: "Restore Purchases" re-posts the same receipt, and Apple
--     can redeliver notifications. A UNIQUE index on transaction_id makes
--     granting idempotent instead of inserting duplicate payment rows.
--
-- Safe to run on an existing database: all columns are NULLable and the unique
-- index tolerates multiple NULLs (wallet purchases have no store transaction).

ALTER TABLE packages_payments
  ADD COLUMN store_product_id VARCHAR(255) DEFAULT NULL
    COMMENT 'Store SKU, e.g. pipi_premium_weekly' AFTER package_price,
  ADD COLUMN platform ENUM('ios','android','wallet') DEFAULT 'wallet'
    COMMENT 'Where the payment came from' AFTER store_product_id,
  ADD COLUMN transaction_id VARCHAR(255) DEFAULT NULL
    COMMENT 'Store transaction id (iOS) / order id (Android)' AFTER platform,
  ADD COLUMN original_transaction_id VARCHAR(255) DEFAULT NULL
    COMMENT 'Stable store subscription id used to match renewals' AFTER transaction_id,
  ADD COLUMN expires_date DATETIME DEFAULT NULL
    COMMENT 'Authoritative expiry reported by the store' AFTER original_transaction_id,
  ADD COLUMN auto_renew_status ENUM('0','1') NOT NULL DEFAULT '1'
    COMMENT '0 once the store reports the subscription will not renew' AFTER expires_date;

-- Idempotency: a given store transaction may only be granted once.
-- MySQL allows repeated NULLs in a UNIQUE index, so wallet payments are fine.
ALTER TABLE packages_payments
  ADD UNIQUE KEY uniq_packages_payments_transaction (transaction_id);

-- Renewals look the user up by this, and getUserPackage reads the newest row.
ALTER TABLE packages_payments
  ADD KEY idx_packages_payments_original_tx (original_transaction_id);
