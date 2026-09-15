import { BrowserRouter, Routes, Route } from 'react-router-dom';
import WizardPage from './pages/WizardPage';
import EditorPage from './pages/EditorPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WizardPage />} />
        <Route path="/v2" element={<EditorPage />} />
      </Routes>
    </BrowserRouter>
  );
}