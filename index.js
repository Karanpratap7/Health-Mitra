const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cron = require('node-cron');
const franc = require('franc-min');
const crypto = require('crypto');

dotenv.config();

const app = express();
app.use(express.json());

// Environment configuration
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'change-me';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';

// In-memory stores (replace with a database in production)
const userStore = new Map(); // key: phone, value: { pseudoId, lang, subscribed, location, members: [], lastActive }
const anonymizedLogs = []; // { pseudoId, ts, msgType, contentLen, intent }

// Supported languages mapping (ISO codes from franc → internal tag)
const languageMap = {
	// English, Hindi, Bengali, Telugu, Marathi
	eng: 'en',
	hin: 'hi',
	ben: 'bn',
	tel: 'te',
	mar: 'mr'
};

const defaultLanguage = 'en';

// Simple i18n strings
const i18n = {
	en: {
		welcome: "Hello! I'm your Public Health Assistant. Ask about hygiene, symptoms, or vaccines. Type 'subscribe' for outbreak alerts or 'help' for options.",
		help: "Options: hygiene | symptoms <disease> | vaccines | add child <Name> <YYYY-MM-DD> | subscribe | unsubscribe | set location <your area>",
		unknown: "Sorry, I didn't understand. Type 'help' to see options.",
		subscribed: "You are now subscribed to local outbreak alerts.",
		unsubscribed: "You have been unsubscribed from alerts.",
		setLocationOk: "Location saved. You'll receive area-specific alerts.",
		vaccinesInfo: "Vaccination info: Children need timely doses (BCG, DPT, OPV, HepB, MMR). Adults: Tetanus boosters, influenza for seniors, COVID boosters per advisory.",
		hygieneInfo: "Preventive care: wash hands with soap, safe drinking water, mosquito control, balanced diet, regular exercise, and adequate sleep.",
		addedChild: name => `Added ${name}. We'll send reminders based on due dates.`,
		outbreakAlert: area => `Health advisory for ${area}: ${new Date().toDateString()}.`,
		reminderPrefix: "Vaccination reminder:",
		symptomsPrefix: disease => `Common symptoms of ${disease}:`,
	},
	hi: {
		welcome: "नमस्ते! मैं आपका स्वास्थ्य सहायक हूँ। स्वच्छता, लक्षण या टीकाकरण के बारे में पूछें। अलर्ट के लिए 'subscribe' लिखें या विकल्पों के लिए 'help'।",
		help: "विकल्प: hygiene | symptoms <रोग> | vaccines | add child <नाम> <YYYY-MM-DD> | subscribe | unsubscribe | set location <क्षेत्र>",
		unknown: "क्षमा करें, मैं समझ नहीं पाया। विकल्पों के लिए 'help' लिखें।",
		subscribed: "आप स्थानीय अलर्ट के लिए सदस्यता ले चुके हैं।",
		unsubscribed: "आपने अलर्ट सदस्यता रद्द कर दी है।",
		setLocationOk: "स्थान सहेजा गया। आपको क्षेत्र-विशिष्ट अलर्ट मिलेंगे।",
		vaccinesInfo: "टीकाकरण जानकारी: बच्चों के लिए BCG, DPT, OPV, HepB, MMR समय पर। वयस्क: टेटनस बूस्टर, वरिष्ठों के लिए इन्फ्लूएंजा, सलाहानुसार COVID बूस्टर।",
		hygieneInfo: "रोकथाम: साबुन से हाथ धोएँ, स्वच्छ पानी, मच्छर नियंत्रण, संतुलित आहार, व्यायाम, और पर्याप्त नींद।",
		addedChild: name => `${name} जोड़ा गया। हम नियत तिथियों के अनुसार रिमाइंडर भेजेंगे।`,
		outbreakAlert: area => `${area} के लिए स्वास्थ्य सलाह: ${new Date().toDateString()}.`,
		reminderPrefix: "टीकाकरण रिमाइंडर:",
		symptomsPrefix: disease => `${disease} के सामान्य लक्षण:`,
	},
	bn: {
		welcome: "হ্যালো! আমি আপনার স্বাস্থ্য সহকারী। স্বাস্থ্যবিধি, উপসর্গ বা টিকা সম্পর্কে জিজ্ঞাসা করুন। সতর্কতার জন্য 'subscribe' বা বিকল্পের জন্য 'help' লিখুন।",
		help: "বিকল্প: hygiene | symptoms <রোগ> | vaccines | add child <নাম> <YYYY-MM-DD> | subscribe | unsubscribe | set location <এলাকা>",
		unknown: "দুঃখিত, বুঝতে পারিনি। বিকল্পগুলোর জন্য 'help' লিখুন।",
		subscribed: "আপনি স্থানীয় সতর্কতায় সাবস্ক্রাইব করেছেন।",
		unsubscribed: "আপনি সতর্কতা থেকে আনসাবস্ক্রাইব করেছেন।",
		setLocationOk: "অবস্থান সংরক্ষিত। এলাকা-ভিত্তিক সতর্কতা পাবেন।",
		vaccinesInfo: "টিকা তথ্য: শিশুদের জন্য BCG, DPT, OPV, HepB, MMR সময়মতো। প্রাপ্তবয়স্ক: টিটেনাস বুস্টার, সিনিয়রদের জন্য ইনফ্লুয়েঞ্জা, পরামর্শ অনুযায়ী COVID বুস্টার।",
		hygieneInfo: "প্রতিরোধ: সাবান দিয়ে হাত ধोय়া, নিরাপদ পানি, মশা নিয়ন্ত্রণ, সুষম খাদ্য, ব্যায়াম, পর্যাপ্ত ঘুম।",
		addedChild: name => `${name} যোগ করা হয়েছে। নির্ধারিত তারিখ অনুযায়ী রিমাইন্ডার পাঠানো হবে।`,
		outbreakAlert: area => `${area} এর জন্য স্বাস্থ্য পরামর্শ: ${new Date().toDateString()}.`,
		reminderPrefix: "টিকাদান রিমাইন্ডার:",
		symptomsPrefix: disease => `${disease} এর সাধারণ উপসর্গ:`,
	},
	te: {
		welcome: "హలో! నేను మీ ఆరోగ్య సహాయకుడు. పరిశుభ్రత, లక్షణాలు లేదా టీకాల గురించి అడగండి. అలర్ట్స్ కోసం 'subscribe' లేదా ఎంపికల కోసం 'help' టైప్ చేయండి.",
		help: "ఎంపికలు: hygiene | symptoms <వ్యాధి> | vaccines | add child <పేరు> <YYYY-MM-DD> | subscribe | unsubscribe | set location <ప్రాంతం>",
		unknown: "క్షమించండి, అర్థం కాలేదు. ఎంపికల కోసం 'help' టైప్ చేయండి.",
		subscribed: "మీరు స్థానిక అలర్ట్స్ కోసం సభ్యత్వం పొందారు.",
		unsubscribed: "మీరు అలర్ట్స్ నుండి సభ్యత్వాన్ని రద్దు చేసుకున్నారు.",
		setLocationOk: "ప్రాంతం సేవ్ చేయబడింది. ప్రాంతానుసారమైన అలర్ట్స్ అందుతాయి.",
		vaccinesInfo: "టీకా సమాచారం: పిల్లలకు BCG, DPT, OPV, HepB, MMR సమయానికి. పెద్దలకు: టెటనస్ బూస్టర్, వృద్ధులకు ఇన్ఫ్లూయెంజా, సలహా ప్రకారం COVID బూస్టర్లు.",
		hygieneInfo: "నిరోధం: సబ్బుతో చేతులు కడగడం, శుభ్రమైన నీరు, దోమ నియంత్రణ, సమతుల ఆహారం, వ్యాయామం, తగిన నిద్ర.",
		addedChild: name => `${name} చేర్చబడింది. నిర్ణీత తేదీల ప్రకారం రిమైंडర్లు పంపబడతాయి.`,
		outbreakAlert: area => `${area} కోసం ఆరోగ్య హెచ్చరిక: ${new Date().toDateString()}.`,
		reminderPrefix: "టీకా రిమైండర్:",
		symptomsPrefix: disease => `${disease} సాధారణ లక్షణాలు:`,
	},
	mr: {
		welcome: "नमस्कार! मी तुमचा आरोग्य सहायक आहे. स्वच्छता, लक्षणे किंवा लसीकरणाबद्दल विचारा. अलर्टसाठी 'subscribe' किंवा पर्यायांसाठी 'help' टाइप करा.",
		help: "पर्याय: hygiene | symptoms <रोग> | vaccines | add child <नाव> <YYYY-MM-DD> | subscribe | unsubscribe | set location <भाग>",
		unknown: "माफ करा, समजले नाही. पर्यायांसाठी 'help' टाइप करा.",
		subscribed: "आपण स्थानिक अलर्टसाठी सदस्यता घेतली आहे.",
		unsubscribed: "आपण अलर्ट सदस्यता रद्द केली आहे.",
		setLocationOk: "स्थान जतन केले. क्षेत्रनिहाय अलर्ट मिळतील.",
		vaccinesInfo: "लसीकरण माहिती: मुलांसाठी BCG, DPT, OPV, HepB, MMR वेळेवर. प्रौढ: टेटनस बुस्टर, ज्येष्ठांसाठी इन्फ्लूएंझा, सल्ल्यानुसार COVID बुस्टर.",
		hygieneInfo: "प्रतिबंध: साबणाने हात धुवा, स्वच्छ पाणी, डास नियंत्रण, संतुलित आहार, व्यायाम, पुरेशी झोप.",
		addedChild: name => `${name} जोडले. नियत तारखेनुसार स्मरणपत्रे पाठवू.`,
		outbreakAlert: area => `${area} साठी आरोग्य सूचना: ${new Date().toDateString()}.`,
		reminderPrefix: "लसीकरण स्मरणपत्र:",
		symptomsPrefix: disease => `${disease} ची सामान्य लक्षणे:`,
	}
};

