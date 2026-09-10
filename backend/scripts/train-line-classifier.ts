/**
 * Trains the declaration-section classifier.
 *
 *   npm run nlp:train
 *
 * The corpus is generated from templates of how Indian packaging phrases each
 * declaration — captions, separators, values, and the running text that is
 * not a declaration at all — with OCR-style noise (0/O, 1/l, dropped and
 * swapped characters, case changes). A softmax regression over hashed text
 * features is fitted with SGD, evaluated on a held-out split, and written to
 * backend/src/ocr/nlp/model.json as int8-quantised weights.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FEATURE_DIM, SECTION_CLASSES, featurise, type SectionClass } from '../src/ocr/nlp/features';

/* ------------------------------------------------------------ random */
let seed = 20260909;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const maybe = (p: number) => rnd() < p;

/* ------------------------------------------------------------ pieces */
const SEP = [': ', ' : ', ' ', ' - ', ' – ', ':', '. '];
const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'Jan', 'Feb', 'Mar', 'Aug', 'Sept', 'Dec'];
const YEARS = ['2024', '2025', '2026', '2027', '2028', '24', '25', '26', '27', '28'];
const dateToken = () => {
  const kind = rnd();
  if (kind < 0.45) return `${pick(MONTHS)}/${pick(YEARS)}`;
  if (kind < 0.6) return `${pick(MONTHS)}-${pick(YEARS)}`;
  if (kind < 0.8) return `${pick(MON)} ${pick(['2025', '2026', '2027', '2028'])}`;
  return `${pick(['01', '05', '12', '18', '23', '30'])}/${pick(MONTHS)}/${pick(['2025', '2026', '2027'])}`;
};
const amount = () => pick(['10', '20', '45', '99', '120', '182', '220', '250', '399', '499', '1,299']) + pick(['.00', '.00', '.50', '', '/-']);
const rsMark = () => pick(['Rs.', 'Rs', '₹', 'INR', 'MRP Rs.', 'M.R.P. Rs.', 'Rs.']);
const qty = () => pick(['1', '2', '5', '50', '100', '200', '250', '300', '500', '750', '1.5']) + pick([' ', '']) + pick(['g', 'g', 'gm', 'kg', 'ml', 'ML', 'L', 'Litre', 'N', 'pcs']);
const company = () =>
  pick(['Shakti Agro Mills', 'Dabur India', 'Nilgiri Dawn Tea', 'Deccan Spice Works', 'Annapurna Select Foods', 'Surya Chakki Fresh', 'Kesar Spice House', 'Alpen Noir Chocolates', 'Hindustan Unilever', 'Patanjali Ayurved', 'ITC', 'Britannia Industries', 'Parle Products', 'Amul Dairy', 'Haldiram Snacks', 'MTR Foods', 'Tata Consumer Products', 'Marico', 'Emami', 'Godrej Consumer Products']) +
  pick([' Pvt. Ltd.', ' Pvt Ltd', ' Ltd.', ' Limited', ' Pvt. Ltd', ' LLP', ' Industries', '', ' Ltd']);
const address = () =>
  pick(['Plot 27, Food Park, Sanand Road', 'Vill. Billanwali Lavana, P.O. Baddi', '8/3, Asaf Ali Road', 'Survey No. 112/2, Industrial Area Phase II', 'Unit-2, Integrated Industrial Estate, Sec-2, Pant Nagar', 'I.G.C., Balipara, Ghoramari', 'Plot No. 44-47, Smart Industrial Park, Pithampur', 'Shed No. 5, MIDC, Taloja', 'D-14, Sector 63', 'No. 21, Old Madras Road']) +
  ', ' + pick(['Ahmedabad, Gujarat - 382110', 'Distt. Solan (H.P.) - 173205', 'New Delhi - 110002', 'Hyderabad, Telangana 500081', 'Sonitpur - 784105, Assam', 'Dhar, Madhya Pradesh - 454774', 'Navi Mumbai, Maharashtra 410208', 'Noida, Uttar Pradesh - 201301', 'Bengaluru, Karnataka - 560016', 'Uttarakhand - 263146']) +
  pick(['', ', India', '. India']);
