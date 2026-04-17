-- StudioFlow seed data — idempotent (ON CONFLICT DO NOTHING)
-- Run after schema.sql

-- ═══════════════════════════════════════════════════════════════════════
-- MEMBERS — 10 real members
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO members (id, slug, full_name, status, plan_type, plan_name, credits_remaining, insights_json, purchase_insights_json, opportunity_signals_json, history_summary_json)
VALUES

-- 1. emma-kelly
('a0000001-0000-0000-0000-000000000001', 'emma-kelly', 'Emma Kelly', 'active', 'unlimited', 'Unlimited Monthly', NULL,
 '{"totalAttended":4,"lateCancels":1,"noShows":1,"cancellationRate":"17%","avgHoldBeforeCancel":"4 hours","preCutoffCancels":0,"postCutoffCancels":1,"behaviourScore":72,"behaviourLabel":"Mixed","classMix":[{"label":"Reformer Pilates","count":2},{"label":"Yoga Flow","count":1},{"label":"Barre Tone","count":1}]}',
 '{"activePlan":{"type":"unlimited","product":"Unlimited Monthly","startDate":"1 Apr","classesAttendedSinceStart":2,"purchaseStatus":"Active"},"previousPurchases":[{"type":"credit_pack","product":"10-Class Pass","purchaseDate":"15 Mar","totalCredits":10,"creditsUsed":10,"creditsRemaining":0,"lastUsedDate":"31 Mar","purchaseStatus":"Consumed","usageLog":[{"className":"Spin Express","date":"10 Mar"},{"className":"Barre Tone","date":"31 Mar"}]}],"buyerPattern":"Moved from packs to unlimited"}',
 '[{"label":"Upgrade success","detail":"Converted from class pack to unlimited — retain with good experience","tone":"positive"},{"label":"Needs attention","detail":"No-show and late cancel history — monitor for churn risk","tone":"attention"}]',
 '[{"date":"10 Apr","event":"Reformer Pilates — Thu 09:00","type":"upcoming"},{"date":"7 Apr","event":"Reformer Pilates — Mon 09:00","type":"attended"},{"date":"3 Apr","event":"Yoga Flow — Thu 07:00","type":"attended"},{"date":"1 Apr","event":"Started Unlimited Monthly","type":"started"},{"date":"31 Mar","event":"Barre Tone — Mon 10:00","type":"attended"},{"date":"28 Mar","event":"Reformer Pilates — Fri 09:00","type":"late_cancel"},{"date":"15 Mar","event":"Purchased 10-Class Pass","type":"purchase"},{"date":"10 Mar","event":"Spin Express — Mon 12:30","type":"attended"},{"date":"3 Mar","event":"Yoga Flow — Mon 07:00","type":"no_show"}]'),

-- 2. ciara-byrne
('a0000001-0000-0000-0000-000000000002', 'ciara-byrne', 'Ciara Byrne', 'active', 'class_pack', '10-Class Pass', 7,
 '{"totalAttended":3,"lateCancels":0,"noShows":0,"cancellationRate":"0%","avgHoldBeforeCancel":"N/A","preCutoffCancels":0,"postCutoffCancels":0,"behaviourScore":98,"behaviourLabel":"Strong","classMix":[{"label":"Reformer Pilates","count":1},{"label":"Yoga Flow","count":1},{"label":"Spin Express","count":1}]}',
 '{"activePlan":{"type":"credit_pack","product":"10-Class Pass","purchaseDate":"25 Mar","totalCredits":10,"creditsUsed":3,"creditsRemaining":7,"lastUsedDate":"7 Apr","purchaseStatus":"Active","usageLog":[{"className":"Spin Express","date":"1 Apr"},{"className":"Yoga Flow","date":"4 Apr"},{"className":"Reformer Pilates","date":"7 Apr"}]},"previousPurchases":[],"buyerPattern":"First-time class pack buyer"}',
 '[{"label":"Reliable regular","detail":"Strong attendance, zero cancellations — ideal member","tone":"positive"},{"label":"Upgrade candidate","detail":"High usage rate on class pack — may benefit from unlimited","tone":"positive"}]',
 '[{"date":"7 Apr","event":"Reformer Pilates — Mon 09:00","type":"attended"},{"date":"4 Apr","event":"Yoga Flow — Fri 07:00","type":"attended"},{"date":"1 Apr","event":"Spin Express — Tue 12:30","type":"attended"},{"date":"25 Mar","event":"Purchased 10-Class Pass","type":"purchase"}]'),

