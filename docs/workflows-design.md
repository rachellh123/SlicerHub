# Workflows (design)

**Status:** design, first pass not yet built.
**Related:** [slicer-gui-addons.md](./slicer-gui-addons.md) (Full Slicer extensions), [keycloak-case-groups.md](./keycloak-case-groups.md) (case roles).

A **workflow** is a named, pre-defined viewer setup that people can create, share and launch.
Today every SlicerWeb launch hardcodes `extensions=SlicerHeart`. Workflows replace that hardcoded value.

## Scope

| | First pass | Later |
|---|---|---|
| Viewer | SlicerWeb | Full Slicer (needs per-seat module loading and seat reuse keyed on workflow; see the end of this doc) |
| Contents | Extensions | Layout, favourite modules, sample data or template scene |
| Discovery | Public workflows imported by link or ID | Gallery of public workflows |

## Decisions

- **Anyone can create a workflow.** Its visibility is `private` (just me) or `public`.
- **Only a case admin can approve a workflow for their case.** They can approve their own workflows or any public one.
- **Launching in a case:** a member can pick one of their own workflows (private or public) or any workflow the case admin approved.
- **With no workflow chosen, launch behaves as it does today** (SlicerHeart). This is the built-in default, not a database row.
- **Approval takes a copy.** The case keeps a copy of the extension list as it was when approved. If the owner later edits, unpublishes or deletes the workflow, the case keeps working with the approved copy. The case page shows "Update available" when the source was edited after the approval; the admin re-approves to take the change.
- **Workflows are data, not code.** SlicerWeb only loads extensions listed in the deployed `extensions/index.json` and ignores unknown names. A workflow can therefore only name extensions we already ship, so it can't add new code to SlicerWeb.

## SlicerWeb launch parameters

SlicerWeb (the build in `data/slicerweb-*`) already reads these query parameters, so no SlicerWeb change is needed:

| Parameter | Used in pass |
|---|---|
| `extensions` | 1 |
| `layout` | later |
| `favoriteModules` | later |
| `sample` | later |

The extension catalog is the static file `/slicerweb/{channel}/extensions/index.json` (name, description, icon, category). The editor reads it directly; no backend route is needed.

**Limitation:** extensions a user installs by hand in SlicerWeb's Extensions Manager are saved in the browser's `localStorage` under `slicerweb.extensions`, as a list of wheel URLs. That storage belongs to the browser profile and site origin, not to a SlicerHub account or a session:

- It stays until browser storage is cleared. Signing out of SlicerHub doesn't clear it, and the stable and latest channels share it.
- Anyone who later uses the same browser profile (for example on a shared workstation) gets those extensions, whoever they sign in as.
- It still loads alongside a workflow, so a workflow sets the minimum set of extensions, not the exact set.

**Security note:** the Extensions Manager can install a wheel from **any URL**, and `slicerweb.extensionIndex` can point at a different extension index. Workflows can't do this, but users can, by hand. The wheel's code runs on the SlicerHub origin. Because SlicerHub authenticates with cookies, that code's requests to `/api` carry the signed-in user's session. On a shared browser, a wheel one person installs therefore runs as whoever signs in next. Mitigations, cheapest first:

1. **Done.** `dev/utils/slicerWebStorage.js` clears `slicerweb.*` keys and SlicerWeb's autosave databases (IndexedDB names under `/home/pyodide/`, which hold scene data) on sign-out, and when a different user signs in on the same browser.
2. Have workflow launches ignore extensions installed by hand (needs a SlicerWeb option), or ask SlicerWeb upstream for a build flag that turns off install-from-URL and custom indexes.
3. Add a `connect-src` CSP on `/slicerweb/` limiting where wheels can be fetched from.

## Data model (Payload)

Both are new collections. Dev push creates them; nothing goes in `RETIRED_SCHEMA`.

**`workflows`**

| Field | Type | Notes |
|---|---|---|
| `name` | text, required | |
| `description` | textarea | |
| `owner_id` | text, indexed | Keycloak sub |
| `visibility` | select `private` / `public` | default `private` |
| `target` | select `slicerweb` | the only value for now; the field exists so Full Slicer can be added later without a schema change |
| `extensions` | json (string[]) | |

