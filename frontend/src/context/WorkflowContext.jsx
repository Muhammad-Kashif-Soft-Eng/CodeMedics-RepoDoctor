import { createContext, useContext, useState } from 'react';

/**
 * WorkflowContext
 *
 * Holds the in-progress state for a single Codemedics workflow run.
 * Shape is intentionally minimal for Phase 1 — services will populate
 * each slice as they are built.
 */
const WorkflowContext = createContext(null);

const initialState = {
  repoUrl: '',   // string — repository URL entered by the user
  scanResult: null, // ScanResult document returned by POST /api/scan
  findings: [],   // Finding[] returned by POST /api/diagnose
  selectedFinding: null, // single Finding chosen by the user on the Diagnosis screen
  prescription: null, // Prescription document returned by POST /api/prescribe
  workspaceId: null, // opaque server-generated treatment workspace ID
  treatmentResult: null, // TreatmentResult document returned by POST /api/treat / /api/verify
  treatmentWorkflowResult: null, // normalized result returned by POST /api/treatment-workflow
};

export function WorkflowProvider({ children }) {
  const [state, setState] = useState(initialState);

  function setRepoUrl(repoUrl) {
    setState((prev) => ({ ...prev, repoUrl }));
  }

  function setScanResult(scanResult) {
    setState((prev) => ({ ...prev, scanResult }));
  }

  function setFindings(findings) {
    setState((prev) => ({ ...prev, findings }));
  }

  function setSelectedFinding(selectedFinding) {
    setState((prev) => ({ ...prev, selectedFinding }));
  }

  function setPrescription(prescription) {
    setState((prev) => ({ ...prev, prescription }));
  }

  function setWorkspaceId(workspaceId) {
    setState((prev) => ({ ...prev, workspaceId }));
  }

  function setTreatmentResult(treatmentResult) {
    setState((prev) => ({ ...prev, treatmentResult }));
  }

  function setTreatmentWorkflowResult(treatmentWorkflowResult) {
    setState((prev) => ({ ...prev, treatmentWorkflowResult }));
  }

  function resetWorkflow() {
    setState(initialState);
  }

  return (
    <WorkflowContext.Provider
      value={{
        ...state,
        setRepoUrl,
        setScanResult,
        setFindings,
        setSelectedFinding,
        setPrescription,
        setWorkspaceId,
        setTreatmentResult,
        setTreatmentWorkflowResult,
        resetWorkflow,
      }}
    >
      {children}
    </WorkflowContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkflow() {
  const ctx = useContext(WorkflowContext);
  if (!ctx) throw new Error('useWorkflow must be used inside <WorkflowProvider>');
  return ctx;
}
