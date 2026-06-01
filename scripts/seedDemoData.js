const bcrypt = require("bcrypt");
const crypto = require("crypto");
const pool = require("../config/db");

const DEFAULT_COUNTS = {
  users: Number(process.env.SEED_USERS || 50),
  pages: Number(process.env.SEED_PAGES || 5),
  groups: Number(process.env.SEED_GROUPS || 5),
  events: Number(process.env.SEED_EVENTS || 5),
  conversations: Number(process.env.SEED_CONVERSATIONS || 10),
  messagesPerConversation: Number(process.env.SEED_MESSAGES_PER_CONVERSATION || 5),
  posts: Number(process.env.SEED_POSTS || 100),
};

const RESET = process.argv.includes("--reset") || process.env.SEED_RESET === "1";
const RUN_TAG = Date.now().toString(36);
const PASSWORD_HASH = bcrypt.hashSync("Password123!", 10);

// ─── Names ────────────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  // East Africa
  "Amara", "Zawadi", "Kofi", "Niambi", "Obinna", "Adaeze", "Seun",
  "Chiamaka", "Emeka", "Fatou", "Kwame", "Abena", "Tunde", "Yewande",
  // West Africa
  "Adeola", "Chisom", "Babatunde", "Ngozi", "Chukwuemeka", "Ifeoma",
  // Southern Africa
  "Nandi", "Sibusiso", "Thandiwe", "Lungelo", "Nokuthula", "Mthokozisi",
  // North Africa
  "Yasmine", "Karim", "Nour", "Tariq", "Leila", "Hamza",
  // Pan-African
  "Zara", "Kemi", "Dami", "Tobi", "Sade", "Femi", "Bisi", "Lola",
];

const LAST_NAMES = [
  // Nigerian
  "Okafor", "Adeyemi", "Nwosu", "Eze", "Adeleke", "Okonkwo", "Balogun", "Afolabi",
  // Kenyan / East African
  "Kamau", "Otieno", "Wanjiku", "Mwangi", "Kariuki", "Ochieng", "Mutua",
  // Ghanaian
  "Mensah", "Asante", "Boateng", "Owusu", "Acheampong",
  // Southern African
  "Dlamini", "Mokoena", "Ndlovu", "Khumalo", "Sithole",
  // Francophone / Sahel
  "Diallo", "Coulibaly", "Touré", "Traoré", "Koné",
  // North African
  "Hassan", "Khalil", "Mansour", "Farouq",
];

const CITIES = [
  "Lagos", "Nairobi", "Accra", "Johannesburg", "Cairo", "Dakar",
  "Abuja", "Kigali", "Kampala", "Dar es Salaam", "Addis Ababa",
  "Casablanca", "Lusaka", "Harare", "Douala", "Abidjan",
];

// ─── Post content ─────────────────────────────────────────────────────────────

const POST_TEXTS = [
  // Thought leadership / commentary
  "Three years ago I couldn't get a single investor to return my emails. Today we closed our seed round. The lesson? Build anyway — the receipts come later.",
  "Unpopular opinion: the reason most African startups struggle isn't funding or talent — it's product market fit we convince ourselves we've found too early. Take the harder road.",
  "The best career advice I ever got: 'Stop networking with people at your level. Obsess over being useful to the people ten steps ahead of you.'",
  "We keep talking about brain drain but not enough about brain circulation. Some of the sharpest operators I know spent five years abroad and came home with capital, contacts, and conviction. Let's reframe the narrative.",
  "Accountability thread: I said I'd launch in Q1. It's Q2. Here's exactly what went wrong, what I'm fixing, and the new date I'm committing to publicly — because public commitments are the only kind I keep.",
  "Not every lesson needs to come from a Ted talk. I learned more about resilience watching my grandmother run her fabric stall in Alaba market than from any podcast.",
  "People ask what made us pivot. Honest answer: the data was trying to tell us something for six months and our egos were too loud to hear it.",

  // Community / culture
  "This neighbourhood raised me. Every time we host a clean-up or skill-share here, I feel that debt getting smaller. What's your community giving back story?",
  "Afrobeats did not just conquer charts — it rewired how the world hears joy. That didn't happen by accident. It happened because a generation of producers in Lagos bet on themselves before anyone else did.",
  "PSA for creatives: your local market is not a consolation prize. It's a foundation. Build deep roots here before you chase the global stage.",
  "Hot take: mentorship in Africa is too transactional. The best mentors I've had just let me observe them doing real work. No deck, no curriculum — just proximity to excellence.",
  "Every time I land back home after a trip abroad, the energy at the airport hits different. There is something about African ambition in motion that is hard to describe and impossible to replicate.",

  // Personal / human
  "Today I took a full day off. No Slack. No email. Just family, jollof, and a very long nap. I'm telling you this so that someone reading it gives themselves permission to do the same.",
  "Lost a deal today that we'd been chasing for four months. Went for a run. Came back. Started writing the next pitch. The only way out is through.",
  "My biggest professional regret is the years I spent waiting for someone to give me a title before I started leading. Permission culture is a tax on potential.",
  "Five years of building taught me more about human psychology than any MBA ever could. People don't buy products — they buy the version of themselves they become when they use it.",
  "Reminder: not everyone gets to see the 3am iterations, the rejected proposals, the months where revenue flatlined. They just see the announcement. Respect the silence behind other people's success.",

  // Knowledge sharing
  "Quick framework I use before every major decision — write down the worst realistic outcome. If you can live with it, move forward. If you can't, redesign until you can.",
  "Thread on the three contracts every freelancer in this space needs before they start any engagement — DM me and I'll send the templates we use. No cost.",
  "Something nobody tells you about scaling: your biggest bottleneck stops being capital at some point and starts being clarity. Clarity of vision, communication, and culture.",
  "The most underrated business skill on this continent right now is storytelling for investors who didn't grow up here. The numbers are often strong. The narrative bridge is where deals die.",
  "I've reviewed over 200 pitch decks this year. The single most common mistake: burying the 'why us' slide at the end. Lead with it. Investors fund teams before they fund ideas.",

  // Media / culture
  "Just finished re-reading Things Fall Apart. Some books don't age — they deepen. Achebe wasn't just writing about colonialism; he was writing about the violence of having your story told by someone else.",
  "The photography coming out of East Africa right now is astonishing. A whole generation of visual artists documenting the continent on their own terms. Tag me in work I should be following.",
  "Film recommendation: go find the independent productions coming out of Nollywood's new wave. Smaller budgets, sharper scripts, zero apology. Cinema is finally looking like us.",
];

