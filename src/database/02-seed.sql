-- Extract Bill & Pay — Seed Data
-- Auto-executed by MySQL Docker container on first boot
-- Uses INSERT IGNORE to be idempotent

-- ── Admin user ────────────────────────────────────────────────────────────────
-- Default password: Admin@123 — change after first login
INSERT IGNORE INTO users (id, name, email, phone, role, is_onboarded, password_hash) VALUES
(1, 'Admin', 'admin@billpay.com', '9999999999', 'admin', TRUE, '$2b$12$XC1Zirmv9UYbII6Cb66FA.S6brBTj.Q4zo7ZBmxlZS/O6BmqUl84.');

-- ── Test users ────────────────────────────────────────────────────────────────
INSERT IGNORE INTO users (id, name, email, phone, gender, role, upi_id, wallet_balance, is_onboarded, is_active, referral_code, coin_balance) VALUES
(2,  'Priya Sharma',   'priya.sharma@gmail.com',   '9876543210', 'female', 'user', 'priya@okaxis',   142.50, TRUE,  TRUE,  'PRIYA2',   340),
(3,  'Rohan Mehta',    'rohan.mehta@gmail.com',    '9871234560', 'male',   'user', 'rohan@okicici',  89.00,  TRUE,  TRUE,  'ROHAN3',   210),
(4,  'Anjali Singh',   'anjali.singh@yahoo.com',   '9867890123', 'female', 'user', NULL,              0.00,  TRUE,  TRUE,  'ANJAL4',   125),
(5,  'Vikram Patel',   'vikram.patel@gmail.com',   '9845678901', 'male',   'user', 'vikram@oksbi',   310.00, TRUE,  TRUE,  'VIKRA5',   580),
(6,  'Neha Gupta',     'neha.gupta@hotmail.com',   '9834567890', 'female', 'user', NULL,              0.00,  TRUE,  FALSE, 'NEHA6',    95),
(7,  'Amit Kumar',     'amit.kumar@gmail.com',     '9823456789', 'male',   'user', 'amit@okhdfc',    55.00,  TRUE,  TRUE,  'AMITK7',   160),
(8,  'Deepika Nair',   'deepika.nair@gmail.com',   '9812345678', 'female', 'user', NULL,              0.00,  FALSE, TRUE,  NULL,       0),
(9,  'Suresh Reddy',   'suresh.reddy@gmail.com',   '9801234567', 'male',   'user', 'suresh@okaxis',  225.00, TRUE,  TRUE,  'SURESH9',  430),
(10, 'Kavya Iyer',     'kavya.iyer@gmail.com',     '9798765432', 'female', 'user', NULL,              0.00,  TRUE,  TRUE,  'KAVYA10',  75),
(11, 'Rahul Verma',    'rahul.verma@outlook.com',  '9787654321', 'male',   'user', 'rahul@okmobikwik', 0.00, TRUE,  TRUE,  'RAHUL11',  200),
(12, 'Sonal Joshi',    'sonal.joshi@gmail.com',    '9776543210', 'female', 'user', NULL,              15.00,  TRUE,  TRUE,  'SONAL12',  110);

-- ── Referral transactions ──────────────────────────────────────────────────────
INSERT IGNORE INTO referral_transactions (id, referrer_user_id, referred_user_id, coins_awarded) VALUES
(1, 2, 4,  115),
(2, 5, 7,  118),
(3, 9, 10, 112),
(4, 2, 11, 120);

-- ── Bills ─────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO bills
  (id, user_id, file_url, platform, order_id, total_amount, bill_date, status,
   rejection_reason, extracted_data, fraud_score, fraud_signals,
   reward_amount, coin_reward, reward_claimed, chest_opened)
VALUES
-- Priya — verified bills
(1,  2, 'https://storage.googleapis.com/billpay-dev/bills/sample_swiggy_1.pdf',
 'swiggy',   'SW-102938475610', 485.00, '2025-04-10', 'verified', NULL,
 '{"platform":"swiggy","order_id":"SW-102938475610","merchant_name":"Burger King","total_amount":485.00,"items":[{"name":"Whopper Meal","quantity":1,"price":285.00},{"name":"Fries","quantity":1,"price":120.00},{"name":"Coke","quantity":1,"price":80.00}]}',
 0, NULL, 8.50, 118, TRUE, TRUE),

(2,  2, 'https://storage.googleapis.com/billpay-dev/bills/sample_zomato_1.pdf',
 'zomato',   'ZOM-7364829103', 620.00, '2025-04-05', 'verified', NULL,
 '{"platform":"zomato","order_id":"ZOM-7364829103","merchant_name":"Dominos Pizza","total_amount":620.00,"items":[{"name":"Pepperoni Pizza","quantity":1,"price":450.00},{"name":"Garlic Bread","quantity":1,"price":170.00}]}',
 0, NULL, 6.00, 112, TRUE, TRUE),

(3,  2, 'https://storage.googleapis.com/billpay-dev/bills/sample_blinkit_1.pdf',
 'blinkit',  'BL-938271046511', 1240.00, '2025-03-28', 'verified', NULL,
 '{"platform":"blinkit","order_id":"BL-938271046511","merchant_name":"Blinkit","total_amount":1240.00,"items":[{"name":"Amul Butter 500g","quantity":2,"price":280.00},{"name":"Mother Dairy Milk 1L","quantity":3,"price":198.00},{"name":"Britannia Bread","quantity":1,"price":52.00},{"name":"Maggi Noodles 12pk","quantity":1,"price":180.00}]}',
 0, NULL, 31.50, 175, TRUE, TRUE),

-- Rohan — pending and rejected
(4,  3, 'https://storage.googleapis.com/billpay-dev/bills/sample_zepto_1.pdf',
 'zepto',    'ZPT-562738192047', 890.00, '2025-04-12', 'pending', NULL,
 '{"platform":"zepto","order_id":"ZPT-562738192047","merchant_name":"Zepto","total_amount":890.00,"items":[{"name":"Haldirams Bhujia 1kg","quantity":1,"price":320.00},{"name":"Red Bull 4pk","quantity":1,"price":570.00}]}',
 12, '{"duplicate_image":false,"order_id_mismatch":false,"high_value":true}',
 NULL, NULL, FALSE, FALSE),