-- 3. declan-power
('a0000001-0000-0000-0000-000000000003', 'declan-power', 'Declan Power', 'active', 'unlimited', 'Unlimited Monthly', NULL,
 '{"totalAttended":2,"lateCancels":0,"noShows":0,"cancellationRate":"0%","avgHoldBeforeCancel":"N/A","preCutoffCancels":0,"postCutoffCancels":0,"behaviourScore":100,"behaviourLabel":"Strong","classMix":[{"label":"Spin Express","count":1},{"label":"HIIT Circuit","count":1}]}',
 '{"activePlan":{"type":"unlimited","product":"Unlimited Monthly","startDate":"1 Apr","classesAttendedSinceStart":2,"purchaseStatus":"Active"},"previousPurchases":[],"buyerPattern":"New unlimited member"}',
 '[{"label":"Under-using unlimited","detail":"Only 2 classes since starting unlimited — encourage more bookings","tone":"attention"}]',
 '[{"date":"7 Apr","event":"Spin Express — Mon 12:30","type":"attended"},{"date":"3 Apr","event":"HIIT Circuit — Thu 18:00","type":"attended"},{"date":"1 Apr","event":"Started Unlimited Monthly","type":"started"}]'),

-- 4. saoirse-flynn
('a0000001-0000-0000-0000-000000000004', 'saoirse-flynn', 'Saoirse Flynn', 'active', 'class_pack', '5-Class Pass', 1,
 '{"totalAttended":3,"lateCancels":1,"noShows":0,"cancellationRate":"25%","avgHoldBeforeCancel":"2 hours","preCutoffCancels":1,"postCutoffCancels":0,"behaviourScore":80,"behaviourLabel":"Mixed","classMix":[{"label":"Yoga Flow","count":1},{"label":"Barre Tone","count":1},{"label":"Reformer Pilates","count":1}]}',
 '{"activePlan":{"type":"credit_pack","product":"5-Class Pass","purchaseDate":"15 Mar","totalCredits":5,"creditsUsed":4,"creditsRemaining":1,"lastUsedDate":"2 Apr","purchaseStatus":"Active","usageLog":[{"className":"Reformer Pilates","date":"24 Mar"},{"className":"Yoga Flow","date":"28 Mar"},{"className":"Barre Tone","date":"2 Apr"}]},"previousPurchases":[],"buyerPattern":"First-time class pack buyer"}',
 '[{"label":"Likely to repurchase","detail":"Down to 1 credit — prompt with renewal offer","tone":"positive"},{"label":"At risk of churn","detail":"Late cancel history and low remaining credits","tone":"attention"}]',
 '[{"date":"8 Apr","event":"Yoga Flow — Tue 07:00","type":"upcoming"},{"date":"2 Apr","event":"Barre Tone — Wed 10:00","type":"attended"},{"date":"28 Mar","event":"Yoga Flow — Fri 07:00","type":"attended"},{"date":"24 Mar","event":"Reformer Pilates — Mon 09:00","type":"attended"},{"date":"20 Mar","event":"Spin Express — Thu 12:30","type":"late_cancel"},{"date":"15 Mar","event":"Purchased 5-Class Pass","type":"purchase"}]'),

