-- Sample disaster campaigns (only inserted when the disasters table is empty).
-- These are placeholders: replace or delete them from the admin panel with your real campaigns.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM disasters) THEN
    INSERT INTO disasters (title, disaster_type, location, description, severity, status, goal_amount, needs_medical, needs_rescue, started_on) VALUES
    ('Monsoon Flood Relief', 'flood', 'Sample River Valley',
     'Continuous monsoon rain flooded river-side villages, cutting roads and leaving families without shelter, clean water or food. Funds buy food packs, drinking water, tarpaulins and blankets.',
     'critical', 'active', 500000, 'Water purification tablets, oral rehydration salts, first-aid kits, antibiotics, tetanus vaccines.', 'Boat operators, swimmers, first-aid trained volunteers, drivers with 4x4 vehicles.', CURRENT_DATE - 12),
    ('Hillside Landslide Recovery', 'landslide', 'Sample Highland District',
     'A major landslide buried homes and blocked the main road. Search teams and heavy equipment are needed while displaced families are sheltered in temporary camps.',
     'high', 'active', 300000, 'Trauma kits, splints, bandages, pain relief, stretchers.', 'Search-and-rescue teams, excavator operators, structural engineers.', CURRENT_DATE - 6),
    ('Earthquake Emergency Shelter', 'earthquake', 'Sample Mountain Town',
     'A strong earthquake damaged hundreds of houses and a health centre. Families are sleeping outdoors in cold weather and need shelter, warm clothing and medical care.',
     'high', 'active', 750000, 'Surgical supplies, wound dressings, insulin, oxygen cylinders, blankets for patients.', 'Structural assessors, medical teams, tent-camp coordinators.', CURRENT_DATE - 20),
    ('Forest Fire Response', 'fire', 'Sample Forest Range',
     'Wildfires are threatening villages and forest land. Funds support firefighting equipment, protective gear and temporary shelter for evacuated families.',
     'medium', 'active', 150000, 'Burn dressings, eye wash, N95 masks, inhalers.', 'Trained fire-fighters, volunteer lookouts, evacuation drivers.', CURRENT_DATE - 3),
    ('Drought Water Supply', 'drought', 'Sample Dry Region',
     'A prolonged dry season has dried up springs. Villages need emergency water tanks, trucked water and support for farmers.',
     'medium', 'active', 200000, 'Oral rehydration salts, children''s nutrition supplements.', 'Water-truck drivers, plumbers, community organisers.', CURRENT_DATE - 30),
    ('Cyclone Storm Recovery', 'storm', 'Sample Coastal Area',
     'A severe storm destroyed roofs and power lines. Recovery focuses on roof repair kits, generators and clearing roads.',
     'low', 'active', 120000, 'First-aid kits, tetanus vaccines, antiseptics.', 'Electricians, carpenters, debris-clearing crews.', CURRENT_DATE - 9);
  END IF;
END $$;