(5,  3, NULL,
 'swiggy',   NULL, NULL, NULL, 'failed', 'Server restarted while processing — please re-upload',
 NULL, 0, NULL, NULL, NULL, FALSE, FALSE),

(6,  3, 'https://storage.googleapis.com/billpay-dev/bills/sample_swiggy_2.pdf',
 'swiggy',   'SW-748291038475', 310.00, '2025-03-22', 'rejected', 'Bill image appears edited — total amount inconsistent with line items',
 '{"platform":"swiggy","order_id":"SW-748291038475","merchant_name":"KFC","total_amount":310.00,"items":[{"name":"Chicken Bucket","quantity":1,"price":199.00}]}',
 78, '{"total_mismatch":true,"amount_discrepancy":111.00}',
 NULL, NULL, FALSE, FALSE),

-- Anjali — verified
(7,  4, 'https://storage.googleapis.com/billpay-dev/bills/sample_blinkit_2.pdf',
 'blinkit',  'BL-847362910284', 760.00, '2025-04-08', 'verified', NULL,
 '{"platform":"blinkit","order_id":"BL-847362910284","merchant_name":"Blinkit","total_amount":760.00,"items":[{"name":"Dove Shampoo 650ml","quantity":1,"price":320.00},{"name":"Dettol Handwash 2pk","quantity":1,"price":180.00},{"name":"Surf Excel 1kg","quantity":1,"price":260.00}]}',
 0, NULL, 11.50, 132, TRUE, TRUE),

-- Vikram — high uploader, all verified
(8,  5, 'https://storage.googleapis.com/billpay-dev/bills/sample_swiggy_3.pdf',
 'swiggy',   'SW-193847261038', 1850.00, '2025-04-14', 'verified', NULL,
 '{"platform":"swiggy","order_id":"SW-193847261038","merchant_name":"Pizza Hut","total_amount":1850.00,"items":[{"name":"Veg Supreme Pizza XL","quantity":2,"price":1200.00},{"name":"Pasta","quantity":1,"price":350.00},{"name":"Mocktail","quantity":2,"price":300.00}]}',
 0, NULL, 48.00, 210, TRUE, TRUE),

(9,  5, 'https://storage.googleapis.com/billpay-dev/bills/sample_zepto_2.pdf',
 'zepto',    'ZPT-829374651092', 2340.00, '2025-04-09', 'verified', NULL,
 '{"platform":"zepto","order_id":"ZPT-829374651092","merchant_name":"Zepto","total_amount":2340.00,"items":[{"name":"Kelloggs Cornflakes 1.2kg","quantity":1,"price":420.00},{"name":"Quaker Oats 2kg","quantity":1,"price":380.00},{"name":"Ensure Powder 400g","quantity":1,"price":790.00},{"name":"Protinex 400g","quantity":1,"price":750.00}]}',
 0, NULL, 62.00, 255, TRUE, TRUE),

(10, 5, 'https://storage.googleapis.com/billpay-dev/bills/sample_zomato_2.pdf',
 'zomato',   'ZOM-4729381047', 540.00, '2025-04-02', 'verified', NULL,
 '{"platform":"zomato","order_id":"ZOM-4729381047","merchant_name":"Barbeque Nation","total_amount":540.00,"items":[{"name":"Starter Platter","quantity":1,"price":390.00},{"name":"Dessert","quantity":1,"price":150.00}]}',
 5, '{"high_value":false}',
 7.50, 116, TRUE, TRUE),

(11, 5, 'https://storage.googleapis.com/billpay-dev/bills/sample_blinkit_3.pdf',
 'blinkit',  'BL-563829104756', 3100.00, '2025-03-30', 'verified', NULL,
 '{"platform":"blinkit","order_id":"BL-563829104756","merchant_name":"Blinkit","total_amount":3100.00,"items":[{"name":"Bosch Mixer Grinder","quantity":1,"price":2800.00},{"name":"Milton Flask","quantity":1,"price":300.00}]}',
 18, '{"high_value":true}',
 35.00, 185, TRUE, TRUE),

-- Neha — blocked user, has old bills
(12, 6, 'https://storage.googleapis.com/billpay-dev/bills/sample_zepto_3.pdf',
 'zepto',    'ZPT-102938475647', 420.00, '2025-03-15', 'rejected', 'Duplicate bill — same order ID submitted twice',
 '{"platform":"zepto","order_id":"ZPT-102938475647","merchant_name":"Zepto","total_amount":420.00}',
 85, '{"duplicate_order_id":true,"duplicate_image":true}',
 NULL, NULL, FALSE, FALSE),

-- Amit — queued and processing
(13, 7, 'https://storage.googleapis.com/billpay-dev/bills/sample_swiggy_4.pdf',
 'swiggy',   'SW-938475610293', 275.00, '2025-04-16', 'queued', NULL,
 NULL, 0, NULL, NULL, NULL, FALSE, FALSE),

(14, 7, 'https://storage.googleapis.com/billpay-dev/bills/sample_blinkit_4.pdf',
 'blinkit',  'BL-192038475610', 650.00, '2025-04-15', 'pending', NULL,
 '{"platform":"blinkit","order_id":"BL-192038475610","merchant_name":"Blinkit","total_amount":650.00,"items":[{"name":"Amul Gold Milk 6pk","quantity":1,"price":390.00},{"name":"Cadbury Silk","quantity":2,"price":260.00}]}',
 8, '{}',
 NULL, NULL, FALSE, FALSE),

-- Suresh — mix of verified and pending
(15, 9, 'https://storage.googleapis.com/billpay-dev/bills/sample_swiggy_5.pdf',
 'swiggy',   'SW-847362910473', 920.00, '2025-04-13', 'verified', NULL,
 '{"platform":"swiggy","order_id":"SW-847362910473","merchant_name":"McDonald\'s","total_amount":920.00,"items":[{"name":"McSpicy Meal","quantity":2,"price":680.00},{"name":"McFlurry","quantity":2,"price":240.00}]}',
 0, NULL, 9.50, 120, TRUE, TRUE),

