'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { MOOD_EMOJIS, MOOD_LABELS } from '@/lib/utils'

interface JournalEntry { id: string; mood: number; energy_level: number; symptoms: string; notes: string; created_at: string }
interface CaretakerNote { id: string; author_name: string; content: string; is_important: number; created_at: string }

export default function JournalPage() {
  const router = useRouter()
  const [patient, setPatient] = useState<any>(null)
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [notes, setNotes] = useState<CaretakerNote[]>([])
  const [form, setForm] = useState({ mood: 3, energy_level: 3, symptoms: '', notes: '' })
  const [noteForm, setNoteForm] = useState({ author_name: '', content: '', is_important: false })
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'journal' | 'caretaker'>('journal')

  useEffect(() => {
    const stored = localStorage.getItem('patient')
    if (!stored) { router.push('/'); return }
    const p = JSON.parse(stored)
    setPatient(p)
    fetchAll(p.id)
  }, [])

  async function fetchAll(patientId: string) {
    setLoading(true)
    const [jRes, nRes] = await Promise.all([
      fetch(`/api/journal?patientId=${patientId}`),
      fetch(`/api/caretaker-notes?patientId=${patientId}`),
    ])
    if (jRes.ok) setEntries(await jRes.json())
    if (nRes.ok) setNotes(await nRes.json())
    setLoading(false)
  }

  async function addEntry(e: React.FormEvent) {
    e.preventDefault()
    await fetch('/api/journal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, patient_id: patient.id }),
    })
    setForm({ mood: 3, energy_level: 3, symptoms: '', notes: '' })
    fetchAll(patient?.id)
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault()
    await fetch('/api/caretaker-notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...noteForm, patient_id: patient.id }),
    })
    setNoteForm({ author_name: '', content: '', is_important: false })
    fetchAll(patient?.id)
  }

  const energyStars = (level: number) => '★'.repeat(level) + '☆'.repeat(5 - level)

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link href="/dashboard" className="text-gray-500 hover:text-gray-700 text-sm">← Dashboard</Link>
          <h1 className="text-xl font-bold text-gray-900">📝 Health Journal</h1>
        </div>
      </nav>

      <main id="main-content" className="max-w-5xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button onClick={() => setActiveTab('journal')}
            className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${activeTab === 'journal' ? 'bg-teal-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
            📝 Daily Journal
          </button>
          <button onClick={() => setActiveTab('caretaker')}
            className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${activeTab === 'caretaker' ? 'bg-teal-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
            👨‍⚕️ Caretaker Notes {notes.filter(n => n.is_important).length > 0 && <span className="ml-1 bg-red-500 text-white px-1.5 rounded-full text-xs">{notes.filter(n => n.is_important).length}</span>}
          </button>
        </div>

        {activeTab === 'journal' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Entry Form */}
            <div className="card">
              <h2 className="font-bold text-gray-900 mb-5">How are you feeling today?</h2>
              <form onSubmit={addEntry} className="space-y-5">
                <div>
                  <label className="label" id="mood-label">Mood</label>
                  <div className="flex gap-3 mt-1" role="group" aria-labelledby="mood-label">
                    {[1, 2, 3, 4, 5].map(m => (
                      <button key={m} type="button" aria-label={`Mood: ${MOOD_LABELS[m]}`} aria-pressed={form.mood === m} onClick={() => setForm(p => ({ ...p, mood: m }))}
                        className={`text-3xl transition-all cursor-pointer ${form.mood === m ? 'scale-125' : 'opacity-40 hover:opacity-70'}`}>
                        {MOOD_EMOJIS[m]}
                      </button>
                    ))}
                  </div>
                  <p className="text-sm text-teal-600 font-medium mt-2">{MOOD_LABELS[form.mood]}</p>
                </div>
                <div>
                  <label className="label" htmlFor="journal-energy">Energy Level: {energyStars(form.energy_level)}</label>
                  <input id="journal-energy" type="range" min="1" max="5" value={form.energy_level}
                    onChange={e => setForm(p => ({ ...p, energy_level: parseInt(e.target.value) }))}
                    className="w-full accent-teal-600 mt-1" />
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>Very Low</span><span>High</span>
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="journal-symptoms">Symptoms (if any)</label>
                  <input id="journal-symptoms" className="input-field" placeholder="e.g. headache, dizziness, nausea"
                    value={form.symptoms} onChange={e => setForm(p => ({ ...p, symptoms: e.target.value }))} />
                </div>
                <div>
                  <label className="label" htmlFor="journal-notes">Notes</label>
                  <textarea id="journal-notes" className="input-field" rows={3} placeholder="Anything else you want to note..."
                    value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
                </div>
                <button type="submit" className="btn-primary w-full">Save Entry</button>
              </form>
            </div>

            {/* Journal History */}
            <div className="card">
              <h2 className="font-bold text-gray-900 mb-5">Journal History ({entries.length})</h2>
              {loading ? (
                <p className="text-gray-500 text-center py-8">Loading...</p>
              ) : entries.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-5xl mb-3">📝</div>
                  <p className="text-gray-500">No journal entries yet</p>
                  <p className="text-gray-400 text-sm mt-1">Write your first entry!</p>
                </div>
              ) : (
                <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1">
                  {entries.map(e => (
                    <div key={e.id} className="border border-gray-100 rounded-xl p-4 hover:border-gray-200 transition-colors">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl">{MOOD_EMOJIS[e.mood]}</span>
                          <div>
                            <p className="font-semibold text-sm text-gray-900">{MOOD_LABELS[e.mood]}</p>
                            <p className="text-xs text-amber-500">{energyStars(e.energy_level || 3)}</p>
                          </div>
                        </div>
                        <span className="text-xs text-gray-400">{format(parseISO(e.created_at), 'MMM d, h:mm a')}</span>
                      </div>
                      {e.symptoms && (
                        <p className="text-sm text-orange-700 bg-orange-50 rounded-lg px-3 py-2 mb-2">
                          🩺 {e.symptoms}
                        </p>
                      )}
                      {e.notes && <p className="text-sm text-gray-600">{e.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Add Note Form */}
            <div className="card h-fit">
              <h2 className="font-bold text-gray-900 mb-5">Add Caretaker Note</h2>
              <form onSubmit={addNote} className="space-y-4">
                <div>
                  <label className="label">Your Name *</label>
                  <input className="input-field" required placeholder="Caretaker / family member name"
                    value={noteForm.author_name} onChange={e => setNoteForm(p => ({ ...p, author_name: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Observation / Note *</label>
                  <textarea className="input-field" rows={4} required placeholder="e.g. Patient seemed confused in the morning, took medication at 9am..."
                    value={noteForm.content} onChange={e => setNoteForm(p => ({ ...p, content: e.target.value }))} />
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="important" checked={noteForm.is_important}
                    onChange={e => setNoteForm(p => ({ ...p, is_important: e.target.checked }))}
                    className="w-5 h-5 accent-red-500" />
                  <label htmlFor="important" className="text-gray-700 font-medium">⚠️ Mark as important</label>
                </div>
                <button type="submit" className="btn-primary w-full">Add Note</button>
              </form>
            </div>

            {/* Notes List */}
            <div className="card">
              <h2 className="font-bold text-gray-900 mb-5">Caretaker Notes ({notes.length})</h2>
              {loading ? (
                <p className="text-gray-500 text-center py-8">Loading...</p>
              ) : notes.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-5xl mb-3">👨‍⚕️</div>
                  <p className="text-gray-500">No caretaker notes yet</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                  {notes.map(note => (
                    <div key={note.id}
                      className={`p-4 rounded-xl border ${note.is_important ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-100'}`}>
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          {note.is_important && <span className="text-red-500 text-sm">⚠️</span>}
                          <span className="font-semibold text-sm text-gray-900">{note.author_name}</span>
                        </div>
                        <span className="text-xs text-gray-400">{format(parseISO(note.created_at), 'MMM d, h:mm a')}</span>
                      </div>
                      <p className="text-sm text-gray-700 leading-relaxed">{note.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