const phone = () => pick(['1800-233-7788', '1800 103 1644', '1800-425-1234', '+91 40 2345 1042', '1800 22 1234', '022-6669 1234', '9876543210']);
const email = () => pick(['consumercare@shaktiagro.in', 'daburcares@dabur.com', 'care@nilgiridawn.com', 'feedback@deccanspice.in', 'customercare@brand.co.in', 'info@company.com']);
const web = () => pick(['www.dabur.com', 'dabur.com', 'www.shaktiagro.in', 'www.brand.co.in']);
const code = () => pick(['SG-2607-D12', 'RU3743 L8B', 'L8B23', 'B2607', 'AX-1209', 'MFG2607A', 'P07A26', '2607/D', 'KA-2026-0412', '260731']);
const fssai = () => pick(['10019043002277', '10012021000123', '11517008000452', '10014023001237', '12719999000045']);
const BRAND = ['Himalaya', 'mamaearth', 'Pepsodent', 'Colgate', 'medimix', 'Dove', 'Dabur', 'Patanjali', 'Nivea', 'Lux', 'Lifebuoy', 'Santoor', 'Vicco', 'Closeup', 'Sensodyne', 'Parachute', 'Boroplus', 'Fiama', 'Pears', 'Cinthol', 'Godrej No.1', 'Hamam', 'Mysore Sandal', 'Chandrika'];
const brand = () => pick(BRAND);
const product = () => pick([
  'Complete Care Herbal Toothpaste', 'Cavity Protection', 'Strong Teeth', 'Ayurvedic Bathing Bar', 'go fresh restore', 'Herbal Toothpaste',
  'Beauty Bar', 'Gentle Cleansing Soap', 'Charcoal Face Wash', 'Onion Hair Oil', 'Turmeric Soap', 'Ubtan Face Wash', 'Fresh Active Gel',
  'Sensitive Whitening', 'Coconut Hair Oil', 'Glycerine Soap', 'Sandal Soap', 'Total Advanced Health','Toor Dal (Arhar)', 'Dabur Red Paste', 'Premium Basmati Rice', 'Chakki Fresh Atta', 'Whole Green Cardamom', 'Sambar Masala Powder', 'Refined Sunflower Oil', 'Orthodox Leaf Tea', 'Dark Chocolate 70%', 'Corn Rings Masala', 'Butter Cookies', 'Whole Wheat Atta', 'Iodised Salt', 'Turmeric Powder', 'Coconut Oil', 'Instant Noodles Masala', 'Ayurvedic Toothpaste', 'Red Chilli Powder', 'Kashmiri Saffron', 'Groundnut Oil', 'SHAKTI GOLD', 'DABUR RED PASTE FOR TEETH & GUMS', 'Moong Dal', 'Poha (Flattened Rice)']);
const country = () => pick(['India', 'India', 'India', 'Sri Lanka', 'Nepal', 'Thailand', 'Malaysia', 'UAE', 'China']);