(16, 9, 'https://storage.googleapis.com/billpay-dev/bills/sample_zomato_3.pdf',
 'zomato',   'ZOM-5839201473', 380.00, '2025-04-07', 'verified', NULL,
 '{"platform":"zomato","order_id":"ZOM-5839201473","merchant_name":"Subway","total_amount":380.00,"items":[{"name":"6-inch Sub","quantity":2,"price":300.00},{"name":"Cookies","quantity":2,"price":80.00}]}',
 0, NULL, 5.50, 113, TRUE, TRUE),

(17, 9, 'https://storage.googleapis.com/billpay-dev/bills/sample_zepto_4.pdf',
 'zepto',    'ZPT-739201847365', 1580.00, '2025-04-01', 'pending', NULL,
 '{"platform":"zepto","order_id":"ZPT-739201847365","merchant_name":"Zepto","total_amount":1580.00,"items":[{"name":"Horlicks 1kg","quantity":1,"price":420.00},{"name":"Bournvita 1kg","quantity":1,"price":380.00},{"name":"Magnum Ice Cream 4pk","quantity":1,"price":780.00}]}',
 15, '{"high_value":true}',
 NULL, NULL, FALSE, FALSE),

-- Rahul — high fraud score bill
(18, 11, 'https://storage.googleapis.com/billpay-dev/bills/sample_swiggy_6.pdf',
 'swiggy',   'SW-029384756102', 8500.00, '2025-04-11', 'pending', NULL,
 '{"platform":"swiggy","order_id":"SW-029384756102","merchant_name":"Five Star Hotel Catering","total_amount":8500.00,"items":[{"name":"Catering Package","quantity":1,"price":8500.00}]}',
 91, '{"high_value":true,"merchant_suspicious":true,"amount_outlier":true,"order_id_mismatch":true}',
 NULL, NULL, FALSE, FALSE),

-- Sonal — verified
(19, 12, 'https://storage.googleapis.com/billpay-dev/bills/sample_blinkit_5.pdf',
 'blinkit',  'BL-736492018475', 490.00, '2025-04-06', 'verified', NULL,
 '{"platform":"blinkit","order_id":"BL-736492018475","merchant_name":"Blinkit","total_amount":490.00,"items":[{"name":"Himalaya Face Wash","quantity":2,"price":180.00},{"name":"Nivea Body Lotion","quantity":1,"price":310.00}]}',
 0, NULL, 5.00, 111, TRUE, TRUE),

(20, 12, 'https://storage.googleapis.com/billpay-dev/bills/sample_swiggy_7.pdf',
 'swiggy',   'SW-102847365091', 340.00, '2025-03-25', 'verified', NULL,
 '{"platform":"swiggy","order_id":"SW-102847365091","merchant_name":"Fassos","total_amount":340.00,"items":[{"name":"Kathi Roll Combo","quantity":1,"price":250.00},{"name":"Brownie","quantity":1,"price":90.00}]}',
 0, NULL, 4.00, 110, TRUE, TRUE);

-- ── Cashback transactions ──────────────────────────────────────────────────────
INSERT IGNORE INTO cashback_transactions (id, user_id, bill_id, amount, type, description) VALUES
-- Priya
(1,  2,  1,  8.50, 'credit', 'Cashback for Swiggy order SW-102938475610'),
(2,  2,  2,  6.00, 'credit', 'Cashback for Zomato order ZOM-7364829103'),
(3,  2,  3,  31.50,'credit', 'Cashback for Blinkit order BL-938271046511'),
-- Anjali
(4,  4,  7,  11.50,'credit', 'Cashback for Blinkit order BL-847362910284'),
-- Vikram
(5,  5,  8,  48.00,'credit', 'Cashback for Swiggy order SW-193847261038'),
(6,  5,  9,  62.00,'credit', 'Cashback for Zepto order ZPT-829374651092'),
(7,  5,  10, 7.50, 'credit', 'Cashback for Zomato order ZOM-4729381047'),
(8,  5,  11, 35.00,'credit', 'Cashback for Blinkit order BL-563829104756'),
(9,  5,  NULL, 90.00,'debit','Withdrawal via UPI vikram@oksbi'),
-- Suresh
(10, 9,  15, 9.50, 'credit', 'Cashback for Swiggy order SW-847362910473'),
(11, 9,  16, 5.50, 'credit', 'Cashback for Zomato order ZOM-5839201473'),
-- Amit
(12, 7,  NULL, 20.00,'credit','Welcome bonus'),
-- Sonal
(13, 12, 19, 5.00, 'credit', 'Cashback for Blinkit order BL-736492018475'),
(14, 12, 20, 4.00, 'credit', 'Cashback for Swiggy order SW-102847365091');

