# Scanner Stage 1 — URL Intake & GitHub Handshake

## Top-Level Overview

**Goal:** Build the first working slice of the repository scanner: accept a GitHub repository
URL from the frontend, validate and parse it, verify that the repository exists and is public
via the GitHub REST API, and return a minimal structured response so the rest of the pipeline
has a confirmed, well-shaped starting point.

**Scope:** URL validation, owner/repo extraction, GitHub repo-existence check, request/response
contract, error reporting, route wiring in `index.js`, and unit + integration tests.

**Out of scope:** repository tree traversal, file content fetching, health scoring, diagnosis,
prescription, treatment, verification.

**Key constraint:** No new npm packages may be installed without team approval. Node's built-in
`fetch` (available in Node 18+) is used for GitHub API calls. No third-party HTTP client is
needed for this stage.

---

## Sub-Tasks

---

### Sub-Task 1 — URL Validator module

**Status:** [ ] pending

**Intent**

Centralise all URL-parsing and validation rules in one pure function so they can be tested
independently of Express and the GitHub API. The validator is the first gate: no network call
is made if the URL cannot be parsed into a valid GitHub owner/repo pair.

**Acceptance rules (from PRD §17.1)**

- Input must be a non-empty string.
- Must match the pattern `https://github.com/{owner}/{repo}` (with or without a trailing slash,
  with or without a `.git` suffix).
- `owner` and `repo` must each be non-empty and contain only characters GitHub allows
  (alphanumeric, hyphens, underscores, dots; no consecutive dots; no leading/trailing hyphens).
- The URL must use `https://` — plain `http://` and SSH forms are rejected.
- Query strings, fragments, and sub-paths deeper than `/{owner}/{repo}` are rejected.

**Output**

Returns one of two shapes:

```
// Success
{ valid: true, owner: string, repo: string }

// Failure
{ valid: false, reason: string }
```

`reason` must be a short, human-readable string safe to return to the frontend.

**Expected Outcomes**

- `backend/services/parseRepoUrl.js` exists and exports a single `parseRepoUrl(url)` function.
- All validation rules listed above are encoded as logic in this file.
- No Express, Mongoose, or network dependencies in this file.

**Todo List**

1. Create `backend/services/` directory.
2. Create `backend/services/parseRepoUrl.js` exporting `parseRepoUrl(url)`.
3. Implement the regex or URL-API-based parse: extract `owner` and `repo` segments.
4. Apply character-level validation rules to each segment.
5. Return the two-shape object described above.

**Relevant Context**

- No existing `backend/services/` directory — must be created.
- `backend/index.js` uses CommonJS (`require`), so this file must also use `module.exports`.
- GitHub's own naming rules: owner/repo names are 1–100 chars, alphanumeric + hyphens only
  (owner may also contain dots in org names). Conservative: reject anything that would produce
  a 404 from the GitHub API anyway.

---

### Sub-Task 2 — GitHub repository-existence check

**Status:** [ ] pending

**Intent**

Make exactly one GitHub REST API call to confirm that the parsed owner/repo refers to a real,
publicly accessible repository. This is the minimum GitHub API interaction required before
tree traversal can begin. It also retrieves a small set of repository metadata that the
next scanner stage will need.

**GitHub API endpoint used**

```
GET https://api.github.com/repos/{owner}/{repo}
```

Headers required:
- `Accept: application/vnd.github+json`
- `Authorization: Bearer {GITHUB_TOKEN}` — only if `process.env.GITHUB_TOKEN` is set;
  omit entirely (not send an empty header) if the token is absent.
- `X-GitHub-Api-Version: 2022-11-28`

**Output shape (minimum fields to capture for next stage)**

```json
{
  "owner":          "string  — login of the repository owner",
  "repo":           "string  — repository name",
  "defaultBranch":  "string  — e.g. main or master",
  "description":    "string | null",
  "language":       "string | null — GitHub-detected primary language",
  "stars":          "number",
  "isPrivate":      false
}
```

All other fields from the GitHub response are discarded at this stage.

**Expected Outcomes**

- `backend/services/githubClient.js` exists and exports `getRepoInfo(owner, repo)`.
- `getRepoInfo` returns the minimal shape above on success.
- `getRepoInfo` throws a typed error on failure (see Sub-Task 4 for error types).
- Token is read from `process.env.GITHUB_TOKEN`; its absence does not crash the service,
  it just omits the Authorization header.

**Todo List**

1. Create `backend/services/githubClient.js`.
2. Implement `getRepoInfo(owner, repo)` using Node's native `fetch`.
3. Build the request headers object, conditionally including the Authorization header.
4. Call the GitHub API and parse the JSON response.
5. On HTTP 200 extract and return the minimum field set listed above.
6. On non-200 responses throw a typed error (defined in Sub-Task 4).