/* ------------------------------------------------------------ templates */
type Gen = () => string;
const T: Record<SectionClass, Gen[]> = {
  MRP: [
    () => `MRP ${pick(['₹', 'Rs.', '?', 'R'])} ${amount()}`,
    () => `${pick(['(Incl. of all taxes)', '(incl. of all taxes)', 'Incl. of all taxes'])}`,
    () => `${pick(['MRP', 'M.R.P.', 'M.R.P', 'Maximum Retail Price', 'MAXIMUM RETAIL PRICE', 'Max. Retail Price', 'Retail Sale Price'])}${pick(SEP)}${rsMark()} ${amount()}`,
    () => `MRP ${pick(['₹', 'Rs.', '?', 'R', '=', 'Z'])} (incl. of all taxes): ${pick(['₹', 'Rs.', '?', 'R', '=', ''])} ${amount()}`,
    () => `MRP ${pick(['₹', 'Rs.'])} (incl. of all taxes)${pick([':', ''])}`,
    () => `${pick(['MRP', 'M.R.P.'])} ${rsMark()} ${amount()} ${pick(['(incl. of all taxes)', '(Inclusive of all taxes)', 'incl. of all taxes', '(Incl. all taxes)', 'Inclusive of all taxes'])}`,
    () => `${pick(['MRP', 'M.R.P.'])} ${pick(['Rs.', '₹'])}${pick(['(incl. of all taxes)', '(Inclusive of all taxes)', ''])}`,
    () => `${rsMark()} ${amount()}`,
    () => `${pick(['₹', 'Rs.'])} ${pick(['0.73', '0.36', '1.20', '2.50'])} per ${pick(['g', 'ml', 'kg', 'unit'])}`,
    () => `${pick(['Inclusive of all taxes', '(incl. of all taxes)', 'Incl. of all taxes', 'MAXIMUM RETAIL PRICE'])}`,
    () => `${pick(['Price', 'MRP'])}${pick(SEP)}${amount()}`,
  ],
  NET_QUANTITY: [
    () => `${pick(['Net Quantity', 'NET QUANTITY', 'Net Qty', 'Net Qty.', 'Net Wt.', 'Net Weight', 'NET WT', 'Net Contents', 'Net Vol.', 'Net Volume', 'Net Weight (when packed)'])}${pick(SEP)}${qty()}`,
    () => `${pick(['Net Wt. When Packed', 'Net Wt. when packed', 'NET WT. WHEN PACKED', 'Net Weight When Packed'])}${maybe(0.5) ? ` ${qty()}` : ''}`,
    () => `${qty()}`,
    () => `${pick(['1N', '2N', '3N'])} x ${qty()}${maybe(0.5) ? ` + ${pick(['1N', '2N'])} x ${qty()}` : ''}`,
    () => `${pick(['Net Quantity', 'Net Wt'])}${pick(SEP)}${qty()} ${pick(['(approx.)', '(when packed)', 'e', ''])}`,
    () => `${pick(['e', '℮'])} ${qty()}`,
    () => `${pick(['Net Quantity', 'NET QUANTITY', 'Net Wt.'])}`,
  ],
  DATE_OF_PACKING: [
    () => `${pick(['Mfg. Date:', 'Mfg. Date', 'Mfg Date:', 'MFG. DATE:'])} ${pick(MONTHS)}/${pick(['2024', '2025', '2026'])}`,
    () => `${pick(['Mfd.', 'MFD', 'Mfg. Date', 'Mfg Date', 'Date of Manufacture', 'Date of Mfg.', 'Month and Year of Packing', 'MONTH & YEAR OF PACKING', 'Packed on', 'Pkd.', 'Pkd on', 'Packing Date', 'Date of Packing', 'Mfd. Date', 'MFG'])}${pick(SEP)}${dateToken()}`,
    () => `${pick(['Mfd.', 'MFD', 'Month and Year of Packing', 'Date of Manufacture', 'Packed on', 'Mfg. Date', 'Batch No., Mfd.'])}`,
    () => `${pick(['Manufactured on', 'Mfd on', 'Packed in'])} ${dateToken()}`,
  ],
  BEST_BEFORE: [
    () => `${pick(['Best Before', 'BEST BEFORE', 'Best before', 'Use By', 'USE BY', 'Expiry', 'Expiry Date', 'Exp. Date', 'EXP', 'Exp.', 'Best Before End', 'Use before'])}${pick(SEP)}${dateToken()}`,
    () => `${pick(['Use Before:', 'Use Before', 'USE BEFORE:', 'Use before:'])} ${pick(MONTHS)}/${pick(['2026', '2027', '2028'])}`,
    () => `${pick(['Best Before', 'Best before', 'BEST BEFORE'])} ${pick(['6', '9', '12', '18', '24', '36'])} ${pick(['months', 'Months', 'MONTHS'])} ${pick(['from packing', 'from manufacture', 'from the date of packing', 'from date of mfg.', ''])}`,
    () => `${pick(['Best Before', 'Expiry', 'Use By', 'Exp. Date', 'EXPIRY'])}`,
    () => `${pick(['Expires on', 'Valid till', 'Best before end of'])} ${dateToken()}`,
  ],
  MANUFACTURER_NAME: [
    () => `${pick(['Manufactured by:', 'Marketed by:', 'Made in India by:', 'Mfd. by:', 'Regd. Office:'])}`,
    () => `${pick(['GlaxoSmithKline Consumer Healthcare Ltd.', 'Hindustan Unilever Limited', 'Hindustan Unilever Ltd.', 'The Himalaya Drug Company', 'Dabur India Ltd.'])}`,
    () => `${pick(['Manufactured by:', 'Mfd. by:', 'Mfd by:', 'Manufactured By:'])} ${pick(['The Himalaya Drug Company', 'Honasa Consumer Pvt. Ltd.', 'Unilever Indonesia Tbk.', 'Colgate-Palmolive (India) Ltd.', 'Unilever Limited', 'Hindustan Unilever Limited', 'Dabur India Ltd.', 'Patanjali Ayurved Ltd.', 'Marico Limited', 'Wipro Enterprises (P) Ltd.'])}`,
    () => `${pick(['The Himalaya Drug Company', 'Colgate-Palmolive (India) Ltd.', 'Unilever Limited', 'Hindustan Unilever Limited', '(Part of Himalaya Global Holdings Ltd.)'])}`,
    () => `${pick(['Manufactured by', 'Manufactured and Packed by', 'MANUFACTURED AND PACKED BY', 'Mfd. by', 'Mfd by', 'Packed by', 'Marketed by', 'Manufactured & Marketed by', 'Manufacturer', 'Mfg. by', 'Manufactured and Marketed by', 'Packed & Marketed by'])}${pick(SEP)}${company()}`,
    () => `${company()}`,
    () => `${pick(['BD)', 'RU)', 'BT)', 'ID)', 'A)', 'B)'])} ${company().toUpperCase()}`,
    () => `${pick(['Manufactured by', 'Marketed by', 'Mfd. by', 'MANUFACTURED AND PACKED BY', 'Packed by'])}${pick([':', ''])}`,
    () => `${company()}, ${pick(['Unit-2', 'Unit II', 'Plant 3', ''])}`.replace(/, $/, ''),
  ],
  MANUFACTURER_ADDRESS: [
    () => `${pick(['Makali, Bengaluru 562 162, India.', 'Plot No. 63, Sector-5, IMT Manesar,', 'Gurugram, Haryana - 122050, India.', 'Jl. Rungkut Industri Raya No. 18, Surabaya 60293, Indonesia.', 'Hiranandani Estate, Thane (W) - 400 607, India.', 'B. D. Sawant Marg, Chakala,', 'Andheri (E), Mumbai 400 099, India.', 'Unilever House, B. D. Sawant Marg, Chakala, Andheri (E),', 'Mumbai 400 099, India.'])}`,
    () => `${pick(['Lic. No.:', 'Lic. No.', 'Lic No:', 'LIC. NO.:'])} ${pick(['AUS-782', '106-ISM(HR)', 'KTK/25D/2019', 'AUS-1042', '12-COS(MH)'])}`,
    () => `${address()}`,
    () => `${pick(['Regd. Office', 'Registered Office', 'Corporate Office', 'Address', 'Head Office', 'Factory'])}${pick(SEP)}${address()}`,
    () => `${pick(['Plot No.', 'Survey No.', 'Shed No.', 'Vill.', 'P.O.', 'Sector', 'Sy. No.'])} ${pick(['4', '27', '112/2', '44,45,46,47 & 97', 'Billanwali Lavana', 'Baddi', '63'])}, ${pick(['Sec-2, Pant Nagar', 'Food Park, Sanand Road', 'MIDC Taloja', 'Industrial Area Phase II', 'Distt. Udham Singh Nagar'])}`,
    () => `${pick(['Ahmedabad, Gujarat', 'Distt. Solan (H.P.)', 'New Delhi', 'Hyderabad, Telangana', 'Uttarakhand', 'Madhya Pradesh', 'Navi Mumbai, Maharashtra', 'Bengaluru, Karnataka', 'Sonitpur, Assam'])} ${pick(['-', '–', ''])} ${pick(['382110', '173 205', '110 002', '500081', '263 146', '454774', '410208', '560016'])}${pick(['', ', India', '.'])}`,
    () => `${pick(['Mfg. Lic. No.', 'Mfg Lic No', 'Licence No.'])}${pick(SEP)}${pick(['HP-173-AY', 'UK.AY-191/2010', 'SNT/Ayur-Mfg./A-210', 'MP/25D/21/912'])}`,
  ],
  CONSUMER_CARE: [
    () => `${pick(['For customer care:', 'For consumer complaints:', 'For queries, contact:', 'Lever Care:', 'Consumer Care:', 'Customer Care:', 'For complaints or feedback:'])}${maybe(0.6) ? ` ${pick([phone(), email(), `${phone()} | ${email()}`])}` : ''}`,
    () => `${phone()} | ${email()}`,
    () => `(Toll Free) | ${web()}`,
    () => `${pick(['care.india@gsk.com', 'care@unilever.com', 'www.sensodyne.co.in', 'www.himalayahealthcare.com', 'www.pepsodent.com', '1800 102 2202', '1800-10-22-221', '1800-208-1930'])}`,
    () => `${pick(['Consumer Care', 'CONSUMER CARE', 'Consumer Cell', 'Consumer Care Cell', 'Customer Care', 'Customer Care No.', 'Consumer Complaints', 'For complaints contact', 'For any complaints', 'For feedback / complaints', 'Consumer Care Details', 'Consumer Care Executive', 'Helpline'])}${pick(SEP)}${pick([company(), phone(), email(), `${company()}, ${phone()}`, `${phone()}, ${email()}`])}`,
    () => `${pick(['Toll Free', 'TOLL FREE', 'Toll Free No.', 'Toll-free', 'Helpline No.', 'Call'])}${pick(SEP)}${phone()}`,
    () => `${pick(['E-mail', 'Email', 'E-MAIL', 'Write to us', 'Mail us at', 'e-mail id'])}${pick(SEP)}${email()}`,
    () => `${pick(['Website', 'Visit', 'Web', 'www'])}${pick(SEP)}${web()}`,
    () => `${email()}`,
    () => `${pick(['DABUR CARES', 'SHAKTI CARES', 'WE CARE', 'Customer care'])}${pick([': CALL OR WRITE', ' - Call or Write', ''])}`,
    () => `${pick(['For consumer complaints', 'For queries', 'For complaints'])} ${pick(['contact', 'write to', 'call'])} ${pick([company(), phone(), email()])}`,
  ],
  COUNTRY_OF_ORIGIN: [
    () => `${pick(['Made in India.', 'Made in India. © Registered Trade Mark.', 'MADE IN INDIA', 'Made in India'])}`,
    () => `${pick(['Country of Origin', 'COUNTRY OF ORIGIN', 'Country of origin', 'Origin'])}${pick(SEP)}${country()}`,
    () => `${pick(['Made in', 'MADE IN', 'Product of', 'Manufactured in', 'Produced in', 'Packed in'])} ${country()}`,
    () => `${pick(['Country of Origin', 'COUNTRY OF ORIGIN'])}`,
    () => `${country().toUpperCase()}`,
  ],
  IMPORTER_DETAILS: [
    () => `Imported & Marketed by: ${pick(['Hindustan Unilever Ltd.,', 'Hindustan Unilever Limited', 'Procter & Gamble Home Products Pvt. Ltd.', 'Nestlé India Ltd.'])}`,
    () => `${pick(['Imported by', 'IMPORTED BY', 'Importer', 'Imported and Marketed by', 'Imported & Packed by', 'Imported by / Importer'])}${pick(SEP)}${company()}${maybe(0.5) ? `, ${address()}` : ''}`,
    () => `${pick(['Imported by', 'Importer', 'Imported & Marketed by'])}${pick([':', ''])}`,
    () => `${pick(['Import Licence No.', 'IEC No.', 'Importer Lic. No.'])}${pick(SEP)}${pick(['0512345678', 'AAACD1234E', 'IEC-0912345678'])}`,
  ],
  FSSAI_LICENSE: [
    () => `${pick(['FSSAI Lic. No.', 'FSSAI Lic No', 'FSSAI License No.', 'FSSAI Licence Number', 'FSSAI LIC. NO.', 'Lic. No.', 'FSSAI No.', 'fssai', 'FSSAI'])}${pick(SEP)}${fssai()}`,
    () => `${fssai()}`,
    () => `${pick(['FSSAI Lic. No.', 'FSSAI License No.', 'FSSAI'])}`,
  ],
  BATCH_NUMBER: [
    () => `${pick(['Batch No.', 'Batch No', 'BATCH NO.', 'Batch Number', 'Lot No.', 'Lot No', 'LOT', 'B. No.', 'B.No.', 'Batch Code', 'Batch', 'Lot'])}${pick(SEP)}${code()}`,
    () => `${code()}`,
    () => `${pick(['Batch No.', 'Lot No.', 'BATCH NO', 'Batch No., Mfd.', 'Batch/Lot No.'])}`,
  ],
  PRODUCT_IDENTITY: [
    () => `${brand()}`,
    () => `${brand()} ${product()}`,
    () => `${brand().toUpperCase()}`,
    () => `${product()}`,
    () => `${product().toUpperCase()}`,
    () => `${pick(['Premium', 'Fresh', 'Organic', 'Natural', 'Classic', 'Gold', 'Pure', 'Royal'])} ${product()}`,
    () => `${product()} ${pick(['- Family Pack', '(Whole)', '(Unpolished)', 'Extra Strong', 'Regular'])}`,
  ],
  OTHER: [
    () => `${pick(['(Under Licence from Dabur Research Foundation)', '® Registered Trade Mark.', 'PAP', 'Germ Protection', 'for healthier smiles', 'EVERFRESH+', 'Daily Care for Sensitive Teeth', 'Not for children under 12 years.', 'or as directed by your dentist.', 'and clean mouth.', 'by your dentist.'])}`,
    () => `${pick(['For external use only.', 'Keep out of reach of children under 6 years.', 'For best results, brush twice daily.', 'For better results, brush twice daily.', 'Directions for use: Brush at least twice a day.', 'For best results, use with Colgate Toothbrush.', 'PAPER BOX', 'SAVE WATER', 'CRUELTY FREE', 'SINCE 1930', 'goodness inside', 'AYURVEDIC', 'CAVITY PROTECTION', 'Active Ingredient: Sodium Fluoride IP 0.32% w/w (1450 ppm F)', 'Restore beauty bar with cucumber & green tea scent', 'helps to gently cleanse your skin and leave it feeling fresh and', 'Medimix Ayurvedic Bathing Bar with 18 herbs helps to', 'keep your skin healthy and naturally glowing.', 'Pepsodent Cavity Protection helps fight cavities', 'and keeps your teeth strong and healthy.'])}`,
    () => `${pick(['Sodium Palmate, Sodium Palm Kernelate,', 'Water, Glycerin, Turmeric Extract, Saffron Extract,', 'Fragrance, Sodium Chloride, Tetrasodium EDTA,', 'Citric Acid.', 'Cellulose Gum, Titanium Dioxide.', 'Sodium Saccharin, Carrageenan, Titanium Dioxide, CI 77891.', 'Sodium Fluoride, CI 42090, CI 77891.', 'Calcium Carbonate, Aqua, Glycerin, Silica,', 'Sodium Monofluorophosphate, Flavor, Sodium Saccharin,', 'Tallowate, Water, Glycerin, Perfume, Cucumis Sativus (Cucumber)', 'Fruit Extract, Camellia Sinensis Leaf Extract, Titanium Dioxide,'])}`,
    () => `${pick(['Ingredients', 'INGREDIENTS', 'Ingredients list'])}${pick(SEP)}${pick(['Sugar, Wheat Flour, Edible Vegetable Oil (Palm), Cocoa Solids, Milk Solids, Emulsifiers (322, 471)', 'Toor Dal', 'Rice, Salt, Turmeric, Chilli, Coriander', 'Tea, Natural Flavours', 'Wheat flour, iodised salt'])}`,
    () => `${pick(['Directions for use', 'How to use', 'Usage', 'Serving suggestion'])}${pick(SEP)}${pick(['2-3g (full length brush amount) twice daily or as directed by a Dentist', 'Add to boiling water and simmer for 10 minutes', 'Mix 2 spoons with warm water', 'Use as required'])}`,
    () => `${pick(['Store in a cool, dry place', 'Store in a cool and dry place away from sunlight', 'Keep away from direct sunlight', 'Refrigerate after opening', 'Shake well before use', 'Keep in an airtight container', 'Do not accept if seal is broken', 'For external use only'])}`,
    () => `${pick(['Nutritional Information', 'NUTRITION FACTS', 'Nutritional Information per 100 g', 'Approx. values per 100g'])}`,
    () => `${pick(['Energy', 'Protein', 'Carbohydrate', 'Total Fat', 'Sodium', 'Dietary Fibre', 'Sugars'])} ${pick(['350 kcal', '12.5 g', '65 g', '0.8 g', '120 mg', '4 g'])}`,
    () => `${pick(['Ayurvedic Medicine Composition', 'Composition', 'Each 100g contains', 'Proprietary Ayurvedic Medicine'])}${pick(SEP)}${pick(['Herbal Extract 2.5% w/w derived from Maricha (Piper nigrum), Pippali (Piper longum)', 'Lavanga 0.50 g, Karpura 0.50 g, Pudina 0.50 g, Gairic powder 1.80 g', 'Sodium Saccharin 0.15% w/w'])}`,
    () => `${pick(['GMP CERTIFIED', 'ISO 22000 Certified', 'HACCP', 'FSSC 22000', 'Vegetarian', 'This is a vegetarian product', '100% Natural', 'No added preservatives', 'No artificial colours', 'Gluten free', 'Rich in protein', 'Since 1884', 'Trusted by millions', 'New improved formula', 'Free 1N Binaca toothbrush', 'Unpolished Premium Grade', 'FOR TEETH & GUMS', 'For healthy gums', 'Family pack', 'Economy pack', 'Buy 2 get 1 free', 'Save Rs. 40', 'Extra 20% free'])}`,
    () => `${pick(['8 901207 027420', '8901207027420', '890 1234 567890', '8 906007 123456'])}`,
    () => `${pick(['For name & address of Mfg. unit, read the first two characters of the batch code & see below', 'Read the batch code for the manufacturing unit', 'Contains permitted natural colours', 'Allergen advice: contains milk, wheat and soy', 'Actual product may vary from the image shown', '*Based on clinical study, with regular use as directed on pack', 'This pack is for reference only', 'Individual pack not to be sold loose', 'Toothbrush image on the pack is for reference only'])}`,
    () => `${pick(['Sugar', 'Salt', 'Wheat Flour', 'Rice', 'Water', 'Edible Oil', 'Palm Oil', 'Milk Solids', 'Cocoa', 'Spices & Condiments'])}${pick([',', ' -', ''])} ${pick(['Sugar', 'Salt', 'Turmeric', 'Chilli', 'Cumin', 'Coriander', 'Fenugreek'])}`,
    () => `${pick(['Serving size', 'Servings per pack', 'Recommended daily allowance', 'Per serve'])} ${pick(['30 g', '10', '2000 kcal', '15 g'])}`,
  ],
};