const LINK_TITLES = [
  "How We Grew to 100k Users Without Paid Ads",
  "The State of Fintech in Sub-Saharan Africa — 2025 Report",
  "A Founder's Honest Breakdown of Their Series A Journey",
  "Why Lagos Is Becoming the Creative Capital of the Continent",
  "Open Source Tools Every African Developer Should Know",
  "Building in Public: Our First Year by the Numbers",
  "The Agricultural Tech Revolution Nobody Is Talking About",
  "Inside Nairobi's New Wave of Design Studios",
];

// ─── Conversation messages ─────────────────────────────────────────────────────

const CONVERSATION_MESSAGES = [
  "Hey, did you catch the announcement? Thoughts?",
  "Just sent you the doc — let me know if the numbers look right on your end.",
  "This looks really solid. I think we can move forward.",
  "Heads up: the timeline shifted slightly. I'll send a full update by end of day.",
  "Good call on the pivot. I think the new direction is much sharper.",
  "Are you free for a quick call Thursday afternoon?",
  "I've been thinking about what you said last week. I think you're right.",
  "Congratulations on the launch! The product looks clean.",
  "Can you introduce me to your contact at that accelerator? No pressure at all.",
  "The feedback from the beta users is better than we expected — sharing the summary now.",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(items) {
  return items[randomInt(0, items.length - 1)];
}

function sample(items, count) {
  const copy = [...items];
  const picked = [];
  while (copy.length && picked.length < count) {
    const index = randomInt(0, copy.length - 1);
    picked.push(copy.splice(index, 1)[0]);
  }
  return picked;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function hoursAgo(hours) {
  const date = new Date();
  date.setHours(date.getHours() - hours);
  return date;
}

function minutesAgo(minutes) {
  const date = new Date();
  date.setMinutes(date.getMinutes() - minutes);
  return date;
}

function futureDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function randomUrl(kind, seed) {
  return `https://picsum.photos/seed/${encodeURIComponent(`${kind}-${seed}`)}/1200/800`;
}

function randomAvatar(seed) {
  return `https://i.pravatar.cc/300?u=${encodeURIComponent(seed)}`;
}

function randomPhone() {
  return `+2547${randomInt(10000000, 99999999)}`;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function getColumns(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName],
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function getSchema(connection, tableNames) {
  const schema = {};
  for (const tableName of tableNames) {
    schema[tableName] = await getColumns(connection, tableName);
  }
  return schema;
}

async function insertRow(connection, schema, tableName, data) {
  const columns = schema[tableName];
  if (!columns || columns.size === 0) {
    throw new Error(`Table not found or has no columns: ${tableName}`);
  }

  const entries = Object.entries(data).filter(
    ([key, value]) => columns.has(key) && value !== undefined,
  );

  if (entries.length === 0) {
    throw new Error(`No matching columns to insert into ${tableName}`);
  }

  const sql = `INSERT INTO \`${tableName}\` (${entries
    .map(([key]) => `\`${key}\``)
    .join(", ")}) VALUES (${entries.map(() => "?").join(", ")})`;
  const values = entries.map(([, value]) => value);
  const [result] = await connection.query(sql, values);
  return result.insertId;
}

async function truncateTables(connection, schema, tableNames) {
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const tableName of tableNames) {
    if (schema[tableName] && schema[tableName].size > 0) {
      await connection.query(`TRUNCATE TABLE \`${tableName}\``);
    }
  }
  await connection.query("SET FOREIGN_KEY_CHECKS = 1");
}

// ─── Seeders ──────────────────────────────────────────────────────────────────

async function seedCategories(connection, schema, tableName, labels) {
  if (!schema[tableName] || schema[tableName].size === 0) return [];

  const ids = [];
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    const id = await insertRow(connection, schema, tableName, {
      category_parent_id: 0,
      category_name: `${label} ${RUN_TAG}`,
      category_description: `${label} category for seeded demo content`,
      category_order: index + 1,
    });
    ids.push(id);
  }
  return ids;
}

