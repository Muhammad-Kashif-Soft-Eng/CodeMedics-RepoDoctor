import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { WorkflowProvider } from './context/WorkflowContext';
import Landing        from './screens/Landing';
import ScanProgress   from './screens/ScanProgress';
import HealthDashboard from './screens/HealthDashboard';
import Diagnosis      from './screens/Diagnosis';
import Prescription   from './screens/Prescription';
import Verification   from './screens/Verification';

export default function App() {
  return (
    <WorkflowProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/"            element={<Landing />} />
          <Route path="/scan"        element={<ScanProgress />} />
          <Route path="/health"      element={<HealthDashboard />} />
          <Route path="/diagnosis"   element={<Diagnosis />} />
          <Route path="/prescription" element={<Prescription />} />
          <Route path="/verification" element={<Verification />} />
        </Routes>
      </BrowserRouter>
    </WorkflowProvider>
  );
}