/* ------------------------------------------------------------ noise */
const CONFUSE: [RegExp, string][] = [
  [/O/g, '0'], [/0/g, 'O'], [/l/g, '1'], [/1/g, 'l'], [/S/g, '$'], [/I/g, 'l'], [/rn/g, 'm'], [/e/g, 'c'], [/a/g, 'o'], [/B/g, '8'], [/G/g, '6'],
];
function noisy(text: string): string {
  let t = text;
  if (maybe(0.35)) {
    const [re, to] = pick(CONFUSE);
    // Apply to a fraction of matches.
    let n = 0;
    t = t.replace(re, (m) => (maybe(0.4) ? ((n++), to) : m));
  }
  if (maybe(0.2)) t = t.replace(/[aeiou]/, '');
  if (maybe(0.15)) {
    const i = Math.floor(rnd() * Math.max(1, t.length - 1));
    t = t.slice(0, i) + t[i + 1] + t[i] + t.slice(i + 2);
  }
  if (maybe(0.15)) t = t.toUpperCase();
  if (maybe(0.1)) t = t.toLowerCase();
  if (maybe(0.15)) t = t.replace(/\s+/g, (s) => (maybe(0.5) ? '  ' : s));
  if (maybe(0.1)) t = `${pick(['| ', ': ', '. ', '- ', '» '])}${t}`;
  return t;
}