-- ── More users ────────────────────────────────────────────────────────────────
INSERT IGNORE INTO users (id, name, email, phone, gender, role, upi_id, wallet_balance, is_onboarded, is_active, referral_code, coin_balance, created_at) VALUES
(13, 'Arjun Nair',      'arjun.nair@gmail.com',      '9765432109', 'male',   'user', 'arjun@okaxis',    0.00,   TRUE,  TRUE,  'ARJUN13',  50,  '2025-01-15 10:00:00'),
(14, 'Pooja Desai',     'pooja.desai@gmail.com',      '9754321098', 'female', 'user', 'pooja@okhdfc',    78.00,  TRUE,  TRUE,  'POOJA14',  290, '2025-01-22 11:30:00'),
(15, 'Manish Tiwari',   'manish.tiwari@yahoo.com',    '9743210987', 'male',   'user', NULL,              0.00,   TRUE,  TRUE,  'MANIS15',  130, '2025-02-03 09:15:00'),
(16, 'Sneha Pillai',    'sneha.pillai@gmail.com',     '9732109876', 'female', 'user', 'sneha@oksbi',     195.50, TRUE,  TRUE,  'SNEHA16',  410, '2025-02-10 14:00:00'),
(17, 'Kiran Rao',       'kiran.rao@gmail.com',        '9721098765', 'male',   'user', NULL,              0.00,   TRUE,  FALSE, 'KIRAN17',  60,  '2025-02-18 08:45:00'),
(18, 'Divya Menon',     'divya.menon@hotmail.com',    '9710987654', 'female', 'user', 'divya@okicici',   42.00,  TRUE,  TRUE,  'DIVYA18',  175, '2025-02-25 16:20:00'),
(19, 'Prakash Hegde',   'prakash.hegde@gmail.com',    '9709876543', 'male',   'user', NULL,              0.00,   FALSE, TRUE,  NULL,       0,   '2025-03-01 12:00:00'),
(20, 'Ritika Saxena',   'ritika.saxena@gmail.com',    '9698765432', 'female', 'user', 'ritika@okaxis',   330.00, TRUE,  TRUE,  'RITIK20',  620, '2025-03-05 10:30:00'),
(21, 'Nikhil Jain',     'nikhil.jain@gmail.com',      '9687654321', 'male',   'user', 'nikhil@okhdfc',   0.00,   TRUE,  TRUE,  'NIKHI21',  95,  '2025-03-12 13:00:00'),
(22, 'Ananya Bose',     'ananya.bose@gmail.com',      '9676543210', 'female', 'user', NULL,              22.50,  TRUE,  TRUE,  'ANANY22',  240, '2025-03-18 09:00:00'),
(23, 'Tarun Kapoor',    'tarun.kapoor@gmail.com',     '9665432109', 'male',   'user', 'tarun@oksbi',     115.00, TRUE,  TRUE,  'TARUN23',  380, '2025-03-22 15:45:00'),
(24, 'Shruti Agarwal',  'shruti.agarwal@gmail.com',   '9654321098', 'female', 'user', NULL,              0.00,   TRUE,  TRUE,  'SHRUT24',  155, '2025-03-28 11:00:00'),
(25, 'Vivek Chandra',   'vivek.chandra@gmail.com',    '9643210987', 'male',   'user', 'vivek@okaxis',    88.00,  TRUE,  TRUE,  'VIVEK25',  270, '2025-04-01 08:00:00'),
(26, 'Meera Krishnan',  'meera.krishnan@gmail.com',   '9632109876', 'female', 'user', NULL,              0.00,   TRUE,  TRUE,  'MEERA26',  190, '2025-04-04 10:00:00'),
(27, 'Gaurav Malhotra', 'gaurav.malhotra@gmail.com',  '9621098765', 'male',   'user', 'gaurav@okicici',  260.00, TRUE,  TRUE,  'GAURA27',  500, '2025-04-06 09:30:00'),
(28, 'Ishaan Sethi',    'ishaan.sethi@outlook.com',   '9610987654', 'male',   'user', NULL,              0.00,   TRUE,  FALSE, 'ISHAA28',  30,  '2025-04-08 14:00:00'),
(29, 'Lavanya Suresh',  'lavanya.suresh@gmail.com',   '9609876543', 'female', 'user', 'lavanya@oksbi',   55.00,  TRUE,  TRUE,  'LAVAN29',  310, '2025-04-10 11:00:00'),
(30, 'Akash Pandey',    'akash.pandey@gmail.com',     '9598765432', 'male',   'user', NULL,              0.00,   TRUE,  TRUE,  'AKASH30',  85,  '2025-04-12 13:30:00');

-- ── More referral transactions ─────────────────────────────────────────────────
INSERT IGNORE INTO referral_transactions (id, referrer_user_id, referred_user_id, coins_awarded, created_at) VALUES
(5,  3,  13, 114, '2025-01-16 10:30:00'),
(6,  5,  14, 120, '2025-01-23 12:00:00'),
(7,  2,  15, 116, '2025-02-04 09:45:00'),
(8,  9,  16, 118, '2025-02-11 14:30:00'),
(9,  2,  18, 115, '2025-02-26 16:50:00'),
(10, 16, 20, 122, '2025-03-06 11:00:00'),
(11, 20, 22, 119, '2025-03-19 09:30:00'),
(12, 20, 23, 121, '2025-03-23 16:00:00'),
(13, 23, 25, 117, '2025-04-02 08:30:00'),
(14, 16, 27, 120, '2025-04-07 10:00:00'),
(15, 27, 29, 115, '2025-04-11 11:30:00');

-- ── More bills ────────────────────────────────────────────────────────────────
INSERT IGNORE INTO bills
  (id, user_id, file_url, platform, order_id, total_amount, bill_date, status,
   rejection_reason, extracted_data, fraud_score, fraud_signals,
   reward_amount, coin_reward, reward_claimed, chest_opened, created_at)
VALUES
-- Pooja — active uploader, mostly verified
(21, 14, 'https://storage.googleapis.com/billpay-dev/bills/u14_swiggy_1.pdf',
 'swiggy', 'SW-384756019283', 720.00, '2025-02-01', 'verified', NULL,
 '{"platform":"swiggy","order_id":"SW-384756019283","merchant_name":"Behrouz Biryani","total_amount":720.00,"items":[{"name":"Dum Biryani","quantity":2,"price":560.00},{"name":"Raita","quantity":1,"price":80.00},{"name":"Gulab Jamun","quantity":2,"price":80.00}]}',
 0, NULL, 18.00, 148, TRUE, TRUE, '2025-02-01 13:00:00'),

(22, 14, 'https://storage.googleapis.com/billpay-dev/bills/u14_zepto_1.pdf',
 'zepto', 'ZPT-019283746510', 1560.00, '2025-02-15', 'verified', NULL,
 '{"platform":"zepto","order_id":"ZPT-019283746510","merchant_name":"Zepto","total_amount":1560.00,"items":[{"name":"Aashirvaad Atta 10kg","quantity":1,"price":490.00},{"name":"Fortune Soyabean Oil 5L","quantity":1,"price":620.00},{"name":"Daawat Basmati Rice 5kg","quantity":1,"price":450.00}]}',
 0, NULL, 22.00, 158, TRUE, TRUE, '2025-02-15 10:00:00'),

(23, 14, 'https://storage.googleapis.com/billpay-dev/bills/u14_blinkit_1.pdf',
 'blinkit', 'BL-293847561029', 980.00, '2025-03-10', 'verified', NULL,
 '{"platform":"blinkit","order_id":"BL-293847561029","merchant_name":"Blinkit","total_amount":980.00,"items":[{"name":"Dove Body Wash 500ml","quantity":1,"price":320.00},{"name":"Head & Shoulders 675ml","quantity":1,"price":380.00},{"name":"Oral-B Toothbrush","quantity":2,"price":280.00}]}',
 0, NULL, 12.50, 136, TRUE, TRUE, '2025-03-10 11:00:00'),

