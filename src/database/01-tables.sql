-- Extract Bill & Pay — Schema DDL
-- Auto-executed by MySQL Docker container on first boot

CREATE TABLE IF NOT EXISTS users (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(150),
  email           VARCHAR(255) NOT NULL UNIQUE,         -- primary login identifier (email OTP)
  phone           VARCHAR(20) UNIQUE,                   -- optional, collected at withdrawal
  gender          ENUM('male', 'female', 'other'),
  role            ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  password_hash   VARCHAR(255),                         -- only set for admin accounts
  upi_id          VARCHAR(255),                         -- stored on first withdrawal
  wallet_balance  DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  is_onboarded    BOOLEAN NOT NULL DEFAULT FALSE,        -- false until onboarding form completed
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  pity_counter    INT NOT NULL DEFAULT 0,               -- tracks uploads since last bonus reward
  referral_code   VARCHAR(20) UNIQUE,                   -- generated on onboarding, shared by user
  referred_by     VARCHAR(20),                          -- referral code of the user who referred them
  coin_balance    INT NOT NULL DEFAULT 0,               -- separate from wallet; earned via referrals
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bills (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  user_id          INT NOT NULL,
  file_url         VARCHAR(500),                        -- NULL for failed bills (never stored if pipeline fails)
  sha256_hash         VARCHAR(64),                      -- SHA-256 of file bytes — exact duplicate gate (checked before FastAPI)
  phash               VARCHAR(20),                      -- perceptual hash — near-duplicate gate (computed by FastAPI)
  pdf_metadata_hash   VARCHAR(64),                      -- SHA-256 of PDF creation date + producer + author — catches re-exported same PDF with edited content
  platform         VARCHAR(100),                        -- swiggy | zomato | zepto | blinkit | unknown
  order_id         VARCHAR(255),
  total_amount     DECIMAL(10, 2),
  bill_date        DATE,
  status           ENUM('queued', 'pending', 'processing', 'verified', 'rejected', 'failed') NOT NULL DEFAULT 'queued',
  rejection_reason VARCHAR(500),
  extracted_data   JSON,                                -- raw structured output from AI (ExtractedBillData)
  fraud_score      INT NOT NULL DEFAULT 0,              -- total fraud score from bill processor (admin filtering)
  fraud_signals    JSON,                                -- full fraud signal breakdown (admin review)
  reward_amount    DECIMAL(10, 2),                      -- amount assigned by reward engine (before claim)
  coin_reward      INT,                                 -- coin reward assigned by reward engine (before claim)
  chest_decoys     JSON,                                -- pre-computed decoy amounts for chest UI [n1, n2]
  reward_claimed   BOOLEAN NOT NULL DEFAULT FALSE,      -- true after user opens chest and claims reward
  chest_opened     BOOLEAN NOT NULL DEFAULT FALSE,      -- true after user has viewed the chest opening UI
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  -- DB-level duplicate safety nets (critical for race-condition protection)
  UNIQUE KEY uniq_bill_sha256 (sha256_hash),
  UNIQUE KEY uniq_bill_phash (phash),
  UNIQUE KEY uniq_bill_order (order_id, platform)
);

CREATE TABLE IF NOT EXISTS cashback_transactions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  bill_id     INT,                                      -- nullable for manual admin credits/debits
  amount      DECIMAL(10, 2) NOT NULL,
  type        ENUM('credit', 'debit') NOT NULL DEFAULT 'credit',
  description VARCHAR(500),
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bill_id) REFERENCES bills(id)
);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  amount       DECIMAL(10, 2) NOT NULL,
  upi_id       VARCHAR(255) NOT NULL,
  status       ENUM('pending', 'processed', 'rejected') NOT NULL DEFAULT 'pending',
  admin_note   VARCHAR(500),
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS tickets (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  bill_id       INT,                                    -- nullable (not all tickets are bill disputes)
  category      ENUM('bill_dispute', 'reward_issue', 'withdrawal_issue', 'other') NOT NULL,
  description   TEXT NOT NULL,
  attachment_url VARCHAR(500),                          -- optional screenshot upload
  status        ENUM('open', 'in_review', 'resolved', 'rejected') NOT NULL DEFAULT 'open',
  admin_comment TEXT,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bill_id) REFERENCES bills(id)
);

