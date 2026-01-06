import { Routes, Route } from "react-router-dom"
import { Layout } from "./components/layout"

// Route imports
import Dashboard from "./routes/dashboard"
import Documents from "./routes/documents"
import DocumentDetail from "./routes/documents/$id"
import Pending from "./routes/pending"
import Prompts from "./routes/prompts"
import Tags from "./routes/tags"
import Settings from "./routes/settings"
import SettingsJobs from "./routes/settings/jobs"
import SettingsBlocked from "./routes/settings/blocked"
import SettingsCustomFields from "./routes/settings/custom-fields"

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/documents/:id" element={<DocumentDetail />} />
        <Route path="/pending" element={<Pending />} />
        <Route path="/prompts" element={<Prompts />} />
        <Route path="/tags" element={<Tags />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/jobs" element={<SettingsJobs />} />
        <Route path="/settings/blocked" element={<SettingsBlocked />} />
        <Route path="/settings/custom-fields" element={<SettingsCustomFields />} />
      </Routes>
    </Layout>
  )
}
