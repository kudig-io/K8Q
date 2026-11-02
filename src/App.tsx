import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { onToast } from './data/dataSource'
import Assistant from './pages/Assistant'
import Dashboard from './pages/Dashboard'
import Events from './pages/Events'
import Explorer from './pages/Explorer'
import Releases from './pages/Releases'

function Toast() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => onToast(setMsg), [])
  if (!msg) return null
  return (
    <div className="toast" role="alert">
      <span className="toast-dot" />
      {msg}
    </div>
  )
}

export default function App() {
  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/explorer" element={<Explorer />} />
          <Route path="/workloads" element={<Navigate to="/explorer?group=workloads" replace />} />
          <Route path="/events" element={<Events />} />
          <Route path="/assistant" element={<Assistant />} />
          <Route path="/releases" element={<Releases />} />
        </Route>
      </Routes>
      <Toast />
    </>
  )
}