async function seedUsers(connection, schema, count, countryIds) {
  const userIds = [];
  for (let index = 0; index < count; index += 1) {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const handle = `${slugify(firstName)}.${slugify(lastName)}.${RUN_TAG}${index + 1}`;
    const city = pick(CITIES);
    const countryId = countryIds.length ? pick(countryIds) : null;
    const userId = await insertRow(connection, schema, "users", {
      user_master_account: 0,
      user_group: 3,
      user_group_custom: 0,
      user_demo: "0",
      user_name: handle,
      user_email: `${handle}@example.test`,
      user_email_verified: "1",
      user_email_verification_code: null,
      user_phone: randomPhone(),
      user_phone_verified: "0",
      user_phone_verification_code: null,
      user_password: PASSWORD_HASH,
      user_two_factor_enabled: "0",
      user_two_factor_type: null,
      user_two_factor_key: null,
      user_two_factor_gsecret: null,
      user_activated: "1",
      user_approved: "1",
      user_reseted: "0",
      user_reset_key: null,
      user_subscribed: "0",
      user_package: null,
      user_subscription_date: null,
      user_boosted_posts: 0,
      user_boosted_pages: 0,
      user_boosted_groups: 0,
      user_boosted_events: 0,
      user_started: "1",
      user_verified: randomInt(0, 1) ? "1" : "0",
      user_banned: "0",
      user_latitude: "0",
      user_longitude: "0",
      user_firstname: firstName,
      user_lastname: lastName,
      user_gender: randomInt(1, 3),
      user_picture: randomAvatar(handle),
      user_cover: randomUrl("cover", handle),
      user_cover_position: "0px 0px",
      user_registered: daysAgo(randomInt(1, 730)),
      user_country: countryId,
      user_birthdate: daysAgo(randomInt(7_000, 12_000)),
      user_relationship: pick(["single", "married", "complicated"]),
      user_biography: pick([
        `Building the next chapter of African tech, one line of code at a time. Based in ${city}.`,
        `Founder. Creative. Connector. Passionate about what Africa builds next.`,
        `Product designer who believes good design is a form of respect. ${city} native.`,
        `Operator, investor, occasional writer. Trying to make the ecosystem a little better than I found it.`,
        `Storyteller by instinct, strategist by trade. Making work that matters from ${city}.`,
        `Community builder, startup advisor, and lifelong student of African markets.`,
        `Engineer turned entrepreneur. I build things and then rebuild them until they actually work.`,
      ]),
      user_website: `https://example.test/${handle}`,
      user_work_title: pick([
        "Founder & CEO", "Product Designer", "Software Engineer", "Growth Lead",
        "Content Creator", "Investment Analyst", "Community Manager", "Creative Director",
        "Operations Lead", "Brand Strategist",
      ]),
      user_work_place: pick([
        "Pipi Africa", "Andela", "Flutterwave", "Paystack", "Jumia", "mPharma",
        "Kuda Bank", "Wave Mobile Money", "54gene", "Twiga Foods",
      ]),
      user_work_url: `https://example.test/work/${handle}`,
      user_current_city: city,
      user_hometown: pick(CITIES),
      user_edu_major: pick([
        "Computer Science", "Business Administration", "Design & Communication",
        "Economics", "Electrical Engineering", "Media Studies", "International Development",
      ]),
      user_edu_school: pick([
        "University of Lagos", "University of Nairobi", "University of Ghana",
        "Cairo University", "Makerere University", "University of Cape Town",
        "Strathmore University", "KNUST", "Covenant University", "ALX Africa",
      ]),
      user_social_facebook: `https://facebook.com/${handle}`,
      user_social_twitter: `https://x.com/${handle}`,
      user_social_instagram: `https://instagram.com/${handle}`,
      user_social_linkedin: `https://linkedin.com/in/${handle}`,
      user_profile_background: randomUrl("profile-background", handle),
      user_chat_enabled: "1",
      user_newsletter_enabled: "1",
      user_tips_enabled: "1",
      user_online_status: pick(["online", "offline", "away"]),
      user_last_active: minutesAgo(randomInt(1, 3000)),
      user_referrer_id: userIds.length ? pick(userIds) : null,
      user_referral_code: crypto.randomBytes(4).toString("hex").toUpperCase(),
      fcm_token: `fcm_${handle}`,
      points_earned: "0",
      user_points: randomInt(0, 500),
      user_wallet_balance: randomInt(0, 250),
      user_affiliate_balance: randomInt(0, 100),
      user_market_balance: randomInt(0, 100),
      user_funding_balance: randomInt(0, 100),
      user_monetization_enabled: randomInt(0, 1) ? "1" : "0",
      user_monetization_chat_price: randomInt(0, 20),
      user_monetization_call_price: randomInt(0, 30),
      user_monetization_min_price: randomInt(0, 10),
      user_monetization_plans: 0,
      user_monetization_balance: randomInt(0, 75),
      chat_sound: "1",
      notifications_sound: "1",
      user_language: "en_us",
      user_free_tried: "0",
      is_fake: "0",
    });

    userIds.push(userId);
  }
  return userIds;
}

async function seedPages(connection, schema, count, adminUserIds, countryIds, pageCategoryIds) {
  const pageIds = [];

  const PAGE_NAMES = [
    "The Build Africa Digest", "Founders Forum Lagos", "Design in Africa",
    "The African Tech Pulse", "Creative Commons Nairobi", "Startup Almanac Africa",
    "The Continent Daily", "Pan-African Ventures", "Makers of the Sahel", "Afrotech Insider",
  ];

  for (let index = 0; index < count; index += 1) {
    const title = PAGE_NAMES[index % PAGE_NAMES.length];
    const pageName = `${slugify(title)}-${RUN_TAG}${index + 1}`;
    const pageId = await insertRow(connection, schema, "pages", {
      page_admin: pick(adminUserIds),
      page_category: pageCategoryIds.length ? pick(pageCategoryIds) : 1,
      page_name: pageName,
      page_title: title,
      page_picture: randomAvatar(pageName),
      page_cover: randomUrl("page-cover", pageName),
      page_country: countryIds.length ? pick(countryIds) : 1,
      page_language: 1,
      page_description: `${title} — a community platform covering innovation, culture, and opportunity across the African continent.`,
      page_action_text: "Follow",
      page_action_color: "blue",
      page_action_url: `https://example.test/pages/${pageName}`,
      page_company: `${title} Media`,
      page_phone: randomPhone(),
      page_website: `https://example.test/pages/${pageName}`,
      page_location: pick(CITIES),
      page_verified: randomInt(0, 1) ? "1" : "0",
      page_tips_enabled: "1",
      page_boosted: "0",
      page_boosted_by: null,
      page_monetization_discount_enabled: "0",
      page_monetization_discount_percent: 0,
      page_pbid: null,
      is_fake: "0",
      page_date: daysAgo(randomInt(1, 365)),
      page_monetization_enabled: "0",
    });
    pageIds.push(pageId);

    await insertRow(connection, schema, "pages_admins", {
      page_id: pageId,
      user_id: pick(adminUserIds),
    });

    const likeCount = randomInt(3, Math.min(10, adminUserIds.length));
    for (const userId of sample(adminUserIds, likeCount)) {
      await insertRow(connection, schema, "pages_likes", {
        page_id: pageId,
        user_id: userId,
      });
    }
  }
  return pageIds;
}