(24, 14, 'https://storage.googleapis.com/billpay-dev/bills/u14_zomato_1.pdf',
 'zomato', 'ZOM-8374650192', 440.00, '2025-04-03', 'verified', NULL,
 '{"platform":"zomato","order_id":"ZOM-8374650192","merchant_name":"Faasos","total_amount":440.00,"items":[{"name":"Kathi Roll","quantity":2,"price":300.00},{"name":"Shake","quantity":1,"price":140.00}]}',
 0, NULL, 5.50, 113, TRUE, TRUE, '2025-04-03 20:00:00'),

-- Sneha — high value, high coins
(25, 16, 'https://storage.googleapis.com/billpay-dev/bills/u16_blinkit_1.pdf',
 'blinkit', 'BL-473829104756', 4200.00, '2025-02-20', 'verified', NULL,
 '{"platform":"blinkit","order_id":"BL-473829104756","merchant_name":"Blinkit","total_amount":4200.00,"items":[{"name":"Philips Air Fryer","quantity":1,"price":3500.00},{"name":"Prestige Pressure Cooker 3L","quantity":1,"price":700.00}]}',
 22, '{"high_value":true}',
 55.00, 225, TRUE, TRUE, '2025-02-20 15:00:00'),

(26, 16, 'https://storage.googleapis.com/billpay-dev/bills/u16_swiggy_1.pdf',
 'swiggy', 'SW-910283746501', 1180.00, '2025-03-05', 'verified', NULL,
 '{"platform":"swiggy","order_id":"SW-910283746501","merchant_name":"Barbeque Nation","total_amount":1180.00,"items":[{"name":"BBQ Platter for 2","quantity":1,"price":990.00},{"name":"Mocktails","quantity":2,"price":190.00}]}',
 0, NULL, 28.00, 168, TRUE, TRUE, '2025-03-05 19:30:00'),

(27, 16, 'https://storage.googleapis.com/billpay-dev/bills/u16_zepto_1.pdf',
 'zepto', 'ZPT-384756102938', 2890.00, '2025-04-01', 'verified', NULL,
 '{"platform":"zepto","order_id":"ZPT-384756102938","merchant_name":"Zepto","total_amount":2890.00,"items":[{"name":"Ensure Powder 900g","quantity":2,"price":1800.00},{"name":"Protinex Original 1kg","quantity":1,"price":1090.00}]}',
 0, NULL, 62.00, 250, TRUE, TRUE, '2025-04-01 10:00:00'),

-- Ritika — power user, most bills verified
(28, 20, 'https://storage.googleapis.com/billpay-dev/bills/u20_swiggy_1.pdf',
 'swiggy', 'SW-647382910475', 850.00, '2025-03-08', 'verified', NULL,
 '{"platform":"swiggy","order_id":"SW-647382910475","merchant_name":"Mainland China","total_amount":850.00,"items":[{"name":"Crispy Chicken","quantity":2,"price":520.00},{"name":"Fried Rice","quantity":1,"price":220.00},{"name":"Spring Rolls","quantity":1,"price":110.00}]}',
 0, NULL, 9.50, 122, TRUE, TRUE, '2025-03-08 20:00:00'),

(29, 20, 'https://storage.googleapis.com/billpay-dev/bills/u20_blinkit_1.pdf',
 'blinkit', 'BL-019283746510', 3650.00, '2025-03-15', 'verified', NULL,
 '{"platform":"blinkit","order_id":"BL-019283746510","merchant_name":"Blinkit","total_amount":3650.00,"items":[{"name":"Bosch Hand Blender","quantity":1,"price":2200.00},{"name":"Tupperware Set","quantity":1,"price":850.00},{"name":"Cello Water Bottles 6pk","quantity":1,"price":600.00}]}',
 20, '{"high_value":true}',
 48.00, 215, TRUE, TRUE, '2025-03-15 11:30:00'),

(30, 20, 'https://storage.googleapis.com/billpay-dev/bills/u20_zepto_1.pdf',
 'zepto', 'ZPT-201938475601', 1920.00, '2025-03-25', 'verified', NULL,
 '{"platform":"zepto","order_id":"ZPT-201938475601","merchant_name":"Zepto","total_amount":1920.00,"items":[{"name":"Kelloggs Muesli 1.4kg","quantity":1,"price":580.00},{"name":"Yoga Bar Oats 1kg","quantity":2,"price":760.00},{"name":"Quaker Oats 2kg","quantity":1,"price":580.00}]}',
 0, NULL, 28.00, 168, TRUE, TRUE, '2025-03-25 09:00:00'),

(31, 20, 'https://storage.googleapis.com/billpay-dev/bills/u20_zomato_1.pdf',
 'zomato', 'ZOM-1029384756', 680.00, '2025-04-05', 'verified', NULL,
 '{"platform":"zomato","order_id":"ZOM-1029384756","merchant_name":"Paradise Biryani","total_amount":680.00,"items":[{"name":"Hyderabadi Biryani","quantity":2,"price":580.00},{"name":"Raita","quantity":1,"price":100.00}]}',
 0, NULL, 8.00, 118, TRUE, TRUE, '2025-04-05 13:30:00'),

(32, 20, 'https://storage.googleapis.com/billpay-dev/bills/u20_swiggy_2.pdf',
 'swiggy', 'SW-384756201938', 425.00, '2025-04-14', 'queued', NULL,
 NULL, 0, NULL, NULL, NULL, FALSE, FALSE, '2025-04-14 12:00:00'),

-- Gaurav — consistent uploader
(33, 27, 'https://storage.googleapis.com/billpay-dev/bills/u27_swiggy_1.pdf',
 'swiggy', 'SW-756019283847', 560.00, '2025-04-07', 'verified', NULL,
 '{"platform":"swiggy","order_id":"SW-756019283847","merchant_name":"Wow Momo","total_amount":560.00,"items":[{"name":"Fried Momo 20pcs","quantity":2,"price":380.00},{"name":"Soup","quantity":2,"price":180.00}]}',
 0, NULL, 6.50, 115, TRUE, TRUE, '2025-04-07 19:00:00'),