CREATE TABLE IF NOT EXISTS referral_transactions (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  referrer_user_id INT NOT NULL,                        -- user who shared their referral code
  referred_user_id INT NOT NULL,                        -- new user who used the code
  coins_awarded    INT NOT NULL,                        -- coins credited to referrer
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (referrer_user_id) REFERENCES users(id),
  FOREIGN KEY (referred_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS reward_config (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  tier_name   VARCHAR(50) NOT NULL,                    -- base / medium / high / jackpot
  reward_min  DECIMAL(10, 2) NOT NULL,
  reward_max  DECIMAL(10, 2) NOT NULL,
  coin_min    INT NOT NULL,
  coin_max    INT NOT NULL,
  weight      INT NOT NULL,                            -- higher = more common
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Default reward tiers (admin can edit/add more, but these are the starting defaults)
INSERT IGNORE INTO reward_config (id, tier_name, reward_min, reward_max, coin_min, coin_max, weight, is_active) VALUES
(1, 'base',    2.00,  10.00, 110, 125, 70, TRUE),
(2, 'medium', 11.00,  30.00, 126, 170, 20, TRUE),
(3, 'high',   31.00,  60.00, 171, 240,  8, TRUE),
(4, 'jackpot',61.00,  80.00, 241, 320,  2, TRUE);

CREATE TABLE IF NOT EXISTS upload_limits (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  daily_limit  INT NOT NULL DEFAULT 3,
  weekly_limit INT NOT NULL DEFAULT 10,
  monthly_limit INT NOT NULL DEFAULT 30,
  pity_cap     INT NOT NULL DEFAULT 15,                -- every Nth upload guaranteed bonus tier
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO upload_limits (id, daily_limit, weekly_limit, monthly_limit, pity_cap) VALUES
(1, 3, 10, 30, 15);

CREATE TABLE IF NOT EXISTS referral_config (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  coins_min  INT NOT NULL DEFAULT 10,                  -- min coins awarded per referral
  coins_max  INT NOT NULL DEFAULT 50,                  -- max coins awarded per referral
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO referral_config (id, coins_min, coins_max) VALUES
(1, 10, 50);

CREATE TABLE IF NOT EXISTS banners (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  title         VARCHAR(255) NOT NULL,
  image_url     VARCHAR(500) NOT NULL,                  -- public GCS HTTPS URL for the app
  gcs_path      VARCHAR(500) NOT NULL,                  -- gs://bucket/path — for GCS deletion
  display_order INT NOT NULL DEFAULT 0,                 -- lower = shown first in the slider
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ── Brand dictionary ──────────────────────────────────────────────────────────
-- Source of truth for brand name extraction. Seeded with ~550 Indian FMCG brands.
-- New brands discovered via GPT fallback are inserted with source='gpt' at runtime.
CREATE TABLE IF NOT EXISTS brands (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(150) NOT NULL,
  source     ENUM('seed', 'gpt') NOT NULL DEFAULT 'seed',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_brand_name (name)
);

INSERT IGNORE INTO brands (name, source) VALUES
-- ── Dairy & Milk Products ─────────────────────────────────────────────────────
('Amul', 'seed'), ('Mother Dairy', 'seed'), ('Nestle', 'seed'), ('Nestlé', 'seed'),
('Nandini', 'seed'), ('Aavin', 'seed'), ('Saras', 'seed'), ('Sumul', 'seed'),
('Govardhan', 'seed'), ('Heritage', 'seed'), ('Parag', 'seed'), ('Hatsun', 'seed'),
('Kwality Walls', 'seed'), ('Epigamia', 'seed'), ('Akshayakalpa', 'seed'),
('Milkfood', 'seed'), ('Dynamix', 'seed'), ('Jain Dairy', 'seed'),
('Go Cheese', 'seed'), ('Britannia Cheese', 'seed'), ('Dlecta', 'seed'),
('Verka', 'seed'), ('Vita', 'seed'), ('Prabhat', 'seed'), ('Mahananda', 'seed'),
('Jersey', 'seed'), ('Tirumala', 'seed'), ('Dodla', 'seed'), ('Srikhand', 'seed'),
-- ── Snacks & Namkeen ──────────────────────────────────────────────────────────
('Haldiram\'s', 'seed'), ('Haldirams', 'seed'), ('Bikaji', 'seed'),
('Bikanervala', 'seed'), ('Chitale', 'seed'), ('MTR', 'seed'), ('Prataap', 'seed'),
('Bikano', 'seed'), ('Too Yumm', 'seed'), ('Bingo', 'seed'), ('Kurkure', 'seed'),
('Lay\'s', 'seed'), ('Lays', 'seed'), ('Pringles', 'seed'), ('Doritos', 'seed'),
('Wingreens', 'seed'), ('Act II', 'seed'), ('Cornitos', 'seed'),
('Yellow Diamond', 'seed'), ('Balaji', 'seed'), ('Parle', 'seed'),
('Jabsons', 'seed'), ('Gopal', 'seed'), ('Chheda', 'seed'), ('Rajkot', 'seed'),
('Garvi Gujarat', 'seed'), ('Anil', 'seed'), ('Bambino', 'seed'),
('Lijjat', 'seed'), ('Priyagold', 'seed'), ('Britannia', 'seed'),
-- ── Biscuits & Bakery ─────────────────────────────────────────────────────────
('Sunfeast', 'seed'), ('McVitie\'s', 'seed'), ('McVities', 'seed'),
('Unibic', 'seed'), ('Bonn', 'seed'), ('Dukes', 'seed'), ('Cremica', 'seed'),
('Julie\'s', 'seed'), ('Anmol', 'seed'), ('Patanjali', 'seed'),
('Hide & Seek', 'seed'), ('Oreo', 'seed'), ('Good Day', 'seed'),
('Bourbon', 'seed'), ('Fifty Fifty', 'seed'), ('Monaco', 'seed'),
-- ── Staples, Flour & Grains ───────────────────────────────────────────────────
('Aashirvaad', 'seed'), ('Aashirvad', 'seed'), ('Fortune', 'seed'),
('Saffola', 'seed'), ('Sundrop', 'seed'), ('Nature Fresh', 'seed'),
('Rajdhani', 'seed'), ('Shakti Bhog', 'seed'), ('Pillsbury', 'seed'),
('Annapoorna', 'seed'), ('Captain Cook', 'seed'), ('Tata', 'seed'),
('Double Horse', 'seed'), ('iD Fresh', 'seed'), ('ID Fresh', 'seed'),
('Bambino', 'seed'), ('Gits', 'seed'), ('MTR Ready', 'seed'),
-- ── Rice ──────────────────────────────────────────────────────────────────────
('Daawat', 'seed'), ('India Gate', 'seed'), ('Kohinoor', 'seed'),
('LT Foods', 'seed'), ('Lal Qilla', 'seed'), ('Shrilalmahal', 'seed'),
('Dawat', 'seed'), ('Rozana', 'seed'), ('Royal', 'seed'),
-- ── Instant Food & Noodles ───────────────────────────────────────────────────
('Maggi', 'seed'), ('Yippee', 'seed'), ('Knorr', 'seed'), ('Top Ramen', 'seed'),
('Ching\'s', 'seed'), ('Chings', 'seed'), ('Wai Wai', 'seed'),
('Smith & Jones', 'seed'), ('Sunfeast Yippee', 'seed'), ('Nissin', 'seed'),
('Foodles', 'seed'), ('Indomie', 'seed'), ('Ramen', 'seed'),
-- ── Chocolates & Confectionery ────────────────────────────────────────────────
('Cadbury', 'seed'), ('Mondelez', 'seed'), ('KitKat', 'seed'), ('Munch', 'seed'),
('5 Star', 'seed'), ('Snickers', 'seed'), ('Ferrero', 'seed'), ('Nutella', 'seed'),
('Lindt', 'seed'), ('Toblerone', 'seed'), ('Galaxy', 'seed'), ('Hershey\'s', 'seed'),
('Hersheys', 'seed'), ('Eclairs', 'seed'), ('Perk', 'seed'), ('Silk', 'seed'),
('Temptations', 'seed'), ('Bournville', 'seed'), ('Kit Kat', 'seed'),
('Dairy Milk', 'seed'), ('Chocobakes', 'seed'), ('Munch', 'seed'),
('Bounty', 'seed'), ('Twix', 'seed'), ('Mars', 'seed'), ('Milky Bar', 'seed'),
-- ── Beverages — Cold ─────────────────────────────────────────────────────────
('Pepsi', 'seed'), ('Coca-Cola', 'seed'), ('Coke', 'seed'), ('Sprite', 'seed'),
('Fanta', 'seed'), ('7Up', 'seed'), ('7 Up', 'seed'), ('Limca', 'seed'),
('Thums Up', 'seed'), ('Thumbs Up', 'seed'), ('Maaza', 'seed'), ('Slice', 'seed'),
('Frooti', 'seed'), ('Tropicana', 'seed'), ('Real', 'seed'),
('Minute Maid', 'seed'), ('Paper Boat', 'seed'), ('Paperboat', 'seed'),
('Appy', 'seed'), ('Mountain Dew', 'seed'), ('Red Bull', 'seed'),
('Monster', 'seed'), ('Sting', 'seed'), ('B Natural', 'seed'),
('Raw Pressery', 'seed'), ('Coolberg', 'seed'), ('Bisleri', 'seed'),
('Kinley', 'seed'), ('Aquafina', 'seed'), ('Himalayan', 'seed'),
('Bailley', 'seed'), ('Evocus', 'seed'), ('Ors', 'seed'),
-- ── Beverages — Hot ──────────────────────────────────────────────────────────
('Nescafe', 'seed'), ('Bru', 'seed'), ('Lipton', 'seed'), ('Taj Mahal', 'seed'),
('Red Label', 'seed'), ('Tata Tea', 'seed'), ('Tetley', 'seed'),
('Wagh Bakri', 'seed'), ('Society Tea', 'seed'), ('Girnar', 'seed'),
('Sleepy Owl', 'seed'), ('Blue Tokai', 'seed'), ('Third Wave Coffee', 'seed'),
('Continental Coffee', 'seed'), ('Leo Coffee', 'seed'), ('Narasu', 'seed'),
('Brooke Bond', 'seed'), ('Yellow Label', 'seed'), ('Double Diamond', 'seed'),
-- ── Health Drinks & Nutrition ─────────────────────────────────────────────────
('Horlicks', 'seed'), ('Bournvita', 'seed'), ('Complan', 'seed'),
('Boost', 'seed'), ('Pediasure', 'seed'), ('Ensure', 'seed'),
('Protinex', 'seed'), ('Yogabar', 'seed'), ('RiteBite', 'seed'),
('Soulfull', 'seed'), ('Quaker', 'seed'), ('True Elements', 'seed'),
('Saffola Oats', 'seed'), ('Kellogg\'s', 'seed'), ('Kelloggs', 'seed'),
('Mueslix', 'seed'), ('Bagrry\'s', 'seed'), ('Baggry\'s', 'seed'),
('Bagrys', 'seed'), ('Sunbix', 'seed'), ('Slurrp Farm', 'seed'),
('Sattu', 'seed'), ('The Whole Truth', 'seed'), ('Millet Amma', 'seed'),
-- ── Spices & Condiments ───────────────────────────────────────────────────────
('Everest', 'seed'), ('MDH', 'seed'), ('Catch', 'seed'), ('Eastern', 'seed'),
('Ramdev', 'seed'), ('Badshah', 'seed'), ('Aachi', 'seed'),
('Mother\'s Recipe', 'seed'), ('Mothers Recipe', 'seed'),
('Kissan', 'seed'), ('Heinz', 'seed'), ('Tops', 'seed'), ('Priya', 'seed'),
('Shan', 'seed'), ('National Foods', 'seed'), ('Ching\'s Secret', 'seed'),
('Del Monte', 'seed'), ('Dr. Oetker', 'seed'), ('Druk', 'seed'),
('Keya', 'seed'), ('Veeba', 'seed'), ('Wingreens Farms', 'seed'),
('Cremica', 'seed'), ('Fun Foods', 'seed'), ('Grill Mate', 'seed'),
-- ── Oils & Ghee ───────────────────────────────────────────────────────────────
('Dhara', 'seed'), ('Gemini', 'seed'), ('Dalda', 'seed'),
('Emami Healthy & Tasty', 'seed'), ('Emami', 'seed'), ('Ruchi Gold', 'seed'),
('Nutrela', 'seed'), ('Engine', 'seed'), ('KLF Nirmal', 'seed'),
('Marico', 'seed'), ('Parachute', 'seed'), ('Gold Drop', 'seed'),
('Meizan', 'seed'), ('Rajam', 'seed'), ('Postman', 'seed'),
-- ── Personal Care ─────────────────────────────────────────────────────────────
('Dove', 'seed'), ('Lux', 'seed'), ('Lifebuoy', 'seed'), ('Pears', 'seed'),
('Dettol', 'seed'), ('Savlon', 'seed'), ('Head & Shoulders', 'seed'),
('Pantene', 'seed'), ('Clinic Plus', 'seed'), ('Sunsilk', 'seed'),
('TRESemme', 'seed'), ('Tresemme', 'seed'), ('L\'Oreal', 'seed'),
('Loreal', 'seed'), ('Garnier', 'seed'), ('Himalaya', 'seed'),
('Biotique', 'seed'), ('Mamaearth', 'seed'), ('WOW', 'seed'),
('Plum', 'seed'), ('Nivea', 'seed'), ('Ponds', 'seed'), ('Pond\'s', 'seed'),
('Vaseline', 'seed'), ('Glow & Lovely', 'seed'), ('Bajaj', 'seed'),
('Dabur', 'seed'), ('Godrej', 'seed'), ('Veet', 'seed'), ('Gillette', 'seed'),
('Brylcreem', 'seed'), ('Set Wet', 'seed'), ('Axe', 'seed'), ('Rexona', 'seed'),
('Park Avenue', 'seed'), ('Fogg', 'seed'), ('Wild Stone', 'seed'),
('Engage', 'seed'), ('Denver', 'seed'), ('Fiama', 'seed'), ('Margo', 'seed'),
('Hamam', 'seed'), ('Cinthol', 'seed'), ('Godrej No.1', 'seed'),
('Santoor', 'seed'), ('Mysore Sandal', 'seed'), ('Medimix', 'seed'),
('Neem', 'seed'), ('Sebamed', 'seed'), ('The Moms Co', 'seed'),
('Cetaphil', 'seed'), ('Neutrogena', 'seed'), ('Olay', 'seed'),
('Lakme', 'seed'), ('Revlon', 'seed'), ('Maybelline', 'seed'),
('Colorbar', 'seed'), ('Nykaa', 'seed'), ('Sugar Cosmetics', 'seed'),
-- ── Hair Care ─────────────────────────────────────────────────────────────────
('Indulekha', 'seed'), ('Kesh King', 'seed'), ('Parachute Advansed', 'seed'),
('Vatika', 'seed'), ('Livon', 'seed'), ('Streax', 'seed'), ('Schwarzkopf', 'seed'),
-- ── Household Cleaning ────────────────────────────────────────────────────────
('Surf Excel', 'seed'), ('Ariel', 'seed'), ('Tide', 'seed'), ('Rin', 'seed'),
('Vim', 'seed'), ('Lizol', 'seed'), ('Colin', 'seed'), ('Harpic', 'seed'),
('Domex', 'seed'), ('Scotch-Brite', 'seed'), ('Mr. Muscle', 'seed'),
('Ujala', 'seed'), ('Robin', 'seed'), ('Wheel', 'seed'), ('Nirma', 'seed'),
('Fena', 'seed'), ('Ghadi', 'seed'), ('Active', 'seed'), ('Exo', 'seed'),
('Pril', 'seed'), ('Finish', 'seed'), ('Vanish', 'seed'), ('Comfort', 'seed'),
('Downy', 'seed'), ('Genteel', 'seed'), ('Ezee', 'seed'), ('Gala', 'seed'),
('Glorix', 'seed'), ('Taski', 'seed'), ('Baygon', 'seed'), ('Mortein', 'seed'),
('GoodKnight', 'seed'), ('HIT', 'seed'), ('All Out', 'seed'),
-- ── Baby & Kids ───────────────────────────────────────────────────────────────
('Mamy Poko', 'seed'), ('Pampers', 'seed'), ('Huggies', 'seed'),
('Johnson\'s', 'seed'), ('Johnsons', 'seed'), ('Chicco', 'seed'),
('Farex', 'seed'), ('Nestum', 'seed'), ('Cerelac', 'seed'),
('Similac', 'seed'), ('Aptamil', 'seed'), ('Nan', 'seed'),
('Himalaya Baby', 'seed'), ('Sebamed Baby', 'seed'),
-- ── Frozen & Ready-to-eat ─────────────────────────────────────────────────────
('McCain', 'seed'), ('Godrej Yummiez', 'seed'), ('Venky\'s', 'seed'),
('Venkys', 'seed'), ('Safal', 'seed'), ('Vadilal', 'seed'),
('ITC Master Chef', 'seed'), ('Suguna', 'seed'), ('Baxter', 'seed'),
('Al Kabeer', 'seed'), ('Prasuma', 'seed'), ('Sumeru', 'seed'),
-- ── Dry Fruits & Nuts ─────────────────────────────────────────────────────────
('Happilo', 'seed'), ('Nutraj', 'seed'), ('Miltop', 'seed'),
('Solimo', 'seed'), ('Amazon Brand', 'seed'), ('Urban Platter', 'seed'),
('Rostaa', 'seed'), ('Tulsi', 'seed'), ('Lion', 'seed'), ('Tulsi Dry Fruits', 'seed'),
-- ── Organic & Natural ─────────────────────────────────────────────────────────
('Organic India', 'seed'), ('24 Mantra', 'seed'), ('Pro Nature', 'seed'),
('Sresta', 'seed'), ('Down to Earth', 'seed'), ('Conscious Food', 'seed'),
('Praakritik', 'seed'), ('Farmonics', 'seed'), ('Tattva', 'seed'),
-- ── ITC Brands ────────────────────────────────────────────────────────────────
('ITC', 'seed'), ('Aashirvaad', 'seed'), ('Sunfeast', 'seed'),
('Bingo', 'seed'), ('Yippee', 'seed'), ('Fiama Di Wills', 'seed'),
('Engage', 'seed'), ('Vivel', 'seed'), ('Savlon', 'seed'),
-- ── HUL Brands ────────────────────────────────────────────────────────────────
('HUL', 'seed'), ('Hindustan Unilever', 'seed'), ('Knorr', 'seed'),
('Horlicks', 'seed'), ('Boost', 'seed'), ('Kissan', 'seed'),
-- ── Regional South India ──────────────────────────────────────────────────────
('Maiyas', 'seed'), ('Grand Sweets', 'seed'), ('Adyar Ananda Bhavan', 'seed'),
('Sri Krishna Sweets', 'seed'), ('Anil', 'seed'), ('Double Horse', 'seed'),
('Eastern', 'seed'), ('Nirapara', 'seed'), ('Manna', 'seed'),
('Priya Foods', 'seed'), ('Telugu Foods', 'seed'), ('Sakthi', 'seed'),
-- ── Regional West India ───────────────────────────────────────────────────────
('Chitale Bandhu', 'seed'), ('Kolhapuri', 'seed'), ('Gokul', 'seed'),
('Solapur', 'seed'), ('Shreekhand', 'seed'), ('Amrakhand', 'seed'),
-- ── Pet Food ──────────────────────────────────────────────────────────────────
('Pedigree', 'seed'), ('Whiskas', 'seed'), ('Royal Canin', 'seed'),
('Drools', 'seed'), ('Sheba', 'seed'), ('Cesar', 'seed'),
-- ── Stationery & Other ────────────────────────────────────────────────────────
('Classmate', 'seed'), ('Apsara', 'seed'), ('Natraj', 'seed'),
('Camlin', 'seed'), ('Reynolds', 'seed'), ('Cello', 'seed'),
-- ── More Dairy & Paneer ───────────────────────────────────────────────────────
('Milky Mist', 'seed'), ('Madhusudan', 'seed'), ('Arokya', 'seed'),
('Thirumala', 'seed'), ('Sagar', 'seed'), ('Fresho', 'seed'),
('Moo', 'seed'), ('Creamline', 'seed'), ('Vijaya', 'seed'),
-- ── More Snacks ───────────────────────────────────────────────────────────────
('Peppy', 'seed'), ('Piknik', 'seed'), ('Uncle Chips', 'seed'),
('Fritos', 'seed'), ('Cheetos', 'seed'), ('Ruffles', 'seed'),
('Crax', 'seed'), ('Ring', 'seed'), ('Wheels', 'seed'),
('Cheeselings', 'seed'), ('Murukku', 'seed'), ('Khakhra', 'seed'),
('Farali', 'seed'), ('Roastery Coffee House', 'seed'), ('Dryfruit', 'seed'),
('Tasty Treat', 'seed'), ('Smart Chef', 'seed'),
-- ── More Beverages ────────────────────────----------------------------------------------------------------
('Glucon-D', 'seed'), ('Glucose D', 'seed'), ('ORS', 'seed'),
('Electral', 'seed'), ('Gatorade', 'seed'), ('Powerade', 'seed'),
('Pokka', 'seed'), ('Ceres', 'seed'), ('Dabur Real', 'seed'),
('Minute Maid Pulpy', 'seed'), ('Starbucks', 'seed'), ('Nescafe Gold', 'seed'),
('Davidoff', 'seed'), ('Nespresso', 'seed'), ('Tim Hortons', 'seed'),
('The Indian Chai', 'seed'), ('Chaayos', 'seed'), ('Teabox', 'seed'),
-- ── More Health & Wellness ────────────────────────────────────────────────────
('Oziva', 'seed'), ('MuscleBlaze', 'seed'), ('Fast&Up', 'seed'),
('Fast and Up', 'seed'), ('Gritzo', 'seed'), ('Carbamide Forte', 'seed'),
('HealthKart', 'seed'), ('Himalaya Herbals', 'seed'), ('Patanjali Ayurved', 'seed'),
('Charak', 'seed'), ('Baidyanath', 'seed'), ('Zandu', 'seed'),
('Hamdard', 'seed'), ('Vaidyaratnam', 'seed'), ('Kottakkal', 'seed'),
('Kapiva', 'seed'), ('Jiva', 'seed'), ('Sri Sri Tattva', 'seed'),
-- ── More Instant & Ready Meals ────────────────────────────────────────────────
('Haldiram Ready', 'seed'), ('MTR Ready to Eat', 'seed'), ('Kohinoor Ready', 'seed'),
('Tasty Bite', 'seed'), ('Global Village', 'seed'), ('Del Monte Ready', 'seed'),
('Kitchens of India', 'seed'), ('Ashoka', 'seed'), ('Nilon\'s', 'seed'),
('Nilons', 'seed'), ('Priya Gold', 'seed'), ('Mothers', 'seed'),
-- ── More Condiments & Sauces ──────────────────────────────────────────────────
('Maggi Masala', 'seed'), ('Ching\'s Red Chilli', 'seed'),
('American Garden', 'seed'), ('Borges', 'seed'), ('Figaro', 'seed'),
('D\'Alive', 'seed'), ('Rao\'s', 'seed'), ('Prego', 'seed'),
('Ragu', 'seed'), ('Annie\'s', 'seed'), ('Mapro', 'seed'),
('Mala\'s', 'seed'), ('Rose', 'seed'), ('Roohafza', 'seed'),
('Dabur Hommade', 'seed'), ('Real Activ', 'seed'),
-- ── More Personal Care ────────────────────────────────────────────────────────
('Beardo', 'seed'), ('Man Arden', 'seed'), ('Ustraa', 'seed'),
('The Man Company', 'seed'), ('Bombay Shaving Company', 'seed'),
('Bella Vita', 'seed'), ('MCaffeine', 'seed'), ('Minimalist', 'seed'),
('Dot & Key', 'seed'), ('Pilgrim', 'seed'), ('Re\'equil', 'seed'),
('Derma Co', 'seed'), ('Acne Star', 'seed'), ('Clearasil', 'seed'),
('Clean & Clear', 'seed'), ('Himalaya Face', 'seed'), ('Everyuth', 'seed'),
('VLCC', 'seed'), ('Lotus Herbals', 'seed'), ('Biotique Bio', 'seed'),
('Forest Essentials', 'seed'), ('Kama Ayurveda', 'seed'),
('Khadi Natural', 'seed'), ('Khadi', 'seed'), ('Vedix', 'seed'),
('Tresemme Keratin', 'seed'), ('Dove Hair', 'seed'), ('Pantene Pro-V', 'seed'),
-- ── More Household ────────────────────────────────────────────────────────────
('Pif Paf', 'seed'), ('Raid', 'seed'), ('Kala HIT', 'seed'),
('Odonil', 'seed'), ('Odomos', 'seed'), ('Naphthalene', 'seed'),
('Ambipur', 'seed'), ('Air Wick', 'seed'), ('Febreze', 'seed'),
('Dettol Surface', 'seed'), ('Lizol Advanced', 'seed'), ('Nimyle', 'seed'),
('Wipro Safewash', 'seed'), ('Purity', 'seed'), ('Surf', 'seed'),
('Rin Advanced', 'seed'), ('Comfort Fabric', 'seed'), ('Syclone', 'seed'),
-- ── Frozen & Ice Cream ────────────────────────────────────────────────────────
('Cream Bell', 'seed'), ('Creambell', 'seed'), ('Naturals Ice Cream', 'seed'),
('Vadilal Ice Cream', 'seed'), ('Amul Ice Cream', 'seed'),
('Mother Dairy Ice Cream', 'seed'), ('Baskin Robbins', 'seed'),
('Havmor', 'seed'), ('London Dairy', 'seed'), ('Gelato Vinto', 'seed'),
('NIC', 'seed'), ('Magnum', 'seed'), ('Cornetto', 'seed'),
-- ── More Bakery & Breads ──────────────────────────────────────────────────────
('English Oven', 'seed'), ('Harvest Gold', 'seed'), ('Modern', 'seed'),
('Wibs', 'seed'), ('Nourish Organics', 'seed'), ('Baker Street', 'seed'),
('The Baker\'s Dozen', 'seed'), ('Theobroma', 'seed'), ('La Folie', 'seed'),
-- ── More Cereals & Breakfast ──────────────────────────────────────────────────
('Corn Flakes', 'seed'), ('Chocos', 'seed'), ('Froot Loops', 'seed'),
('Honey Loops', 'seed'), ('Milo', 'seed'), ('Ovaltine', 'seed'),
('Dr. Oetker Muesli', 'seed'), ('Yoga Bar Muesli', 'seed'),
('Slurrp Farm', 'seed'), ('Little Millet', 'seed'), ('Early Foods', 'seed'),
-- ── Electronics & Accessories ─────────────────────────────────────────────────
('boAt', 'seed'), ('Noise', 'seed'), ('Realme', 'seed'), ('Oneplus', 'seed'),
('OnePlus', 'seed'), ('Oppo', 'seed'), ('Vivo', 'seed'), ('Samsung', 'seed'),
('Apple', 'seed'), ('MI', 'seed'), ('Xiaomi', 'seed'), ('Redmi', 'seed'),
('Syska', 'seed'), ('Portronics', 'seed'), ('Zebronics', 'seed'),
-- ── International Brands common in India ─────────────────────────────────────
('Kinder', 'seed'), ('Milka', 'seed'), ('Haribo', 'seed'), ('Skittles', 'seed'),
('M&M\'s', 'seed'), ('Reese\'s', 'seed'), ('Lay\'s Maxx', 'seed'),
('Pringles Sour Cream', 'seed'), ('Ritz', 'seed'), ('Oreo Mini', 'seed'),
('Pepperidge Farm', 'seed'), ('Nabisco', 'seed'), ('Nature Valley', 'seed'),
('Quaker Oats', 'seed'), ('Tropicana Pure', 'seed'), ('Welch\'s', 'seed'),
('Ocean Spray', 'seed'), ('Dole', 'seed'), ('Del Monte Fruit', 'seed'),
-- ── Meat & Poultry ────────────────────────────────────────────────────────────
('Licious', 'seed'), ('FreshToHome', 'seed'), ('Zappfresh', 'seed'),
('TenderCuts', 'seed'), ('Nandu\'s', 'seed'), ('Nandus', 'seed'),
('Kegg Farms', 'seed'), ('Country Delight Eggs', 'seed'),
('Bagrry\'s Eggs', 'seed'), ('Eggoz', 'seed'),
-- ── BB Now & Swiggy Instamart brands ─────────────────────────────────────────
-- Brands discovered from BB Now (BigBasket Now) invoices
('Go Zero', 'seed'),     -- premium ice cream brand (seen in BB Now bills)
('Crax', 'seed'),        -- Bikanervala snacks (Crax Masala Punch Chips)
-- Brands discovered from Swiggy Instamart invoices
('Laxmipati', 'seed'),   -- regional flour/grain brand (Laxmipati Rice Poha)
('Talod', 'seed'),       -- regional Gujarat snack brand (Talod Dalwada Flour)
('NOICE', 'seed'),       -- packaged snack brand (NOICE Salted Potato Wafers)
('Dr Trust', 'seed');    -- healthcare/medical devices brand (Dr Trust Orthopaedic Heat Belt)

-- ── HSN Category dictionary ───────────────────────────────────────────────────
-- Maps HSN chapter (2-digit) and sub-chapter (4-digit) to human-readable category.
-- 4-digit entries take priority over 2-digit during lookup.
CREATE TABLE IF NOT EXISTS hsn_categories (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  chapter  VARCHAR(8) NOT NULL,
  category VARCHAR(100) NOT NULL,
  UNIQUE KEY uniq_hsn_chapter (chapter)
);

INSERT IGNORE INTO hsn_categories (chapter, category) VALUES
-- Chapter 01 — Live Animals
('01', 'Meat & Poultry'),
-- Chapter 02 — Meat
('02', 'Meat & Poultry'),
('0201', 'Beef'), ('0202', 'Beef Frozen'), ('0203', 'Pork'), ('0207', 'Poultry'),
-- Chapter 03 — Fish
('03', 'Fish & Seafood'),
('0301', 'Live Fish'), ('0302', 'Fresh Fish'), ('0303', 'Frozen Fish'),
('0304', 'Fish Fillets'), ('0306', 'Crustaceans'), ('0307', 'Molluscs'),
-- Chapter 04 — Dairy & Eggs
('04', 'Dairy & Eggs'),
('0401', 'Milk'), ('0402', 'Milk Powder'), ('0403', 'Curd & Yogurt'),
('0404', 'Whey'), ('0405', 'Butter & Ghee'), ('0406', 'Cheese'),
('0407', 'Eggs'), ('0408', 'Egg Products'),
-- Chapter 07 — Vegetables
('07', 'Vegetables'),
('0701', 'Potatoes'), ('0702', 'Tomatoes'), ('0703', 'Onions & Garlic'),
('0704', 'Cabbage & Cauliflower'), ('0706', 'Carrots'), ('0707', 'Cucumbers'),
('0709', 'Other Vegetables'), ('0710', 'Frozen Vegetables'),
('0711', 'Preserved Vegetables'), ('0713', 'Dried Legumes'),
-- Chapter 08 — Fruits & Nuts
('08', 'Fruits & Nuts'),
('0801', 'Coconut'), ('0802', 'Nuts'), ('0803', 'Bananas'),
('0804', 'Mangoes & Dates'), ('0805', 'Citrus Fruits'), ('0806', 'Grapes'),
('0807', 'Melons'), ('0808', 'Apples & Pears'), ('0809', 'Stone Fruits'),
('0810', 'Other Fresh Fruits'), ('0811', 'Frozen Fruits'), ('0813', 'Dried Fruits'),
-- Chapter 09 — Tea, Coffee, Spices
('09', 'Tea, Coffee & Spices'),
('0901', 'Coffee'), ('0902', 'Tea'), ('0903', 'Mate'),
('0904', 'Pepper'), ('0905', 'Vanilla'), ('0906', 'Cinnamon'),
('0907', 'Cloves'), ('0908', 'Nutmeg & Mace'), ('0909', 'Seeds & Spices'),
('0910', 'Ginger, Turmeric & Mixed Spices'),
-- Chapter 10 — Cereals
('10', 'Cereals & Grains'),
('1001', 'Wheat'), ('1002', 'Rye'), ('1003', 'Barley'), ('1004', 'Oats'),
('1005', 'Corn / Maize'), ('1006', 'Rice'), ('1007', 'Sorghum'), ('1008', 'Millets'),
-- Chapter 11 — Milling Products
('11', 'Flour & Grain Products'),
('1101', 'Wheat Flour'), ('1102', 'Cereal Flours'), ('1103', 'Groats & Meal'),
('1104', 'Processed Cereals'), ('1105', 'Potato Flour'), ('1106', 'Legume Flour'),
('1107', 'Malt'), ('1108', 'Starches'),
-- Chapter 12 — Oil Seeds
('12', 'Oilseeds'),
-- Chapter 15 — Oils & Fats
('15', 'Oils & Fats'),
('1507', 'Soybean Oil'), ('1508', 'Groundnut Oil'), ('1509', 'Olive Oil'),
('1511', 'Palm Oil'), ('1512', 'Sunflower Oil'), ('1514', 'Mustard Oil'),
('1515', 'Other Vegetable Oils'), ('1516', 'Hydrogenated Oils'),
-- Chapter 16 — Prepared Meat & Fish
('16', 'Meat & Fish Preparations'),
('1601', 'Sausages'), ('1602', 'Prepared Meat'), ('1603', 'Fish Extracts'),
('1604', 'Prepared Fish'), ('1605', 'Prepared Crustaceans'),
-- Chapter 17 — Sugar
('17', 'Sugar & Confectionery'),
('1701', 'Cane Sugar'), ('1702', 'Other Sugars'), ('1703', 'Molasses'),
('1704', 'Sugar Confectionery'),
-- Chapter 18 — Cocoa
('18', 'Cocoa & Chocolate'),
('1801', 'Cocoa Beans'), ('1802', 'Cocoa Shells'), ('1803', 'Cocoa Paste'),
('1804', 'Cocoa Butter'), ('1805', 'Cocoa Powder'), ('1806', 'Chocolate'),
-- Chapter 19 — Bakery & Cereals
('19', 'Bakery & Cereals'),
('1901', 'Malt Extract & Baby Food'), ('1902', 'Pasta & Noodles'),
('1903', 'Tapioca'), ('1904', 'Breakfast Cereals'), ('1905', 'Biscuits & Bread'),
-- Chapter 20 — Processed Vegetables & Fruits
('20', 'Packaged Fruits & Vegetables'),
('2001', 'Pickled Vegetables'), ('2002', 'Tomatoes Preserved'), ('2003', 'Mushrooms'),
('2004', 'Frozen Vegetables Prepared'), ('2005', 'Non-frozen Vegetables Prepared'),
('2006', 'Candied Fruits'), ('2007', 'Jams & Jellies'), ('2008', 'Fruit Preparations'),
('2009', 'Fruit & Vegetable Juices'),
-- Chapter 21 — Misc Food Preparations
('21', 'Snacks & Food Preparations'),
('2101', 'Extracts & Essences'), ('2102', 'Yeast & Baking Powder'),
('2103', 'Sauces & Condiments'), ('2104', 'Soups & Broths'),
('2105', 'Ice Cream'), ('2106', 'Food Preparations NEC'),
-- Chapter 22 — Beverages
('22', 'Beverages'),
('2201', 'Water & Ice'), ('2202', 'Soft Drinks'), ('2203', 'Beer'),
('2204', 'Wine'), ('2205', 'Vermouth'), ('2206', 'Other Fermented'),
('2207', 'Ethyl Alcohol'), ('2208', 'Spirits'), ('2209', 'Vinegar'),
-- Chapter 24 — Tobacco
('24', 'Tobacco'),
-- Chapter 30 — Pharma & Healthcare
('30', 'Medicines & Healthcare'),
('3003', 'Medicines Mixed'), ('3004', 'Medicines Dosage'),
('3005', 'Bandages & Dressings'), ('3006', 'Pharmaceutical Goods'),
-- Chapter 33 — Personal Care
('33', 'Personal Care'),
('3301', 'Essential Oils'), ('3302', 'Aromatic Mixtures'),
('3303', 'Perfumes'), ('3304', 'Beauty & Make-up'), ('3305', 'Hair Products'),
('3306', 'Oral Hygiene'), ('3307', 'Shaving Products'), ('3308', 'Deodorants'),
-- Chapter 34 — Household Cleaning
('34', 'Household Cleaning'),
('3401', 'Soap'), ('3402', 'Detergents'), ('3403', 'Lubricants'),
('3405', 'Polishes'), ('3406', 'Candles'), ('3407', 'Putties'),
-- Chapter 39 — Plastics
('39', 'Household Plastics'),
-- Chapter 48 — Paper & Stationery
('48', 'Stationery & Paper'),
-- Chapter 61-63 — Clothing & Textiles
('61', 'Clothing'), ('62', 'Clothing'), ('63', 'Home Textiles'),
-- Chapter 85 — Electronics
('85', 'Electronics'),
('8501', 'Motors & Generators'), ('8504', 'Transformers'),
('8516', 'Electric Appliances'), ('8517', 'Phones & Communication'),
('8519', 'Sound Equipment'), ('8528', 'Monitors & TVs'),
-- Chapter 94 — Furniture
('94', 'Furniture'),
-- Service HSN codes (common on food delivery platform invoices)
('9968', 'Delivery & Logistics Services'),
('9969', 'Logistics & Courier Services'),
('9985', 'Support Services'),
('9988', 'Manufacturing Services'),
('998549', 'Platform Handling / Bag Charge'),
('996819', 'Platform Surge Charge'),
('996813', 'Platform Delivery Charge'),
-- Chapter 90 — Medical & Orthopaedic Devices (seen on Swiggy Instamart health product bills)
('90', 'Medical & Orthopaedic Devices'),
('9021', 'Orthopaedic & Prosthetic Appliances'),
-- Miscellaneous service codes seen on Swiggy Instamart invoices
('999799', 'Other Miscellaneous Services');
