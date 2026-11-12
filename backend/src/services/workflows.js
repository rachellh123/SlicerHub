/**
 * Workflows (docs/workflows-design.md): what the workflow routes and the case-workflow routes
 * share — collection names, the list queries, and the API shape of a workflow.
 */

import { getPayloadClient } from '../payload/index.js';
import { requireOwnerId, isOwner } from '../utils/ownedDocs.js';

export const WORKFLOWS = 'workflows';
export const CASE_WORKFLOWS = 'case-workflows';

/** At most 200 rows: plenty for now; the public gallery will need paging. */
export async function findAll(collection, where, sort) {
    const { docs } = await getPayloadClient().find({ collection, where, sort, depth: 0, limit: 200 });
    return docs;
}

export const myWorkflows = (req) => findAll(WORKFLOWS, { owner_id: { equals: requireOwnerId(req) } }, 'name');
export const publicWorkflows = () => findAll(WORKFLOWS, { visibility: { equals: 'public' } }, 'name');

/** A workflow as the API returns it (never its owner_id). */
export const toWorkflow = (doc, req) => ({
    id: doc.id,
    name: doc.name,
    description: doc.description || '',
    visibility: doc.visibility,
    extensions: doc.extensions || [],
    fileTypes: doc.file_types || [],
    isMine: isOwner(doc, req),
    // The key changes with each upload, so it versions the URL: a new icon is never hidden by a
    // cached old one, and editing anything else doesn't make browsers fetch the icon again.
    iconUrl: doc.icon_key ? `/api/workflows/${doc.id}/icon?v=${encodeURIComponent(doc.icon_key.split('/').pop())}` : null,
    updatedAt: doc.updatedAt,
});