(34, 27, 'https://storage.googleapis.com/billpay-dev/bills/u27_blinkit_1.pdf',
 'blinkit', 'BL-756201938470', 2100.00, '2025-04-10', 'verified', NULL,
 '{"platform":"blinkit","order_id":"BL-756201938470","merchant_name":"Blinkit","total_amount":2100.00,"items":[{"name":"Bajaj Mixer Grinder","quantity":1,"price":1800.00},{"name":"Pigeon Kettle","quantity":1,"price":300.00}]}',
 18, '{"high_value":true}',
 36.00, 190, TRUE, TRUE, '2025-04-10 10:30:00'),

(35, 27, 'https://storage.googleapis.com/billpay-dev/bills/u27_zepto_1.pdf',
 'zepto', 'ZPT-938475620193', 760.00, '2025-04-13', 'pending', NULL,
 '{"platform":"zepto","order_id":"ZPT-938475620193","merchant_name":"Zepto","total_amount":760.00,"items":[{"name":"Haldirams Aloo Bhujia 1kg","quantity":1,"price":280.00},{"name":"Bikaji Namkeen Mix 1kg","quantity":1,"price":240.00},{"name":"Bingo Mad Angles","quantity":4,"price":240.00}]}',
 5, '{}',
 NULL, NULL, FALSE, FALSE, '2025-04-13 16:00:00'),

-- Lavanya — new active user
(36, 29, 'https://storage.googleapis.com/billpay-dev/bills/u29_swiggy_1.pdf',
 'swiggy', 'SW-201938475647', 390.00, '2025-04-11', 'verified', NULL,
 '{"platform":"swiggy","order_id":"SW-201938475647","merchant_name":"Dominos Pizza","total_amount":390.00,"items":[{"name":"Margherita Pizza","quantity":1,"price":269.00},{"name":"Pepsi 500ml","quantity":2,"price":121.00}]}',
 0, NULL, 5.00, 112, TRUE, TRUE, '2025-04-11 20:30:00'),

(37, 29, 'https://storage.googleapis.com/billpay-dev/bills/u29_zepto_1.pdf',
 'zepto', 'ZPT-475620193847', 1380.00, '2025-04-15', 'pending', NULL,
 '{"platform":"zepto","order_id":"ZPT-475620193847","merchant_name":"Zepto","total_amount":1380.00,"items":[{"name":"Surf Excel 4kg","quantity":1,"price":580.00},{"name":"Ariel Matic 3kg","quantity":1,"price":480.00},{"name":"Comfort Fabric Conditioner","quantity":2,"price":320.00}]}',
 8, '{}',
 NULL, NULL, FALSE, FALSE, '2025-04-15 11:00:00'),

-- Akash — just joined, one pending bill
(38, 30, 'https://storage.googleapis.com/billpay-dev/bills/u30_blinkit_1.pdf',
 'blinkit', 'BL-620193847560', 580.00, '2025-04-13', 'pending', NULL,
 '{"platform":"blinkit","order_id":"BL-620193847560","merchant_name":"Blinkit","total_amount":580.00,"items":[{"name":"Amul Taaza 1L","quantity":4,"price":220.00},{"name":"Britannia Bread","quantity":2,"price":104.00},{"name":"Amul Butter 100g","quantity":2,"price":120.00},{"name":"Amul Cheese Slices","quantity":1,"price":136.00}]}',
 0, NULL, NULL, NULL, FALSE, FALSE, '2025-04-13 08:30:00'),

-- Tarun — one verified, one rejected fraud
(39, 23, 'https://storage.googleapis.com/billpay-dev/bills/u23_swiggy_1.pdf',
 'swiggy', 'SW-938472016384', 680.00, '2025-04-02', 'verified', NULL,
 '{"platform":"swiggy","order_id":"SW-938472016384","merchant_name":"Truffles","total_amount":680.00,"items":[{"name":"Truffle Burger","quantity":2,"price":480.00},{"name":"Milkshake","quantity":2,"price":200.00}]}',
 0, NULL, 8.00, 118, TRUE, TRUE, '2025-04-02 21:00:00'),

(40, 23, 'https://storage.googleapis.com/billpay-dev/bills/u23_swiggy_bad.pdf',
 'swiggy', 'SW-999999999999', 12000.00, '2025-04-10', 'rejected', 'Amount far exceeds typical Swiggy order range — likely fabricated',
 '{"platform":"swiggy","order_id":"SW-999999999999","merchant_name":"Premium Catering","total_amount":12000.00}',
 96, '{"high_value":true,"amount_outlier":true,"order_id_mismatch":true,"merchant_suspicious":true}',
 NULL, NULL, FALSE, FALSE, '2025-04-10 15:00:00'),

-- Ananya — steady user
(41, 22, 'https://storage.googleapis.com/billpay-dev/bills/u22_zomato_1.pdf',
 'zomato', 'ZOM-2019384756', 510.00, '2025-03-20', 'verified', NULL,
 '{"platform":"zomato","order_id":"ZOM-2019384756","merchant_name":"Punjabi Tadka","total_amount":510.00,"items":[{"name":"Butter Chicken","quantity":1,"price":320.00},{"name":"Naan","quantity":3,"price":120.00},{"name":"Lassi","quantity":1,"price":70.00}]}',
 0, NULL, 6.50, 115, TRUE, TRUE, '2025-03-20 13:00:00'),

(42, 22, 'https://storage.googleapis.com/billpay-dev/bills/u22_blinkit_1.pdf',
 'blinkit', 'BL-938472016348', 1420.00, '2025-04-04', 'verified', NULL,
 '{"platform":"blinkit","order_id":"BL-938472016348","merchant_name":"Blinkit","total_amount":1420.00,"items":[{"name":"Pampers Diapers L 52pcs","quantity":1,"price":850.00},{"name":"Johnson Baby Wash","quantity":2,"price":380.00},{"name":"Cerelac Stage 2","quantity":1,"price":190.00}]}',
 0, NULL, 18.50, 150, TRUE, TRUE, '2025-04-04 10:00:00'),

-- Manish — mix of status
(43, 15, 'https://storage.googleapis.com/billpay-dev/bills/u15_zepto_1.pdf',
 'zepto', 'ZPT-102938475620', 640.00, '2025-03-14', 'verified', NULL,
 '{"platform":"zepto","order_id":"ZPT-102938475620","merchant_name":"Zepto","total_amount":640.00,"items":[{"name":"Maggi Masala 12pk","quantity":2,"price":280.00},{"name":"Knorr Soup 8pk","quantity":1,"price":200.00},{"name":"Ching\'s Schezwan Chutney","quantity":2,"price":160.00}]}',
 0, NULL, 7.50, 117, TRUE, TRUE, '2025-03-14 12:00:00'),

