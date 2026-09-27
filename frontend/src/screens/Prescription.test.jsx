// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useWorkflow } from '../context/WorkflowContext';
import Prescription from './Prescription';

vi.mock('../context/WorkflowContext', () => ({ useWorkflow: vi.fn() }));

const WORKSPACE_ID = 'repodoctor-6c94fe5c-b10a-4da4-85fa-721a61c906bd';
const FINDING = {
    title: 'Limited test coverage',
    category: 'Testing',
    severity: 'High',
    evidence: 'One test file was detected.',
    affectedPath: 'test/widget.test.js',
    explanation: 'More behavior should be covered.',
};
const PRESCRIPTION = {
    title: 'Improve test coverage',
    reason: 'Important behavior is not covered.',
    expectedOutcome: 'The test file is expanded.',
    affectedPaths: ['test/widget.test.js'],
    treatmentSteps: ['Add focused tests.'],
    verificationPlan: 'Run the supported verification check.',
    riskNotes: null,
};
const SCAN_RESULT = {
    scanId: 'scan-result-123',
    owner: 'acme',
    repo: 'widget',
    defaultBranch: 'main',
};
const SOURCE_CONTENT = 'must not be rendered';

let originalFetch;
let workflowState;

function LocationDisplay() {
    const location = useLocation();
    return <output data-testid="location">{location.pathname}</output>;
}

function renderPrescription(overrides = {}) {
    workflowState = {
        scanResult: SCAN_RESULT,
        selectedFinding: FINDING,
        prescription: PRESCRIPTION,
        setPrescription: vi.fn((value) => { workflowState.prescription = value; }),
        setWorkspaceId: vi.fn((value) => { workflowState.workspaceId = value; }),
        ...overrides,
    };
    useWorkflow.mockReturnValue(workflowState);

    return render(
        <MemoryRouter initialEntries={['/prescription']}>
            <LocationDisplay />
            <Routes>
                <Route path="/prescription" element={<Prescription />} />
                <Route path="/diagnosis" element={<p>Diagnosis screen</p>} />
                <Route path="/treatment" element={<p>Treatment screen</p>} />
            </Routes>
        </MemoryRouter>
    );
}

function jsonResponse(result, { ok = true, status = 200 } = {}) {
    return {
        ok,
        status,
        json: async () => result,
        text: async () => JSON.stringify(result),
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

describe('Prescription workspace approval handoff', () => {
    test('posts only scanId, selectedFinding, and the explicitly approved prescription', async () => {
        globalThis.fetch.mockResolvedValue(jsonResponse({ workspaceId: WORKSPACE_ID }));
        renderPrescription();

        fireEvent.click(screen.getByRole('button', { name: 'Approve Treatment' }));

        await screen.findByText('Treatment screen');
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        const [url, options] = globalThis.fetch.mock.calls[0];
        expect(url).toContain('/api/workspace');
        expect(JSON.parse(options.body)).toEqual({
            scanId: SCAN_RESULT.scanId,
            selectedFinding: FINDING,
            prescription: { ...PRESCRIPTION, approved: true },
        });
    });

    test('disables approval and prevents duplicate workspace requests while preparing', async () => {
        let resolveFetch;
        globalThis.fetch.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
        renderPrescription();
        const approveButton = screen.getByRole('button', { name: 'Approve Treatment' });

        fireEvent.click(approveButton);
        fireEvent.click(approveButton);

        expect(screen.getByRole('button', { name: 'Preparing workspace' }).disabled).toBe(true);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(document.body.textContent).not.toContain('Treatment screen');

        resolveFetch(jsonResponse({ workspaceId: WORKSPACE_ID }));
        await screen.findByText('Treatment screen');
    });

    test('stores the returned opaque workspace ID before navigating to Treatment', async () => {
        globalThis.fetch.mockResolvedValue(jsonResponse({
            workspaceId: WORKSPACE_ID,
            repository: { owner: 'acme', repo: 'widget', defaultBranch: 'main' },
            materializedFiles: ['package.json', 'test/widget.test.js'],
            workspacePath: 'C:\\private\\workspace',
            sourceContents: SOURCE_CONTENT,
        }));
        renderPrescription();

        fireEvent.click(screen.getByRole('button', { name: 'Approve Treatment' }));

        await screen.findByText('Treatment screen');
        expect(workflowState.setWorkspaceId).toHaveBeenCalledWith(WORKSPACE_ID);
        expect(workflowState.setPrescription).toHaveBeenCalledWith({ ...PRESCRIPTION, approved: true });
        expect(document.body.textContent).not.toContain('C:\\private');
        expect(document.body.textContent).not.toContain(SOURCE_CONTENT);
    });

    test('stays on the prescription screen after preparation failure and retries', async () => {
        globalThis.fetch
            .mockResolvedValueOnce(jsonResponse({ error: { message: 'C:\\private API_KEY=secret' } }, { ok: false, status: 500 }))
            .mockResolvedValueOnce(jsonResponse({ workspaceId: WORKSPACE_ID }));
        renderPrescription();

        fireEvent.click(screen.getByRole('button', { name: 'Approve Treatment' }));

        expect((await screen.findByRole('alert')).textContent)
            .toContain('The treatment workspace could not be prepared. Please retry.');
        expect(screen.getByTestId('location').textContent).toBe('/prescription');
        expect(workflowState.setWorkspaceId).not.toHaveBeenCalled();
        expect(document.body.textContent).not.toContain('C:\\private');
        expect(document.body.textContent).not.toContain('secret');

        fireEvent.click(screen.getByRole('button', { name: 'Retry workspace preparation' }));
        await screen.findByText('Treatment screen');
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    test('does not prepare a workspace when scanId is missing', async () => {
        renderPrescription({ scanResult: { ...SCAN_RESULT, scanId: undefined } });

        await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/diagnosis'));
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('does not prepare a workspace when the selected finding is missing', async () => {
        renderPrescription({ selectedFinding: null });

        await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/diagnosis'));
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('does not prepare a workspace without a prescription', async () => {
        globalThis.fetch.mockResolvedValueOnce(jsonResponse({ error: { message: 'prescription unavailable' } }, { ok: false, status: 500 }));
        renderPrescription({ prescription: null });

        expect(await screen.findByRole('heading', { name: 'Prescription could not be generated' })).toBeTruthy();
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch.mock.calls[0][0]).not.toContain('/api/workspace');
        expect(workflowState.setWorkspaceId).not.toHaveBeenCalled();
    });

    test('does not construct or render filesystem paths or clone details', async () => {
        globalThis.fetch.mockResolvedValue(jsonResponse({ workspaceId: WORKSPACE_ID }));
        renderPrescription();

        fireEvent.click(screen.getByRole('button', { name: 'Approve Treatment' }));
        await screen.findByText('Treatment screen');

        expect(document.body.textContent).not.toMatch(/[A-Za-z]:\\/);
        expect(JSON.stringify(globalThis.fetch.mock.calls)).not.toContain('workspacePath');
        expect(JSON.stringify(globalThis.fetch.mock.calls)).not.toContain('clone');
    });
});