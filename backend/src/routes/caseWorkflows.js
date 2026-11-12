/**
 * Workflows on a case (docs/workflows-design.md): which ones members can launch, and case
 * admins approving and removing them. An approval keeps a copy of the workflow as approved.
 *
 *   GET    /api/cases/:id/workflows               members: approved + their own (admins: + available)
 *   POST   /api/cases/:id/workflows               admins: approve, or re-approve to refresh the copy
 *   DELETE /api/cases/:id/workflows/:approvalId   admins
 */

import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getPayloadClient, requirePayload } from '../payload/index.js';
import { NotFoundError } from '../utils/errors.js';
import { loadCaseWithAccess } from '../utils/caseAccess.js';
import { requireOwnerId, canView, loadOwnedDoc } from '../utils/ownedDocs.js';
import { isDocId } from '../utils/validation.js';
import {
    WORKFLOWS, CASE_WORKFLOWS, findAll, myWorkflows, publicWorkflows, toWorkflow,
} from '../services/workflows.js';

const toApproval = (row, source) => ({
    id: row.id,
    workflowId: row.workflow,
    name: row.name,
    extensions: row.extensions || [],
    approvedAt: row.approved_at,
    updateAvailable: Boolean(source) && Date.parse(source.updatedAt) > Date.parse(row.source_updated_at),
});

export default function caseWorkflowRoutes(app) {
    const auth = [authenticateToken, requirePayload];

    // What a member can launch on this case: the approved workflows, and their own. Admins also
    // get `available`: what they could approve (their own and public ones, not yet approved).
    app.get('/api/cases/:id/workflows', ...auth, asyncHandler(async (req, res) => {
        const { role } = await loadCaseWithAccess(req.params.id, req);
        const canManage = role === 'admin';
        const [approvals, mine, everyonePublic] = await Promise.all([
            findAll(CASE_WORKFLOWS, { case: { equals: Number(req.params.id) } }, 'name'),
            myWorkflows(req),
            canManage ? publicWorkflows() : [],
        ]);
        const sourceIds = [...new Set(approvals.map((a) => a.workflow))];
        const sources = sourceIds.length
            ? (await findAll(WORKFLOWS, { id: { in: sourceIds } })).filter((d) => canView(d, req))
            : [];
        const sourceById = new Map(sources.map((d) => [String(d.id), d]));
        const approvedIds = new Set(approvals.map((a) => String(a.workflow)));
        const available = canManage
            ? [...new Map([...mine, ...everyonePublic].map((d) => [String(d.id), d])).values()]
                .filter((d) => !approvedIds.has(String(d.id)))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((d) => toWorkflow(d, req))
            : undefined;
        res.json({
            approved: approvals.map((a) => toApproval(a, sourceById.get(String(a.workflow)))),
            mine: mine.map((d) => toWorkflow(d, req)),
            canManage,
            ...(available ? { available } : {}),
        });
    }));

    // Approve (or re-approve, refreshing the copy) a public workflow or one of the admin's own.
    app.post('/api/cases/:id/workflows', ...auth, asyncHandler(async (req, res) => {
        await loadCaseWithAccess(req.params.id, req, 'admin');
        const source = await loadOwnedDoc(WORKFLOWS, String(req.body?.workflowId ?? ''), req, { write: false });
        const data = {
            case: Number(req.params.id),
            workflow: String(source.id),
            name: source.name,
            extensions: source.extensions || [],
            approved_by: requireOwnerId(req),
            approved_at: new Date().toISOString(),
            source_updated_at: source.updatedAt,
        };
        const payload = getPayloadClient();
        const [existing] = await findAll(CASE_WORKFLOWS, {
            case: { equals: data.case }, workflow: { equals: data.workflow },
        });
        const row = existing
            ? await payload.update({ collection: CASE_WORKFLOWS, id: existing.id, data })
            : await payload.create({ collection: CASE_WORKFLOWS, data });
        res.status(existing ? 200 : 201).json({ approval: toApproval(row, null) });
    }));

    app.delete('/api/cases/:id/workflows/:approvalId', ...auth, asyncHandler(async (req, res) => {
        await loadCaseWithAccess(req.params.id, req, 'admin');
        const payload = getPayloadClient();
        const row = isDocId(req.params.approvalId)
            ? await payload.findByID({ collection: CASE_WORKFLOWS, id: req.params.approvalId, depth: 0, disableErrors: true })
            : null;
        if (!row || String(row.case) !== String(req.params.id)) throw new NotFoundError('Not found');
        await payload.delete({ collection: CASE_WORKFLOWS, id: row.id });
        res.status(204).end();
    }));
}
