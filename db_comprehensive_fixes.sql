-- Comprehensive fix: Add all columns from old DB that are missing in new DB
-- Run on your upgraded database to fix ALL remaining schema gaps
START TRANSACTION;

-- ============================================================
-- 1. Fix users table: add missing columns
-- ============================================================
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `user_referral_code` varchar(32) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `user_last_active` datetime DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `user_online_status` enum('online','offline','away') DEFAULT 'offline',
  ADD COLUMN IF NOT EXISTS `fcm_token` varchar(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `onesignal_user_id` varchar(100) DEFAULT NULL;

-- ============================================================
-- 2. Fix users_sessions: widen session_token + add refresh_token
-- ============================================================
ALTER TABLE `users_sessions`
  ADD COLUMN IF NOT EXISTS `refresh_token` text DEFAULT NULL AFTER `user_device_name`,
  MODIFY COLUMN `session_token` varchar(512) DEFAULT NULL;

-- ============================================================
-- 3. Fix stories: add media_count column
-- ============================================================
ALTER TABLE `stories`
  ADD COLUMN IF NOT EXISTS `media_count` int(11) DEFAULT 1;

-- ============================================================
-- 4. Fix stories_media: add storage columns
-- ============================================================
ALTER TABLE `stories_media`
  ADD COLUMN IF NOT EXISTS `storage_type` varchar(64) DEFAULT 'google-cloud',
  ADD COLUMN IF NOT EXISTS `storage_data` json DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `thumbnail_path` varchar(500) DEFAULT NULL;

-- ============================================================
-- 5. Fix conversations_users: add last_seen_time
-- ============================================================
ALTER TABLE `conversations_users`
  ADD COLUMN IF NOT EXISTS `last_seen_time` datetime DEFAULT NULL;

-- ============================================================
-- 6. Fix bank_transfers: add orders_collection_id (if table exists)
-- ============================================================
ALTER TABLE `bank_transfers`
  ADD COLUMN IF NOT EXISTS `orders_collection_id` varchar(256) DEFAULT NULL;

-- ============================================================
-- 6. Fix conversations: add color (if missing)
-- ============================================================
ALTER TABLE `conversations`
  ADD COLUMN IF NOT EXISTS `color` varchar(32) DEFAULT NULL;

-- ============================================================
-- 7. Fix conversations_messages: add all reaction counts
-- ============================================================
ALTER TABLE `conversations_messages`
  ADD COLUMN IF NOT EXISTS `product_post_id` int(10) unsigned DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `reaction_like_count` int(10) unsigned NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `reaction_love_count` int(10) unsigned NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `reaction_haha_count` int(10) unsigned NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `reaction_yay_count` int(10) unsigned NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `reaction_wow_count` int(10) unsigned NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `reaction_sad_count` int(10) unsigned NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `reaction_angry_count` int(10) unsigned NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `video` varchar(256) NOT NULL DEFAULT '';

COMMIT;