// Fallback safe symptoms dictionary (static knowledge base)
const symptomsKB = {
	en: {
		malaria: ["fever (often intermittent)", "chills", "sweats", "headache", "nausea"],
		dengue: ["high fever", "severe headache", "pain behind eyes", "joint/muscle pain"],
		influenza: ["fever", "cough", "sore throat", "body aches", "fatigue"],
		diarrhea: ["loose stools", "abdominal cramps", "dehydration risk"],
	},
	hi: {
		malaria: ["बुखार (रुक-रुक कर)", "कँपकँपी", "पसीना", "सिरदर्द", "जी मिचलाना"],
		dengue: ["तेज़ बुखार", "तेज़ सिरदर्द", "आँखों के पीछे दर्द", "जोड़/मांसपेशियों में दर्द"],
		influenza: ["बुखार", "खाँसी", "गले में खराश", "दर्द", "थकान"],
		diarrhea: ["पतले दस्त", "पेट में दर्द", "डिहाइड्रेशन का खतरा"],
	},
	bn: {
		malaria: ["জ্বর (থেমে থেমে)", "কাঁপুনি", "ঘাম", "মাথাব্যথা", "বমিভাব"],
		dengue: ["উচ্চ জ্বর", "তীব্র মাথাব্যথা", "চোখের পিছনে ব্যথা", "গাঁট/পেশীতে ব্যথা"],
		influenza: ["জ্বর", "কাশি", "গলা ব্যথা", "শরীর ব্যথা", "ক্লান্তি"],
		diarrhea: ["পাতলা পায়খানা", "পেট ব্যথা", "ডিহাইড্রেশন ঝুঁকি"],
	},
	te: {
		malaria: ["జ్వరం (కొన్ని సార్లు)", "వణుకు", "చెమటలు", "తలనొప్పి", "వాంతులు"],
		dengue: ["అధిక జ్వరం", "తీవ్ర తలనొప్పి", "కళ్ల వెనుక నొప్పి", "కీళ్ల/కండరాల నొప్పి"],
		influenza: ["జ్వరం", "దగ్గు", "గొంతు నొప్పి", "శరీర నొప్పులు", "అలసట"],
		diarrhea: ["విసర్జన ద్రవంగా", "కడుపునొప్పి", "డీహైడ్రేషన్ ప్రమాదం"],
	},
	mr: {
		malaria: ["ताप (मधूनमधून)", "कंप", "घाम", "डोकेदुखी", "मळमळ"],
		dengue: ["उच्च ताप", "तीव्र डोकेदुखी", "डोळ्यांच्या मागे वेदना", "सांधे/स्नायू वेदना"],
		influenza: ["ताप", "खोकला", "घसा खवखवणे", "शरीरदुखी", "थकवा"],
		diarrhea: ["सैल शौच", "पोटदुखी", "डिहायड्रेशनचा धोका"],
	},
};