**Relevant Context**

- `backend/package.json` has no HTTP client library — use native `fetch`.
- `GITHUB_TOKEN` is documented in `backend/.env.example` as optional.
- Node 18+ is required for native `fetch`; confirm the team's Node version before merging.
- The GitHub `GET /repos/{owner}/{repo}` endpoint returns HTTP 404 for missing or private
  repos (GitHub intentionally conflates the two for unauthenticated requests).

---

### Sub-Task 3 — Scan route and controller

**Status:** [ ] pending

**Intent**

Wire the validator and GitHub client into an Express route so the frontend's existing
`apiClient.scan(repoUrl)` call produces a well-defined JSON response. This is the only
new Express route in this stage.

**Request contract**

```
POST /api/scan
Content-Type: application/json

{ "repoUrl": "https://github.com/owner/repo" }
```

**Response contract — success (HTTP 200)**

```json
{
  "scanId":        "MongoDB ObjectId string — ID of the saved ScanResult document",
  "owner":         "string",
  "repo":          "string",
  "defaultBranch": "string",
  "description":   "string | null",
  "language":      "string | null",
  "stars":         0,
  "repoUrl":       "https://github.com/owner/repo"
}
```

Note: at this stage `ScanResult` is saved with empty signal fields and a zeroed
health score. The score will be populated by the tree-analysis stage. The document
is saved now so the frontend immediately has a `scanId` to reference in subsequent calls.

**Why save an empty ScanResult now?**

The `ScanResult` schema already exists (`backend/models/ScanResult.js`). Saving it
at intake time gives the frontend a stable document ID from the first response.
Subsequent scanner stages update the same document rather than creating a new one.
This avoids a "create on completion" design where a failure mid-scan produces no record.

**Empty ScanResult fields at save time**

```
structure:         {}
testingSignals:    {}
docSignals:        {}
qualitySignals:    {}
dependencySignals: {}
healthScore: { testing: 0, documentation: 0, structure: 0, codeQuality: 0, dependencies: 0, overall: 0 }
```

**Expected Outcomes**

- `backend/routes/scan.js` exists and exports an Express Router.
- `POST /api/scan` is reachable after the route is mounted in `index.js`.
- The route calls `parseRepoUrl`, then `getRepoInfo`, then saves a `ScanResult`.
- The route returns the success shape above or one of the error shapes (Sub-Task 4).
- The commented-out mount line in `index.js` (`// app.use('/api/scan', ...)`) is uncommented.

**Todo List**

1. Create `backend/routes/` directory.
2. Create `backend/routes/scan.js` with an Express Router.
3. Implement the `POST /` handler: call `parseRepoUrl` → call `getRepoInfo` → save `ScanResult` → respond.
4. Uncomment `app.use('/api/scan', require('./routes/scan'))` in `backend/index.js`.
5. Keep the handler thin: parsing and GitHub logic stay in the service files, not in the route.

**Relevant Context**

- `backend/index.js` line 21 already has the commented mount stub ready to uncomment.
- `ScanResult` Mongoose model is at `backend/models/ScanResult.js`; `healthScore` sub-fields
  are all `required: true` so must be provided (zeroed) even at this early save.
- `backend/index.js` uses CommonJS — route file must also use `module.exports`.

---

### Sub-Task 4 — Error response contract

**Status:** [ ] pending

**Intent**

Define a single consistent error shape and a small set of named error codes so the frontend
can display specific, actionable messages rather than generic HTTP status text. All error
paths in Sub-Tasks 1–3 must use this contract.

**Error response shape (all errors)**

```json
{
  "error": {
    "code":    "MACHINE_READABLE_CODE",
    "message": "Human-readable explanation safe to show in the UI"
  }
}
```

**Error codes for this stage**

| Code | HTTP status | When |
|---|---|---|
| `MISSING_URL` | 400 | `repoUrl` field absent or empty in request body |
| `INVALID_URL` | 400 | URL does not match the `https://github.com/{owner}/{repo}` pattern |
| `REPO_NOT_FOUND` | 404 | GitHub returned 404 for the owner/repo pair |
| `REPO_PRIVATE` | 403 | Reserved — GitHub 404 conflates missing and private; use this if a token is present and GitHub returns 403 |
| `GITHUB_RATE_LIMITED` | 429 | GitHub returned 403 with a rate-limit header or 429 |
| `GITHUB_UNAVAILABLE` | 502 | GitHub returned 5xx or the fetch itself threw a network error |
| `INTERNAL_ERROR` | 500 | Any other unexpected error |

**Expected Outcomes**

- `backend/services/AppError.js` exists and exports an `AppError` class extending `Error`
  with `code`, `httpStatus`, and `message` properties.