/* ------------------------------------------------------------ corpus */
interface Sample { text: string; label: number }
const PER_CLASS = 900;
const samples: Sample[] = [];
SECTION_CLASSES.forEach((cls, label) => {
  const gens = T[cls];
  const n = cls === 'OTHER' ? PER_CLASS * 2 : PER_CLASS;
  for (let i = 0; i < n; i++) {
    const text = pick(gens)();
    samples.push({ text: maybe(0.6) ? noisy(text) : text, label });
  }
});
// Real OCR lines labelled by dataset-eval (dataset/lines.jsonl). Each is
// repeated so the handful of real lines is not drowned by the synthetic corpus,
// and a noisy copy is added so the model sees them the way OCR mangles them.
const REAL = fileURLToPath(new URL('../../dataset/lines.jsonl', import.meta.url));
let realCount = 0;
if (existsSync(REAL)) {
  const seen = new Set<string>();
  for (const raw of readFileSync(REAL, 'utf8').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const rec = JSON.parse(raw) as { text: string; label: string };
    const label = SECTION_CLASSES.indexOf(rec.label as SectionClass);
    const key = `${label}|${rec.text}`;
    if (label < 0 || seen.has(key)) continue;
    seen.add(key);
    realCount++;
    for (let i = 0; i < 3; i++) samples.push({ text: i === 0 ? rec.text : noisy(rec.text), label });
  }
  console.log(`real labelled lines: ${realCount} (×3 with noise)`);
}
// shuffle
for (let i = samples.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [samples[i], samples[j]] = [samples[j], samples[i]];
}
const holdout = Math.floor(samples.length * 0.15);
const test = samples.slice(0, holdout);
const train = samples.slice(holdout);
console.log(`corpus: ${samples.length} lines · train ${train.length} · test ${test.length} · ${SECTION_CLASSES.length} classes`);