-- 5. sean-brennan
('a0000001-0000-0000-0000-000000000005', 'sean-brennan', 'Sean Brennan', 'active', 'class_pack', '10-Class Pass', 4,
 '{"totalAttended":4,"lateCancels":1,"noShows":1,"cancellationRate":"17%","avgHoldBeforeCancel":"6 hours","preCutoffCancels":0,"postCutoffCancels":1,"behaviourScore":58,"behaviourLabel":"Needs attention","classMix":[{"label":"HIIT Circuit","count":2},{"label":"Spin Express","count":2}]}',
 '{"activePlan":{"type":"credit_pack","product":"10-Class Pass","purchaseDate":"10 Mar","totalCredits":10,"creditsUsed":6,"creditsRemaining":4,"lastUsedDate":"31 Mar","purchaseStatus":"Active","usageLog":[{"className":"HIIT Circuit","date":"17 Mar"},{"className":"Spin Express","date":"20 Mar"},{"className":"Spin Express","date":"27 Mar"},{"className":"HIIT Circuit","date":"31 Mar"}]},"previousPurchases":[],"buyerPattern":"Usually buys class packs"}',
 '[{"label":"At risk of churn","detail":"No-show + late cancel pattern — may disengage if not addressed","tone":"attention"},{"label":"Needs attention","detail":"Holds spots for long periods then cancels — impacts class availability","tone":"attention"}]',
 '[{"date":"8 Apr","event":"HIIT Circuit — Tue 18:00","type":"upcoming"},{"date":"4 Apr","event":"Spin Express — Fri 12:30","type":"late_cancel"},{"date":"31 Mar","event":"HIIT Circuit — Mon 18:00","type":"attended"},{"date":"27 Mar","event":"Spin Express — Thu 12:30","type":"attended"},{"date":"24 Mar","event":"HIIT Circuit — Mon 18:00","type":"no_show"},{"date":"20 Mar","event":"Spin Express — Thu 12:30","type":"attended"},{"date":"17 Mar","event":"HIIT Circuit — Mon 18:00","type":"attended"},{"date":"10 Mar","event":"Purchased 10-Class Pass","type":"purchase"}]'),

-- 6. clodagh-murray
('a0000001-0000-0000-0000-000000000006', 'clodagh-murray', 'Clodagh Murray', 'active', 'unlimited', 'Unlimited Monthly', NULL,
 '{"totalAttended":1,"lateCancels":0,"noShows":0,"cancellationRate":"0%","avgHoldBeforeCancel":"N/A","preCutoffCancels":0,"postCutoffCancels":0,"behaviourScore":100,"behaviourLabel":"Strong","classMix":[{"label":"Barre Tone","count":1}]}',
 '{"activePlan":{"type":"unlimited","product":"Unlimited Monthly","startDate":"1 Apr","classesAttendedSinceStart":1,"purchaseStatus":"Active"},"previousPurchases":[],"buyerPattern":"New unlimited member"}',
 '[{"label":"Under-using unlimited","detail":"Only 1 class since starting unlimited — encourage variety","tone":"attention"}]',
 '[{"date":"9 Apr","event":"Barre Tone — Wed 10:00","type":"upcoming"},{"date":"2 Apr","event":"Barre Tone — Wed 10:00","type":"attended"},{"date":"1 Apr","event":"Started Unlimited Monthly","type":"started"}]'),

-- 7. conor-brady
('a0000001-0000-0000-0000-000000000007', 'conor-brady', 'Conor Brady', 'inactive', 'class_pack', '5-Class Pass', 0,
 '{"totalAttended":5,"lateCancels":0,"noShows":0,"cancellationRate":"0%","avgHoldBeforeCancel":"N/A","preCutoffCancels":0,"postCutoffCancels":0,"behaviourScore":95,"behaviourLabel":"Strong","classMix":[{"label":"Spin Express","count":2},{"label":"Yoga Flow","count":1},{"label":"HIIT Circuit","count":1},{"label":"Barre Tone","count":1}]}',
 '{"activePlan":{"type":"credit_pack","product":"5-Class Pass","purchaseDate":"20 Mar","totalCredits":5,"creditsUsed":5,"creditsRemaining":0,"lastUsedDate":"7 Apr","purchaseStatus":"Consumed","usageLog":[{"className":"Spin Express","date":"24 Mar"},{"className":"Barre Tone","date":"27 Mar"},{"className":"HIIT Circuit","date":"31 Mar"},{"className":"Yoga Flow","date":"3 Apr"},{"className":"Spin Express","date":"7 Apr"}]},"previousPurchases":[],"buyerPattern":"Reliable pack user — may repurchase"}',
 '[{"label":"Likely to repurchase","detail":"Used all 5 credits with perfect attendance — ready for another pack","tone":"positive"},{"label":"Upgrade candidate","detail":"High class frequency suggests unlimited would suit better","tone":"positive"}]',
 '[{"date":"7 Apr","event":"Spin Express — Mon 12:30","type":"attended"},{"date":"3 Apr","event":"Yoga Flow — Thu 07:00","type":"attended"},{"date":"31 Mar","event":"HIIT Circuit — Mon 18:00","type":"attended"},{"date":"27 Mar","event":"Barre Tone — Thu 10:00","type":"attended"},{"date":"24 Mar","event":"Spin Express — Mon 12:30","type":"attended"},{"date":"20 Mar","event":"Purchased 5-Class Pass","type":"purchase"}]'),