async function seedGroups(connection, schema, count, adminUserIds, groupCategoryIds, countryIds) {
  const groupIds = [];

  const GROUP_NAMES = [
    "African Founders Network", "Women in Tech Africa", "Lagos Product Community",
    "East Africa Dev Circle", "Nairobi Design Guild", "Sahel Agritech Collective",
    "Pan-African Investors Forum", "Creative Industries Lagos", "Accra Startup Hub", "Build Africa Remotely",
  ];

  for (let index = 0; index < count; index += 1) {
    const title = GROUP_NAMES[index % GROUP_NAMES.length];
    const groupName = `${slugify(title)}-${RUN_TAG}${index + 1}`;
    const groupId = await insertRow(connection, schema, "groups", {
      group_privacy: pick(["public", "closed", "secret"]),
      group_admin: pick(adminUserIds),
      group_category: groupCategoryIds.length ? pick(groupCategoryIds) : 1,
      group_name: groupName,
      group_title: title,
      group_country: countryIds.length ? pick(countryIds) : 1,
      group_language: 1,
      group_description: `${title} — a curated space for operators, builders, and thinkers shaping Africa's next decade.`,
      group_publish_enabled: "1",
      group_publish_approval_enabled: "0",
      group_picture: randomAvatar(groupName),
      group_cover: randomUrl("group-cover", groupName),
      group_cover_position: "0px 0px",
      group_members: randomInt(5, 30),
      group_boosted: "0",
      group_monetization_enabled: randomInt(0, 1) ? "1" : "0",
      group_monetization_min_price: randomInt(0, 20),
      group_monetization_plans: 0,
      group_rate: randomInt(0, 5),
      group_date: daysAgo(randomInt(1, 365)),
    });
    groupIds.push(groupId);

    await insertRow(connection, schema, "groups_admins", {
      group_id: groupId,
      user_id: pick(adminUserIds),
    });

    const memberIds = sample(adminUserIds, randomInt(6, Math.min(15, adminUserIds.length)));
    for (const userId of memberIds) {
      await insertRow(connection, schema, "groups_members", {
        group_id: groupId,
        user_id: userId,
        approved: "1",
      });
    }
  }
  return groupIds;
}

async function seedEvents(connection, schema, count, adminUserIds, pageIds, eventCategoryIds) {
  const eventIds = [];

  const EVENT_NAMES = [
    "AfriTech Summit 2026", "Lagos Startup Weekend", "Design Indaba Nairobi Edition",
    "Pan-African Founders Retreat", "East Africa Product Week", "Accra Creator Fest",
    "African Climate Innovation Forum", "Johannesburg VC Connect", "Cairo Tech Expo", "Dakar Creative Labs",
  ];

  for (let index = 0; index < count; index += 1) {
    const title = EVENT_NAMES[index % EVENT_NAMES.length];
    const eventId = await insertRow(connection, schema, "events", {
      event_privacy: pick(["public", "closed", "secret"]),
      event_admin: pick(adminUserIds),
      event_page_id: pageIds.length && randomInt(0, 1) ? pick(pageIds) : null,
      event_category: eventCategoryIds.length ? pick(eventCategoryIds) : 1,
      event_title: title,
      event_location: pick(CITIES),
      event_latitude: null,
      event_longitude: null,
      event_country: 1,
      event_language: 1,
      event_is_online: randomInt(0, 3) === 0 ? "1" : "0",
      event_boosted: "0",
      event_boosted_by: null,
      event_is_sponsored: "0",
      event_sponsor_name: null,
      event_sponsor_url: null,
      event_description: `${title} brings together Africa's most ambitious builders, investors, and creatives for two days of conversations, workshops, and connections that actually matter.`,
      event_start_date: futureDays(randomInt(1, 30)),
      event_end_date: futureDays(randomInt(31, 60)),
      event_publish_enabled: "1",
      event_publish_approval_enabled: "0",
      event_cover: randomUrl("event-cover", title),
      event_cover_position: "0px 0px",
      chatbox_enabled: "1",
      event_tickets_link: `https://example.test/events/${slugify(title)}`,
      event_prices: JSON.stringify([0, 25, 75]),
      event_rate: randomInt(0, 5),
      event_date: daysAgo(randomInt(1, 365)),
    });
    eventIds.push(eventId);

    const attendeeIds = sample(adminUserIds, randomInt(6, Math.min(15, adminUserIds.length)));
    for (const userId of attendeeIds) {
      await insertRow(connection, schema, "events_members", {
        event_id: eventId,
        user_id: userId,
        is_invited: randomInt(0, 1) ? "1" : "0",
        is_interested: randomInt(0, 1) ? "1" : "0",
        is_going: randomInt(0, 1) ? "1" : "0",
      });
    }
  }
  return eventIds;
}