- Every error path in `parseRepoUrl`, `githubClient`, and the scan route creates or re-throws
  an `AppError`.
- The scan route has a single catch block that converts any `AppError` into the JSON error
  shape and sends the correct HTTP status.
- Non-`AppError` exceptions are caught and re-wrapped as `INTERNAL_ERROR`.

**Todo List**

1. Create `backend/services/AppError.js` exporting the `AppError` class.
2. Update `parseRepoUrl.js` to throw `AppError` with `MISSING_URL` or `INVALID_URL` instead of
   returning a failure object (simplifies the route handler — no need to check `valid: false`).
3. Update `githubClient.js` to throw typed `AppError` values for each GitHub failure mode.
4. Add a catch block in the scan route that serialises `AppError` to the defined JSON shape.
5. Ensure non-`AppError` exceptions are wrapped in `INTERNAL_ERROR` before responding.

**Note on parseRepoUrl return shape**

After this sub-task, `parseRepoUrl` throws on failure rather than returning `{ valid: false }`.
The test suite (Sub-Task 5) must be updated to reflect this if Sub-Task 1 tests were written
first. Alternatively, implement Sub-Task 4 before Sub-Task 1 and write `parseRepoUrl` to throw
from the start.

**Relevant Context**

- No error-handling middleware exists in `backend/index.js` today. The catch block lives
  directly in the route handler for this stage — do not add global error middleware unless
  agreed by the team, as it affects all future routes.

---

### Sub-Task 5 — Tests

**Status:** [ ] pending

**Intent**

Provide automated test coverage for every logic branch introduced in this stage. Tests must
be runnable without a live MongoDB connection or a live GitHub API connection — both are
replaced by test doubles.

**Test framework decision**

No test runner is currently installed in the backend (`package.json` test script is a
placeholder). **Jest** is recommended: it is the most common choice for Node CommonJS projects,
requires no configuration file for basic use, and supports module mocking with `jest.mock`.
Install as a `devDependency` only.

**Test file locations**

```
backend/
  services/
    __tests__/
      parseRepoUrl.test.js
      githubClient.test.js
  routes/
    __tests__/
      scan.test.js
```

**parseRepoUrl.test.js — cases to cover**

| Input | Expected outcome |
|---|---|
| `""` (empty string) | throws `AppError` with code `MISSING_URL` |
| `null` / `undefined` | throws `AppError` with code `MISSING_URL` |
| `"not a url"` | throws `AppError` with code `INVALID_URL` |
| `"http://github.com/owner/repo"` | throws `INVALID_URL` (http not https) |
| `"https://github.com/owner/repo"` | returns `{ owner: "owner", repo: "repo" }` |
| `"https://github.com/owner/repo/"` | returns correct owner/repo (trailing slash) |
| `"https://github.com/owner/repo.git"` | returns correct owner/repo (.git stripped) |
| `"https://github.com/owner/repo/tree/main"` | throws `INVALID_URL` (sub-path) |
| `"https://gitlab.com/owner/repo"` | throws `INVALID_URL` (wrong host) |
| Owner with invalid chars | throws `INVALID_URL` |

**githubClient.test.js — cases to cover**

Mock `fetch` globally. Do not make real network calls.

| Scenario | Mock | Expected outcome |
|---|---|---|
| Repo exists, public | `fetch` returns 200 with minimal GitHub body | Returns correct mapped object |
| Repo not found | `fetch` returns 404 | Throws `AppError` with code `REPO_NOT_FOUND` |
| Rate limited | `fetch` returns 403 with `x-ratelimit-remaining: 0` | Throws `AppError` with code `GITHUB_RATE_LIMITED` |
| GitHub 500 | `fetch` returns 500 | Throws `AppError` with code `GITHUB_UNAVAILABLE` |
| Network error | `fetch` throws | Throws `AppError` with code `GITHUB_UNAVAILABLE` |
| Token absent | `GITHUB_TOKEN` env var not set | Authorization header absent from outgoing request |
| Token present | `GITHUB_TOKEN` env var set | Authorization header present |

**scan.test.js — cases to cover**

Use `supertest` to exercise the route. Mock `parseRepoUrl` and `getRepoInfo` and `ScanResult.save`.

| Scenario | Setup | Expected HTTP response |
|---|---|---|
| Valid URL, repo exists | Both services succeed; Mongoose save succeeds | 200 with `scanId`, `owner`, `repo`, `defaultBranch` |
| Missing `repoUrl` body field | — | 400 `MISSING_URL` error shape |
| Invalid URL | `parseRepoUrl` throws `MISSING_URL` or `INVALID_URL` | 400 with correct error code |
| Repo not found | `getRepoInfo` throws `REPO_NOT_FOUND` | 404 with correct error code |
| GitHub rate limited | `getRepoInfo` throws `GITHUB_RATE_LIMITED` | 429 with correct error code |
| GitHub unavailable | `getRepoInfo` throws `GITHUB_UNAVAILABLE` | 502 with correct error code |
| Unexpected error | `getRepoInfo` throws plain `Error` | 500 `INTERNAL_ERROR` |