-- 8. aoife-nolan
('a0000001-0000-0000-0000-000000000008', 'aoife-nolan', 'Aoife Nolan', 'active', 'trial', 'Drop-in Trial', 1,
 '{"totalAttended":0,"lateCancels":0,"noShows":0,"cancellationRate":"0%","avgHoldBeforeCancel":"N/A","preCutoffCancels":0,"postCutoffCancels":0,"behaviourScore":100,"behaviourLabel":"Strong","classMix":[]}',
 '{"activePlan":{"type":"simple","product":"Drop-in Trial","purchaseDate":"6 Apr","purchaseStatus":"Active"},"previousPurchases":[],"buyerPattern":"Occasional drop-in buyer"}',
 '[{"label":"Conversion opportunity","detail":"Trial activated but no classes yet — follow up to encourage first booking","tone":"neutral"}]',
 '[{"date":"6 Apr","event":"Trial pass activated","type":"purchase"}]'),

-- 9. padraig-roche
('a0000001-0000-0000-0000-000000000009', 'padraig-roche', 'Padraig Roche', 'active', 'class_pack', '10-Class Pass', 10,
 '{"totalAttended":0,"lateCancels":0,"noShows":0,"cancellationRate":"0%","avgHoldBeforeCancel":"N/A","preCutoffCancels":0,"postCutoffCancels":0,"behaviourScore":100,"behaviourLabel":"Strong","classMix":[]}',
 '{"activePlan":{"type":"credit_pack","product":"10-Class Pass","purchaseDate":"5 Apr","totalCredits":10,"creditsUsed":0,"creditsRemaining":10,"lastUsedDate":null,"purchaseStatus":"Active","usageLog":[]},"previousPurchases":[],"buyerPattern":"New class pack buyer"}',
 '[{"label":"New member","detail":"Recently purchased first pack — ensure a great first class experience","tone":"neutral"}]',
 '[{"date":"8 Apr","event":"HIIT Circuit — Tue 18:00","type":"upcoming"},{"date":"5 Apr","event":"Purchased 10-Class Pass","type":"purchase"}]'),

-- 10. fiona-healy
('a0000001-0000-0000-0000-000000000010', 'fiona-healy', 'Fiona Healy', 'active', 'class_pack', '5-Class Pass', 3,
 '{"totalAttended":2,"lateCancels":0,"noShows":0,"cancellationRate":"0%","avgHoldBeforeCancel":"N/A","preCutoffCancels":0,"postCutoffCancels":0,"behaviourScore":100,"behaviourLabel":"Strong","classMix":[{"label":"Yoga Flow","count":1},{"label":"Barre Tone","count":1}]}',
 '{"activePlan":{"type":"credit_pack","product":"5-Class Pass","purchaseDate":"25 Mar","totalCredits":5,"creditsUsed":2,"creditsRemaining":3,"lastUsedDate":"1 Apr","purchaseStatus":"Active","usageLog":[{"className":"Barre Tone","date":"31 Mar"},{"className":"Yoga Flow","date":"1 Apr"}]},"previousPurchases":[],"buyerPattern":"First-time class pack buyer"}',
 '[{"label":"Reliable regular","detail":"Perfect attendance on first pack — good retention candidate","tone":"positive"}]',
 '[{"date":"1 Apr","event":"Yoga Flow — Tue 07:00","type":"attended"},{"date":"31 Mar","event":"Barre Tone — Mon 10:00","type":"attended"},{"date":"25 Mar","event":"Purchased 5-Class Pass","type":"purchase"}]'),

