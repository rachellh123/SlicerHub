# Workflows (design)

**Status:** first pass built (SlicerWeb, extensions only).
**Related:** [slicer-gui-addons.md](./slicer-gui-addons.md) (Full Slicer extensions), [keycloak-case-groups.md](./keycloak-case-groups.md) (case roles).

A **workflow** is a named, pre-defined viewer setup that people can create, share and launch.
Today every SlicerWeb launch hardcodes `extensions=SlicerHeart`. Workflows replace that hardcoded value.

## Scope

| | First pass | Later |
|---|---|---|
| Viewer | SlicerWeb | Full Slicer (needs per-seat module loading and seat reuse keyed on workflow; see the end of this doc) |
| Contents | Extensions | Layout, favourite modules, sample data or template scene |
| Discovery | An "All workflows" tab on the Workflows page; case admins pick from a list | Search across all public workflows, authors, ratings |

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
| `file_types` | json (string[]) | data file extensions it is for, stored lowercase without the dot (`mrb`, `nii.gz`); empty means any. Not used yet: it is for choosing which workflows to offer for a file once workflows come back to cases. |
| `icon_key` | text | storage key of an uploaded icon (`workflowIcons/<id>.<ext>`), or empty |

**`case-workflows`** (one row per approval)

| Field | Type | Notes |
|---|---|---|
| `case` | relationship → cases, indexed | |
| `workflow` | text | source workflow ID; may later point to a deleted workflow |
| `name` | text | copied at approval |
| `extensions` | json (string[]) | copied at approval |
| `approved_by` | text | Keycloak sub |
| `approved_at` | date | when it was approved |
| `source_updated_at` | date | the source's `updatedAt` when approved; a later `updatedAt` shows "Update available". Comparing two database timestamps avoids clock skew between the app and the database. |

A default workflow per case can be added later as an `is_default` field; it isn't needed for the first pass.

## API