**Expected Outcomes**

- `npm test` in `backend/` runs all three test files and produces a pass result.
- 0 real network calls are made during tests.
- 0 real MongoDB connections are made during tests.
- Coverage of all named error codes and the success path.

**Todo List**

1. Install `jest` and `supertest` as `devDependencies` in `backend/package.json`.
2. Update the `test` script in `backend/package.json` to `jest`.
3. Create `backend/services/__tests__/parseRepoUrl.test.js` with all cases above.
4. Create `backend/services/__tests__/githubClient.test.js` with all cases above.
5. Create `backend/routes/__tests__/scan.test.js` with all cases above.
6. Confirm `npm test` passes in `backend/`.

---

## Data Flow

```
Frontend
  apiClient.scan(repoUrl)
      │
      │ POST /api/scan  { repoUrl }
      ▼
backend/routes/scan.js
      │
      ├─ parseRepoUrl(repoUrl)
      │       ├── throws AppError MISSING_URL  ──► 400 error response
      │       └── returns { owner, repo }
      │
      ├─ getRepoInfo(owner, repo)
      │       ├── throws AppError REPO_NOT_FOUND     ──► 404 error response
      │       ├── throws AppError GITHUB_RATE_LIMITED ──► 429 error response
      │       ├── throws AppError GITHUB_UNAVAILABLE  ──► 502 error response
      │       └── returns { owner, repo, defaultBranch, description, language, stars, isPrivate }
      │
      ├─ new ScanResult({ repoUrl, structure:{}, ..., healthScore:{all zeros} }).save()
      │
      └─ 200 response { scanId, owner, repo, defaultBranch, description, language, stars, repoUrl }
```

---

## Files / Modules Involved

### New files to create

| File | Purpose |
|---|---|
| `backend/services/AppError.js` | Typed error class with `code`, `httpStatus`, `message` |
| `backend/services/parseRepoUrl.js` | Pure URL validation and owner/repo extraction |
| `backend/services/githubClient.js` | GitHub REST API wrapper — `getRepoInfo` only |
| `backend/routes/scan.js` | Express Router for `POST /api/scan` |
| `backend/services/__tests__/parseRepoUrl.test.js` | Unit tests for URL parser |
| `backend/services/__tests__/githubClient.test.js` | Unit tests for GitHub client |
| `backend/routes/__tests__/scan.test.js` | Integration tests for the scan route |

### Existing files to modify

| File | Change |
|---|---|
| `backend/index.js` | Uncomment line 21: `app.use('/api/scan', require('./routes/scan'))` |
| `backend/package.json` | Add `jest` + `supertest` to `devDependencies`; update `test` script |

### Existing files read but not modified

| File | Why it is relevant |
|---|---|
| `backend/models/ScanResult.js` | Route saves an empty `ScanResult`; schema must be satisfied |
| `backend/.env.example` | Documents `GITHUB_TOKEN`; client reads this env var |
| `frontend/src/api/client.js` | `apiClient.scan(repoUrl)` already calls `POST /api/scan` — no change needed |

---

## Error Cases

| Scenario | Code | HTTP |
|---|---|---|
| `repoUrl` absent or empty in body | `MISSING_URL` | 400 |
| URL is not a valid GitHub URL | `INVALID_URL` | 400 |
| GitHub returns 404 for owner/repo | `REPO_NOT_FOUND` | 404 |
| GitHub returns 403 with rate-limit headers | `GITHUB_RATE_LIMITED` | 429 |
| GitHub returns 5xx or network failure | `GITHUB_UNAVAILABLE` | 502 |
| Any other unhandled exception | `INTERNAL_ERROR` | 500 |

---

## Completion Criteria

This stage is complete when all of the following are true:

1. `POST /api/scan` with a valid public GitHub URL returns HTTP 200 with `scanId`, `owner`,
   `repo`, `defaultBranch`, and `repoUrl` in the response body.
2. `POST /api/scan` with a missing, malformed, or unsupported URL returns an appropriate
   4xx response with the defined error code/message JSON shape.
3. A corresponding `ScanResult` document exists in MongoDB after a successful call, with
   zeroed signal fields.
4. `npm test` in `backend/` passes with 0 failures and covers all named error codes.
5. No test makes a real HTTP call to GitHub.
6. No test requires a running MongoDB instance.
7. `frontend/src/api/client.js` requires no changes — the contract matches `apiClient.scan`.