(44, 15, 'https://storage.googleapis.com/billpay-dev/bills/u15_swiggy_1.pdf',
 'swiggy', 'SW-029384756201', 310.00, '2025-04-09', 'processing', NULL,
 NULL, 0, NULL, NULL, NULL, FALSE, FALSE, '2025-04-09 14:30:00'),

-- Vivek — decent uploader
(45, 25, 'https://storage.googleapis.com/billpay-dev/bills/u25_blinkit_1.pdf',
 'blinkit', 'BL-384756201930', 870.00, '2025-04-05', 'verified', NULL,
 '{"platform":"blinkit","order_id":"BL-384756201930","merchant_name":"Blinkit","total_amount":870.00,"items":[{"name":"Saffola Gold 5L","quantity":1,"price":680.00},{"name":"Tata Salt 2kg","quantity":2,"price":90.00},{"name":"Aashirvaad Atta 5kg","quantity":1,"price":260.00}]}',
 0, NULL, 11.00, 132, TRUE, TRUE, '2025-04-05 09:00:00'),

(46, 25, 'https://storage.googleapis.com/billpay-dev/bills/u25_swiggy_1.pdf',
 'swiggy', 'SW-473829016384', 460.00, '2025-04-12', 'verified', NULL,
 '{"platform":"swiggy","order_id":"SW-473829016384","merchant_name":"KFC","total_amount":460.00,"items":[{"name":"Zinger Burger","quantity":2,"price":320.00},{"name":"Pepsi","quantity":2,"price":80.00},{"name":"Popcorn Chicken","quantity":1,"price":60.00}]}',
 0, NULL, 5.50, 113, TRUE, TRUE, '2025-04-12 19:30:00'),

-- Meera — light user
(47, 26, 'https://storage.googleapis.com/billpay-dev/bills/u26_zomato_1.pdf',
 'zomato', 'ZOM-3847562019', 360.00, '2025-04-08', 'verified', NULL,
 '{"platform":"zomato","order_id":"ZOM-3847562019","merchant_name":"Social","total_amount":360.00,"items":[{"name":"Nachos","quantity":1,"price":200.00},{"name":"Virgin Mojito","quantity":2,"price":160.00}]}',
 0, NULL, 4.50, 111, TRUE, TRUE, '2025-04-08 21:00:00'),

-- Shruti — pending and queued
(48, 24, 'https://storage.googleapis.com/billpay-dev/bills/u24_blinkit_1.pdf',
 'blinkit', 'BL-193847562019', 730.00, '2025-04-11', 'queued', NULL,
 NULL, 0, NULL, NULL, NULL, FALSE, FALSE, '2025-04-11 10:00:00'),

-- Arjun — newly active
(49, 13, 'https://storage.googleapis.com/billpay-dev/bills/u13_swiggy_1.pdf',
 'swiggy', 'SW-756201938475', 290.00, '2025-04-16', 'queued', NULL,
 NULL, 0, NULL, NULL, NULL, FALSE, FALSE, '2025-04-16 12:00:00'),

-- Divya — one verified
(50, 18, 'https://storage.googleapis.com/billpay-dev/bills/u18_zepto_1.pdf',
 'zepto', 'ZPT-847562019384', 920.00, '2025-04-07', 'verified', NULL,
 '{"platform":"zepto","order_id":"ZPT-847562019384","merchant_name":"Zepto","total_amount":920.00,"items":[{"name":"Pampers Premium L 76pcs","quantity":1,"price":920.00}]}',
 0, NULL, 11.00, 133, TRUE, TRUE, '2025-04-07 09:30:00'),

-- Nikhil — fraud case
(51, 21, 'https://storage.googleapis.com/billpay-dev/bills/u21_zepto_fraud.pdf',
 'zepto', 'ZPT-000000000001', 9800.00, '2025-04-09', 'rejected', 'Duplicate bill detected — phash match with existing submission',
 '{"platform":"zepto","order_id":"ZPT-000000000001","total_amount":9800.00}',
 88, '{"duplicate_image":true,"high_value":true,"amount_outlier":true}',
 NULL, NULL, FALSE, FALSE, '2025-04-09 17:00:00'),

-- Kavya — one more verified bill
(52, 10, 'https://storage.googleapis.com/billpay-dev/bills/u10_blinkit_1.pdf',
 'blinkit', 'BL-847562019384', 580.00, '2025-04-13', 'verified', NULL,
 '{"platform":"blinkit","order_id":"BL-847562019384","merchant_name":"Blinkit","total_amount":580.00,"items":[{"name":"Dove Shampoo 340ml","quantity":1,"price":220.00},{"name":"Pantene Conditioner","quantity":1,"price":180.00},{"name":"Colgate MaxFresh 150g","quantity":2,"price":180.00}]}',
 0, NULL, 7.00, 116, TRUE, TRUE, '2025-04-13 10:00:00'),

-- Rahul — one more pending
(53, 11, 'https://storage.googleapis.com/billpay-dev/bills/u11_blinkit_1.pdf',
 'blinkit', 'BL-912038475612', 640.00, '2025-04-14', 'pending', NULL,
 '{"platform":"blinkit","order_id":"BL-912038475612","merchant_name":"Blinkit","total_amount":640.00,"items":[{"name":"Red Bull 4pk","quantity":1,"price":380.00},{"name":"Monster Energy 3pk","quantity":1,"price":260.00}]}',
 10, '{}',
 NULL, NULL, FALSE, FALSE, '2025-04-14 16:30:00'),

-- Deepika — completed onboarding, first bill
(54, 8, 'https://storage.googleapis.com/billpay-dev/bills/u8_swiggy_1.pdf',
 'swiggy', 'SW-192038475612', 320.00, '2025-04-15', 'verified', NULL,
 '{"platform":"swiggy","order_id":"SW-192038475612","merchant_name":"Burger King","total_amount":320.00,"items":[{"name":"Whopper","quantity":1,"price":220.00},{"name":"Fries","quantity":1,"price":100.00}]}',
 0, NULL, 4.00, 111, TRUE, TRUE, '2025-04-15 13:00:00');

