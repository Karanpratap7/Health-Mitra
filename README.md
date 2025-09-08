## AI-Driven Public Health Chatbot

An Express-based WhatsApp chatbot that provides multilingual public health guidance, vaccination reminders, and local outbreak alerts. Includes lightweight intent parsing, i18n, scheduled jobs, and a simple in-memory store.

### Features
- Multilingual responses (English, Hindi, Bengali, Telugu, Marathi)
- Simple intents: hygiene, symptoms <disease>, vaccines, subscribe/unsubscribe, set location, add child <Name> <YYYY-MM-DD>
- Hourly outbreak alerts for subscribed users with a saved location
- Daily vaccination reminders at 08:00 for added children
- WhatsApp Cloud API integration (webhook verify + message send)
- Health check endpoint

---

## Prerequisites
- Node.js 18+ and npm
- A Facebook Developer account with WhatsApp Cloud API access
- A public HTTPS URL for webhooks (e.g., via `ngrok` during local development)

---

## Quick Start

1) Install dependencies
```bash
npm install
```

2) Create a `.env` file in the project root
```bash
PORT=3000
WHATSAPP_VERIFY_TOKEN=change-me
WHATSAPP_TOKEN=YOUR_WHATSAPP_USER_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID=YOUR_WHATSAPP_PHONE_NUMBER_ID
```

3) Start the server
```bash
npm start
```

4) Verify it’s running
```bash
curl http://localhost:3000/
# {"status":"ok","uptime":...}
```

---

## Environment Variables
- `PORT` (optional): HTTP port. Defaults to `3000`.
- `WHATSAPP_VERIFY_TOKEN`: String used by Meta for webhook verification.
- `WHATSAPP_TOKEN`: WhatsApp Cloud API user access token (Bearer).
- `WHATSAPP_PHONE_NUMBER_ID`: WhatsApp phone number ID used for sending messages.
- `GOOGLE_API_KEY` (optional but recommended): Google Generative AI (Gemini) API key for AI answers.

If `WHATSAPP_TOKEN` or `WHATSAPP_PHONE_NUMBER_ID` are missing, outbound messages are skipped with a console warning.

---

## WhatsApp Cloud API Setup (Local Dev)

1) Expose your local server with HTTPS (example using `ngrok`):
```bash
ngrok http 3000
```
Copy the `https://...` forwarding URL.

2) Configure Webhooks in Meta Developer Console:
- Callback URL (GET/POST): `https://YOUR_NGROK_DOMAIN/webhook`
- Verify Token: the same value as `WHATSAPP_VERIFY_TOKEN` in `.env`
- Subscribe to messages for your app

3) Add your phone number as a test recipient (per WhatsApp Cloud API docs).

4) Send a WhatsApp message to your WhatsApp Business number. The bot will respond based on intents. Try:
- `help`
- `hygiene`
- `symptoms influenza`
- `vaccines`
- `subscribe`
- `set location Mumbai`
- `add child Meera 2023-01-15`

---

## API Endpoints
- `GET /` — health check
- `GET /webhook` — Meta verification endpoint (`hub.mode`, `hub.verify_token`, `hub.challenge`)
- `POST /webhook` — WhatsApp message webhook receiver

### AI Behavior
- For `symptoms <disease>`: if the disease exists in the built-in dictionary, the bot replies from the KB; otherwise it asks Gemini for common symptoms and prevention tips.
- For free-text that doesn’t match a known command (e.g., “I have a cough and cold”), the bot queries Gemini for brief, India-context general guidance in the detected language.
- If `GOOGLE_API_KEY` is not set or Gemini errors, it falls back to static messages.

### Multilingual NLM (Intent Classification)
- The bot uses Gemini to classify user messages across languages into intents: `help`, `hygiene`, `vaccines`, `symptoms`, `subscribe`, `unsubscribe`, `set_location`, `add_child`, or `unknown`.
- The NLM runs as a fallback after fast rule-based parsing, improving understanding for free-text in Indian languages.
- Entities extracted: disease name, location area, child name, and DOB (`YYYY-MM-DD`).

---

## Cron Jobs
- Outbreak alerts: `0 * * * *` (hourly)
- Vaccination reminders: `0 8 * * *` (daily at 08:00)

These iterate over the in-memory `userStore`. Replace with a database in production.

---

## Development Notes
- Tech stack: Node.js, Express, Axios, `node-cron`, `franc-min`, `dotenv`
- Code entrypoint: `index.js`
- Scripts: `npm start`
- Data storage: in-memory maps/arrays; not persisted across restarts

### Google Generative AI (Gemini) Setup
1) Get an API key from Google AI Studio and set it in `.env`:
```bash
GOOGLE_API_KEY=YOUR_GOOGLE_API_KEY
```
2) Restart the server. Unknown intents and non-covered diseases will use Gemini with an India-focused safety prompt and language auto-detection.

### Production Tips
- Replace in-memory storage with a persistent database
- Secure and rotate `WHATSAPP_TOKEN`
- Validate and sanitize webhook payloads
- Add logging/observability and retry strategies
- Consider rate limiting and request authentication for non-webhook routes

---

## License
ISC

# AI-Driven Public Health Chatbot (WhatsApp)

This service implements a WhatsApp chatbot that provides multilingual public health information, basic symptom guidance (non-diagnostic), vaccination schedule reminders, and proactive outbreak alerts.

## Prerequisites
- Node.js 18+
- Meta WhatsApp Cloud API access (App + WhatsApp Business Account)
- A public HTTPS URL for webhooks (e.g., ngrok)

## Environment Variables
Create a `.env` file based on `.env.example`:

- `PORT`: Server port (default 3000)
- `WHATSAPP_VERIFY_TOKEN`: Arbitrary token to verify webhook (set in Meta App)
- `WHATSAPP_TOKEN`: Permanent access token from Meta (System User token)
- `WHATSAPP_PHONE_NUMBER_ID`: Phone number ID from WhatsApp Cloud API

## Install
```bash
npm install
```

## Run Locally
```bash
npm start
```
Expose your local port using ngrok (example):
```bash
ngrok http http://localhost:3000
```

## Configure WhatsApp Cloud API
1. In Meta for Developers → Your App → WhatsApp → API Setup
2. Set Webhook callback URL to: `https://<your-public-host>/webhook`
3. Set Verify Token to the value of `WHATSAPP_VERIFY_TOKEN`
4. Subscribe to these webhook fields: `messages`
5. Add your recipient phone number to the app for testing (or enable production)

## Test Flow
- Send `help` to your WhatsApp number to see options
- Supported commands:
  - `hygiene`
  - `symptoms <disease>` (e.g., `symptoms dengue`)
  - `vaccines`
  - `set location <area>` (e.g., `set location Pune`)
  - `subscribe` / `unsubscribe`
  - `add child <Name> <YYYY-MM-DD>` (e.g., `add child Riya 2024-01-15`)

Language auto-detection supports English, Hindi, Bengali, Telugu, and Marathi.

## Notes
- This implementation uses in-memory storage for demo purposes; use a persistent database for production.
- Outbreak data is a placeholder; integrate an official government API in `fetchOutbreakData()` with proper auth and error handling.
- The bot does not diagnose, prescribe, or provide emergency medical advice.