-- 11. mairead-kinsella (v0.9.0 eligibility fixture: active class_pack, 0 credits)
-- The only seeded member that cleanly demonstrates the "no_credits" path
-- of sf_check_eligibility. Conor Brady is inactive + 0, so he hits the
-- account_inactive branch first. Mairead is explicitly active so she
-- exposes the credit-exhaustion gate on its own.
('a0000001-0000-0000-0000-000000000011', 'mairead-kinsella', 'Mairead Kinsella', 'active', 'class_pack', '5-Class Pass', 0,
 '{"totalAttended":5,"lateCancels":0,"noShows":0,"cancellationRate":"0%","avgHoldBeforeCancel":"N/A","preCutoffCancels":0,"postCutoffCancels":0,"behaviourScore":98,"behaviourLabel":"Strong","classMix":[{"label":"Yoga Flow","count":3},{"label":"Barre Tone","count":2}]}',
 '{"activePlan":{"type":"credit_pack","product":"5-Class Pass","purchaseDate":"20 Mar","totalCredits":5,"creditsUsed":5,"creditsRemaining":0,"lastUsedDate":"7 Apr","purchaseStatus":"Consumed","usageLog":[]},"previousPurchases":[],"buyerPattern":"Reliable pack user — pack fully consumed"}',
 '[{"label":"Likely to repurchase","detail":"Strong attendance, just drained her pack — prime moment to sell another","tone":"positive"}]',
 '[{"date":"7 Apr","event":"Yoga Flow — Mon 07:00","type":"attended"},{"date":"20 Mar","event":"Purchased 5-Class Pass","type":"purchase"}]')

