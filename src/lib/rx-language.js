/**
 * Prescription language layer.
 *
 * A doctor writes in English; the patient needs to read their instructions in the
 * language they actually speak. This module holds the pharmacy vocabulary that
 * appears on a prescription — time of day, relation to food, duration, frequency
 * and the standing advice labels — in Indian languages.
 *
 * Principles
 * ----------
 * 1. Drug names are NEVER translated. A chemist must be able to read the brand or
 *    molecule exactly as the doctor wrote it, so medicine names stay in Latin script
 *    on every prescription. Only instructions are localised.
 * 2. Numbers stay in Latin numerals (Devanagari/other numeral systems on a
 *    prescription cause more harm than good at a pharmacy counter).
 * 3. Every translation is a plain-language phrase a patient can read aloud, not a
 *    literal word-for-word conversion.
 */

export const RX_LANGUAGES = [
  { code: 'en', label: 'English', native: 'English', script: 'Latin' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', script: 'Devanagari' },
  { code: 'mr', label: 'Marathi', native: 'मराठी', script: 'Devanagari' },
  { code: 'gu', label: 'Gujarati', native: 'ગુજરાતી', script: 'Gujarati' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা', script: 'Bengali' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்', script: 'Tamil' },
  { code: 'te', label: 'Telugu', native: 'తెలుగు', script: 'Telugu' },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ', script: 'Kannada' },
  { code: 'ml', label: 'Malayalam', native: 'മലയാളം', script: 'Malayalam' },
  { code: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ', script: 'Gurmukhi' },
];

/** Canonical frequency options — the English label is what gets stored. */
export const FREQUENCIES = [
  { value: 'Once a day', key: 'od' },
  { value: 'Twice a day', key: 'bd' },
  { value: 'Three times a day', key: 'tds' },
  { value: 'Four times a day', key: 'qid' },
  { value: 'At night', key: 'hs' },
  { value: 'Every 6 hours', key: 'q6h' },
  { value: 'Every 8 hours', key: 'q8h' },
  { value: 'When needed', key: 'sos' },
  { value: 'Once a week', key: 'weekly' },
];

export const TIMINGS = [
  { value: 'Morning', key: 'morning' },
  { value: 'Afternoon', key: 'afternoon' },
  { value: 'Evening', key: 'evening' },
  { value: 'Night', key: 'night' },
];

export const RELATIONS = [
  { value: 'After food', key: 'after_food' },
  { value: 'Before food', key: 'before_food' },
  { value: 'With food', key: 'with_food' },
  { value: 'Empty stomach', key: 'empty_stomach' },
  { value: 'Before sleeping', key: 'before_sleep' },
];

const T = {
  en: {
    morning: 'morning', afternoon: 'afternoon', evening: 'evening', night: 'at night',
    after_food: 'after food', before_food: 'before food', with_food: 'with food',
    empty_stomach: 'on an empty stomach', before_sleep: 'before sleeping',
    od: 'once a day', bd: 'twice a day', tds: 'three times a day', qid: 'four times a day',
    hs: 'at night', q6h: 'every 6 hours', q8h: 'every 8 hours', sos: 'when needed', weekly: 'once a week',
    day: 'day', days: 'days', week: 'week', weeks: 'weeks', month: 'month', months: 'months',
    heading_medicines: 'Medicines', heading_advice: 'Advice', heading_followup: 'Next visit',
    heading_diagnosis: 'Diagnosis', heading_complaint: 'Complaint', heading_vitals: 'Vitals',
    heading_patient: 'Patient', heading_allergy: 'ALLERGY',
    dose: 'Dose', how_often: 'How often', how_long: 'For', notes: 'Notes',
    take: 'Take', for_days: 'for', as_needed: 'only if needed',
    followup_in: 'Come back on', no_medicine: 'No medicine prescribed.',
    signature: 'Signature', valid: 'This prescription is valid for the follow-up period shown above. Do not self-medicate beyond the stated duration.',
  },
  hi: {
    morning: 'सुबह', afternoon: 'दोपहर', evening: 'शाम', night: 'रात में',
    after_food: 'खाने के बाद', before_food: 'खाने से पहले', with_food: 'खाने के साथ',
    empty_stomach: 'खाली पेट', before_sleep: 'सोने से पहले',
    od: 'दिन में एक बार', bd: 'दिन में दो बार', tds: 'दिन में तीन बार', qid: 'दिन में चार बार',
    hs: 'रात में', q6h: 'हर 6 घंटे में', q8h: 'हर 8 घंटे में', sos: 'ज़रूरत पड़ने पर', weekly: 'सप्ताह में एक बार',
    day: 'दिन', days: 'दिन', week: 'सप्ताह', weeks: 'सप्ताह', month: 'महीना', months: 'महीने',
    heading_medicines: 'दवाइयाँ', heading_advice: 'सलाह', heading_followup: 'अगली जाँच',
    heading_diagnosis: 'निदान', heading_complaint: 'शिकायत', heading_vitals: 'जाँच के आँकड़े',
    heading_patient: 'मरीज़', heading_allergy: 'एलर्जी',
    dose: 'मात्रा', how_often: 'कितनी बार', how_long: 'कितने दिन', notes: 'टिप्पणी',
    take: 'लें', for_days: 'तक', as_needed: 'ज़रूरत पड़ने पर ही',
    followup_in: 'दोबारा आएँ', no_medicine: 'कोई दवा नहीं लिखी गई।',
    signature: 'हस्ताक्षर', valid: 'यह पर्चा ऊपर बताई अवधि तक मान्य है। तय समय से ज़्यादा दवा न लें।',
  },
  mr: {
    morning: 'सकाळी', afternoon: 'दुपारी', evening: 'संध्याकाळी', night: 'रात्री',
    after_food: 'जेवणानंतर', before_food: 'जेवणापूर्वी', with_food: 'जेवणासोबत',
    empty_stomach: 'उपाशीपोटी', before_sleep: 'झोपण्यापूर्वी',
    od: 'दिवसातून एकदा', bd: 'दिवसातून दोन वेळा', tds: 'दिवसातून तीन वेळा', qid: 'दिवसातून चार वेळा',
    hs: 'रात्री', q6h: 'दर 6 तासांनी', q8h: 'दर 8 तासांनी', sos: 'गरज असेल तेव्हा', weekly: 'आठवड्यातून एकदा',
    day: 'दिवस', days: 'दिवस', week: 'आठवडा', weeks: 'आठवडे', month: 'महिना', months: 'महिने',
    heading_medicines: 'औषधे', heading_advice: 'सल्ला', heading_followup: 'पुढील भेट',
    heading_diagnosis: 'निदान', heading_complaint: 'तक्रार', heading_vitals: 'तपासणी',
    heading_patient: 'रुग्ण', heading_allergy: 'अ‍ॅलर्जी',
    dose: 'मात्रा', how_often: 'किती वेळा', how_long: 'किती दिवस', notes: 'सूचना',
    take: 'घ्या', for_days: 'पर्यंत', as_needed: 'गरज असेल तेव्हाच',
    followup_in: 'पुन्हा या', no_medicine: 'औषध लिहिलेले नाही.',
    signature: 'सही', valid: 'हे प्रिस्क्रिप्शन वर दिलेल्या कालावधीपर्यंत वैध आहे. ठरलेल्या कालावधीपेक्षा जास्त औषध घेऊ नका.',
  },
  gu: {
    morning: 'સવારે', afternoon: 'બપોરે', evening: 'સાંજે', night: 'રાત્રે',
    after_food: 'જમ્યા પછી', before_food: 'જમ્યા પહેલાં', with_food: 'જમવા સાથે',
    empty_stomach: 'ખાલી પેટે', before_sleep: 'સૂતા પહેલાં',
    od: 'દિવસમાં એક વાર', bd: 'દિવસમાં બે વાર', tds: 'દિવસમાં ત્રણ વાર', qid: 'દિવસમાં ચાર વાર',
    hs: 'રાત્રે', q6h: 'દર 6 કલાકે', q8h: 'દર 8 કલાકે', sos: 'જરૂર પડે ત્યારે', weekly: 'અઠવાડિયે એક વાર',
    day: 'દિવસ', days: 'દિવસ', week: 'અઠવાડિયું', weeks: 'અઠવાડિયાં', month: 'મહિનો', months: 'મહિના',
    heading_medicines: 'દવાઓ', heading_advice: 'સલાહ', heading_followup: 'આગળની મુલાકાત',
    heading_diagnosis: 'નિદાન', heading_complaint: 'ફરિયાદ', heading_vitals: 'તપાસ',
    heading_patient: 'દર્દી', heading_allergy: 'એલર્જી',
    dose: 'માત્રા', how_often: 'કેટલી વાર', how_long: 'કેટલા દિવસ', notes: 'નોંધ',
    take: 'લો', for_days: 'સુધી', as_needed: 'જરૂર પડે તો જ',
    followup_in: 'ફરી આવો', no_medicine: 'કોઈ દવા લખાયેલી નથી.',
    signature: 'સહી', valid: 'આ પ્રિસ્ક્રિપ્શન ઉપર દર્શાવેલા સમયગાળા સુધી માન્ય છે. વધુ સમય દવા ન લો.',
  },
  bn: {
    morning: 'সকালে', afternoon: 'দুপুরে', evening: 'সন্ধ্যায়', night: 'রাতে',
    after_food: 'খাওয়ার পরে', before_food: 'খাওয়ার আগে', with_food: 'খাওয়ার সাথে',
    empty_stomach: 'খালি পেটে', before_sleep: 'ঘুমানোর আগে',
    od: 'দিনে একবার', bd: 'দিনে দুবার', tds: 'দিনে তিনবার', qid: 'দিনে চারবার',
    hs: 'রাতে', q6h: 'প্রতি ৬ ঘণ্টায়', q8h: 'প্রতি ৮ ঘণ্টায়', sos: 'প্রয়োজনে', weekly: 'সপ্তাহে একবার',
    day: 'দিন', days: 'দিন', week: 'সপ্তাহ', weeks: 'সপ্তাহ', month: 'মাস', months: 'মাস',
    heading_medicines: 'ঔষধ', heading_advice: 'পরামর্শ', heading_followup: 'পরবর্তী সাক্ষাৎ',
    heading_diagnosis: 'রোগনির্ণয়', heading_complaint: 'অভিযোগ', heading_vitals: 'শারীরিক পরীক্ষা',
    heading_patient: 'রোগী', heading_allergy: 'অ্যালার্জি',
    dose: 'মাত্রা', how_often: 'কতবার', how_long: 'কতদিন', notes: 'মন্তব্য',
    take: 'নিন', for_days: 'পর্যন্ত', as_needed: 'শুধু প্রয়োজন হলে',
    followup_in: 'আবার আসুন', no_medicine: 'কোনো ওষুধ লেখা হয়নি।',
    signature: 'স্বাক্ষর', valid: 'এই প্রেসক্রিপশন উপরে উল্লেখিত সময় পর্যন্ত বৈধ। নির্দিষ্ট সময়ের বেশি ওষুধ খাবেন না।',
  },
  ta: {
    morning: 'காலை', afternoon: 'மதியம்', evening: 'மாலை', night: 'இரவு',
    after_food: 'உணவுக்குப் பிறகு', before_food: 'உணவுக்கு முன்', with_food: 'உணவுடன்',
    empty_stomach: 'வெறும் வயிற்றில்', before_sleep: 'தூங்கும் முன்',
    od: 'நாளுக்கு ஒரு முறை', bd: 'நாளுக்கு இரு முறை', tds: 'நாளுக்கு மூன்று முறை', qid: 'நாளுக்கு நான்கு முறை',
    hs: 'இரவில்', q6h: 'ஒவ்வொரு 6 மணி நேரத்திற்கும்', q8h: 'ஒவ்வொரு 8 மணி நேரத்திற்கும்', sos: 'தேவைப்படும்போது', weekly: 'வாரத்திற்கு ஒரு முறை',
    day: 'நாள்', days: 'நாட்கள்', week: 'வாரம்', weeks: 'வாரங்கள்', month: 'மாதம்', months: 'மாதங்கள்',
    heading_medicines: 'மருந்துகள்', heading_advice: 'ஆலோசனை', heading_followup: 'அடுத்த வருகை',
    heading_diagnosis: 'நோயறிதல்', heading_complaint: 'புகார்', heading_vitals: 'உடல் நிலை',
    heading_patient: 'நோயாளர்', heading_allergy: 'ஒவ்வாமை',
    dose: 'அளவு', how_often: 'எத்தனை முறை', how_long: 'எத்தனை நாட்கள்', notes: 'குறிப்பு',
    take: 'எடுத்துக்கொள்ளுங்கள்', for_days: 'வரை', as_needed: 'தேவைப்பட்டால் மட்டும்',
    followup_in: 'மீண்டும் வாருங்கள்', no_medicine: 'மருந்து எதுவும் பரிந்துரைக்கப்படவில்லை.',
    signature: 'கையொப்பம்', valid: 'மேலே குறிப்பிட்ட காலம் வரை இந்த மருந்துச்சீட்டு செல்லுபடியாகும். குறிப்பிட்ட காலத்திற்கு மேல் மருந்து எடுக்க வேண்டாம்.',
  },
  te: {
    morning: 'ఉదయం', afternoon: 'మధ్యాహ్నం', evening: 'సాయంత్రం', night: 'రాత్రి',
    after_food: 'భోజనం తర్వాత', before_food: 'భోజనానికి ముందు', with_food: 'భోజనంతో పాటు',
    empty_stomach: 'పరగడుపున', before_sleep: 'నిద్రకు ముందు',
    od: 'రోజుకు ఒకసారి', bd: 'రోజుకు రెండుసార్లు', tds: 'రోజుకు మూడుసార్లు', qid: 'రోజుకు నాలుగుసార్లు',
    hs: 'రాత్రి', q6h: 'ప్రతి 6 గంటలకు', q8h: 'ప్రతి 8 గంటలకు', sos: 'అవసరమైనప్పుడు', weekly: 'వారానికి ఒకసారి',
    day: 'రోజు', days: 'రోజులు', week: 'వారం', weeks: 'వారాలు', month: 'నెల', months: 'నెలలు',
    heading_medicines: 'మందులు', heading_advice: 'సలహా', heading_followup: 'తదుపరి సందర్శన',
    heading_diagnosis: 'నిర్ధారణ', heading_complaint: 'ఫిర్యాదు', heading_vitals: 'పరీక్షలు',
    heading_patient: 'రోగి', heading_allergy: 'అలర్జీ',
    dose: 'మోతాదు', how_often: 'ఎన్నిసార్లు', how_long: 'ఎన్ని రోజులు', notes: 'గమనిక',
    take: 'తీసుకోండి', for_days: 'వరకు', as_needed: 'అవసరమైతే మాత్రమే',
    followup_in: 'మళ్లీ రండి', no_medicine: 'మందులు సూచించబడలేదు.',
    signature: 'సంతకం', valid: 'ఈ ప్రిస్క్రిప్షన్ పైన చూపిన కాలం వరకు చెల్లుబాటు అవుతుంది. ఎక్కువ కాలం మందులు వాడకండి.',
  },
  kn: {
    morning: 'ಬೆಳಿಗ್ಗೆ', afternoon: 'ಮಧ್ಯಾಹ್ನ', evening: 'ಸಂಜೆ', night: 'ರಾತ್ರಿ',
    after_food: 'ಊಟದ ನಂತರ', before_food: 'ಊಟಕ್ಕೆ ಮೊದಲು', with_food: 'ಊಟದ ಜೊತೆ',
    empty_stomach: 'ಖಾಲಿ ಹೊಟ್ಟೆಯಲ್ಲಿ', before_sleep: 'ಮಲಗುವ ಮೊದಲು',
    od: 'ದಿನಕ್ಕೆ ಒಮ್ಮೆ', bd: 'ದಿನಕ್ಕೆ ಎರಡು ಬಾರಿ', tds: 'ದಿನಕ್ಕೆ ಮೂರು ಬಾರಿ', qid: 'ದಿನಕ್ಕೆ ನಾಲ್ಕು ಬಾರಿ',
    hs: 'ರಾತ್ರಿ', q6h: 'ಪ್ರತಿ 6 ಗಂಟೆಗೆ', q8h: 'ಪ್ರತಿ 8 ಗಂಟೆಗೆ', sos: 'ಅಗತ್ಯವಿದ್ದಾಗ', weekly: 'ವಾರಕ್ಕೆ ಒಮ್ಮೆ',
    day: 'ದಿನ', days: 'ದಿನಗಳು', week: 'ವಾರ', weeks: 'ವಾರಗಳು', month: 'ತಿಂಗಳು', months: 'ತಿಂಗಳುಗಳು',
    heading_medicines: 'ಔಷಧಿಗಳು', heading_advice: 'ಸಲಹೆ', heading_followup: 'ಮುಂದಿನ ಭೇಟಿ',
    heading_diagnosis: 'ರೋಗನಿರ್ಣಯ', heading_complaint: 'ದೂರು', heading_vitals: 'ತಪಾಸಣೆ',
    heading_patient: 'ರೋಗಿ', heading_allergy: 'ಅಲರ್ಜಿ',
    dose: 'ಪ್ರಮಾಣ', how_often: 'ಎಷ್ಟು ಬಾರಿ', how_long: 'ಎಷ್ಟು ದಿನ', notes: 'ಟಿಪ್ಪಣಿ',
    take: 'ತೆಗೆದುಕೊಳ್ಳಿ', for_days: 'ವರೆಗೆ', as_needed: 'ಅಗತ್ಯವಿದ್ದರೆ ಮಾತ್ರ',
    followup_in: 'ಮತ್ತೆ ಬನ್ನಿ', no_medicine: 'ಯಾವುದೇ ಔಷಧಿ ಸೂಚಿಸಿಲ್ಲ.',
    signature: 'ಸಹಿ', valid: 'ಈ ಚೀಟಿ ಮೇಲೆ ತಿಳಿಸಿದ ಅವಧಿವರೆಗೆ ಮಾನ್ಯವಾಗಿದೆ. ಹೆಚ್ಚು ದಿನ ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳಬೇಡಿ.',
  },
  ml: {
    morning: 'രാവിലെ', afternoon: 'ഉച്ചയ്ക്ക്', evening: 'വൈകുന്നേരം', night: 'രാത്രി',
    after_food: 'ഭക്ഷണത്തിനു ശേഷം', before_food: 'ഭക്ഷണത്തിനു മുൻപ്', with_food: 'ഭക്ഷണത്തോടൊപ്പം',
    empty_stomach: 'വെറും വയറ്റിൽ', before_sleep: 'ഉറങ്ങുന്നതിനു മുൻപ്',
    od: 'ദിവസത്തിൽ ഒരിക്കൽ', bd: 'ദിവസത്തിൽ രണ്ടു തവണ', tds: 'ദിവസത്തിൽ മൂന്നു തവണ', qid: 'ദിവസത്തിൽ നാലു തവണ',
    hs: 'രാത്രി', q6h: 'ഓരോ 6 മണിക്കൂറിലും', q8h: 'ഓരോ 8 മണിക്കൂറിലും', sos: 'ആവശ്യമുള്ളപ്പോൾ', weekly: 'ആഴ്ചയിൽ ഒരിക്കൽ',
    day: 'ദിവസം', days: 'ദിവസം', week: 'ആഴ്ച', weeks: 'ആഴ്ച', month: 'മാസം', months: 'മാസം',
    heading_medicines: 'മരുന്നുകൾ', heading_advice: 'നിർദേശങ്ങൾ', heading_followup: 'അടുത്ത സന്ദർശനം',
    heading_diagnosis: 'രോഗനിർണയം', heading_complaint: 'പരാതി', heading_vitals: 'പരിശോധന',
    heading_patient: 'രോഗി', heading_allergy: 'അലർജി',
    dose: 'അളവ്', how_often: 'എത്ര തവണ', how_long: 'എത്ര ദിവസം', notes: 'കുറിപ്പ്',
    take: 'കഴിക്കുക', for_days: 'വരെ', as_needed: 'ആവശ്യമെങ്കിൽ മാത്രം',
    followup_in: 'വീണ്ടും വരിക', no_medicine: 'മരുന്നുകൾ നിർദേശിച്ചിട്ടില്ല.',
    signature: 'ഒപ്പ്', valid: 'മുകളിൽ കാണിച്ച കാലയളവുവരെ ഈ കുറിപ്പ് സാധുവാണ്. നിർദേശിച്ചതിലധികം മരുന്ന് കഴിക്കരുത്.',
  },
  pa: {
    morning: 'ਸਵੇਰੇ', afternoon: 'ਦੁਪਹਿਰ', evening: 'ਸ਼ਾਮ', night: 'ਰਾਤ ਨੂੰ',
    after_food: 'ਖਾਣੇ ਤੋਂ ਬਾਅਦ', before_food: 'ਖਾਣੇ ਤੋਂ ਪਹਿਲਾਂ', with_food: 'ਖਾਣੇ ਨਾਲ',
    empty_stomach: 'ਖਾਲੀ ਪੇਟ', before_sleep: 'ਸੌਣ ਤੋਂ ਪਹਿਲਾਂ',
    od: 'ਦਿਨ ਵਿੱਚ ਇੱਕ ਵਾਰ', bd: 'ਦਿਨ ਵਿੱਚ ਦੋ ਵਾਰ', tds: 'ਦਿਨ ਵਿੱਚ ਤਿੰਨ ਵਾਰ', qid: 'ਦਿਨ ਵਿੱਚ ਚਾਰ ਵਾਰ',
    hs: 'ਰਾਤ ਨੂੰ', q6h: 'ਹਰ 6 ਘੰਟੇ ਬਾਅਦ', q8h: 'ਹਰ 8 ਘੰਟੇ ਬਾਅਦ', sos: 'ਲੋੜ ਪੈਣ ਤੇ', weekly: 'ਹਫ਼ਤੇ ਵਿੱਚ ਇੱਕ ਵਾਰ',
    day: 'ਦਿਨ', days: 'ਦਿਨ', week: 'ਹਫ਼ਤਾ', weeks: 'ਹਫ਼ਤੇ', month: 'ਮਹੀਨਾ', months: 'ਮਹੀਨੇ',
    heading_medicines: 'ਦਵਾਈਆਂ', heading_advice: 'ਸਲਾਹ', heading_followup: 'ਅਗਲੀ ਮੁਲਾਕਾਤ',
    heading_diagnosis: 'ਨਿਦਾਨ', heading_complaint: 'ਸ਼ਿਕਾਇਤ', heading_vitals: 'ਜਾਂਚ',
    heading_patient: 'ਮਰੀਜ਼', heading_allergy: 'ਐਲਰਜੀ',
    dose: 'ਮਾਤਰਾ', how_often: 'ਕਿੰਨੀ ਵਾਰ', how_long: 'ਕਿੰਨੇ ਦਿਨ', notes: 'ਨੋਟ',
    take: 'ਲਓ', for_days: 'ਤੱਕ', as_needed: 'ਲੋੜ ਪੈਣ ਤੇ ਹੀ',
    followup_in: 'ਦੁਬਾਰਾ ਆਓ', no_medicine: 'ਕੋਈ ਦਵਾਈ ਨਹੀਂ ਲਿਖੀ ਗਈ।',
    signature: 'ਦਸਤਖ਼ਤ', valid: 'ਇਹ ਪਰਚੀ ਉੱਪਰ ਦਿੱਤੇ ਸਮੇਂ ਤੱਕ ਵੈਧ ਹੈ। ਤੈਅ ਸਮੇਂ ਤੋਂ ਵੱਧ ਦਵਾਈ ਨਾ ਲਓ।',
  },
};

/** Translate a canonical key into a language. Falls back to English. */
export function t(lang, key) {
  return T[lang]?.[key] ?? T.en[key] ?? key;
}

/** Full dictionary for a language (used by the print sheet). */
export function dict(lang) {
  return { ...T.en, ...(T[lang] ?? {}) };
}

/**
 * Normalise free-text frequency/duration into a key so it can be translated,
 * while preserving anything the doctor typed by hand.
 */
export function frequencyKey(value) {
  const v = String(value ?? '').toLowerCase().trim();
  const hit = FREQUENCIES.find((f) => f.value.toLowerCase() === v || f.key === v);
  if (hit) return hit.key;
  if (/once|1 time|od|^1x/.test(v)) return 'od';
  if (/twice|2 time|bd|^2x/.test(v)) return 'bd';
  if (/thrice|three|3 time|tds|^3x/.test(v)) return 'tds';
  if (/four|4 time|qid|^4x/.test(v)) return 'qid';
  if (/night|bed|hs/.test(v)) return 'hs';
  if (/6 hour/.test(v)) return 'q6h';
  if (/8 hour/.test(v)) return 'q8h';
  if (/sos|needed|required/.test(v)) return 'sos';
  if (/week/.test(v)) return 'weekly';
  return null;
}

export function relationKey(value) {
  const v = String(value ?? '').toLowerCase().trim();
  const hit = RELATIONS.find((r) => r.value.toLowerCase() === v);
  if (hit) return hit.key;
  if (/empty/.test(v)) return 'empty_stomach';
  if (/before.*(food|meal)/.test(v)) return 'before_food';
  if (/with.*(food|meal)/.test(v)) return 'with_food';
  if (/sleep|bed/.test(v)) return 'before_sleep';
  if (/after.*(food|meal)/.test(v)) return 'after_food';
  return null;
}

/**
 * The shorthand a chemist reads, next to the sentence the assistant reads.
 *
 * "Twice a day" is what gets stored and printed in words; BD is what is written
 * on a prescription pad and what the person at the counter glances at. Both are
 * shown, and neither is ever translated.
 */
/**
 * The pad notation — "1-0-1".
 *
 * A prescription in this country is written by hand as three numbers: morning,
 * afternoon, night. 1-0-1 is a tablet in the morning and one at night; 1-1-1 is
 * three times a day; 0-0-1 is bedtime only. Two numbers mean morning and night,
 * four add the evening, and a half tablet is written ½ — the way it is written on
 * a pad, never 0.5, because a chemist reads a fraction.
 *
 * Anything that is not made of those parts is not a pattern: parseDosePattern
 * returns null and the words in the frequency field stand, rather than a slip
 * carrying a number nobody can act on.
 */
export const PATTERN_COLUMNS = {
  2: ['morning', 'night'],
  3: ['morning', 'afternoon', 'night'],
  4: ['morning', 'afternoon', 'evening', 'night'],
};

const PATTERN_AMOUNTS = {
  0: 0, '½': 0.5, '0.5': 0.5, '.5': 0.5, '1/2': 0.5,
  1: 1, 2: 2, 3: 3, 4: 4,
};

export function parseDosePattern(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const parts = raw.split(/[\s\-–—_,/]+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return null;
  const slots = [];
  for (const part of parts) {
    const amount = PATTERN_AMOUNTS[part];
    if (amount === undefined) return null;
    slots.push(amount);
  }
  // 0-0-0 is a schedule that orders nothing.
  if (!slots.some((n) => n > 0)) return null;
  return slots;
}

export function formatDosePattern(slots) {
  if (!Array.isArray(slots) || !slots.length) return '';
  return slots.map((n) => (n === 0.5 ? '½' : String(n))).join('-');
}

const PATTERN_WHEN_EN = {
  morning: 'in the morning',
  afternoon: 'in the afternoon',
  evening: 'in the evening',
  night: 'at night',
};

/** The words for a pattern: "in the morning · at night", or "½ in the morning · 1 at night". */
export function patternPhrase(slots, lang = 'en') {
  const columns = PATTERN_COLUMNS[slots?.length];
  if (!columns) return '';
  const d = dict(lang);
  const when = (slot) => (lang === 'en' ? PATTERN_WHEN_EN[slot] ?? d[slot] : d[slot]);
  const taken = slots.map((amount, i) => ({ amount, when: when(columns[i]) })).filter((x) => x.amount > 0);
  if (!taken.length) return '';
  const uniform = taken.every((x) => x.amount === taken[0].amount);
  return taken.map((x) => (uniform ? x.when : `${x.amount === 0.5 ? '½' : x.amount} ${x.when}`)).join(' · ');
}

/** The frequency words a pattern implies, so the two fields cannot contradict each other. */
const PATTERN_FREQUENCIES = {
  '1-1': 'Twice a day',
  '1-0-0': 'Once a day',
  '1-0-1': 'Twice a day',
  '0-1-0': '',
  '1-1-1': 'Three times a day',
  '1-1-1-1': 'Four times a day',
  '0-0-1': 'At night',
};

export function frequencyForPattern(pattern) {
  const slots = parseDosePattern(pattern);
  if (!slots) return '';
  const signature = slots.map((n) => (n > 0 ? 1 : 0)).join('-');
  return PATTERN_FREQUENCIES[signature] ?? '';
}

/** The chips beside the field: what a pad is actually written in. */
export const PATTERN_PRESETS = [
  { pattern: '1-0-0', hint: 'morning only' },
  { pattern: '1-0-1', hint: 'morning and night' },
  { pattern: '1-1-1', hint: 'after each meal' },
  { pattern: '1-1-1-1', hint: 'four times a day' },
  { pattern: '0-1-0', hint: 'afternoon only' },
  { pattern: '0-0-1', hint: 'bedtime only' },
];

export const FREQUENCY_SHORTHAND = {
  od: 'OD', bd: 'BD', tds: 'TDS', qid: 'QID', hs: 'HS',
  q6h: 'q6h', q8h: 'q8h', sos: 'SOS', weekly: '1/wk',
};

/** The times of day each frequency covers — what the dose pattern is built from. */
const SLOTS_BY_FREQUENCY = {
  od: ['morning'],
  bd: ['morning', 'night'],
  tds: ['morning', 'afternoon', 'night'],
  qid: ['morning', 'afternoon', 'evening', 'night'],
  hs: ['night'],
};

export function slotsForFrequency(value) {
  const key = frequencyKey(value);
  const slots = key ? SLOTS_BY_FREQUENCY[key] : null;
  return slots ? [...slots] : [];
}

/**
 * "1-0-1" — the pattern on the strip, not a sentence.
 *
 * A half tablet is written ½ rather than 0.5: a chemist reads a fraction, not a
 * decimal. "When needed", "every 6 hours" and "once a week" have no daily
 * pattern, so they return '' and the slip keeps the words instead.
 */
export function dosePattern(rx) {
  // A pattern the doctor typed is the pattern that prints — it is the only thing
  // on the row that knows a dose can be skipped in the afternoon.
  const explicit = parseDosePattern(rx?.pattern) ?? parseDosePattern(rx?.frequency);
  if (explicit) return formatDosePattern(explicit);
  const slots = slotsForFrequency(rx?.frequency);
  if (!slots.length) return '';
  const dose = String(rx?.dose ?? '').toLowerCase();
  const each = /(^|[^0-9])½|half/.test(dose) ? '½' : /^\s*(2|two)\b/.test(dose) ? '2' : '1';
  const columns = slots.length === 4 ? ['morning', 'afternoon', 'evening', 'night'] : ['morning', 'afternoon', 'night'];
  return columns.map((slot) => (slots.includes(slot) ? each : '0')).join('-');
}

/**
 * Duration in days, when the duration says something countable.
 *
 * "5 days" → 5, "2 weeks" → 14, "1 month" → 30 (the calendar-aware version is
 * addDays' job), "till review" → null. Used for the "till 12 Nov" hint and for
 * the follow-up check, never to rewrite what the doctor typed.
 */
export function durationInDays(value) {
  const { amount, unit } = durationParts(value);
  if (amount == null) return null;
  const per = String(unit).startsWith('week') ? 7 : String(unit).startsWith('month') ? 30 : 1;
  return Math.round(amount * per);
}

/**
 * How many doses a day a frequency means.
 *
 * Every-6-hours is four a day and every-8-hours is three, which is what makes a
 * quantity calculable; "when needed" and "once a week" have no per-day rate and
 * return null rather than a guess.
 */
export function dosesPerDay(frequency) {
  // A pattern carries its own count: 1-0-1 is two a day whatever the words say.
  const slots = parseDosePattern(frequency);
  if (slots) return slots.reduce((sum, n) => sum + n, 0);
  const key = frequencyKey(frequency);
  const rate = { od: 1, bd: 2, tds: 3, qid: 4, hs: 1, q6h: 4, q8h: 3 }[key];
  return rate ?? null;
}

/** Doses per day for a whole row: the typed pattern if there is one, else the words. */
export function dosesPerDayFor(rx) {
  const slots = parseDosePattern(rx?.pattern);
  if (slots) return slots.reduce((sum, n) => sum + n, 0);
  return dosesPerDay(rx?.frequency);
}

/** Units a dose can be counted in, so a quantity can be labelled rather than guessed. */
const DOSE_UNITS = ['tablet', 'capsule', 'puff', 'drop', 'sachet', 'respule', 'dose', 'ml', 'application'];

function doseUnit(dose) {
  const text = String(dose ?? '').toLowerCase();
  return DOSE_UNITS.find((u) => new RegExp(`(^|[^a-z])${u}`).test(text)) ?? null;
}

function doseAmount(dose) {
  const text = String(dose ?? '').trim().toLowerCase();
  if (!text) return null;
  if (/(^|[^0-9])½|half/.test(text)) return 0.5;
  const n = Number((text.match(/\d+(?:\.\d+)?/) ?? [])[0]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * What the chemist has to hand over: 1 tablet twice a day for 5 days is 10
 * tablets, and a slip that says so is a slip nobody has to count out twice.
 *
 * Returns null when the answer would be a guess — "when needed", "till review",
 * "apply thinly" — and the print then shows a dash instead of a false number.
 */
export function quantityToDispense(rx) {
  const days = durationInDays(rx?.duration);
  const amount = doseAmount(rx?.dose);
  const unit = doseUnit(rx?.dose);
  if (!days || !amount || !unit) return null;

  const slots = parseDosePattern(rx?.pattern);
  let count = null;
  if (slots) {
    // The pattern's numbers are counts of the dose, so for a tablet 1-0-1 is two
    // tablets a day — the dose field and the pattern cannot both be multiplied.
    // A volume is the exception: "5 ml · 0-0-3" is three doses of 5 ml.
    const perDay = unit === 'ml' ? amount * slots.reduce((sum, n) => sum + n, 0) : slots.reduce((sum, n) => sum + n, 0);
    count = perDay * days;
  } else {
    const perDay = dosesPerDay(rx?.frequency);
    if (!perDay) return null;
    count = amount * perDay * days;
  }

  // Half a tablet still comes out of a whole one: 4.5 tablets is 5 on the counter.
  count = unit === 'ml' ? Math.round(count * 100) / 100 : Math.ceil(count * 100) / 100;
  if (unit !== 'ml' && count > 0 && Number.isInteger(count) === false) count = Math.ceil(count);
  const singular = unit === 'ml' ? 'ml' : unit;
  const label = unit === 'ml'
    ? `${count} ml`
    : `${count} ${singular}${count === 1 ? '' : 's'}`;
  return { count, unit, label };
}

/**
 * Dose chips that match the form of the drug that was picked.
 *
 * "1 tablet" is nonsense for a syrup and "5 ml" is nonsense for an inhaler, and
 * a doctor should not have to type either. The default list is tablets, because
 * that is what most of a clinic's day is.
 */
export function doseChoicesFor(form) {
  const f = String(form ?? '').toLowerCase();
  if (/eye|ear|nasal|nose/.test(f)) return ['1 drop', '2 drops'];
  if (/cream|ointment|gel|lotion|paste/.test(f)) return ['Apply thinly', 'Apply twice'];
  if (/inhaler|rotacap|respule|nebul/.test(f)) return ['1 puff', '2 puffs', '1 respule'];
  if (/injection|vial|ampoule|infusion/.test(f)) return ['1 dose', '0.5 ml', '1 ml'];
  if (/syrup|suspension|solution|liquid|elixir|oral/.test(f)) return ['5 ml', '10 ml', '2.5 ml', '15 ml'];
  if (/sachet|powder|granule/.test(f)) return ['1 sachet', '½ sachet'];
  if (/capsule/.test(f)) return ['1 capsule', '2 capsules'];
  return ['1 tablet', '½ tablet', '2 tablets'];
}

/** Split "5 days" / "2 weeks" / "1 month" into a translatable unit + amount. */
export function durationParts(value) {
  const raw = String(value ?? '').trim();
  const m = raw.match(/^(\d+(?:\.\d+)?)\s*(day|days|week|weeks|month|months|d|w|m)?$/i);
  if (!m) return { amount: null, unit: null, raw };
  const amount = Number(m[1]);
  const u = (m[2] ?? 'day').toLowerCase();
  let unit = 'day';
  if (u.startsWith('w')) unit = amount === 1 ? 'week' : 'weeks';
  else if (u.startsWith('m')) unit = amount === 1 ? 'month' : 'months';
  else unit = amount === 1 ? 'day' : 'days';
  return { amount, unit, raw };
}

/**
 * The one-line patient instruction shown on the printed slip, e.g.
 *   "खाने के बाद · दिन में दो बार · 5 दिन तक"
 */
export function patientInstruction(rx, lang = 'en') {
  const d = dict(lang);
  const parts = [];
  const rel = relationKey(rx.instructions) ?? relationKey(rx.relation);
  if (rel) parts.push(d[rel]);
  const slots = parseDosePattern(rx.pattern);
  if (slots) {
    // "1-0-1" read out loud: in the morning · at night. The words in the frequency
    // field would say "twice a day" and be right, but they cannot say which two.
    parts.push(patternPhrase(slots, lang));
  } else {
    const freq = frequencyKey(rx.frequency);
    if (freq) parts.push(d[freq]);
    else if (rx.frequency) parts.push(rx.frequency);     // hand-typed, leave as written
  }

  const dur = durationParts(rx.duration);
  if (dur.amount != null) parts.push(lang === 'en' ? `for ${dur.amount} ${d[dur.unit]}` : `${dur.amount} ${d[dur.unit]} ${d.for_days}`);
  else if (rx.duration) parts.push(rx.duration);

  return parts.filter(Boolean).join(' · ');
}

/** Does this language need a non-Latin font stack? */
export function fontStackFor(lang) {
  const common = '"Noto Sans", "Noto Sans Devanagari", "Noto Sans Gujarati", "Noto Sans Bengali", "Noto Sans Tamil", "Noto Sans Telugu", "Noto Sans Kannada", "Noto Sans Malayalam", "Noto Sans Gurmukhi", var(--font)';
  return common;
}

/**
 * Build the printable text lines for a consultation in a given language,
 * so the same data can render in English, Hindi, Marathi and so on.
 */
export function rxSheet(consultation, { lang = 'en', patient = {}, doctor = {}, clinic = {} } = {}) {
  const d = dict(lang);
  return {
    headings: {
      medicines: d.heading_medicines,
      advice: d.heading_advice,
      followup: d.heading_followup,
      diagnosis: d.heading_diagnosis,
      complaint: d.heading_complaint,
      vitals: d.heading_vitals,
      patient: d.heading_patient,
      allergy: d.heading_allergy,
    },
    columns: { dose: d.dose, howOften: d.how_often, howLong: d.how_long, notes: d.notes },
    rows: (consultation.prescription ?? []).map((rx) => ({
      medicine: rx.drug,                       // never translated
      dose: rx.dose,
      instruction: patientInstruction(rx, lang),
      notes: rx.notes ?? '',
    })),
    advice: consultation.advice ?? '',
    followUp: consultation.follow_up_on,
    footer: d.valid,
    signature: d.signature,
    languageLabel: RX_LANGUAGES.find((l) => l.code === lang)?.native ?? 'English',
  };
}