// Vaccination schedule (simplified). Real schedules vary; consult official sources.
const vaccinationSchedule = [
	{ name: 'BCG', dueDays: 0 },
	{ name: 'OPV-0', dueDays: 0 },
	{ name: 'HepB-1', dueDays: 0 },
	{ name: 'DPT-1', dueDays: 42 }, // 6 weeks
	{ name: 'OPV-1', dueDays: 42 },
	{ name: 'HepB-2', dueDays: 28 },
	{ name: 'MMR-1', dueDays: 270 }, // 9 months
];

// Utilities
function toPseudoId(phone) {
	const hash = crypto.createHash('sha256').update(String(phone)).digest('hex');
	return `u_${hash.slice(0, 16)}`;
}

function detectLanguage(text) {
	try {
		const code = franc(text || '', { minLength: 3 });
		return languageMap[code] || defaultLanguage;
	} catch {
		return defaultLanguage;
	}
}

function getStrings(lang) {
	return i18n[lang] || i18n[defaultLanguage];
}

function logEvent(pseudoId, msgType, content, intent) {
	anonymizedLogs.push({
		pseudoId,
		ts: Date.now(),
		msgType,
		contentLen: (content || '').length,
		intent: intent || 'unknown'
	});
}

// WhatsApp send helper
async function sendWhatsAppText(to, text) {
	if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
		console.warn('WhatsApp credentials are not configured.');
		return;
	}
	const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
	try {
		await axios.post(
			url,
			{
				messaging_product: 'whatsapp',
				to,
				type: 'text',
				text: { preview_url: false, body: text }
			},
			{ headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
		);
	} catch (err) {
		console.error('Failed to send WhatsApp message', err?.response?.data || err.message);
	}
}