async function seedConnections(connection, schema, userIds) {
  const friendPairs = new Set();
  const followPairs = new Set();

  for (const userId of userIds) {
    const follows = sample(userIds.filter((id) => id !== userId), randomInt(2, 6));
    for (const followingId of follows) {
      const key = `${userId}:${followingId}`;
      if (followPairs.has(key)) continue;
      followPairs.add(key);
      await insertRow(connection, schema, "followings", {
        user_id: userId,
        following_id: followingId,
        points_earned: "0",
        time: daysAgo(randomInt(1, 90)),
      });
    }
  }

  const attempts = userIds.length * 2;
  for (let index = 0; index < attempts; index += 1) {
    const pair = sample(userIds, 2);
    if (pair.length < 2) continue;
    const [userOneId, userTwoId] = pair[0] < pair[1] ? pair : [pair[1], pair[0]];
    const key = `${userOneId}:${userTwoId}`;
    if (friendPairs.has(key)) continue;
    friendPairs.add(key);
    await insertRow(connection, schema, "friends", {
      user_one_id: userOneId,
      user_two_id: userTwoId,
      status: 1,
    });
  }
}

async function seedConversations(connection, schema, userIds, count, messagesPerConversation) {
  if (
    !schema.conversations || schema.conversations.size === 0 ||
    !schema.conversations_users || schema.conversations_users.size === 0 ||
    !schema.conversations_messages || schema.conversations_messages.size === 0
  ) {
    return [];
  }

  const conversationIds = [];
  const usedPairs = new Set();

  for (let index = 0; index < count; index += 1) {
    const pair = sample(userIds, 2);
    if (pair.length < 2) continue;
    const [userOneId, userTwoId] = pair[0] < pair[1] ? pair : [pair[1], pair[0]];
    const pairKey = `${userOneId}:${userTwoId}`;
    if (usedPairs.has(pairKey)) { index -= 1; continue; }
    usedPairs.add(pairKey);

    const conversationId = await insertRow(connection, schema, "conversations", {
      last_message_id: 0,
      color: `#${crypto.randomBytes(3).toString("hex")}`,
      node_id: null,
      node_type: null,
    });
    conversationIds.push(conversationId);

    for (const userId of [userOneId, userTwoId]) {
      await insertRow(connection, schema, "conversations_users", {
        conversation_id: conversationId,
        user_id: userId,
        seen: "1",
        typing: "0",
        deleted: "0",
        last_seen_time: minutesAgo(randomInt(1, 500)),
      });
    }

    let lastMessageId = null;
    for (let messageIndex = 0; messageIndex < messagesPerConversation; messageIndex += 1) {
      const senderId = messageIndex % 2 === 0 ? userOneId : userTwoId;
      lastMessageId = await insertRow(connection, schema, "conversations_messages", {
        conversation_id: conversationId,
        user_id: senderId,
        message: pick(CONVERSATION_MESSAGES),
        image: randomInt(0, 4) === 0 ? randomUrl("message-image", `${conversationId}-${messageIndex}`) : "",
        voice_note: randomInt(0, 8) === 0 ? randomUrl("voice-note", `${conversationId}-${messageIndex}`) : "",
        video: "",
        product_post_id: null,
        reaction_like_count: 0,
        reaction_love_count: 0,
        reaction_haha_count: 0,
        reaction_yay_count: 0,
        reaction_wow_count: 0,
        reaction_sad_count: 0,
        reaction_angry_count: 0,
        time: minutesAgo(randomInt(1, 200)),
      });
    }

    if (lastMessageId) {
      await connection.query(
        "UPDATE conversations SET last_message_id = ? WHERE conversation_id = ?",
        [lastMessageId, conversationId],
      );
    }
  }

  return conversationIds;
}

