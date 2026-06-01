-- Fix users_sessions: add refresh_token + widen session_token for JWT
START TRANSACTION;

ALTER TABLE `users_sessions`
  ADD COLUMN IF NOT EXISTS `refresh_token` text DEFAULT NULL AFTER `user_device_name`,
  MODIFY COLUMN `session_token` varchar(512) DEFAULT NULL;

COMMIT;