/* ------------------------------------------------------------ model */
const K = SECTION_CLASSES.length;
const W = new Float32Array(K * FEATURE_DIM);
const feats = train.map((s) => featurise(s.text));
const testFeats = test.map((s) => featurise(s.text));

function scores(f: Map<number, number>, out: Float32Array) {
  out.fill(0);
  for (const [i, v] of f) for (let k = 0; k < K; k++) out[k] += W[k * FEATURE_DIM + i] * v;
}
function softmax(z: Float32Array) {
  let max = -Infinity;
  for (const v of z) max = Math.max(max, v);
  let sum = 0;
  for (let k = 0; k < z.length; k++) { z[k] = Math.exp(z[k] - max); sum += z[k]; }
  for (let k = 0; k < z.length; k++) z[k] /= sum;
}
function accuracy(fs: Map<number, number>[], ss: Sample[]) {
  const z = new Float32Array(K);
  let ok = 0;
  const confusion = new Map<string, number>();
  fs.forEach((f, i) => {
    scores(f, z);
    let best = 0;
    for (let k = 1; k < K; k++) if (z[k] > z[best]) best = k;
    if (best === ss[i].label) ok++;
    else confusion.set(`${SECTION_CLASSES[ss[i].label]}→${SECTION_CLASSES[best]}`, (confusion.get(`${SECTION_CLASSES[ss[i].label]}→${SECTION_CLASSES[best]}`) ?? 0) + 1);
  });
  return { acc: ok / fs.length, confusion };
}

