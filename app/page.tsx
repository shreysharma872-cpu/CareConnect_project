'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function HomePage() {
  const router = useRouter()
  const [mode, setMode] = useState<'landing' | 'login' | 'register'>('landing')
  const [patientId, setPatientId] = useState('')
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [createdPatientId, setCreatedPatientId] = useState('')
  const [copiedPatientId, setCopiedPatientId] = useState(false)
  const [regForm, setRegForm] = useState({
    name: '', dob: '', blood_group: '', passcode: '', confirmPasscode: '',
    email: '', phone: '', emergency_contact_name: '', emergency_contact_phone: '',
    emergency_contact_relation: '', allergies: '', medical_conditions: ''
  })

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch('/api/patients/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId: patientId.toUpperCase(), passcode }),
        signal: controller.signal,
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Login failed'); return }
      localStorage.setItem('patient', JSON.stringify({ id: data.patient.id, name: data.patient.name }))
      router.replace('/dashboard')
    } catch (error) {
      setError(controller.signal.aborted
        ? 'The server took too long to respond. Check that the app and database are running, then try again.'
        : 'Could not connect to the server. Check that npm run dev is still running.')
    } finally {
      window.clearTimeout(timeout)
      setLoading(false)
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (regForm.passcode !== regForm.confirmPasscode) { setError('Passcodes do not match'); return }
    if (regForm.passcode.length < 8) { setError('Passcode must be at least 8 characters'); return }
    setError(''); setLoading(true)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch('/api/patients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(regForm),
        signal: controller.signal,
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Registration failed'); return }
      setCreatedPatientId(data.id)
      setCopiedPatientId(false)
      setPatientId(data.id)
      setMode('login')
    } catch {
      setError(controller.signal.aborted
        ? 'The server took too long to respond. Check the database setup and try again.'
        : 'Could not connect to the server. Check that npm run dev is still running.')
    } finally {
      window.clearTimeout(timeout)
      setLoading(false)
    }
  }

  const features = [
    { icon: '💊', title: 'Medication Management', desc: 'Track all medications, doses, and schedules with smart reminders' },
    { icon: '📅', title: 'Appointment Tracking', desc: 'Never miss a doctor visit with automated email reminders' },
    { icon: '👨‍👩‍👧', title: 'Family Collaboration', desc: 'Share access with caretakers and family via secure passcode' },
    { icon: '📊', title: 'Adherence Insights', desc: 'Visual charts and streaks to motivate consistent medication habits' },
    { icon: '📋', title: 'Vitals Tracking', desc: 'Log blood pressure, sugar levels, weight, and more over time' },
    { icon: '📝', title: 'Health Journal', desc: 'Daily mood and symptom logs for a complete health picture' },
  ]

  if (mode === 'landing') return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-green-50 flex flex-col">
      <header className="p-6 flex justify-between items-center max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-teal-600 rounded-xl flex items-center justify-center text-white text-xl">⚕️</div>
          <span className="text-2xl font-bold text-teal-700">CareConnect</span>
        </div>
        <button onClick={() => setMode('login')} className="btn-primary text-sm px-5 py-2.5">Sign In</button>
      </header>
      <main id="main-content" className="flex-1 flex flex-col items-center justify-center text-center px-6 py-20">
        <div className="inline-flex items-center gap-2 bg-teal-100 text-teal-700 px-4 py-2 rounded-full text-sm font-semibold mb-6">
          <span>✨</span> Smart Elderly Care Platform
        </div>
        <h1 className="text-5xl font-bold text-gray-900 max-w-3xl leading-tight mb-6">
          Healthcare Made Simple<br />
          <span className="text-teal-600">for Those Who Matter Most</span>
        </h1>
        <p className="text-xl text-gray-600 max-w-2xl mb-10 leading-relaxed">
          CareConnect helps elderly individuals, caretakers, and family members manage medications,
          appointments, and health routines — all in one place.
        </p>
        <div className="flex flex-wrap gap-4 justify-center mb-16">
          <button onClick={() => setMode('register')} className="btn-primary text-lg px-8 py-4">Create Profile →</button>
          <button onClick={() => setMode('login')} className="btn-secondary text-lg px-8 py-4">Sign In</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full">
          {features.map(f => (
            <div key={f.title} className="card text-left hover:shadow-md transition-shadow">
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="font-bold text-gray-900 mb-2">{f.title}</h3>
              <p className="text-gray-600 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>
      <footer className="text-center py-8 text-gray-400 text-sm">
        CareConnect — PromptWars x Catalyst | Build with AI
      </footer>
    </div>
  )

  if (mode === 'login') return (
    <div id="main-content" tabIndex={-1} className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-green-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-teal-600 rounded-2xl flex items-center justify-center text-white text-3xl mx-auto mb-4">⚕️</div>
          <h1 className="text-3xl font-bold text-gray-900">Welcome Back</h1>
          <p className="text-gray-600 mt-2">Sign in to your CareConnect profile</p>
        </div>
        <div className="card">
          {createdPatientId && <div role="status" className="mb-5 rounded-xl border border-teal-200 bg-teal-50 p-4 text-left">
            <p className="font-semibold text-teal-900">Profile created. Save your Patient ID to sign in.</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <strong className="font-mono text-xl tracking-widest text-teal-950">{createdPatientId}</strong>
              <button type="button" className="btn-secondary px-4 py-2" onClick={async () => {
                try { await navigator.clipboard.writeText(createdPatientId); setCopiedPatientId(true) } catch { setCopiedPatientId(false) }
              }}>{copiedPatientId ? 'Copied' : 'Copy ID'}</button>
            </div>
          </div>}
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="label" htmlFor="login-patient-id">Patient ID</label>
              <input id="login-patient-id" autoComplete="username" type="text" value={patientId} onChange={e => setPatientId(e.target.value.toUpperCase())}
                placeholder="e.g. AB3K9MX2" className="input-field font-mono tracking-widest text-center text-xl"
                required maxLength={8} />
              <p className="text-xs text-gray-500 mt-1 text-center">Your 8-character Patient ID</p>
            </div>
            <div>
              <label className="label" htmlFor="login-passcode">Passcode</label>
              <input id="login-passcode" autoComplete="current-password" type="password" value={passcode} onChange={e => setPasscode(e.target.value)}
                placeholder="Enter your passcode" className="input-field" required />
            </div>
            {error && <div role="alert" className="bg-red-50 text-red-800 px-4 py-3 rounded-xl font-medium">{error}</div>}
            <button type="submit" disabled={loading} className="btn-primary w-full text-lg">
              {loading ? 'Signing in...' : 'Sign In →'}
            </button>
          </form>
          <div className="mt-6 pt-5 border-t border-gray-100 text-center">
            <p className="text-gray-600 text-sm">New to CareConnect?</p>
            <button onClick={() => { setMode('register'); setError('') }} className="text-teal-600 font-semibold mt-1 hover:underline">
              Create a Patient Profile
            </button>
          </div>
        </div>
        <button onClick={() => setMode('landing')} className="mt-4 text-gray-500 hover:text-gray-700 text-sm w-full text-center block">
          ← Back to Home
        </button>
      </div>
    </div>
  )

  // Register mode
  const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']
  return (
    <div id="main-content" tabIndex={-1} className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-green-50 py-12 px-6">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-teal-600 rounded-2xl flex items-center justify-center text-white text-3xl mx-auto mb-4">⚕️</div>
          <h1 className="text-3xl font-bold text-gray-900">Create Patient Profile</h1>
          <p className="text-gray-600 mt-2">Set up an elderly care profile for your loved one</p>
        </div>
        <div className="card">
          <form onSubmit={handleRegister} className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b border-gray-100">Personal Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="label" htmlFor="register-name">Full Name *</label>
                  <input id="register-name" type="text" className="input-field" placeholder="e.g. Ramesh Sharma" required
                    value={regForm.name} onChange={e => setRegForm(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div>
                  <label className="label" htmlFor="register-dob">Date of Birth</label>
                  <input id="register-dob" type="date" className="input-field" value={regForm.dob} onChange={e => setRegForm(p => ({ ...p, dob: e.target.value }))} />
                </div>
                <div>
                  <label className="label" htmlFor="register-blood-group">Blood Group</label>
                  <select id="register-blood-group" className="input-field" value={regForm.blood_group} onChange={e => setRegForm(p => ({ ...p, blood_group: e.target.value }))}>
                    <option value="">Select...</option>
                    {bloodGroups.map(bg => <option key={bg}>{bg}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="register-email">Email Address</label>
                  <input id="register-email" type="email" className="input-field" placeholder="For reminders" value={regForm.email} onChange={e => setRegForm(p => ({ ...p, email: e.target.value }))} />
                </div>
                <div>
                  <label className="label" htmlFor="register-phone">Phone Number</label>
                  <input id="register-phone" type="tel" className="input-field" placeholder="+91 98765 43210" value={regForm.phone} onChange={e => setRegForm(p => ({ ...p, phone: e.target.value }))} />
                </div>
              </div>
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b border-gray-100">Emergency Contact</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="label" htmlFor="emergency-name">Name</label>
                  <input id="emergency-name" type="text" className="input-field" placeholder="Contact name" value={regForm.emergency_contact_name} onChange={e => setRegForm(p => ({ ...p, emergency_contact_name: e.target.value }))} />
                </div>
                <div>
                  <label className="label" htmlFor="emergency-phone">Phone</label>
                  <input id="emergency-phone" type="tel" className="input-field" placeholder="Phone number" value={regForm.emergency_contact_phone} onChange={e => setRegForm(p => ({ ...p, emergency_contact_phone: e.target.value }))} />
                </div>
                <div>
                  <label className="label" htmlFor="emergency-relation">Relation</label>
                  <input id="emergency-relation" type="text" className="input-field" placeholder="e.g. Son, Daughter" value={regForm.emergency_contact_relation} onChange={e => setRegForm(p => ({ ...p, emergency_contact_relation: e.target.value }))} />
                </div>
              </div>
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b border-gray-100">Medical Info</h2>
              <div className="space-y-4">
                <div>
                  <label className="label" htmlFor="register-allergies">Known Allergies</label>
                  <input id="register-allergies" type="text" className="input-field" placeholder="e.g. Penicillin, Aspirin" value={regForm.allergies} onChange={e => setRegForm(p => ({ ...p, allergies: e.target.value }))} />
                </div>
                <div>
                  <label className="label" htmlFor="register-conditions">Medical Conditions</label>
                  <input id="register-conditions" type="text" className="input-field" placeholder="e.g. Diabetes, Hypertension" value={regForm.medical_conditions} onChange={e => setRegForm(p => ({ ...p, medical_conditions: e.target.value }))} />
                </div>
              </div>
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b border-gray-100">Secure Access</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="register-passcode">Passcode *</label>
                  <input id="register-passcode" autoComplete="new-password" type="password" className="input-field" placeholder="At least 8 characters" required minLength={8}
                    value={regForm.passcode} onChange={e => setRegForm(p => ({ ...p, passcode: e.target.value }))} />
                </div>
                <div>
                  <label className="label" htmlFor="register-confirm-passcode">Confirm Passcode *</label>
                  <input id="register-confirm-passcode" autoComplete="new-password" type="password" className="input-field" placeholder="Repeat passcode" required minLength={8}
                    value={regForm.confirmPasscode} onChange={e => setRegForm(p => ({ ...p, confirmPasscode: e.target.value }))} />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">Share this passcode with trusted caretakers and family members</p>
            </div>
            {error && <div role="alert" className="bg-red-50 text-red-800 px-4 py-3 rounded-xl font-medium">{error}</div>}
            <button type="submit" disabled={loading} className="btn-primary w-full text-lg">
              {loading ? 'Creating Profile...' : 'Create Patient Profile →'}
            </button>
          </form>
        </div>
        <button onClick={() => { setMode('landing'); setError('') }} className="mt-4 text-gray-500 hover:text-gray-700 text-sm w-full text-center block">
          ← Back to Home
        </button>
      </div>
    </div>
  )
}
