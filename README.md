# PeopleClock

A small, responsive HRMS assignment demo with separate employee and manager workspaces, real account registration, attendance records stored in MongoDB, browser-based live shift location sharing, and a Python RAG policy assistant.

> **Full-stack app:** `client/` is the React UI, `server/` is the Express/Node API, MongoDB stores accounts and attendance, and `python-rag/` is the FastAPI policy service. In production, one Docker-based Render web service runs the Node app and Python service together. `PeopleClock-preview.html` is only an offline visual preview of the UI.

Opening `PeopleClock-preview.html` directly uses a `file://` origin. Browsers isolate file pages and do not route `/api/...` requests to the Node server, so sign-in from that preview cannot work. The app now identifies this case in the UI. For working sign-in and live records, launch the services below and open the HTTP address `http://localhost:5173`.

## What works

- Employee and manager accounts have separate role-based interfaces after sign-in.
- Forgot password opens a form for the registered email, new password, and confirmation. The API checks the match, hashes the password with bcrypt, and saves the hash to MongoDB. This demo flow does not verify email ownership; use mock accounts only.
- Employees register with their name, email, title, department, and password; manager registration also requires a private registration code.
- Employees clock in and out. While clocked in, the signed-in employee page uses the browser's visible geolocation permission to send current coordinates and a compact shift trail. The employee must keep the page open and connected; browser tracking pauses when the page closes or the device is offline. The employee sees a live-sharing indicator, and sharing stops at clock-out or sign-out.
- Managers see active employees on an interactive OpenStreetMap map with a live marker and shift route. The dashboard refreshes every five seconds; the UI does not print raw coordinates. OpenStreetMap tiles are used without an API key for this low-volume demo, and their public tile service is best-effort rather than a production SLA.
- The employee attendance history is tied to the signed-in employee. Attendance and accounts are MongoDB records, not sample dashboard arrays.
- The Python FastAPI service retrieves relevant passages from the mock company policy Markdown files using TF-IDF, then sends those passages and the question to Gemini for a concise grounded answer. The Gemini API key is held only by the Python service.

Only company handbook content in `python-rag/company_docs/` is mock data. New employees and attendance events come from normal sign-up and clock actions.

## Run locally

Requirements: Node.js 20+ and Python 3.10+. Create a free MongoDB Atlas cluster (or use a local MongoDB server), create a database user, and allow your development IP in Atlas network access. For the Render demo, Render's outbound IPs can change; Atlas may need a `0.0.0.0/0` network rule for the hosted API to reach it. Use that only for a fake-data demo with a strong database password, never for real HR data.

1. Copy `.env.example` to `.env` and fill in `MONGODB_URI`, a long random `JWT_SECRET`, and a private `MANAGER_SIGNUP_CODE`. `MONGODB_DB_NAME` defaults to `peopleclock`, regardless of the database path in the URI. Copy `python-rag/.env.example` to `python-rag/.env` and set `GEMINI_API_KEY` from Google AI Studio. Keep both `.env` files private.
2. Install Node dependencies:

   ```bash
   npm install
   ```

3. Start the API, browser app, and Python service in three terminals:

   ```bash
   npm run dev:server
   ```

   ```bash
   npm run dev:client
   ```

   ```bash
   cd python-rag
   python -m venv .venv
   # Activate the environment, then install and run:
   pip install -r requirements.txt
   uvicorn main:app --reload --port 8000
   ```

4. Open `http://localhost:5173`. Register a manager using your configured manager code, then register one or more employees. Use the Manager/Employee selector on the registration and sign-in screens. Sign-in redirects each account to its own interface.

## Deploy free for a demo

The included `render.yaml` creates **one** free Render web service. Its Docker image runs the React app, Node/Express API, and Python/FastAPI RAG service together, so the browser and APIs share one public URL. In Render, create or sync the Blueprint from this repository and set these environment variables on the `peopleclock` service:

- `MONGODB_URI`: connection string for a free MongoDB Atlas cluster.
- `MONGODB_DB_NAME`: database to use; the Blueprint sets it to `peopleclock`.
- `MANAGER_SIGNUP_CODE`: a private code you choose and share only with the demo manager.
- `GEMINI_API_KEY`: a key from Google AI Studio. Do not add it to the React client or commit it to GitHub.

Render creates `JWT_SECRET`; `RAG_API_URL` points internally to the Python service in the same container. After deployment, register your manager and employee accounts through the app. HTTPS is provided by Render, which is needed for browser geolocation outside localhost. If Blueprint sync offers to remove the old `peopleclock-rag` service, that is the previous separate deployment; the new configuration no longer needs it.

Free Render services can sleep when idle, so the first request after a quiet period can take a while. Free hosting is suitable for showing the assignment, not for real HR records: use fake names and locations in the public demo. Hosting limits and free-plan eligibility are controlled by the hosting provider and can change.

## Configuration

| Variable | Service | Required | Purpose |
| --- | --- | --- | --- |
| `MONGODB_URI` | Render service | Yes | MongoDB connection URI |
| `JWT_SECRET` | Render service | Yes in deployment | Signs login tokens; generated by Render |
| `MANAGER_SIGNUP_CODE` | Render service | Yes | Prevents open manager self-registration |
| `CLIENT_ORIGIN` | Node API | No | Restricts browser origin when API is deployed separately |
| `RAG_API_URL` | Render service | Set by Blueprint | Internal URL for FastAPI (`http://127.0.0.1:8000`) |
| `GEMINI_API_KEY` | Render service | Yes | Secret API key used by FastAPI for Gemini requests |
| `GEMINI_MODEL` | Render service | No | Gemini model ID (default `gemini-3.1-flash-lite`) |

## Stack and request flow

```text
React + Vite browser → Express API → MongoDB
                            │
                            └────→ FastAPI RAG → TF-IDF handbook retrieval → Gemini API
                                  (same Render Docker service)
```

The browser sends a clock event to Express. Express validates the signed-in account, records server time and the optional coordinates, and returns the saved record. Manager-only API routes are role-checked on the server. The browser never connects directly to MongoDB or Ollama.
