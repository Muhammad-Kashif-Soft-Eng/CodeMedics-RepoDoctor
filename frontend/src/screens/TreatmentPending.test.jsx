// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useWorkflow } from '../context/WorkflowContext';
import TreatmentPending from './TreatmentPending';

vi.mock('../context/WorkflowContext', () => ({
    useWorkflow: vi.fn(),
}));

const WORKSPACE_ID = 'repodoctor-6c94fe5c-b10a-4da4-85fa-721a61c906bd';
const FINDING = {
    title: 'Resolve TODO markers',
    category: 'Code Quality',
    severity: 'Medium',
    evidence: 'The source file contains TODO markers.',
    affectedPath: 'src/index.js',
    explanation: 'Remove completed-work markers.',
};
const WORKFLOW_RESULT = {
    workspaceId: WORKSPACE_ID,
    treatmentResult: {
        status: 'applied',
        changedFiles: ['src/index.js', 'C:\\private\\hidden.js'],
        beforeContent: { 'src/index.js': 'source before' },
        workspacePath: 'C:\\private\\workspace',
    },
    verificationResult: {
        status: 'passed',
        checksRun: ['node --check src/index.js'],
        outputSummary: 'node output and API_KEY=secret-value',
        changedFiles: ['src/index.js'],
    },
    beforeAfter: {
        beforeScore: 32,
        afterScore: 34,
        scoreDelta: 2,
        improved: true,
        summary: 'Health improved by 2 points and verification passed. 1 approved changed file was confirmed.',
        commandOutput: 'must not render',
    },
    changedFiles: ['src/index.js', 'C:\\private\\hidden.js'],
    status: 'completed',
    environment: { API_KEY: 'secret-value' },
};

let originalFetch;
let workflowState;

function LocationDisplay() {
    const location = useLocation();
    return <output data-testid="location">{location.pathname}</output>;
}

function renderTreatment(overrides = {}) {
    workflowState = {
        workspaceId: WORKSPACE_ID,
        selectedFinding: FINDING,
        prescription: { title: 'Remove completed TODO markers', approved: true },
        treatmentWorkflowResult: null,
        setTreatmentWorkflowResult: vi.fn((result) => {
            workflowState.treatmentWorkflowResult = result;
        }),
        ...overrides,
    };
    useWorkflow.mockReturnValue(workflowState);

    return render(
        <MemoryRouter initialEntries={['/treatment']}>
            <LocationDisplay />
            <Routes>
                <Route path="/treatment" element={<TreatmentPending />} />
                <Route path="/prescription" element={<p>Prescription screen</p>} />
                <Route path="/diagnosis" element={<p>Diagnosis screen</p>} />
            </Routes>
        </MemoryRouter>
    );
}

function successfulResponse(result = WORKFLOW_RESULT) {
    return {
        ok: true,
        json: async () => result,
    };
}

beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
});

afterEach(() => {
    cleanup();
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
    vi.clearAllMocks();
});

describe('TreatmentPending controlled workflow', () => {
    test('sends only the server workspace ID and selected finding', async () => {
        globalThis.fetch.mockResolvedValue(successfulResponse());
        renderTreatment();

        fireEvent.click(screen.getByRole('button', { name: 'Start treatment' }));

        await screen.findByRole('heading', { name: 'Treatment complete' });
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        const [url, options] = globalThis.fetch.mock.calls[0];
        expect(url).toContain('/api/treatment-workflow');
        expect(JSON.parse(options.body)).toEqual({ workspaceId: WORKSPACE_ID, finding: FINDING });
    });

    test('shows a disabled loading action and prevents duplicate submissions', async () => {
        let resolveFetch;
        globalThis.fetch.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
        renderTreatment();
        const startButton = screen.getByRole('button', { name: 'Start treatment' });

        fireEvent.click(startButton);
        fireEvent.click(startButton);

        expect(screen.getByRole('heading', { name: 'Treatment workflow running' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Running workflow' }).disabled).toBe(true);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);

        resolveFetch(successfulResponse());
        await screen.findByRole('heading', { name: 'Treatment complete' });
    });

    test('renders safe workflow details and stores the normalized result', async () => {
        globalThis.fetch.mockResolvedValue(successfulResponse());
        renderTreatment();
        fireEvent.click(screen.getByRole('button', { name: 'Start treatment' }));

        expect(await screen.findByText('Before score')).toBeTruthy();
        expect(screen.getByText('After score')).toBeTruthy();
        expect(screen.getByText('Score change')).toBeTruthy();
        expect(document.body.textContent).toContain('+2');
        expect(screen.getByText('Yes')).toBeTruthy();
        expect(screen.getByText('src/index.js')).toBeTruthy();
        expect(screen.getByText(WORKFLOW_RESULT.beforeAfter.summary)).toBeTruthy();
        expect(workflowState.setTreatmentWorkflowResult).toHaveBeenCalledWith(WORKFLOW_RESULT);

        const rendered = document.body.textContent;
        expect(rendered).not.toContain('source before');
        expect(rendered).not.toContain('C:\\private');
        expect(rendered).not.toContain('API_KEY');
        expect(rendered).not.toContain('secret-value');
        expect(rendered).not.toContain('must not render');
    });

    test('shows a user-friendly failure and allows retry', async () => {
        globalThis.fetch
            .mockRejectedValueOnce(new Error('API failure at C:\\private\\workspace API_KEY=secret-value'))
            .mockResolvedValueOnce(successfulResponse());
        renderTreatment();
        fireEvent.click(screen.getByRole('button', { name: 'Start treatment' }));

        expect(await screen.findByRole('heading', { name: 'Treatment workflow failed' })).toBeTruthy();
        expect(screen.getByText('The treatment workflow could not be completed. Please retry.')).toBeTruthy();
        expect(document.body.textContent).not.toContain('C:\\private');
        expect(document.body.textContent).not.toContain('secret-value');

        fireEvent.click(screen.getByRole('button', { name: 'Retry workflow' }));
        await screen.findByRole('heading', { name: 'Treatment complete' });
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    test('redirects to prescription when workspace ID is missing', async () => {
        renderTreatment({ workspaceId: null });

        await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/prescription'));
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('redirects to diagnosis when the selected finding is missing', async () => {
        renderTreatment({ selectedFinding: null });

        await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/diagnosis'));
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('redirects to prescription when approval is missing', async () => {
        renderTreatment({ prescription: { title: 'Not approved', approved: false } });

        await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/prescription'));
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('does not automatically resubmit a saved workflow result', async () => {
        renderTreatment({ treatmentWorkflowResult: WORKFLOW_RESULT });

        expect(await screen.findByRole('heading', { name: 'Treatment complete' })).toBeTruthy();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});