async function seedPosts(
  connection,
  schema,
  userIds,
  pageIds,
  groupIds,
  eventIds,
  categoryIdsByType,
  count,
) {
  const postIds = [];
  const postTypes = [
    "normal", "photo", "video", "article", "link",
    "product", "job", "poll", "live", "funding", "offer",
  ];

  for (let index = 0; index < count; index += 1) {
    const postType = postTypes[index % postTypes.length];
    const usePage = pageIds.length > 0 && randomInt(0, 4) === 0;
    const authorId = usePage ? pick(pageIds) : pick(userIds);
    const userType = usePage ? "page" : "user";
    const isGroupPost = groupIds.length > 0 && randomInt(0, 3) === 0;
    const isEventPost = !isGroupPost && eventIds.length > 0 && randomInt(0, 5) === 0;
    const groupId = isGroupPost ? pick(groupIds) : null;
    const eventId = isEventPost ? pick(eventIds) : null;
    const caption = pick(POST_TEXTS);

    const postId = await insertRow(connection, schema, "posts", {
      user_id: authorId,
      user_type: userType,
      in_group: isGroupPost ? "1" : "0",
      group_id: groupId,
      group_approved: "1",
      in_event: isEventPost ? "1" : "0",
      event_id: eventId,
      event_approved: "1",
      in_wall: "0",
      wall_id: null,
      post_type: postType,
      colored_pattern: null,
      origin_id: null,
      time: hoursAgo(randomInt(1, 720)),
      location: pick(CITIES),
      privacy: pick(["public", "friends"]),
      text: caption,
      feeling_action: randomInt(0, 1) ? pick(["feeling", "thinking", "watching", "listening"]) : null,
      feeling_value: randomInt(0, 1) ? pick(["motivated", "focused", "grateful", "inspired", "hopeful"]) : null,
      boosted: randomInt(0, 5) === 0 ? "1" : "0",
      boosted_by: null,
      comments_disabled: "0",
      is_hidden: "0",
      for_adult: "0",
      is_anonymous: randomInt(0, 8) === 0 ? "1" : "0",
      reaction_like_count: randomInt(0, 200),
      reaction_love_count: randomInt(0, 40),
      reaction_haha_count: randomInt(0, 20),
      reaction_yay_count: randomInt(0, 20),
      reaction_wow_count: randomInt(0, 20),
      reaction_sad_count: randomInt(0, 10),
      reaction_angry_count: randomInt(0, 10),
      comments: randomInt(0, 30),
      shares: randomInt(0, 12),
      views: randomInt(10, 500),
      post_rate: randomInt(0, 5),
      points_earned: "0",
      tips_enabled: randomInt(0, 1) ? "1" : "0",
      for_subscriptions: randomInt(0, 6) === 0 ? "1" : "0",
      is_paid: randomInt(0, 8) === 0 ? "1" : "0",
      post_price: randomInt(0, 25),
      paid_text: randomInt(0, 8) === 0 ? "Subscribe to read the full breakdown." : null,
      is_collaborative: "0",
      collaborative_percent: 0,
      is_schedule: "0",
      is_paid_locked: "0",
      paid_image: null,
      post_latitude: "0",
      post_longitude: "0",
      subscriptions_image: null,
      processing: "0",
      pre_approved: "1",
      has_approved: "1",
    });

    postIds.push(postId);

    if (schema.posts_photos && schema.posts_photos.size > 0 && postType === "photo") {
      const photoCount = randomInt(1, 4);
      for (let photoIndex = 0; photoIndex < photoCount; photoIndex += 1) {
        await insertRow(connection, schema, "posts_photos", {
          post_id: postId,
          album_id: null,
          source: randomUrl("post-photo", `${postId}-${photoIndex}`),
          storage_type: "local",
          storage_data: JSON.stringify({ seed: `${postId}-${photoIndex}` }),
          filename: `photo-${postId}-${photoIndex}.jpg`,
          blur: "0",
          pinned: photoIndex === 0 ? "1" : "0",
        });
      }
    }

    if (schema.posts_videos && schema.posts_videos.size > 0 && postType === "video") {
      await insertRow(connection, schema, "posts_videos", {
        post_id: postId,
        category_id: categoryIdsByType.posts_videos.length ? pick(categoryIdsByType.posts_videos) : 1,
        source: randomUrl("post-video", postId),
        source_240p: null, source_360p: null, source_480p: null,
        source_720p: null, source_1080p: null, source_1440p: null,
        source_2160p: null,
        thumbnail: randomUrl("video-thumb", postId),
        views: randomInt(5, 250),
      });
    }

    if (schema.posts_articles && schema.posts_articles.size > 0 && postType === "article") {
      const ARTICLE_TITLES = [
        "What the Next Five Years of African Tech Actually Look Like",
        "Why Founders on This Continent Are Playing a Different Game",
        "The Infrastructure Gap Nobody Wants to Fund — and Why That's Changing",
        "Building Trust in Markets Where Trust Has Been Broken",
        "A Candid Look at What It Takes to Scale Past 10,000 Users in Africa",
      ];
      await insertRow(connection, schema, "posts_articles", {
        post_id: postId,
        cover: randomUrl("article-cover", postId),
        title: pick(ARTICLE_TITLES),
        text: caption,
        category_id: categoryIdsByType.blogs.length ? pick(categoryIdsByType.blogs) : 1,
        tags: "africa,tech,founders,growth",
        views: randomInt(10, 200),
      });
    }

    if (schema.posts_links && schema.posts_links.size > 0 && postType === "link") {
      await insertRow(connection, schema, "posts_links", {
        post_id: postId,
        source_url: `https://example.test/articles/${postId}`,
        source_host: "example.test",
        source_title: pick(LINK_TITLES),
        source_text: caption.slice(0, 120),
        source_thumbnail: randomUrl("link-thumb", postId),
      });
    }

    if (schema.posts_products && schema.posts_products.size > 0 && postType === "product") {
      const PRODUCTS = [
        "Handwoven Ankara Tote Bag", "Shea Butter Skincare Kit", "Solar Desk Lamp",
        "Adire Print Journal", "African Chess Set (Mahogany)", "Organic Moringa Powder",
        "Beaded Phone Holder", "Kente Print Laptop Sleeve",
      ];
      await insertRow(connection, schema, "posts_products", {
        post_id: postId,
        name: pick(PRODUCTS),
        price: randomInt(10, 100),
        quantity: randomInt(1, 20),
        category_id: categoryIdsByType.market.length ? pick(categoryIdsByType.market) : 1,
        status: pick(["new", "old"]),
        location: pick(CITIES),
        available: "1",
        is_digital: randomInt(0, 1) ? "1" : "0",
        product_download_url: null,
        product_file_source: null,
      });
    }

    if (schema.posts_jobs && schema.posts_jobs.size > 0 && postType === "job") {
      const JOBS = [
        { title: "Senior Product Designer", type: "full-time" },
        { title: "Backend Engineer (Node.js)", type: "full-time" },
        { title: "Growth & Partnerships Lead", type: "full-time" },
        { title: "Data Analyst — Fintech", type: "contract" },
        { title: "Community Manager", type: "part-time" },
        { title: "Content Strategist", type: "contract" },
        { title: "DevOps Engineer", type: "full-time" },
      ];
      const job = pick(JOBS);
      const jobId = await insertRow(connection, schema, "posts_jobs", {
        post_id: postId,
        category_id: categoryIdsByType.jobs.length ? pick(categoryIdsByType.jobs) : 1,
        title: job.title,
        location: pick(CITIES),
        salary_minimum: randomInt(800, 2500),
        salary_maximum: randomInt(2500, 8000),
        pay_salary_per: pick(["month", "month", "week"]),
        type: job.type,
        question_1_type: "text",
        question_1_title: "What draws you to this role specifically?",
        question_1_choices: null,
        question_2_type: "text",
        question_2_title: "Describe a relevant project or challenge you've solved.",
        question_2_choices: null,
        question_3_type: "text",
        question_3_title: "When are you available to start?",
        question_3_choices: null,
        cover_image: randomUrl("job-cover", postId),
        available: "1",
      });

      if (schema.posts_jobs_applications && schema.posts_jobs_applications.size > 0) {
        const applicants = sample(userIds, randomInt(1, 4));
        for (const applicantId of applicants) {
          await insertRow(connection, schema, "posts_jobs_applications", {
            post_id: postId,
            user_id: applicantId,
            name: `Applicant ${applicantId}`,
            location: pick(CITIES),
            phone: randomPhone(),
            email: `applicant${applicantId}@example.test`,
            work_place: pick(["Andela", "Flutterwave", "Jumia", "mPharma", "Wave"]),
            work_position: pick(["Product Manager", "Engineer", "Designer", "Analyst"]),
            work_description: "Seeded application.",
            work_from: "2021",
            work_to: "2025",
            work_now: "0",
            question_1_answer: "The mission resonates with me and the scope is exactly where I want to grow.",
            question_2_answer: "Led a full redesign of our onboarding flow that cut drop-off by 30%.",
            question_3_answer: "Two weeks from offer.",
            cv: `https://example.test/cv/${applicantId}.pdf`,
            applied_time: minutesAgo(randomInt(5, 500)),
          });
        }
      }
    }

    if (schema.posts_polls && schema.posts_polls.size > 0 && postType === "poll") {
      const POLLS = [
        { q: "What's the biggest blocker for African startups right now?", opts: ["Access to capital", "Talent retention", "Infrastructure gaps", "Regulatory friction"] },
        { q: "Which city has the most exciting startup scene right now?", opts: ["Lagos", "Nairobi", "Accra", "Cairo"] },
        { q: "How do you prefer to learn new skills?", opts: ["Online courses", "Mentorship", "Building projects", "Books & articles"] },
        { q: "What matters most when choosing a co-founder?", opts: ["Complementary skills", "Shared values", "Prior track record", "Energy and work ethic"] },
      ];
      const pollData = pick(POLLS);
      const pollId = await insertRow(connection, schema, "posts_polls", {
        post_id: postId,
        votes: randomInt(5, 250),
      });

      if (schema.posts_polls_options && schema.posts_polls_options.size > 0) {
        const optionIds = [];
        for (const optionText of pollData.opts) {
          const optionId = await insertRow(connection, schema, "posts_polls_options", {
            poll_id: pollId,
            text: optionText,
          });
          optionIds.push(optionId);
        }

        if (schema.posts_polls_options_users && schema.posts_polls_options_users.size > 0) {
          const voters = sample(userIds, randomInt(1, Math.min(5, userIds.length)));
          for (const voterId of voters) {
            await insertRow(connection, schema, "posts_polls_options_users", {
              user_id: voterId,
              poll_id: pollId,
              option_id: pick(optionIds),
            });
          }
        }
      }
    }

    if (schema.posts_live && schema.posts_live.size > 0 && postType === "live") {
      await insertRow(connection, schema, "posts_live", {
        post_id: postId,
        video_thumbnail: randomUrl("live-thumb", postId),
        agora_uid: randomInt(1000, 9999),
        agora_channel_name: `channel-${postId}`,
        agora_resource_id: null,
        agora_sid: null,
        agora_file: null,
        live_ended: randomInt(0, 1) ? "0" : "1",
        live_recorded: randomInt(0, 1) ? "1" : "0",
      });

      if (schema.posts_live_users && schema.posts_live_users.size > 0) {
        for (const userId of sample(userIds, randomInt(2, 6))) {
          await insertRow(connection, schema, "posts_live_users", {
            user_id: userId,
            post_id: postId,
          });
        }
      }
    }

    if (schema.posts_funding && schema.posts_funding.size > 0 && postType === "funding") {
      const FUNDING_TITLES = [
        "Help Us Build a Rural Solar Grid in Northern Ghana",
        "Coding Bootcamp Scholarships for 50 Young Women in Lagos",
        "Community Library & Makerspace — Kigali",
        "Clean Water Initiative for Three Villages in the Sahel",
        "African Oral History Archive — Digitisation Project",
      ];
      await insertRow(connection, schema, "posts_funding", {
        post_id: postId,
        title: pick(FUNDING_TITLES),
        amount: randomInt(2000, 10000),
        raised_amount: randomInt(200, 5000),
        total_donations: randomInt(5, 80),
        cover_image: randomUrl("funding-cover", postId),
      });

      if (schema.posts_funding_donors && schema.posts_funding_donors.size > 0) {
        for (const donorId of sample(userIds, randomInt(1, 5))) {
          await insertRow(connection, schema, "posts_funding_donors", {
            user_id: donorId,
            post_id: postId,
            donation_amount: randomInt(10, 500),
            donation_time: minutesAgo(randomInt(1, 2000)),
          });
        }
      }
    }

    if (schema.posts_offers && schema.posts_offers.size > 0 && postType === "offer") {
      const OFFERS = [
        "30% off all skincare this weekend", "Buy 2 get 1 free — handcrafted jewellery",
        "Flash sale: digital design assets", "Early-bird rate for the summit — ends Friday",
      ];
      await insertRow(connection, schema, "posts_offers", {
        post_id: postId,
        category_id: categoryIdsByType.offers.length ? pick(categoryIdsByType.offers) : 1,
        title: pick(OFFERS),
        discount_type: pick(["percentage", "amount"]),
        discount_percent: randomInt(10, 50),
        discount_amount: randomInt(5, 100),
        buy_x: randomInt(1, 3),
        get_y: randomInt(1, 3),
        spend_x: randomInt(10, 50),
        amount_y: randomInt(5, 20),
        end_date: futureDays(randomInt(1, 14)),
        price: randomInt(10, 80),
        thumbnail: randomUrl("offer-thumb", postId),
      });
    }

    if (schema.posts_reactions && schema.posts_reactions.size > 0) {
      for (const reactorId of sample(userIds, randomInt(1, 4))) {
        await insertRow(connection, schema, "posts_reactions", {
          post_id: postId,
          user_id: reactorId,
          reaction: pick(["like", "love", "haha", "wow", "sad", "angry"]),
          reaction_time: minutesAgo(randomInt(1, 4000)),
          points_earned: "0",
        });
      }
    }

    if (schema.posts_saved && schema.posts_saved.size > 0 && randomInt(0, 3) === 0) {
      for (const saverId of sample(userIds, randomInt(1, 3))) {
        await insertRow(connection, schema, "posts_saved", {
          post_id: postId,
          user_id: saverId,
          time: minutesAgo(randomInt(1, 4000)),
        });
      }
    }
  }

  return postIds;
}


