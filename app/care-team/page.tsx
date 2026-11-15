'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface CareMember { id: string; name: string; email: string; role: string; created_at: string }

export default function CareTeamPage() {
  const router = useRouter()
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(null)
  const [members, setMembers] = useState<CareMember[]>([])
  const [form, setForm] = useState({ name: '', email: '', role: 'family' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const stored = localStorage.getItem('patient')
    if (!stored) { router.push('/'); return }
    try {
      const current = JSON.parse(stored)
      setPatient(current)
      void fetchMembers(current.id)
    } catch { localStorage.removeItem('patient'); router.push('/') }
  }, [router])

  async function fetchMembers(patientId: string) {
    setLoading(true)
    try {
      const response = await fetch(`/api/care-team?patientId=${encodeURIComponent(patientId)}`)
      if (response.status === 401) { localStorage.removeItem('patient'); router.push('/'); return }
      if (!response.ok) throw new Error('Unable to load your care team.')
      setMembers(await response.json())
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load your care team.') }
    finally { setLoading(false) }
  }

  async function addMember(event: FormEvent) {
    event.preventDefault()
    setError(''); setNotice(''); setSaving(true)
    try {
      const response = await fetch('/api/care-team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to add this person.')
      setForm({ name: '', email: '', role: 'family' })
      setNotice('Added to your care team. They can receive email reminders now.')
      if (patient) await fetchMembers(patient.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to add this person.') }
    finally { setSaving(false) }
  }

  async function removeMember(member: CareMember) {
    if (!confirm(`Remove ${member.name} from your care team? They will stop receiving reminders.`)) return
    setError(''); setNotice('')
    try {
      const response = await fetch(`/api/care-team?id=${encodeURIComponent(member.id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Unable to remove this person.')
      setMembers(current => current.filter(item => item.id !== member.id))
      setNotice(`${member.name} was removed from your care team.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to remove this person.') }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link href="/dashboard" className="text-gray-500 hover:text-gray-700 text-sm">← Dashboard</Link>
          <h1 className="text-xl font-bold text-gray-900">👨‍👩‍👧 Care Team</h1>
        </div>
      </nav>
      <main id="main-content" className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <section className="card">
          <h2 className="text-xl font-bold text-gray-900 mb-2">People who help with care</h2>
          <p className="text-gray-600 leading-relaxed">Add trusted family members and caretakers to receive medication and appointment email reminders for {patient?.name || 'this patient'}.</p>
          <p className="mt-3 text-sm text-teal-800 bg-teal-50 rounded-xl p-3">To let someone sign in and manage this shared care profile, give them the Patient ID and passcode directly. Care team membership alone does not give account access.</p>
        </section>

        <section className="card">
          <h2 className="font-bold text-gray-900 mb-4">Add a trusted contact</h2>
          <form onSubmit={addMember} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="md:col-span-1">
              <label className="label" htmlFor="member-name">Name</label>
              <input id="member-name" className="input-field" required maxLength={100} value={form.name} onChange={e => setForm(current => ({ ...current, name: e.target.value }))} placeholder="e.g. Asha Sharma" />
            </div>
            <div className="md:col-span-1">
              <label className="label" htmlFor="member-email">Email</label>
              <input id="member-email" type="email" className="input-field" required maxLength={254} value={form.email} onChange={e => setForm(current => ({ ...current, email: e.target.value }))} placeholder="name@example.com" />
            </div>
            <div>
              <label className="label" htmlFor="member-role">Role</label>
              <select id="member-role" className="input-field" value={form.role} onChange={e => setForm(current => ({ ...current, role: e.target.value }))}>
                <option value="family">Family</option><option value="caretaker">Caretaker</option>
              </select>
            </div>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Adding…' : 'Add Contact'}</button>
          </form>
          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          {notice && <p role="status" className="mt-4 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">{notice}</p>}
        </section>

        <section className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-gray-900">Trusted contacts</h2>
            <span className="text-sm text-gray-500">{members.length} {members.length === 1 ? 'person' : 'people'}</span>
          </div>
          {loading ? <p className="py-8 text-center text-gray-500">Loading your care team…</p> : members.length === 0 ? (
            <div className="py-8 text-center"><div className="text-4xl mb-3">🤝</div><p className="text-gray-600">No trusted contacts yet.</p></div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {members.map(member => <li key={member.id} className="py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-teal-50 flex items-center justify-center text-xl">{member.role === 'caretaker' ? '🩺' : '💚'}</div>
                <div className="flex-1"><p className="font-semibold text-gray-900">{member.name}</p><p className="text-sm text-gray-500">{member.email} · {member.role === 'caretaker' ? 'Caretaker' : 'Family'}</p></div>
                <button type="button" onClick={() => void removeMember(member)} className="text-sm font-semibold text-red-600 hover:text-red-700 self-start sm:self-auto">Remove</button>
              </li>)}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}
