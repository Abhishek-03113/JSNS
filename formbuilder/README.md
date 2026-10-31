# MCQ Form Builder API

A Bun + TypeScript API behind Google sign-in. It takes the form payload the
[MCQ Form Builder artifact](https://claude.ai/artifact/C4FABJbasGdXieEFkRzgiz) builds
(`MCQ.buildPayload()`), runs Apps Script **as the signed-in Google user** to create the graded
Google Form in their Drive, and stores each script with its edit, student and response links in
Postgres (Supabase works). The web frontend is only the Google sign-in page and a dashboard of the
forms made.

Parsing question papers stays in the artifact. This service only validates the payload, executes
Apps Script, and keeps the record.

```
artifact ──POST /api/forms (Bearer token)──▶ API ──scripts.run (user's OAuth token)──▶ executor Apps Script ──▶ Google Form
                                              │
                                              └──▶ Postgres: forms(script, payload, edit/published/responses URLs, counts)
```

## How Apps Script is executed

`apps-script/` is a small **executor** project (`createMcqQuiz(payload)`, `getFormStats(formIds)`,
`ping()`), deployed once as an *API Executable* with access "Anyone". The API calls it through the
Apps Script API (`scripts.run`) with the user's own OAuth token, so each form is created and owned by
that user. The full standalone script (same text the artifact shows) is stored per form, and
`POST /api/forms/:id/script-project` can save it as an Apps Script project in the user's Drive.

Scopes requested at sign-in: `openid email profile`, `forms`, `script.projects`,
`script.deployments`. Sign-in is refused if the Forms scope is not granted.

## Setup

### 1. Google Cloud

1. Create (or pick) a Cloud project. Enable the **Apps Script API**.
2. OAuth consent screen: External, add the scopes above, and add yourself (and teachers) as
   **test users** while the app is unverified.
3. Credentials → OAuth client ID → *Web application*. Authorised redirect URI:
   `<BASE_URL>/auth/google/callback`.
4. Note the project **number** (Project settings), you need it in step 4.
5. Every user who signs in must have the Apps Script API turned on for their own account at
   <https://script.google.com/home/usersettings>. The API returns a clear error if it is off.

### 2. Database (Supabase or any Postgres)

Supabase → Project Settings → Database → Connection string (URI). The transaction pooler on port
6543 works because the client runs without prepared statements. Add `?sslmode=require`.
Migrations in `migrations/` run automatically at start-up. Every table has row level security
switched on with no policies, so Supabase's anon/authenticated API roles can't read them; the
server connects as the database owner.

### 3. Run

```bash
cp .env.example .env    # fill in the values
bun install
bun run start           # or: bun run dev
```

Open `BASE_URL`, sign in with Google.

### 4. Deploy the executor (once)

```bash
bun run setup:executor --email you@gmail.com
```

This pushes `apps-script/` to a new Apps Script project in your Drive and creates an API
Executable deployment. Then:

1. Open the printed editor link → Project Settings → *Change project* → enter the Cloud project
   number from step 1. (`scripts.run` only works when the script and the OAuth client share a
   Cloud project; Google has no API for this step.)
2. Put the printed deployment ID in `APPS_SCRIPT_EXECUTOR_ID` and restart.
3. While signed in, open `/api/executor/ping`. It should return your email.

## Claude connector (MCP)

The app is also a remote MCP server at `<BASE_URL>/mcp`, so it can be added to claude.ai as a custom
connector and called from the MCQ Form Builder artifact. claude.ai connects with OAuth, which
this app provides itself:

- discovery: `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`
- dynamic client registration: `POST /oauth/register`
- `GET /oauth/authorize`: Google sign-in if needed, then a consent page (PKCE S256 required)
- `POST /oauth/token`: authorization code and refresh token grants (refresh tokens rotate),
  1-hour access tokens
- `POST /oauth/revoke`

Tools: `get_account` (who is signed in, whether forms can be made), `create_google_form`
(`{ payload }`, returns the edit and student links), `list_google_forms`. Connector tokens only
work on `/mcp`; the dashboard lists connected apps and can disconnect them.

To connect: Claude → Settings → Connectors → Add custom connector, name it **MCQ Form Builder**
(the artifact calls the connector by this name) and use the URL `<BASE_URL>/mcp`.

Why a Google OAuth client is still needed: claude.ai signs in to *this app*, and this app signs in to
*Google*, because the Apps Script runs as the teacher. Google only issues tokens to an OAuth client
registered in a Google Cloud project, and `scripts.run` additionally requires the executor script and
that OAuth client to share the same Cloud project. So `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are a
one-time setup by whoever hosts the app; teachers never see them.

## API

Browser calls use the session cookie. Everything else uses an API token made on the dashboard:
`Authorization: Bearer fbk_...`. Cross-origin callers must be listed in `CORS_ORIGINS` and use a
token; cookies are never accepted cross-origin.

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/me` | Signed-in user, granted/missing Google scopes, executor status |
| `POST` | `/api/forms` | `{ payload, script?, source?, dryRun? }` → runs `createMcqQuiz`, returns the stored form (`201`) |
| `GET` | `/api/forms?status=&limit=&offset=` | Forms made by this user, newest first |
| `GET` | `/api/forms/:id` | One form, including its payload and script |
| `GET` | `/api/forms/:id/script` | The standalone Apps Script as text |
| `POST` | `/api/forms/:id/retry` | Re-run a failed form (`409` if it was already made) |
| `POST` | `/api/forms/:id/script-project` | Save the script as an Apps Script project in the user's Drive |
| `POST` | `/api/forms/stats` | Refresh response counts via `getFormStats` |
| `DELETE` | `/api/forms/:id` | Remove the record (the Google Form stays) |
| `GET` | `/api/executor/ping` | Runs `ping()` in the executor as you |
| `GET/POST/DELETE` | `/api/tokens[/:id]` | API tokens (browser session only) |

`payload` is exactly `MCQ.buildPayload(model, settings)` from the artifact:

```json
{
  "title": "Std 6 Tense Quiz", "description": "", "points": 1,
  "student": true, "pages": false, "shuffle": false, "confirm": "Your answers have been submitted.",
  "nameLabel": "Student Name", "rollLabel": "Roll No.", "wordLabel": "Underlined word: ",
  "items": [
    { "section": "Section A", "help": "Choose the correct option." },
    { "q": "Which sentence is in the simple present tense?", "options": ["A) She is playing.", "B) They walk to school."], "answer": 1 }
  ]
}
```

`answer` is the 0-based correct option, `-1` for none (the form still gets made; the response
carries a warning). Invalid payloads get `422` with every problem in `error.details.errors`.
Each made form carries the two links the script returns: `editUrl` (the teacher's editor) and
`publishedUrl` (the student form). The executor also asks Google for a `forms.gle` short link
(`shortUrl`); `studentUrl` is that short link when there is one, otherwise `publishedUrl`. The
dashboard shows both links as clickable URLs with Copy and Open in new tab.

Errors always look like `{ "error": { "code", "message", "details"? } }`. A failed Apps Script run
is stored with `status: "failed"` and returned in `error.details.form`.

## Tests

```bash
bun test          # needs Postgres: TEST_DATABASE_URL (default postgres://postgres:postgres@localhost:5432/formbuilder_test)
bun run typecheck
```

The tests run the real OAuth redirect chain, token refresh, Apps Script calls, CSRF and CORS
against a fake Google (`test/mockGoogle.ts`), and check that the API's stored script is byte-for-byte
what the artifact's own `MCQ.buildScript()` produces (`test/fixtures/` holds the artifact's MCQ core).

`bun run dev:mock` runs the whole app against the fake Google, so you can click through sign-in and
the dashboard without any Google setup. The test database is wiped on every test run, so don't point
`TEST_DATABASE_URL` at real data.
