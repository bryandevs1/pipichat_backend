# Database Schema Column-Level Comparison
## NEW vs OLD Schema

---

## users TABLE

**NEW_COLUMNS_TO_ADD:**
- user_online_status
- user_last_active
- user_referral_code
- fcm_token

**OLD_COLUMNS_TO_DROP:**
- None (all old columns exist in new)

**SHARED_COLUMNS:** 130

---

## stories TABLE

**NEW_COLUMNS_TO_ADD:**
- media_count

**OLD_COLUMNS_TO_DROP:**
- None

**SHARED_COLUMNS:** 4

---

## stories_media TABLE

**NEW_COLUMNS_TO_ADD:**
- storage_type
- storage_data
- thumbnail_path

**OLD_COLUMNS_TO_DROP:**
- None

**SHARED_COLUMNS:** 6

---

## groups TABLE

**NEW_COLUMNS_TO_ADD:**
- group_picture_id (changed from int to varchar)
- group_cover_id (changed from int to varchar)

**OLD_COLUMNS_TO_DROP:**
- None

**SHARED_COLUMNS:** 24

---

## posts_offers TABLE

**NEW_COLUMNS_TO_ADD:**
- None (columns restructured with type changes)

**OLD_COLUMNS_TO_DROP:**
- None

**SHARED_COLUMNS:** 12

**TYPE CHANGES:**
- discount_percent: `int(10) unsigned` → `int` (nullable changed: YES)
- discount_amount: `varchar(100)` → `decimal(10,2)` (nullable: YES)
- buy_x: `varchar(100)` → `int` (nullable: YES)
- get_y: `varchar(100)` → `int` (nullable: YES)
- spend_x: `varchar(100)` → `decimal(10,2)` (nullable: YES)
- amount_y: `varchar(100)` → `decimal(10,2)` (nullable: YES)

---

## posts_photos TABLE

**NEW_COLUMNS_TO_ADD:**
- storage_type
- storage_data
- filename

**OLD_COLUMNS_TO_DROP:**
- None

**SHARED_COLUMNS:** 14

---

## conversations_calls_audio TABLE

**NEW_COLUMNS_TO_ADD:**
- None (channel_name already exists)

**OLD_COLUMNS_TO_DROP:**
- None

**SHARED_COLUMNS:** 11

**TYPE CHANGES:**
- from_user_token: `mediumtext` (NO nullable) → `mediumtext` (YES nullable)
- to_user_token: `mediumtext` (NO nullable) → `mediumtext` (YES nullable)
- channel_name: Added to NEW schema (actually missing in OLD, need review)

---

## conversations_calls_video TABLE

**NEW_COLUMNS_TO_ADD:**
- None

**OLD_COLUMNS_TO_DROP:**
- None

**SHARED_COLUMNS:** 11

**TYPE CHANGES:**
- from_user_token: `text` (NO nullable) → `text` (YES nullable)
- to_user_token: `text` (NO nullable) → `text` (YES nullable)
- channel_name: Already present

---

## posts_videos TABLE

**NEW_COLUMNS_TO_ADD:**
- None

**OLD_COLUMNS_TO_DROP:**
- None

**SHARED_COLUMNS:** 15

**TYPE CHANGES:**
- views: `int(10)` → `int` (no change, just format)

---

## users_sessions TABLE

**NEW_COLUMNS_TO_ADD:**
- refresh_token

**OLD_COLUMNS_TO_DROP:**
- None

**SHARED_COLUMNS:** 10

**TYPE CHANGES:**
- session_token: `varchar(64)` (NO nullable) → `varchar(512)` (YES nullable)

---

## posts_audios TABLE

**NEW_COLUMNS_TO_ADD:**
- None

**OLD_COLUMNS_TO_DROP:**
- None

**SHARED_COLUMNS:** 4

**TYPE CHANGES:**
- views: `int(10)` → `int` (no impact)

---

## posts_live TABLE

**NEW_COLUMNS_TO_ADD:**
- None

**OLD_COLUMNS_TO_DROP:**
- None

**SHARED_COLUMNS:** 9

**TYPE CHANGES:**
- agora_uid: `int(10)` → `int` (no impact)

---

## group_storage_data TABLE

**NEW_COLUMNS_TO_ADD:**
- created_at
- updated_at

**OLD_COLUMNS_TO_DROP:**
- None (NEW table added entirely)

**SHARED_COLUMNS:** 5

---

## Payment Tables Analysis