async function seedStories(connection, schema, userIds) {
  if (!schema.stories || schema.stories.size === 0 || !schema.stories_media || schema.stories_media.size === 0) return;
  for (let index = 0; index < 5; index += 1) {
    const userId = pick(userIds);
    const storyId = await insertRow(connection, schema, "stories", {
      user_id: userId,
      is_ads: "0",
      time: hoursAgo(randomInt(1, 12)),
      media_count: 1,
    });
    await insertRow(connection, schema, "stories_media", {
      story_id: storyId,
      source: randomUrl("story", `story-${index}`),
      storage_type: "google-cloud",
      storage_data: JSON.stringify({}),
      is_photo: randomInt(0, 1) ? "1" : "0",
      text: pick(["Good morning! ☀️", "Having a great day!", "Check this out 🔥", "New vibes 🎵", "Hello world! 🌍"]),
      time: hoursAgo(randomInt(1, 12)),
      thumbnail_path: null,
    });
  }
}
// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const connection = await pool.getConnection();

  const baseTables = [
    "users", "pages", "groups", "events", "followings", "friends",
    "pages_admins", "pages_likes", "groups_admins", "groups_members", "events_members",
    "conversations", "conversations_users", "conversations_messages",
    "posts", "posts_photos", "posts_videos", "posts_articles", "posts_links",
    "posts_products", "posts_jobs", "posts_jobs_applications",
    "posts_polls", "posts_polls_options", "posts_polls_options_users",
    "posts_live", "posts_live_users", "posts_funding", "posts_funding_donors",
    "posts_offers", "posts_reactions", "posts_saved",
    "blogs_categories", "pages_categories", "groups_categories", "events_categories",
    "jobs_categories", "market_categories", "offers_categories", "posts_videos_categories",
    "system_countries",
  ];

  try {
    await connection.beginTransaction();

    const schema = await getSchema(connection, baseTables);

    if (RESET) {
      await truncateTables(connection, schema, [
        "posts_saved", "posts_reactions", "posts_funding_donors", "posts_funding",
        "posts_live_users", "posts_live", "posts_polls_options_users", "posts_polls_options",
        "posts_polls", "posts_jobs_applications", "posts_jobs", "posts_products", "posts_links",
        "posts_articles", "posts_videos", "posts_photos", "posts",
        "conversations_messages", "conversations_users", "conversations",
        "events_members", "events", "groups_members", "groups_admins", "groups",
        "pages_likes", "pages_admins", "pages", "followings", "friends", "users",
        "blogs_categories", "pages_categories", "groups_categories", "events_categories",
        "jobs_categories", "market_categories", "offers_categories",
        "posts_videos_categories", "system_countries",
      ]);
    }

    const countryIds = [];
    if (schema.system_countries && schema.system_countries.size > 0) {
      const [countries] = await connection.query(
        "SELECT country_id FROM system_countries ORDER BY country_id ASC LIMIT 10",
      );
      for (const row of countries) countryIds.push(row.country_id);
    }

    const blogsCategoryIds = await seedCategories(connection, schema, "blogs_categories", ["News", "Opinion", "Deep Dive"]);
    const pageCategoryIds = await seedCategories(connection, schema, "pages_categories", ["Creator", "Business", "Community"]);
    const groupCategoryIds = await seedCategories(connection, schema, "groups_categories", ["Community", "Industry", "Learning"]);
    const eventCategoryIds = await seedCategories(connection, schema, "events_categories", ["Conference", "Meetup", "Workshop"]);
    const jobCategoryIds = await seedCategories(connection, schema, "jobs_categories", ["Full-time", "Part-time", "Contract"]);
    const marketCategoryIds = await seedCategories(connection, schema, "market_categories", ["Handcraft", "Digital", "Lifestyle"]);
    const offersCategoryIds = await seedCategories(connection, schema, "offers_categories", ["Flash Sale", "Bundle", "Seasonal"]);
    const videoCategoryIds = await seedCategories(connection, schema, "posts_videos_categories", ["Short-form", "Documentary", "Tutorial"]);

    const users = await seedUsers(connection, schema, DEFAULT_COUNTS.users, countryIds);
    const pages = await seedPages(connection, schema, DEFAULT_COUNTS.pages, users, countryIds, pageCategoryIds);
    const groups = await seedGroups(connection, schema, DEFAULT_COUNTS.groups, users, groupCategoryIds, countryIds);
    const events = await seedEvents(connection, schema, DEFAULT_COUNTS.events, users, pages, eventCategoryIds);
    await seedStories(connection, schema, users);
    await seedConnections(connection, schema, users);
    await seedConversations(connection, schema, users, DEFAULT_COUNTS.conversations, DEFAULT_COUNTS.messagesPerConversation);

    const postIds = await seedPosts(
      connection, schema, users, pages, groups, events,
      {
        blogs: blogsCategoryIds,
        jobs: jobCategoryIds,
        market: marketCategoryIds,
        offers: offersCategoryIds,
        posts_videos: videoCategoryIds,
      },
      DEFAULT_COUNTS.posts,
    );

    await connection.commit();

    console.log("✓ Demo data seeded successfully.");
    console.log({
      users: users.length,
      pages: pages.length,
      groups: groups.length,
      events: events.length,
      posts: postIds.length,
      reset: RESET,
      runTag: RUN_TAG,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

main();