// Google Gemini (Generative Language) helper via REST API
async function generateAIResponse({ prompt, lang }) {
    if (!GOOGLE_API_KEY) return null;
    try {
        const model = 'gemini-1.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_API_KEY}`;
        const systemPreamble = [
            'You are a concise public health assistant for India.',
            'Provide general guidance, hygiene, prevention, and vaccine awareness.',
            'Avoid diagnosis or prescriptions; advise consulting professionals for severe/persistent symptoms.',
            'Keep answers short (4-8 sentences); use bullet points for lists.',
            'Respond in the requested language; default to English.'
        ].join(' ');
        const langHint = lang && lang !== 'en' ? `Language: ${lang}.` : '';
        const body = {
            contents: [
                {
                    role: 'user',
                    parts: [ { text: `${systemPreamble}\n${langHint}\nUser message: ${prompt}` } ]
                }
            ]
        };
        const resp = await axios.post(url, body, { headers: { 'Content-Type': 'application/json' } });
        const text = resp?.data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n').trim();
        return text || null;
    } catch (e) {
        return null;
    }
}

// Parse-safe JSON helper
function tryParseJson(str) {
    try { return JSON.parse(str); } catch { return null; }
}

// Gemini multilingual intent classifier (JSON output)
async function classifyIntentAI({ text, lang }) {
    if (!GOOGLE_API_KEY || !text) return null;
    const model = 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_API_KEY}`;
    const schema = `Respond ONLY with valid minified JSON matching this schema:
{"name":"help|hygiene|vaccines|symptoms|subscribe|unsubscribe|set_location|add_child|unknown","disease":string|null,"area":string|null,"childName":string|null,"dob":string|null}`;
    const instructions = [
        'Classify the user message into one of the intents.',
        'Extract simple entities if present.',
        'If you are unsure, use name="unknown".',
        'DOB format must be YYYY-MM-DD when add_child is present.',
        'If the message asks about symptoms of a disease, use name="symptoms" and fill disease.',
        'For location setting, name="set_location" and fill area.'
    ].join(' ');
    const langHint = lang && lang !== 'en' ? `Language: ${lang}.` : '';
    const prompt = `${instructions}\n${schema}\n${langHint}\nMessage: ${text}`;
    try {
        const body = { contents: [ { role: 'user', parts: [ { text: prompt } ] } ] };
        const resp = await axios.post(url, body, { headers: { 'Content-Type': 'application/json' } });
        const out = resp?.data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n').trim();
        const jsonStart = out?.indexOf('{');
        const jsonEnd = out?.lastIndexOf('}');
        const jsonText = (jsonStart !== -1 && jsonEnd !== -1) ? out.slice(jsonStart, jsonEnd + 1) : out;
        const parsed = tryParseJson(jsonText || '');
        if (!parsed || !parsed.name) return null;
        return parsed;
    } catch {
        return null;
    }
}

// Mock government outbreak data fetcher
async function fetchOutbreakData(area) {
	// Placeholder: integrate secure API here, handle errors and fallbacks
	// Simulate some rotating advisory messages
	const advisories = [
		'Increase mosquito control measures due to rising vector cases.',
		'Boil water before drinking to prevent water-borne illnesses.',
		'Flu-like symptoms reported; consider masks in crowded places.',
	];
	const idx = Math.floor((Date.now() / 3600000) % advisories.length);
	return { area, message: advisories[idx] };
}

// Intent parsing (very simple keyword-based; can be replaced with ML/NLU)
function parseIntent(textLower) {
	if (!textLower) return { name: 'unknown' };
	if (textLower === 'hi' || textLower === 'hello' || textLower === 'help') return { name: 'help' };
	if (textLower.startsWith('symptoms')) {
		const parts = textLower.split(/\s+/);
		const disease = parts.slice(1).join(' ').trim();
		return { name: 'symptoms', disease: disease || 'influenza' };
	}
	if (textLower.includes('hygiene') || textLower.includes('prevent') || textLower.includes('clean')) return { name: 'hygiene' };
	if (textLower.startsWith('vaccines') || textLower.includes('vaccine')) return { name: 'vaccines' };
	if (textLower === 'subscribe') return { name: 'subscribe' };
	if (textLower === 'unsubscribe') return { name: 'unsubscribe' };
	if (textLower.startsWith('set location')) return { name: 'set_location', area: textLower.replace('set location', '').trim() };
	if (textLower.startsWith('add child')) {
		const m = textLower.match(/^add child\s+([^\s]+)\s+(\d{4}-\d{2}-\d{2})/);
		if (m) return { name: 'add_child', childName: m[1], dob: m[2] };
		return { name: 'add_child' };
	}
	return { name: 'unknown' };
}

function ensureUser(phone, text) {
	if (!userStore.has(phone)) {
		const lang = detectLanguage(text || '');
		userStore.set(phone, {
			pseudoId: toPseudoId(phone),
			lang,
			subscribed: false,
			location: null,
			members: [], // { name, dob, remindersSent: Set<string> }
			lastActive: Date.now(),
			lastWelcomed: false,
		});
	} else {
		const u = userStore.get(phone);
		// Update language opportunistically based on user text
		const newLang = detectLanguage(text || '');
		if (newLang && newLang !== u.lang) u.lang = newLang;
		u.lastActive = Date.now();
	}
	return userStore.get(phone);
}

function daysBetween(a, b) {
	const ms = 24 * 60 * 60 * 1000;
	const start = new Date(a).setHours(0,0,0,0);
	const end = new Date(b).setHours(0,0,0,0);
	return Math.floor((end - start) / ms);
}

function dueVaccines(dob) {
	const today = new Date();
	const days = daysBetween(dob, today);
	return vaccinationSchedule.filter(v => days >= v.dueDays && days <= v.dueDays + 3); // window of 3 days
}

// Webhook verification (GET)
app.get('/webhook', (req, res) => {
	const mode = req.query['hub.mode'];
	const token = req.query['hub.verify_token'];
	const challenge = req.query['hub.challenge'];

	if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
		return res.status(200).send(challenge);
	}
	return res.sendStatus(403);
});

// Webhook receiver (POST)
app.post('/webhook', async (req, res) => {
	try {
		const body = req.body;
		if (body.object !== 'whatsapp_business_account') {
			return res.sendStatus(200);
		}

		const entry = body.entry?.[0];
		const change = entry?.changes?.[0];
		const value = change?.value;
		const message = value?.messages?.[0];
		const phone = message?.from; // E.164 without plus
		const text = message?.text?.body || '';

		if (!phone) {
			return res.sendStatus(200);
		}

		const user = ensureUser(phone, text);
		const lang = user.lang;
		const t = getStrings(lang);

		let reply = '';
		const lower = (text || '').trim().toLowerCase();
		const intent = parseIntent(lower);

		switch (intent.name) {
			case 'help':
				reply = `${t.welcome}\n${t.help}`;
				break;
			case 'hygiene':
				reply = t.hygieneInfo;
				break;
			case 'vaccines':
				reply = t.vaccinesInfo;
				break;
			case 'symptoms': {
				const disease = (intent.disease || 'influenza').toLowerCase();
				const kb = symptomsKB[lang]?.[disease] || symptomsKB[defaultLanguage][disease];
				if (kb) {
					reply = `${t.symptomsPrefix(disease)}\n- ${kb.join('\n- ')}`;
				} else {
					const aiText = await generateAIResponse({
						prompt: `List common symptoms and basic prevention tips for ${disease}. Keep it general and non-diagnostic.`,
						lang,
					});
					reply = aiText || `${t.symptomsPrefix(disease)}\n- fever\n- cough\n- sore throat`;
				}
				break;
			}
			case 'subscribe':
				user.subscribed = true;
				reply = t.subscribed;
				break;
			case 'unsubscribe':
				user.subscribed = false;
				reply = t.unsubscribed;
				break;
			case 'set_location': {
				const area = (intent.area || '').trim();
				if (area) {
					user.location = area;
					reply = t.setLocationOk;
				} else {
					reply = t.unknown;
				}
				break;
			}
			case 'add_child': {
				const { childName, dob } = intent;
				if (childName && dob) {
					user.members.push({ name: childName, dob, remindersSent: new Set() });
					reply = t.addedChild(childName);
				} else {
					reply = t.help;
				}
				break;
			}
			default:
				// Try multilingual NLM intent classification when rules fail
				const aiIntent = await classifyIntentAI({ text, lang });
				if (aiIntent && aiIntent.name && aiIntent.name !== 'unknown') {
					if (aiIntent.name === 'symptoms') {
						const disease = (aiIntent.disease || 'influenza').toLowerCase();
						const kb = symptomsKB[lang]?.[disease] || symptomsKB[defaultLanguage][disease];
						if (kb) {
							reply = `${t.symptomsPrefix(disease)}\n- ${kb.join('\n- ')}`;
						} else {
							const aiText = await generateAIResponse({
								prompt: `List common symptoms and basic prevention tips for ${disease}. Keep it general and non-diagnostic.`,
								lang,
							});
							reply = aiText || `${t.symptomsPrefix(disease)}\n- fever\n- cough\n- sore throat`;
						}
					} else if (aiIntent.name === 'hygiene') {
						reply = t.hygieneInfo;
					} else if (aiIntent.name === 'vaccines') {
						reply = t.vaccinesInfo;
					} else if (aiIntent.name === 'subscribe') {
						user.subscribed = true;
						reply = t.subscribed;
					} else if (aiIntent.name === 'unsubscribe') {
						user.subscribed = false;
						reply = t.unsubscribed;
					} else if (aiIntent.name === 'set_location') {
						const area = (aiIntent.area || '').trim();
						if (area) {
							user.location = area;
							reply = t.setLocationOk;
						} else {
							reply = t.unknown;
						}
					} else if (aiIntent.name === 'add_child') {
						const { childName, dob } = aiIntent;
						if (childName && dob) {
							user.members.push({ name: childName, dob, remindersSent: new Set() });
							reply = t.addedChild(childName);
						} else {
							reply = t.help;
						}
					}
				}
				if (!reply) {
				// First time users get welcome
				if (!user.lastWelcomed) {
					reply = `${t.welcome}\n${t.help}`;
					user.lastWelcomed = true;
				} else {
					const aiText = await generateAIResponse({
						prompt: `User says: "${text}". Provide brief, non-diagnostic health guidance relevant to India. Include prevention and when to seek medical care.`,
						lang,
					});
					reply = aiText || t.unknown;
				}
				}
				break;
		}

		logEvent(user.pseudoId, 'msg', text, intent.name);
		await sendWhatsAppText(phone, reply);

		return res.sendStatus(200);
	} catch (err) {
		console.error('Webhook handling error', err);
		return res.sendStatus(200);
	}
});

// Health check
app.get('/', (_req, res) => {
	res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Cron: hourly outbreak alerts for subscribed users
cron.schedule('0 * * * *', async () => {
	for (const [phone, user] of userStore.entries()) {
		if (!user.subscribed || !user.location) continue;
		try {
			const data = await fetchOutbreakData(user.location);
			const t = getStrings(user.lang);
			const alertText = `${t.outbreakAlert(user.location)}\n${data.message}`;
			await sendWhatsAppText(phone, alertText);
			logEvent(user.pseudoId, 'alert', data.message, 'outbreak_alert');
		} catch (e) {
			// fail silently; next run will try again
		}
	}
});

// Cron: daily vaccination reminders at 8 AM
cron.schedule('0 8 * * *', async () => {
	for (const [phone, user] of userStore.entries()) {
		if (!user.members?.length) continue;
		const t = getStrings(user.lang);
		for (const member of user.members) {
			const due = dueVaccines(member.dob);
			for (const v of due) {
				const key = `${member.name}:${v.name}:${new Date().toDateString()}`;
				if (member.remindersSent.has(key)) continue;
				const msg = `${t.reminderPrefix} ${member.name} is due for ${v.name}.`;
				await sendWhatsAppText(phone, msg);
				member.remindersSent.add(key);
				logEvent(user.pseudoId, 'reminder', v.name, 'vaccination_reminder');
			}
		}
	}
});

app.listen(PORT, () => {
	console.log(`Server listening on port ${PORT}`);
});