**`case-workflows`** (one row per approval)

| Field | Type | Notes |
|---|---|---|
| `case` | relationship → cases, indexed | |
| `workflow` | text | source workflow ID; may later point to a deleted workflow |
| `name` | text | copied at approval |
| `extensions` | json (string[]) | copied at approval |
| `approved_by` | text | Keycloak sub |
| `approved_at` | date | compared with the source's `updatedAt` to show "Update available" |

A default workflow per case can be added later as an `is_default` field; it isn't needed for the first pass.

## API

| Route | Who |
|---|---|
| `GET /api/workflows?mine=1` | The signed-in user's own workflows |
| `GET /api/workflows/:id` | The owner, or anyone if the workflow is public |
| `POST /api/workflows`, `PATCH /api/workflows/:id`, `DELETE /api/workflows/:id` | The owner |
| `GET /api/cases/:id/workflows` | Case members (read_only and up) |
| `POST /api/cases/:id/workflows` with `{ workflowId }` | Case admin. The source must be public or owned by the admin. Approving the same workflow again refreshes the copy. |
| `DELETE /api/cases/:id/workflows/:approvalId` | Case admin |

Input validation: `extensions` is an array of at most 50 strings matching `/^[\w.-]{1,100}$/`, with duplicates removed.

## Launch

The SlicerWeb launch points in `cases-page.js` (two calls to `buildSlicerWebUrl`) show a workflow picker. It offers the case's approved workflows plus the user's own workflows, under a "Default (SlicerHeart)" option. The chosen workflow's `extensions` go to `buildSlicerWebUrl({ extensions })`, which already supports this. If the user only has the default, nothing changes and no picker is shown.

## Code style for this feature: concise and reusable

Patterns that this feature repeats go into shared utils. Existing callers move over when they're next touched; there's no separate refactor pass.

**Backend**

- `loadCaseWithAccess(caseId, req, minRole)` in `utils/caseAccess.js`. It replaces the `findByID('cases') → NotFoundError → assertCaseAccess` block that `routes/` repeats 18 times, and returns `{ caseDoc, role }`.
- `loadOwnedDoc(collection, id, req)` in `utils/ownedDocs.js` (new). It finds a document by ID, throws `NotFoundError` if missing, and throws `ForbiddenError` unless `owner_id` matches the requester. Workflows use it now, and anything else with an `owner_id` can use it later.
- `canView(doc, req)` (`owner || visibility === 'public'`) lives with `loadOwnedDoc`. It will be reused for the gallery.
- `sanitizeNameList(value, { max, pattern })` in `utils/`. It does the string-array validation above, and layout and favourite modules can reuse it.

**Frontend**

- `apiRequest(path, { method, body })` in `services/apiResponse.js`. It wraps `fetch(API_URL + path, { credentials: 'include', cache: 'no-store', JSON headers })` plus `parseApiResponse`, which `services/cases.js` currently repeats for each endpoint. `services/workflows.js` is then one line per endpoint.
- `loadExtensionCatalog(channel)` in `utils/viewerLaunch.js`. It fetches and caches `index.json` for the picker.
- `canManageWorkflows(role)` in `utils/casePermissions.js`, next to `canManageCollaborators`.

**Tests:** route and permission tests for both route files, using the existing `mock.module` pattern; unit tests for the new utils.

## Later: Full Slicer

Full Slicer seats mount one shared add-ons snapshot (`data/slicer-addons`). The plan is to keep that single snapshot, containing every catalog extension, and have the workflow choose which modules load (via an environment variable read by `slicer_session.py`, or `--modules-to-ignore`). The workflow ID and version must then be part of the seat reuse check (where `priorUseSimplifiedViewer` is checked in `slicerGui/sessionManager.js`). Simplified Viewer would become a built-in workflow, and `use_simplified_viewer` would go into `RETIRED_SCHEMA`.
