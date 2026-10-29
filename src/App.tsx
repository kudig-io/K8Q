import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Assistant from './pages/Assistant'
import Dashboard from './pages/Dashboard'
import Events from './pages/Events'
import Releases from './pages/Releases'
import Workloads from './pages/Workloads'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/workloads" element={<Workloads />} />
        <Route path="/events" element={<Events />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/releases" element={<Releases />} />
      </Route>
    </Routes>
  )
}