ON CONFLICT (id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- STUB MEMBERS — 36 non-member attendees
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO members (id, slug, full_name, status, plan_type, plan_name, credits_remaining, insights_json, purchase_insights_json, opportunity_signals_json, history_summary_json)
VALUES
('a0000002-0000-0000-0000-000000000001', 'niamh-walsh',       'Niamh Walsh',       'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000002', 'orla-duffy',        'Orla Duffy',        'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000003', 'sinead-murphy',     'Sinead Murphy',     'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000004', 'roisin-daly',       'Roisin Daly',       'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000005', 'aisling-nolan',     'Aisling Nolan',     'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000006', 'maeve-ryan',        'Maeve Ryan',        'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000007', 'laura-keane',       'Laura Keane',       'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000008', 'brendan-quinn',     'Brendan Quinn',     'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000009', 'shauna-reid',       'Shauna Reid',       'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000010', 'kevin-molloy',      'Kevin Molloy',      'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000011', 'aidan-cullen',      'Aidan Cullen',      'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000012', 'michelle-orourke',  'Michelle O''Rourke','active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000013', 'paul-sweeney',      'Paul Sweeney',      'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000014', 'emer-fahey',        'Emer Fahey',        'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000015', 'ruairi-coyle',      'Ruairi Coyle',      'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000016', 'isabel-burke',      'Isabel Burke',      'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000017', 'diarmuid-hayes',    'Diarmuid Hayes',    'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000018', 'grainne-doyle',     'Grainne Doyle',     'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000019', 'eimear-cahill',     'Eimear Cahill',     'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000020', 'sile-brennan',      'Sile Brennan',      'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000021', 'brigid-moran',      'Brigid Moran',      'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000022', 'cathal-donnelly',   'Cathal Donnelly',   'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000023', 'cian-oneill',       'Cian O''Neill',     'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000024', 'eoin-gallagher',    'Eoin Gallagher',    'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000025', 'shane-oconnor',     'Shane O''Connor',   'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000026', 'niall-mccarthy',    'Niall McCarthy',    'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000027', 'tomas-lenehan',     'Tomas Lenehan',     'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000028', 'fionnuala-darcy',   'Fionnuala Darcy',   'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000029', 'caoimhe-barrett',   'Caoimhe Barrett',   'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000030', 'ailbhe-connolly',   'Ailbhe Connolly',   'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000031', 'aoibhinn-smyth',    'Aoibhinn Smyth',    'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000032', 'deirdre-whelan',    'Deirdre Whelan',    'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000033', 'brid-costello',     'Brid Costello',     'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000034', 'una-mac-mahon',     'Una Mac Mahon',     'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000035', 'grace-foley',       'Grace Foley',       'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]'),
('a0000002-0000-0000-0000-000000000036', 'laoise-tierney',    'Laoise Tierney',    'active', 'drop_in', 'Walk-in', NULL, '{}', '{}', '[]', '[]')
ON CONFLICT (id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- CLASSES
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO classes (id, slug, title, instructor_name, starts_at, ends_at, capacity, location_name, cancellation_window_hours)
VALUES
-- Completed: in the past
('b0000001-0000-0000-0000-000000000001', 'reformer-mon-9',  'Reformer Pilates', 'Sarah', now() - interval '7 days' + time '09:00', now() - interval '7 days' + time '10:00', 12, 'Studio A', 24),
('b0000001-0000-0000-0000-000000000003', 'yoga-tue-7',      'Yoga Flow',        'Aoife', now() - interval '6 days' + time '07:00', now() - interval '6 days' + time '08:00', 10, 'Studio A', 24),
-- Live: happening right now
('b0000001-0000-0000-0000-000000000002', 'spin-mon-1230',   'Spin Express',     'James', now() - interval '20 minutes', now() + interval '40 minutes', 16, 'Studio B', 24),
-- Upcoming: in the future
('b0000001-0000-0000-0000-000000000004', 'hiit-tue-1800',   'HIIT Circuit',     'Mark',  now() + interval '1 hour',  now() + interval '2 hours', 10, 'Studio B', 2),
('b0000001-0000-0000-0000-000000000005', 'barre-wed-10',    'Barre Tone',       'Sarah', now() + interval '1 day' + time '10:00',  now() + interval '1 day' + time '11:00',  8, 'Studio A', 24),
('b0000001-0000-0000-0000-000000000006', 'reformer-thu-9',  'Reformer Pilates', 'Sarah', now() + interval '2 days' + time '09:00', now() + interval '2 days' + time '10:00', 12, 'Studio A', 24)
ON CONFLICT (id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- BOOKINGS — reformer-mon-9 (completed)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO class_bookings (id, class_id, member_id, booking_status, checked_in_at, cancelled_at, is_active)
VALUES
-- emma-kelly: attended
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 'checked_in', '2025-04-07 08:55:00+01', NULL, true),
-- ciara-byrne: attended
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000002', 'checked_in', '2025-04-07 08:50:00+01', NULL, true),
-- niamh-walsh: attended
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000001', 'a0000002-0000-0000-0000-000000000001', 'checked_in', '2025-04-07 08:52:00+01', NULL, true),
-- orla-duffy: attended
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000001', 'a0000002-0000-0000-0000-000000000002', 'checked_in', '2025-04-07 08:53:00+01', NULL, true),
-- sinead-murphy: no_show
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000001', 'a0000002-0000-0000-0000-000000000003', 'no_show', NULL, NULL, true),
-- roisin-daly: late_cancel
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000001', 'a0000002-0000-0000-0000-000000000004', 'late_cancel', NULL, '2025-04-07 07:00:00+01', false),
-- aisling-nolan: attended
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000001', 'a0000002-0000-0000-0000-000000000005', 'checked_in', '2025-04-07 08:58:00+01', NULL, true),
-- maeve-ryan: attended
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000001', 'a0000002-0000-0000-0000-000000000006', 'checked_in', '2025-04-07 08:56:00+01', NULL, true)
ON CONFLICT DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- BOOKINGS — spin-mon-1230 (live)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO class_bookings (id, class_id, member_id, booking_status, checked_in_at, is_active)
VALUES
-- declan-power: booked + checked_in
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000002', 'a0000001-0000-0000-0000-000000000003', 'booked', now(), true),
-- fiona-healy: booked, not checked in
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000002', 'a0000001-0000-0000-0000-000000000010', 'booked', NULL, true),
-- conor-brady: booked + checked_in
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000002', 'a0000001-0000-0000-0000-000000000007', 'booked', now(), true),
-- laura-keane: booked, not checked in
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000007', 'booked', NULL, true),
-- brendan-quinn: booked + checked_in
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000008', 'booked', now(), true),
-- shauna-reid: booked + checked_in
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000009', 'booked', now(), true),
-- kevin-molloy: booked, not checked in
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000010', 'booked', NULL, true),
-- aidan-cullen: booked + checked_in
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000011', 'booked', now(), true),
-- michelle-orourke: booked + checked_in
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000012', 'booked', now(), true),
-- paul-sweeney: booked, not checked in
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000013', 'booked', NULL, true),
-- emer-fahey: booked + checked_in
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000014', 'booked', now(), true),
-- ruairi-coyle: booked + checked_in
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000015', 'booked', now(), true),
-- isabel-burke: booked + checked_in
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000016', 'booked', now(), true),
-- diarmuid-hayes: booked + checked_in
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000017', 'booked', now(), true)
ON CONFLICT DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- BOOKINGS — yoga-tue-7 (completed)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO class_bookings (id, class_id, member_id, booking_status, checked_in_at, is_active)
VALUES
-- saoirse-flynn: attended
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000003', 'a0000001-0000-0000-0000-000000000004', 'checked_in', '2025-04-08 06:55:00+01', true),
-- grainne-doyle: attended
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000003', 'a0000002-0000-0000-0000-000000000018', 'checked_in', '2025-04-08 06:50:00+01', true),
-- eimear-cahill: no_show
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000003', 'a0000002-0000-0000-0000-000000000019', 'no_show', NULL, true),
-- sile-brennan: attended
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000003', 'a0000002-0000-0000-0000-000000000020', 'checked_in', '2025-04-08 06:52:00+01', true),
-- brigid-moran: attended
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000003', 'a0000002-0000-0000-0000-000000000021', 'checked_in', '2025-04-08 06:54:00+01', true),
-- cathal-donnelly: attended
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000003', 'a0000002-0000-0000-0000-000000000022', 'checked_in', '2025-04-08 06:56:00+01', true)
ON CONFLICT DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- BOOKINGS — hiit-tue-1800 (upcoming, cancellation window closed)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO class_bookings (id, class_id, member_id, booking_status, waitlist_position, is_active)
VALUES
-- Booked attendees
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000004', 'a0000001-0000-0000-0000-000000000005', 'booked', NULL, true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000004', 'a0000001-0000-0000-0000-000000000009', 'booked', NULL, true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000004', 'a0000002-0000-0000-0000-000000000023', 'booked', NULL, true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000004', 'a0000002-0000-0000-0000-000000000024', 'booked', NULL, true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000004', 'a0000002-0000-0000-0000-000000000025', 'booked', NULL, true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000004', 'a0000002-0000-0000-0000-000000000026', 'booked', NULL, true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000004', 'a0000002-0000-0000-0000-000000000027', 'booked', NULL, true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000004', 'a0000002-0000-0000-0000-000000000028', 'booked', NULL, true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000004', 'a0000002-0000-0000-0000-000000000029', 'booked', NULL, true),
-- Waitlisted
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000004', 'a0000001-0000-0000-0000-000000000004', 'waitlisted', 1, true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000004', 'a0000001-0000-0000-0000-000000000008', 'waitlisted', 2, true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000004', 'a0000002-0000-0000-0000-000000000030', 'waitlisted', 3, true)
ON CONFLICT DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- BOOKINGS — barre-wed-10 (upcoming)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO class_bookings (id, class_id, member_id, booking_status, is_active)
VALUES
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000005', 'a0000001-0000-0000-0000-000000000006', 'booked', true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000005', 'a0000002-0000-0000-0000-000000000031', 'booked', true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000005', 'a0000002-0000-0000-0000-000000000032', 'booked', true)
ON CONFLICT DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- BOOKINGS — reformer-thu-9 (upcoming)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO class_bookings (id, class_id, member_id, booking_status, is_active)
VALUES
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000006', 'a0000001-0000-0000-0000-000000000001', 'booked', true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000006', 'a0000002-0000-0000-0000-000000000001', 'booked', true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000006', 'a0000002-0000-0000-0000-000000000002', 'booked', true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000006', 'a0000002-0000-0000-0000-000000000006', 'booked', true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000006', 'a0000002-0000-0000-0000-000000000004', 'booked', true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000006', 'a0000002-0000-0000-0000-000000000005', 'booked', true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000006', 'a0000002-0000-0000-0000-000000000003', 'booked', true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000006', 'a0000002-0000-0000-0000-000000000033', 'booked', true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000006', 'a0000002-0000-0000-0000-000000000034', 'booked', true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000006', 'a0000002-0000-0000-0000-000000000035', 'booked', true),
(gen_random_uuid(), 'b0000001-0000-0000-0000-000000000006', 'a0000002-0000-0000-0000-000000000036', 'booked', true)
ON CONFLICT DO NOTHING;