Workflows are in `backend/src/routes/workflows.js`; workflows on a case (`/api/cases/:id/workflows`) are in `backend/src/routes/caseWorkflows.js`, next to the other case routes. What both use (collection names, list queries, the workflow's API shape) is in `backend/src/services/workflows.js`.

| Route | Who |
|---|---|
| `GET /api/workflows` | The signed-in user's own workflows; `?scope=public` lists everyone's public ones |
| `GET /api/workflows/:id` | The owner, or anyone if the workflow is public |
| `POST /api/workflows`, `PATCH /api/workflows/:id`, `DELETE /api/workflows/:id` | The owner |
| `GET /api/cases/:id/workflows` | Case members (read_only and up). Returns `{ approved, mine, canManage }`, plus `available` for admins (their own and public workflows not yet approved), so the case page needs one request. |
| `POST /api/cases/:id/workflows` with `{ workflowId }` | Case admin. The source must be public or owned by the admin. Approving the same workflow again refreshes the copy. |
| `DELETE /api/cases/:id/workflows/:approvalId` | Case admin |

Icons: `PUT` / `DELETE /api/workflows/:id/icon` (owner; multipart field `icon`) and `GET` (anyone who can see the workflow). Uploads are checked by their contents (PNG, JPEG, GIF or WebP, up to 256 KB; never SVG, since other people see public workflows), and responses carry a versioned `iconUrl`. Responses never include `owner_id`. Input validation: `extensions` is an array of at most 50 strings matching `/^[\w.-]{1,100}$/`, with duplicates removed.

## Launch

`<case-workflows>` (`dev/components/case-workflows.js`) sits above the case's files. It offers "Default (SlicerHeart)", the case's approved workflows and the user's own workflows; with no choices it shows nothing. The choice is remembered per case under the `slicerweb.hub.caseWorkflows` storage key, so sign-out clears it along with SlicerWeb's own state. Both SlicerWeb launch points in `cases-page.js` build their URL through `_slicerWebUrl()`, which passes the chosen `extensions` to `buildSlicerWebUrl`. Case admins also get a "Manage approved workflows" section there: approve from a list, update a workflow whose source has changed, remove.

The **Workflows** page in the sidebar (`dev/pages/workflows-page.js`) is laid out like My Cases. It has two tabs of cards with search and sort: "My workflows", split into "Just me" and "Public" sections, and "All workflows" (everyone's public ones). It also has a detail view that lists the extensions with their descriptions, and a form to create or edit, with the checklist in `dev/components/extension-picker.js`. From someone else's public workflow you can make a private copy. Approving a workflow for a case happens on the case page only; how workflows get into cases needs its own design pass (see the "Open" section below). Extensions show their icons. Most icons live on GitHub, and a browser loading them there would reveal who is browsing, so the backend serves its own copies at `GET /api/slicerweb/extension-icon/:channel/:name` (`backend/src/services/extensionIcons.js`). It fetches only the exact `https` URL the build's `index.json` lists, accepts only PNG, JPEG, GIF or WebP up to 512 KB (no SVG, which can carry script), caches copies on disk (`SLICERWEB_ICON_CACHE_DIR`, default the system temp folder), and waits an hour before retrying a failed fetch. Icons shipped inside the build are served from it directly. With no icon, the tile shows the name's first letter. Public workflows don't show their author.

## Code style for this feature: concise and reusable

Patterns that this feature repeats go into shared utils. Existing callers move over when they're next touched; there's no separate refactor pass.

**Backend**

- `loadCaseWithAccess(caseId, req, minRole)` in `utils/caseAccess.js`. It replaces the `findByID('cases') → NotFoundError → assertCaseAccess` block that `routes/` repeats 18 times, and returns `{ caseDoc, role }`.
- `loadOwnedDoc(collection, id, req)` in `utils/ownedDocs.js` (new). It finds a document by ID, throws `NotFoundError` if missing, and throws `ForbiddenError` unless `owner_id` matches the requester. Workflows use it now, and anything else with an `owner_id` can use it later.
- `canView(doc, req)` (`owner || visibility === 'public'`) lives with `loadOwnedDoc`. It will be reused for the gallery.
- `requireOwnerId(req)` and `isOwner(doc, req)` live with `loadOwnedDoc`. It takes `{ write: false }` for read access; someone else's private document returns 404, not 403.
- `sanitizeNameList`, `sanitizeText` and `sanitizeChoice` in `utils/validation.js`.
- `ALL_COLLECTIONS` in `payload/collections.js` is the one collection list both Payload configs use.

**Frontend**

- `apiRequest(path, { method, body })` in `services/apiResponse.js`. It wraps `fetch(API_URL + path, { credentials: 'include', cache: 'no-store', JSON headers })` plus `parseApiResponse`, which `services/cases.js` currently repeats for each endpoint. `services/workflows.js` is then one line per endpoint.
- `loadExtensionCatalog(channel)` in `services/workflows.js`. It fetches and caches `index.json` for the editor.
- `styles/listPage.js` holds the My Cases look: page header, card grid, detail toolbar and header, the panel of rows (case attachments, workflow extensions), form panel, and their dark-mode rules. Rows are `file-list-row`; its `plain` option shows a name with nothing to open. The cases page and the workflows page both use it.
- `utils/listSort.js` (`LIST_SORT_OPTIONS`, `filterByText`, `sortRows`) does the search and sort for cases, attachments and workflows.
- Instead of `canManageWorkflows(role)`, the server returns `canManage`.

**Tests:** `tests/unit/backend/workflowsRoute.test.mjs` and `tests/unit/frontend/workflowsService.test.mjs`. `tests/unit/backend/helpers/routeHarness.mjs` (`makeApp`, `dispatch`, `fakePayload`) replaces the copies of these helpers in older route tests when those tests are next touched.

## Open

- **Getting workflows into cases.** Each workflow already records the file types it is for (`file_types`), so a case could offer only the workflows that match the file being opened. The case page's picker and approval list is a first cut. An earlier "Use in a case" section on the Workflows page was taken out; the flow between the Workflows page and cases still needs dedicated design.

## To think about later

**Abuse once there's a public gallery.** Nothing limits how many workflows one person can create or make public, and `GET /api/workflows?scope=public` returns the first 200 by name. One account could crowd the list, or publish misleading names and descriptions. None of this is a vulnerability today (public workflows can only name extensions we ship, and every field is shown as plain text), but the gallery needs some of these before it ships:

- a per-person limit on workflows, or on public ones, and rate limits on create and publish;
- paging and search on the server instead of a fixed 200;
- a way to report a workflow, and to hide or unpublish it (for example from the Payload admin);
- showing who published a workflow, which needs the same opt-in as names elsewhere (`share_name_in_groups`); today public workflows show no author, by design;
- a sort that isn't just alphabetical (recent, or most used), so the first page can't be claimed by naming.

**Extension icon fetcher: DNS rebinding.** `services/extensionIcons.js` checks that every hop is https to a public address before requesting it. The address is looked up for the check and then again by `fetch`, so a host that changes its DNS answer between the two could still reach an internal address. Exploiting this needs control of a listed icon URL, and the response is discarded unless it's an image. Closing the gap fully means connecting to the checked address itself (a custom `undici` dispatcher with a pinned `lookup`), which isn't worth it for 16 icons from a build we control. Revisit if icons ever come from user input.

**Profile pictures uploaded before content checks.** Avatars are now checked by their contents on upload (`routes/auth.js`), as workflow icons are. Pictures uploaded earlier were stored under whatever extension their file name had. They're served with `nosniff`, so a disguised file can't run, but a one-off scan of `avatars/` with `sniffImageType` would find any that aren't really images.

## Later: Full Slicer

Full Slicer seats mount one shared add-ons snapshot (`data/slicer-addons`). The plan is to keep that single snapshot, containing every catalog extension, and have the workflow choose which modules load (via an environment variable read by `slicer_session.py`, or `--modules-to-ignore`). The workflow ID and version must then be part of the seat reuse check (where `priorUseSimplifiedViewer` is checked in `slicerGui/sessionManager.js`). Simplified Viewer would become a built-in workflow, and `use_simplified_viewer` would go into `RETIRED_SCHEMA`.
