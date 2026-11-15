'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'

interface Appointment {
  id: string; doctor_name: string; specialty: string;
  appointment_datetime: string; location: string; notes: string; status: string;
}

export default function AppointmentsPage() {
  const router = useRouter()
  const [patient, setPatient] = useState<any>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ doctor_name: '', specialty: '', appointment_datetime: '', location: '', notes: '' })

  useEffect(() => {
    const stored = localStorage.getItem('patient')
    if (!stored) { router.push('/'); return }
    const p = JSON.parse(stored)
    setPatient(p)
    fetchAppointments(p.id)
  }, [])

  async function fetchAppointments(patientId: string) {
    setLoading(true)
    const res = await fetch(`/api/appointments?patientId=${patientId}`)
    if (res.ok) setAppointments(await res.json())
    setLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch('/api/appointments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, patient_id: patient.id }),
    })
    if (res.ok) {
      setShowForm(false)
      setForm({ doctor_name: '', specialty: '', appointment_datetime: '', location: '', notes: '' })
      fetchAppointments(patient.id)
    }
  }

  async function cancelAppointment(id: string) {
    if (!confirm('Cancel this appointment?')) return
    await fetch(`/api/appointments?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    fetchAppointments(patient?.id)
  }

  const upcoming = appointments.filter(a => new Date(a.appointment_datetime) >= new Date() && a.status !== 'cancelled')
  const past = appointments.filter(a => new Date(a.appointment_datetime) < new Date() || a.status === 'cancelled')

  const statusBadge: Record<string, string> = {
    scheduled: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-gray-100 text-gray-600',
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-gray-500 hover:text-gray-700 text-sm">← Dashboard</Link>
            <h1 className="text-xl font-bold text-gray-900">📅 Appointments</h1>
          </div>
          <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ Schedule Appointment</button>
        </div>
      </nav>

      <main id="main-content" className="max-w-4xl mx-auto px-6 py-8">
        {showForm && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && setShowForm(false)}>
            <div role="dialog" aria-modal="true" aria-labelledby="appointment-dialog-title" className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <h2 id="appointment-dialog-title" className="text-xl font-bold">Schedule Appointment</h2>
                <button type="button" aria-label="Close appointment form" onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label className="label" htmlFor="appointment-doctor">Doctor Name *</label>
                  <input id="appointment-doctor" className="input-field" required placeholder="e.g. Priya Sharma"
                    value={form.doctor_name} onChange={e => setForm(p => ({ ...p, doctor_name: e.target.value }))} />
                </div>
                <div>
                  <label className="label" htmlFor="appointment-specialty">Specialty</label>
                  <input id="appointment-specialty" className="input-field" placeholder="e.g. Cardiologist, Neurologist"
                    value={form.specialty} onChange={e => setForm(p => ({ ...p, specialty: e.target.value }))} />
                </div>
                <div>
                  <label className="label" htmlFor="appointment-datetime">Date &amp; Time *</label>
                  <input id="appointment-datetime" type="datetime-local" className="input-field" required
                    value={form.appointment_datetime} onChange={e => setForm(p => ({ ...p, appointment_datetime: e.target.value }))} />
                </div>
                <div>
                  <label className="label" htmlFor="appointment-location">Location / Clinic</label>
                  <input id="appointment-location" className="input-field" placeholder="e.g. Apollo Hospital, Room 302"
                    value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} />
                </div>
                <div>
                  <label className="label" htmlFor="appointment-notes">Notes</label>
                  <textarea id="appointment-notes" className="input-field" rows={3} placeholder="Bring reports, fasting required, etc."
                    value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
                </div>
                <button type="submit" className="btn-primary w-full">Schedule Appointment</button>
              </form>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 text-gray-500">Loading appointments...</div>
        ) : (
          <div className="space-y-8">
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-4">Upcoming ({upcoming.length})</h2>
              {upcoming.length === 0 ? (
                <div className="card text-center py-10">
                  <div className="text-5xl mb-3">📅</div>
                  <p className="text-gray-500 mb-4">No upcoming appointments</p>
                  <button onClick={() => setShowForm(true)} className="btn-primary text-sm">Schedule Appointment</button>
                </div>
              ) : (
                <div className="grid gap-4">
                  {upcoming.map(appt => (
                    <div key={appt.id} className="card">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-3 mb-1">
                            <h3 className="font-bold text-gray-900 text-lg">Dr. {appt.doctor_name}</h3>
                            {appt.specialty && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-medium">{appt.specialty}</span>}
                          </div>
                          <p className="text-teal-700 font-semibold">{format(parseISO(appt.appointment_datetime), 'EEEE, MMMM d yyyy • h:mm a')}</p>
                          {appt.location && <p className="text-gray-500 text-sm mt-1">📍 {appt.location}</p>}
                          {appt.notes && <p className="text-gray-500 text-sm mt-1 bg-gray-50 rounded px-3 py-2">📋 {appt.notes}</p>}
                        </div>
                        <button onClick={() => cancelAppointment(appt.id)}
                          className="text-red-500 hover:text-red-700 text-xs font-medium flex-shrink-0 ml-4">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {past.length > 0 && (
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-4">Past Appointments</h2>
                <div className="grid gap-3">
                  {past.map(appt => (
                    <div key={appt.id} className="card opacity-70 flex justify-between items-center">
                      <div>
                        <div className="flex items-center gap-3">
                          <h3 className="font-semibold text-gray-700">Dr. {appt.doctor_name}</h3>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusBadge[appt.status] || 'bg-gray-100 text-gray-600'}`}>{appt.status}</span>
                        </div>
                        <p className="text-gray-500 text-sm">{format(parseISO(appt.appointment_datetime), 'MMM d, yyyy h:mm a')}</p>
                        {appt.location && <p className="text-gray-400 text-xs">📍 {appt.location}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
