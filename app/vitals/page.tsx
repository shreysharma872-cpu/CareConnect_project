'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { VITAL_TYPES } from '@/lib/utils'

interface Vital { id: string; type: string; value: number; unit: string; notes: string; recorded_at: string }

export default function VitalsPage() {
  const router = useRouter()
  const [patient, setPatient] = useState<any>(null)
  const [vitals, setVitals] = useState<Vital[]>([])
  const [selectedType, setSelectedType] = useState(VITAL_TYPES[0].key)
  const [form, setForm] = useState({ value: '', notes: '' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('patient')
    if (!stored) { router.push('/'); return }
    const p = JSON.parse(stored)
    setPatient(p)
    fetchVitals(p.id)
  }, [])

  async function fetchVitals(patientId: string) {
    setLoading(true)
    const res = await fetch(`/api/vitals?patientId=${patientId}&limit=50`)
    if (res.ok) setVitals(await res.json())
    setLoading(false)
  }

  async function addVital(e: React.FormEvent) {
    e.preventDefault()
    const vt = VITAL_TYPES.find(v => v.key === selectedType)!
    await fetch('/api/vitals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patient_id: patient.id, type: selectedType, value: parseFloat(form.value), unit: vt.unit, notes: form.notes }),
    })
    setForm({ value: '', notes: '' })
    fetchVitals(patient?.id)
  }

  const currentType = VITAL_TYPES.find(v => v.key === selectedType)!
  const filteredVitals = vitals.filter(v => v.type === selectedType).slice(0, 15)
  const maxVal = filteredVitals.length > 0 ? Math.max(...filteredVitals.map(v => v.value)) : 0

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link href="/dashboard" className="text-gray-500 hover:text-gray-700 text-sm">← Dashboard</Link>
          <h1 className="text-xl font-bold text-gray-900">📊 Vitals Tracker</h1>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Type tabs */}
        <div className="flex gap-2 flex-wrap mb-6">
          {VITAL_TYPES.map(vt => (
            <button key={vt.key} onClick={() => setSelectedType(vt.key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${selectedType === vt.key ? 'bg-teal-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-teal-300'}`}>
              {vt.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Add Form */}
          <div className="card h-fit">
            <h2 className="font-bold text-gray-900 mb-4">Record {currentType.label}</h2>
            <form onSubmit={addVital} className="space-y-4">
              <div>
                <label className="label">Value ({currentType.unit})</label>
                <input type="number" step="0.1" className="input-field" required placeholder="Enter value"
                  value={form.value} onChange={e => setForm(p => ({ ...p, value: e.target.value }))} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <input className="input-field" placeholder="e.g. After breakfast"
                  value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
              <button type="submit" className="btn-primary w-full">Record Reading</button>
            </form>

            {/* Summary */}
            {filteredVitals.length > 0 && (
              <div className="mt-6 pt-6 border-t border-gray-100">
                <h3 className="font-semibold text-gray-700 mb-3 text-sm">Summary</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-teal-50 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-teal-600">{filteredVitals[0].value}</div>
                    <div className="text-xs text-gray-500">Latest</div>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-gray-700">{(filteredVitals.reduce((a, v) => a + v.value, 0) / filteredVitals.length).toFixed(1)}</div>
                    <div className="text-xs text-gray-500">Average</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* History */}
          <div className="md:col-span-2 card">
            <h2 className="font-bold text-gray-900 mb-4">{currentType.label} History</h2>
            {loading ? (
              <p className="text-gray-500 text-center py-8">Loading...</p>
            ) : filteredVitals.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-5xl mb-3">📊</div>
                <p className="text-gray-500">No readings yet. Add your first reading!</p>
              </div>
            ) : (
              <div>
                {/* Bar Chart */}
                {filteredVitals.length > 1 && (
                  <div className="mb-6">
                    <div className="flex items-end gap-1" style={{ height: '80px' }}>
                      {[...filteredVitals].reverse().map((v, i) => (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                          <div className="w-full bg-gray-100 rounded relative" style={{ height: '64px' }}>
                            <div className="w-full bg-teal-400 rounded absolute bottom-0 transition-all"
                              style={{ height: maxVal > 0 ? `${(v.value / maxVal) * 100}%` : '0%' }}></div>
                          </div>
                          <span className="text-xs text-gray-400 truncate max-w-full">{v.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Table */}
                <div className="space-y-3">
                  {filteredVitals.map(v => (
                    <div key={v.id} className="flex justify-between items-center p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
                      <div>
                        <span className="text-2xl font-bold text-teal-600">{v.value}</span>
                        <span className="text-gray-500 text-sm ml-1">{v.unit}</span>
                        {v.notes && <p className="text-xs text-gray-400 mt-1">{v.notes}</p>}
                      </div>
                      <div className="text-right">
                        <span className="text-sm text-gray-500">{format(parseISO(v.recorded_at), 'MMM d, yyyy')}</span>
                        <p className="text-xs text-gray-400">{format(parseISO(v.recorded_at), 'h:mm a')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