### affiliates_payments
**NEW_COLUMNS_TO_ADD:** None
**OLD_COLUMNS_TO_DROP:** None
**SHARED_COLUMNS:** 7

### funding_payments
**NEW_COLUMNS_TO_ADD:** None
**OLD_COLUMNS_TO_DROP:** None
**SHARED_COLUMNS:** 7

### market_payments
**NEW_COLUMNS_TO_ADD:** None
**OLD_COLUMNS_TO_DROP:** None
**SHARED_COLUMNS:** 7

### monetization_payments
**NEW_COLUMNS_TO_ADD:** None
**OLD_COLUMNS_TO_DROP:** None
**SHARED_COLUMNS:** 7

### wallet_payments
**NEW_COLUMNS_TO_ADD:** None
**OLD_COLUMNS_TO_DROP:** None
**SHARED_COLUMNS:** 7

### coinpayments_transactions
**NEW_COLUMNS_TO_ADD:** None
**OLD_COLUMNS_TO_DROP:** None
**SHARED_COLUMNS:** 8

### log_commissions
**NEW_COLUMNS_TO_ADD:** None
**OLD_COLUMNS_TO_DROP:** None
**SHARED_COLUMNS:** 5

### log_payments
**NEW_COLUMNS_TO_ADD:** None
**OLD_COLUMNS_TO_DROP:** None
**SHARED_COLUMNS:** 5

### bank_transfers
**NEW_COLUMNS_TO_ADD:** None
**OLD_COLUMNS_TO_DROP:** None
**SHARED_COLUMNS:** 10

### orders
**NEW_COLUMNS_TO_ADD:** None
**OLD_COLUMNS_TO_DROP:** None
**SHARED_COLUMNS:** 11

---

## story_reactions TABLE (NEW)

**NEW_COLUMNS_TO_ADD:** All columns (new table)
- id
- story_id
- user_id
- reaction
- reacted_at
- created_at

**OLD_COLUMNS_TO_DROP:** N/A (table didn't exist)

**SHARED_COLUMNS:** 0

---

## story_views TABLE (NEW)

**NEW_COLUMNS_TO_ADD:** All columns (new table)
- id
- story_id
- user_id
- viewed_at
- created_at

**OLD_COLUMNS_TO_DROP:** N/A (table didn't exist)

**SHARED_COLUMNS:** 0

---

## posts_media TABLE

**NEW_COLUMNS_TO_ADD:** None

**OLD_COLUMNS_TO_DROP:** None

**SHARED_COLUMNS:** 9

**TYPE CHANGES:**
- post_id: `int(10)` → `int` (no impact)

---

## groups_members TABLE

**NEW_COLUMNS_TO_ADD:**
- requested_at
- updated_at

**OLD_COLUMNS_TO_DROP:**
- None

**SHARED_COLUMNS:** 3

---

## hashtags_posts TABLE

**NEW_COLUMNS_TO_ADD:**
- None

**OLD_COLUMNS_TO_DROP:**
- None

**SHARED_COLUMNS:** 3

**TYPE CHANGES:**
- created_at: `datetime` (YES nullable) → `datetime` (YES nullable) - consistent

---

## Summary of Major Changes

### NEW Tables Added:
- group_storage_data
- story_reactions
- story_views

### Key Column Additions:
1. **users table:** user_referral_code ✓ (user mentioned this one), user_online_status, user_last_active, fcm_token
2. **stories table:** media_count
3. **stories_media table:** storage_type, storage_data, thumbnail_path
4. **posts_photos table:** storage_type, storage_data, filename
5. **users_sessions table:** refresh_token
6. **groups_members table:** requested_at, updated_at
7. **groups table:** group_picture_id, group_cover_id (type changes)
8. **posts_offers table:** Multiple decimal precision changes

### Notable Type Changes:
1. posts_offers discount/pricing fields: varchar → decimal(10,2) for better precision
2. groups table media IDs: int → varchar(255)
3. users_sessions session_token: varchar(64) → varchar(512)
4. conversations_calls tokens: Made nullable in NEW schema
5. posts_videos views: Minor format update

---

## Migration Recommendations

### Priority 1 - Data Integrity:
1. Add user_referral_code to users table
2. Add storage fields to stories_media
3. Create story_reactions and story_views tables
4. Update posts_offers decimal fields

### Priority 2 - Feature Support:
5. Add FCM token support
6. Add online_status tracking
7. Add refresh_token for session management

### Priority 3 - Infrastructure:
8. Create group_storage_data for file storage management
9. Update groups table for varchar media IDs
10. Add timestamp tracking to groups_members

