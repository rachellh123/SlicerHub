import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { buttonStyles } from '../styles/buttons.js';
import { workflowStyles } from '../styles/workflows.js';
import { listCaseWorkflows, approveCaseWorkflow, removeCaseWorkflow } from '../services/workflows.js';

// Under slicerweb.* so sign-out clears it with SlicerWeb's own state (utils/slicerWebStorage.js).
const CHOICE_KEY = 'slicerweb.hub.caseWorkflows';
const DEFAULT = 'default';

function readChoices() {
    try { return JSON.parse(localStorage.getItem(CHOICE_KEY) || '{}') || {}; } catch { return {}; }
}

function saveChoice(caseId, choice) {
    try { localStorage.setItem(CHOICE_KEY, JSON.stringify({ ...readChoices(), [caseId]: choice })); } catch { /* ignore */ }
}

/**
 * Case page: which workflow SlicerWeb opens with (approved for the case, or the person's own),
 * and for case admins, approving and removing workflows.
 * Emits `workflow-change` with { extensions }: a list, or null for the default.
 */
export class CaseWorkflows extends LitElement {
    static get properties() {
        return {
            caseId: { type: String },
            data: { state: true },
            choice: { state: true },
            approveId: { state: true },
            busy: { state: true },
            error: { state: true },
        };
    }

    static get styles() {
        return [buttonStyles, workflowStyles, css`
            :host { margin-bottom: 12px; }
            summary { cursor: pointer; color: var(--color-text-secondary); font-size: 0.85rem; }
            details[open] summary { margin-bottom: 8px; }
            #approve-id { min-width: 200px; }
        `];
    }

    constructor() {
        super();
        this.data = null;
        this.choice = DEFAULT;
        this.approveId = '';
        this.busy = false;
        this.error = '';
    }

    updated(changed) {
        if (changed.has('caseId') && this.caseId) this._load();
    }

    /** `refresh` (after an admin change) keeps what is on screen until the new list arrives. */
    async _load({ refresh = false } = {}) {
        const caseId = this.caseId;
        if (!refresh) {
            this.data = null;
            this.error = '';
            this._select(DEFAULT, { remember: false });
        }
        try {
            const data = await listCaseWorkflows(caseId);
            if (caseId !== this.caseId) return;
            this.data = data;
            this._select(readChoices()[caseId] || DEFAULT, { remember: false });
        } catch (err) {
            if (caseId === this.caseId) this.error = err?.message || t('workflows.loadFailed');
        }
    }

    /** Choices: 'default', 'approved:<id>', 'mine:<id>'. */
    _options() {
        const { approved = [], mine = [] } = this.data || {};
        return {
            approved: approved.map((a) => ({ key: `approved:${a.id}`, name: a.name, extensions: a.extensions })),
            mine: mine.map((w) => ({ key: `mine:${w.id}`, name: w.name, extensions: w.extensions })),
        };
    }

    _select(choice, { remember = true } = {}) {
        const { approved, mine } = this._options();
        const option = [...approved, ...mine].find((o) => o.key === choice);
        this.choice = option ? choice : DEFAULT;
        if (remember) saveChoice(this.caseId, this.choice);
        this.dispatchEvent(new CustomEvent('workflow-change', {
            detail: { extensions: option ? option.extensions : null },
            bubbles: true,
            composed: true,
        }));
    }

    async _manage(action) {
        this.busy = true;
        this.error = '';
        try {
            await action();
            await this._load({ refresh: true });
        } catch (err) {
            this.error = err?.message || t('common.somethingWentWrong');
        } finally {
            this.busy = false;
        }
    }

    _approve(workflowId) {
        return this._manage(async () => {
            await approveCaseWorkflow(this.caseId, workflowId);
            this.approveId = '';
        });
    }

    _renderManage() {
        const approved = this.data.approved;
        return html`
            <details>
                <summary>${t('workflows.manage')}</summary>
                <div class="stack">
                    ${approved.length ? html`<ul class="list">${approved.map((a) => html`
                        <li class="item">
                            <span class="item-name grow">${a.name}</span>
                            <span class="muted">${a.extensions.join(', ') || t('workflows.noExtensions')}</span>
                            ${a.updateAvailable ? html`
                                <span class="pill">${t('workflows.updateAvailable')}</span>
                                <button class="quiet-button" type="button" ?disabled=${this.busy}
                                    aria-label=${t('workflows.updateItem', { name: a.name })}
                                    @click=${() => this._approve(a.workflowId)}>${t('workflows.update')}</button>
                            ` : ''}
                            <button class="quiet-button" type="button" ?disabled=${this.busy}
                                aria-label=${t('common.removeItem', { item: a.name })}
                                @click=${() => this._manage(() => removeCaseWorkflow(this.caseId, a.id))}>${t('common.remove')}</button>
                        </li>`)}</ul>`
                    : html`<span class="muted">${t('workflows.noneApproved')}</span>`}
                    <form class="row" @submit=${(e) => { e.preventDefault(); this._approve(this.approveId); }}>
                        <label for="approve-id" class="muted">${t('workflows.approveLabel')}</label>
                        <select id="approve-id" .value=${this.approveId}
                            @change=${(e) => { this.approveId = e.target.value; }}>
                            <option value="">${t('workflows.chooseWorkflow')}</option>
                            ${(this.data.available || []).map((w) => html`
                                <option value=${String(w.id)}>${w.name}${w.isMine ? '' : ` (${t('workflows.public')})`}</option>`)}
                        </select>
                        <button class="secondary-button" type="submit" ?disabled=${this.busy || !this.approveId}>
                            ${t('workflows.approve')}
                        </button>
                    </form>
                </div>
            </details>
        `;
    }

    render() {
        if (!this.data) return this.error ? html`<span class="error">${this.error}</span>` : '';
        const { approved, mine } = this._options();
        const hasChoices = approved.length + mine.length > 0;
        if (!hasChoices && !this.data.canManage) return '';
        return html`
            <div class="stack">
                ${hasChoices ? html`
                    <label class="row">
                        <span class="muted">${t('workflows.picker')}</span>
                        <select .value=${this.choice} @change=${(e) => this._select(e.target.value)}>
                            <option value=${DEFAULT} ?selected=${this.choice === DEFAULT}>${t('workflows.default')}</option>
                            ${[['approvedGroup', approved], ['mineGroup', mine]].filter(([, list]) => list.length).map(([label, list]) => html`
                                <optgroup label=${t(`workflows.${label}`)}>
                                    ${list.map((o) => html`<option value=${o.key} ?selected=${this.choice === o.key}>${o.name}</option>`)}
                                </optgroup>
                            `)}
                        </select>
                    </label>
                ` : ''}
                ${this.error ? html`<span class="error" role="alert">${this.error}</span>` : ''}
                ${this.data.canManage ? this._renderManage() : ''}
            </div>
        `;
    }
}

customElements.define('case-workflows', CaseWorkflows);
