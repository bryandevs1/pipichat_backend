-- Add missing 'description' column to wallet_transactions table
-- This column is referenced by INSERT queries in:
--   - Postservice.js (funding donations, product purchases)
--   - postController.js (sending tips)
--   - walletController.js (wallet transactions)

ALTER TABLE wallet_transactions
ADD COLUMN description VARCHAR(500) DEFAULT NULL AFTER date;