const EPOCHS = 30;
const L2 = 1e-5;
const z = new Float32Array(K);
for (let epoch = 0; epoch < EPOCHS; epoch++) {
  const lr = 0.5 / (1 + epoch * 0.15);
  const order = feats.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (const idx of order) {
    const f = feats[idx];
    scores(f, z);
    softmax(z);
    const y = train[idx].label;
    for (let k = 0; k < K; k++) {
      const g = z[k] - (k === y ? 1 : 0);
      if (Math.abs(g) < 1e-4) continue;
      const base = k * FEATURE_DIM;
      for (const [i, v] of f) W[base + i] -= lr * (g * v + L2 * W[base + i]);
    }
  }
  if (epoch % 5 === 4 || epoch === EPOCHS - 1) {
    const { acc } = accuracy(testFeats, test);
    console.log(`epoch ${String(epoch + 1).padStart(2)} · held-out accuracy ${(acc * 100).toFixed(1)}%`);
  }
}
const { acc, confusion } = accuracy(testFeats, test);
console.log(`\nheld-out accuracy: ${(acc * 100).toFixed(1)}%`);
const worst = [...confusion.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
if (worst.length) console.log('most common confusions:', worst.map(([k, v]) => `${k} ×${v}`).join(' · '));

/* ------------------------------------------------------------ spot check */
const SPOT: [string, SectionClass][] = [
  ['MRP Rs.(incl. of all taxes)', 'MRP'], ['Rs. 220.00', 'MRP'], ['Rs. 0.73 per g', 'MRP'], ['Net Quantity: 300g', 'NET_QUANTITY'],
  ['2 Packs 1N x 200g + 1N x 100g', 'NET_QUANTITY'], ['Batch No., Mfd.', 'DATE_OF_PACKING'], ['Expiry', 'BEST_BEFORE'], ['07/2026', 'DATE_OF_PACKING'],
  ['RU3743 L8B', 'BATCH_NUMBER'], ['DABUR CARES: CALL OR WRITE', 'CONSUMER_CARE'], ['E-MAIL: daburcares@dabur.com', 'CONSUMER_CARE'],
  ['TOLL FREE 1800-103-1644', 'CONSUMER_CARE'], ['MADE IN INDIA', 'COUNTRY_OF_ORIGIN'], ['DABUR RED PASTE', 'PRODUCT_IDENTITY'],
  ['BD) DABUR INDIA LTD., Vill. Billanwali Lavana, P.O. Baddi, Distt. Solan, (H.P.) - 173 205. Mfg. Lic. No.: HP-173-AY', 'MANUFACTURER_NAME'],
  ['Regd. Office: 8/3, Asaf Ali Road, New Delhi - 110 002.', 'MANUFACTURER_ADDRESS'], ['GMP CERTIFIED', 'OTHER'],
  ['Directions for use: 2-3g (full length brush amount) twice daily', 'OTHER'], ['FSSAI Lic. No. 10019043002277', 'FSSAI_LICENSE'],
  ['Consumer Coll. Agro Mills Pvt Lid, Toll Free 1800-233-7788', 'CONSUMER_CARE'], ['Toor Dal (Arhar)', 'PRODUCT_IDENTITY'],
  ['MAXIMUM RETAIL PRICE', 'MRP'], ['Best Before 9 months from packing', 'BEST_BEFORE'], ['Imported by: ABC Imports Pvt Ltd, Mumbai', 'IMPORTER_DETAILS'],
  ['Himalaya', 'PRODUCT_IDENTITY'], ['mamaearth', 'PRODUCT_IDENTITY'], ['medimix', 'PRODUCT_IDENTITY'], ['Complete Care Herbal Toothpaste', 'PRODUCT_IDENTITY'],
  ['MRP ₹ (incl. of all taxes): ₹ 60.00', 'MRP'], ['Batch No.: B1224', 'BATCH_NUMBER'], ['Mfg. Date: 12/2024', 'DATE_OF_PACKING'], ['Use Before: 11/2027', 'BEST_BEFORE'],
  ['Net Wt. When Packed', 'NET_QUANTITY'], ['125 g', 'NET_QUANTITY'], ['Lic. No.: AUS-782', 'MANUFACTURER_ADDRESS'], ['Manufactured by: The Himalaya Drug Company', 'MANUFACTURER_NAME'],
  ['Makali, Bengaluru 562 162, India.', 'MANUFACTURER_ADDRESS'], ['Imported & Marketed by: Hindustan Unilever Ltd.,', 'IMPORTER_DETAILS'], ['Made in India.', 'COUNTRY_OF_ORIGIN'],
  ['For external use only.', 'OTHER'], ['PAPER BOX', 'OTHER'], ['Keep out of reach of children under 6 years.', 'OTHER'], ['www.colgate.com', 'CONSUMER_CARE'],
];
let spotOk = 0;
for (const [text, expect] of SPOT) {
  const f = featurise(text);
  scores(f, z); softmax(z);
  let best = 0;
  for (let k = 1; k < K; k++) if (z[k] > z[best]) best = k;
  const ok = SECTION_CLASSES[best] === expect;
  if (ok) spotOk++;
  console.log(`${ok ? '  ok ' : ' MISS'} ${text.slice(0, 48).padEnd(48)} → ${SECTION_CLASSES[best]} ${(z[best] * 100).toFixed(0)}%${ok ? '' : `  (expected ${expect})`}`);
}
console.log(`spot check: ${spotOk}/${SPOT.length}`);

/* ------------------------------------------------------------ save */
// int8 quantisation with one scale per class.
const scales: number[] = [];
const q = new Int8Array(K * FEATURE_DIM);
for (let k = 0; k < K; k++) {
  let max = 0;
  for (let i = 0; i < FEATURE_DIM; i++) max = Math.max(max, Math.abs(W[k * FEATURE_DIM + i]));
  const scale = max / 127 || 1;
  scales.push(scale);
  for (let i = 0; i < FEATURE_DIM; i++) q[k * FEATURE_DIM + i] = Math.round(W[k * FEATURE_DIM + i] / scale);
}
const model = {
  version: 1,
  featureDim: FEATURE_DIM,
  classes: SECTION_CLASSES,
  scales,
  weights: Buffer.from(q.buffer).toString('base64'),
  heldOutAccuracy: Number(acc.toFixed(4)),
  trainedAt: new Date().toISOString(),
  samples: samples.length,
};
const out = fileURLToPath(new URL('../src/ocr/nlp/model.json', import.meta.url));
writeFileSync(out, JSON.stringify(model));
console.log(`\nmodel written: ${out} (${Math.round(JSON.stringify(model).length / 1024)} KB)`);