-- ── More cashback transactions ─────────────────────────────────────────────────
INSERT IGNORE INTO cashback_transactions (id, user_id, bill_id, amount, type, description, created_at) VALUES
-- Pooja
(15, 14, 21, 18.00, 'credit', 'Cashback for Swiggy order SW-384756019283',  '2025-02-01 14:00:00'),
(16, 14, 22, 22.00, 'credit', 'Cashback for Zepto order ZPT-019283746510',  '2025-02-15 11:00:00'),
(17, 14, 23, 12.50, 'credit', 'Cashback for Blinkit order BL-293847561029', '2025-03-10 12:00:00'),
(18, 14, 24, 5.50,  'credit', 'Cashback for Zomato order ZOM-8374650192',   '2025-04-03 21:00:00'),
-- Sneha
(19, 16, 25, 55.00, 'credit', 'Cashback for Blinkit order BL-473829104756', '2025-02-20 16:00:00'),
(20, 16, 26, 28.00, 'credit', 'Cashback for Swiggy order SW-910283746501',  '2025-03-05 20:30:00'),
(21, 16, 27, 62.00, 'credit', 'Cashback for Zepto order ZPT-384756102938',  '2025-04-01 11:00:00'),
(22, 16, NULL, 100.00, 'debit', 'Withdrawal via UPI sneha@oksbi',            '2025-03-20 10:00:00'),
-- Ritika
(23, 20, 28, 9.50,  'credit', 'Cashback for Swiggy order SW-647382910475',  '2025-03-08 21:00:00'),
(24, 20, 29, 48.00, 'credit', 'Cashback for Blinkit order BL-019283746510', '2025-03-15 12:30:00'),
(25, 20, 30, 28.00, 'credit', 'Cashback for Zepto order ZPT-201938475601',  '2025-03-25 10:00:00'),
(26, 20, 31, 8.00,  'credit', 'Cashback for Zomato order ZOM-1029384756',   '2025-04-05 14:30:00'),
(27, 20, NULL, 150.00, 'debit', 'Withdrawal via UPI ritika@okaxis',          '2025-04-08 11:00:00'),
-- Gaurav
(28, 27, 33, 6.50,  'credit', 'Cashback for Swiggy order SW-756019283847',  '2025-04-07 20:00:00'),
(29, 27, 34, 36.00, 'credit', 'Cashback for Blinkit order BL-756201938470', '2025-04-10 11:30:00'),
-- Tarun
(30, 23, 39, 8.00,  'credit', 'Cashback for Swiggy order SW-938472016384',  '2025-04-02 22:00:00'),
-- Ananya
(31, 22, 41, 6.50,  'credit', 'Cashback for Zomato order ZOM-2019384756',   '2025-03-20 14:00:00'),
(32, 22, 42, 18.50, 'credit', 'Cashback for Blinkit order BL-938472016348', '2025-04-04 11:00:00'),
-- Manish
(33, 15, 43, 7.50,  'credit', 'Cashback for Zepto order ZPT-102938475620',  '2025-03-14 13:00:00'),
-- Vivek
(34, 25, 45, 11.00, 'credit', 'Cashback for Blinkit order BL-384756201930', '2025-04-05 10:00:00'),
(35, 25, 46, 5.50,  'credit', 'Cashback for Swiggy order SW-473829016384',  '2025-04-12 20:30:00'),
-- Meera
(36, 26, 47, 4.50,  'credit', 'Cashback for Zomato order ZOM-3847562019',   '2025-04-08 22:00:00'),
-- Divya
(37, 18, 50, 11.00, 'credit', 'Cashback for Zepto order ZPT-847562019384',  '2025-04-07 10:30:00'),
-- Kavya
(38, 10, 52, 7.00,  'credit', 'Cashback for Blinkit order BL-847562019384', '2025-04-13 11:00:00'),
-- Deepika — first cashback
(39, 8,  54, 4.00,  'credit', 'Cashback for Swiggy order SW-192038475612',  '2025-04-15 14:00:00'),
-- Welcome bonuses for new users
(40, 13, NULL, 10.00, 'credit', 'Welcome bonus',                             '2025-01-15 10:30:00'),
(41, 16, NULL, 10.00, 'credit', 'Welcome bonus',                             '2025-02-10 14:30:00'),
(42, 20, NULL, 10.00, 'credit', 'Welcome bonus',                             '2025-03-05 11:00:00'),
(43, 27, NULL, 10.00, 'credit', 'Welcome bonus',                             '2025-04-06 10:00:00');

-- ── Default reward tiers ───────────────────────────────────────────────────────
INSERT IGNORE INTO reward_config (id, tier_name, reward_min, reward_max, coin_min, coin_max, weight) VALUES
(1, 'base',    2.00,  10.00, 110, 125, 70),
(2, 'medium',  11.00, 30.00, 126, 170, 20),
(3, 'high',    31.00, 60.00, 171, 240,  8),
(4, 'jackpot', 61.00, 80.00, 241, 320,  2);

-- ── Default upload limits + pity cap ──────────────────────────────────────────
INSERT IGNORE INTO upload_limits (id, daily_limit, weekly_limit, monthly_limit, pity_cap) VALUES
(1, 3, 10, 30, 15);

INSERT IGNORE INTO referral_config (id, coins_min, coins_max) VALUES
(1, 10, 50);

-- ── Banners ───────────────────────────────────────────────────────────────────
INSERT IGNORE INTO banners (id, title, image_url, gcs_path, display_order, is_active) VALUES
(1, 'Earn cashback on every grocery order', 'https://storage.googleapis.com/billpay-dev/banners/banner_grocery.jpg', 'gs://billpay-dev/banners/banner_grocery.jpg', 1, TRUE),
(2, 'Upload Swiggy & Zomato bills for rewards', 'https://storage.googleapis.com/billpay-dev/banners/banner_food.jpg', 'gs://billpay-dev/banners/banner_food.jpg', 2, TRUE),
(3, 'Refer a friend and earn 100+ coins each', 'https://storage.googleapis.com/billpay-dev/banners/banner_referral.jpg', 'gs://billpay-dev/banners/banner_referral.jpg', 3, TRUE);
