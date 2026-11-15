'use client'
import { apiFetch } from '@/lib/api-client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { formatDate, MEDICATION_COLORS } from '@/lib/utils'

interface Medication {
  id: string; name: string; dosage: string; dosage_unit: string;
  frequency: string; times: string; with_food: number;
  start_date: string; end_date: string; notes: string; color: string; active: number;
}

const FREQUENCIES = ['Once daily', 'Twice daily', 'Three times daily', 'Four times daily', 'Weekly', 'As needed']
const DEFAULT_TIMES: Record<string, string[]> = {
  'Once daily': ['08:00'],
  'Twice daily': ['08:00', '20:00'],
  'Three times daily': ['08:00', '14:00', '20:00'],
  'Four times daily': ['08:00', '12:00', '16:00', '20:00'],
  'Weekly': ['08:00'],
  'As needed': ['08:00'],
}

export default function MedicationsPage() {
  const router = useRouter()
  const [patient, setPatient] = useState<any>(null)
  const [medications, setMedications] = useState<Medication[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    name: '', dosage: '', dosage_unit: 'mg', frequency: 'Once daily',
    times: ['08:00'], with_food: false,
    start_date: format(new Date(), 'yyyy-MM-dd'), end_date: '', notes: '', color: MEDICATION_COLORS[0]
  })

  useEffect(() => {
    const stored = localStorage.getItem('patient')
    if (!stored) { router.push('/'); return }
    const p = JSON.parse(stored)
    setPatient(p)
    fetchMedications(p.id)
  }, [])

  async function fetchMedications(patientId: string) {
    setLoading(true)
    const res = await apiFetch(`/api/medications?patientId=${patientId}`)
    if (res.ok) setMedications(await res.json())
    setLoading(false)
  }

  function updateFrequency(freq: string) {
    setForm(p => ({ ...p, frequency: freq, times: DEFAULT_TIMES[freq] || ['08:00'] }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const res = await apiFetch('/api/medications', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, patient_id: patient.id }),
    })
    if (res.ok) {
      setShowForm(false)
      setForm({ name: '', dosage: '', dosage_unit: 'mg', frequency: 'Once daily', times: ['08:00'], with_food: false, start_date: format(new Date(), 'yyyy-MM-dd'), end_date: '', notes: '', color: MEDICATION_COLORS[0] })
      fetchMedications(patient.id)
    }
  }

  async function toggleActive(med: Medication) {
    await apiFetch('/api/medications', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...med, times: JSON.parse(med.times), active: med.active ? 0 : 1 }),
    })
    fetchMedications(patient?.id)
  }

  const units = ['mg', 'mcg', 'g', 'ml', 'tablets', 'capsules', 'drops', 'units']

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-gray-500 hover:text-gray-700 text-sm">← Dashboard</Link>
            <h1 className="text-xl font-bold text-gray-900">💊 Medications</h1>
          </div>
          <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ Add Medication</button>
        </div>
      </nav>

      <main id="main-content" className="max-w-5xl mx-auto px-6 py-8">
        {/* Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && setShowForm(false)}>
            <div role="dialog" aria-modal="true" aria-labelledby="medication-dialog-title" className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <h2 id="medication-dialog-title" className="text-xl font-bold text-gray-900">Add Medication</h2>
                <button type="button" aria-label="Close medication form" onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-5">
                <div>
                  <label className="label" htmlFor="medication-name">Medication Name *</label>
                  <input id="medication-name" className="input-field" required placeholder="e.g. Metformin"
                    value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label" htmlFor="medication-dosage">Dosage *</label>
                    <input id="medication-dosage" className="input-field" required type="number" placeholder="500"
                      value={form.dosage} onChange={e => setForm(p => ({ ...p, dosage: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label" htmlFor="medication-unit">Unit</label>
                    <select id="medication-unit" className="input-field" value={form.dosage_unit} onChange={e => setForm(p => ({ ...p, dosage_unit: e.target.value }))}>
                      {units.map(u => <option key={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="medication-frequency">Frequency *</label>
                  <select id="medication-frequency" className="input-field" value={form.frequency} onChange={e => updateFrequency(e.target.value)}>
                    {FREQUENCIES.map(f => <option key={f}>{f}</option>)}
                  </select>
                </div>
                {form.frequency === 'As needed' ? (
                  <p className="text-sm text-gray-500 bg-blue-50 rounded-xl p-3">As-needed medicines won&apos;t create scheduled doses or reminders. Follow the prescription instructions.</p>
                ) : (
                  <div>
                    <span className="label" id="medication-times-label">{form.frequency === 'Weekly' ? 'Weekly dose time' : 'Schedule Times'}</span>
                    {form.frequency === 'Weekly' && <p className="text-xs text-gray-500 mb-2">Repeats on the weekday of the start date.</p>}
                    {form.times.map((time, i) => (
                      <input key={i} aria-label={`Dose time ${i + 1}`} type="time" className="input-field mb-2" value={time}
                        onChange={e => { const t = [...form.times]; t[i] = e.target.value; setForm(p => ({ ...p, times: t })) }} />
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="withFood" checked={form.with_food}
                    onChange={e => setForm(p => ({ ...p, with_food: e.target.checked }))} className="w-5 h-5 accent-teal-600" />
                  <label htmlFor="withFood" className="text-gray-700 font-medium">🍽️ Take with food</label>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label" htmlFor="medication-start">Start Date *</label>
                    <input id="medication-start" type="date" className="input-field" required value={form.start_date}
                      onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label" htmlFor="medication-end">End Date</label>
                    <input id="medication-end" type="date" className="input-field" value={form.end_date}
                      onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="label">Color Label</label>
                  <div className="flex gap-2 flex-wrap mt-1">
                    {MEDICATION_COLORS.map(c => (
                      <button key={c} type="button" aria-label={`Choose color ${c}`} aria-pressed={form.color === c} onClick={() => setForm(p => ({ ...p, color: c }))}
                        className={`w-8 h-8 rounded-full border-2 transition-all ${form.color === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="medication-notes">Notes</label>
                  <textarea id="medication-notes" className="input-field" rows={2} placeholder="Any special instructions..."
                    value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
                </div>
                <button type="submit" className="btn-primary w-full">Add Medication</button>
              </form>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 text-gray-500">Loading medications...</div>
        ) : medications.length === 0 ? (
          <div className="card text-center py-16">
            <div className="text-6xl mb-4">💊</div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">No medications yet</h3>
            <p className="text-gray-500 mb-6">Add medications to track doses and get reminders</p>
            <button onClick={() => setShowForm(true)} className="btn-primary">+ Add First Medication</button>
          </div>
        ) : (
          <div className="grid gap-4">
            {medications.map(med => {
              const times: string[] = JSON.parse(med.times)
              return (
                <div key={med.id} className={`card flex items-start gap-4 ${!med.active ? 'opacity-50' : ''}`}>
                  <div className="w-4 h-4 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: med.color }}></div>
                  <div className="flex-1">
                    <div className="flex justify-between items-start gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-bold text-gray-900 text-lg">{med.name}</h3>
                          {!med.active && <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded text-xs">Inactive</span>}
                        </div>
                        <p className="text-gray-600">{med.dosage} {med.dosage_unit} • {med.frequency}</p>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {med.frequency === 'As needed' ? <span className="text-sm text-gray-500">No fixed schedule · as needed</span> : times.map((t: string) => (
                            <span key={t} className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs font-medium">🕐 {t}</span>
                          ))}
                          {med.with_food === 1 && <span className="bg-orange-100 text-orange-700 px-2 py-1 rounded text-xs font-medium">🍽️ With food</span>}
                        </div>
                        {med.notes && <p className="text-sm text-gray-500 mt-2">{med.notes}</p>}
                        <p className="text-xs text-gray-400 mt-2">
                          From {formatDate(med.start_date)}{med.end_date ? ` to ${formatDate(med.end_date)}` : ' (ongoing)'}
                        </p>
                      </div>
                      <button onClick={() => toggleActive(med)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold flex-shrink-0 ${med.active ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>
                        {med.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
