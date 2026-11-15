'use client'
import { apiFetch } from '@/lib/api-client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { formatDate, formatTime, getAdherenceColor, getAdherenceBg } from '@/lib/utils'

interface DoseLog {
  id: string; medication_id: string; scheduled_time: string; status: string;
  medication_name: string; dosage: string; dosage_unit: string; color: string; with_food: number;
}
interface Appointment {
  id: string; doctor_name: string; specialty: string; appointment_datetime: string; location: string;
}
interface Stats {
  adherenceRate: number; takenDoses: number; missedDoses: number;
  upcomingAppointments: number; activeMedications: number;
  dailyStats: { date: string; total: number; taken: number; rate: number }[];
}

export default function DashboardPage() {
  const router = useRouter()
  const [patient, setPatient] = useState<any>(null)
  const [todayDoses, setTodayDoses] = useState<DoseLog[]>([])
  const [upcomingAppointments, setUpcomingAppointments] = useState<Appointment[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const today = format(new Date(), 'yyyy-MM-dd')

  useEffect(() => {
    const stored = localStorage.getItem('patient')
    if (!stored) { router.push('/'); return }
    const p = JSON.parse(stored)
    setPatient(p)
    fetchAll(p.id)
  }, [])

  async function fetchAll(patientId: string) {
    setLoading(true)
    const [dosesRes, apptRes, statsRes] = await Promise.all([
      apiFetch(`/api/doses?patientId=${patientId}&date=${today}`),
      apiFetch(`/api/appointments?patientId=${patientId}&upcoming=true`),
      apiFetch(`/api/stats?patientId=${patientId}&days=30`),
    ])
    if (dosesRes.ok) setTodayDoses(await dosesRes.json())
    if (apptRes.ok) setUpcomingAppointments((await apptRes.json()).slice(0, 3))
    if (statsRes.ok) setStats(await statsRes.json())
    setLoading(false)
  }

  async function markDose(doseId: string, status: 'taken' | 'missed') {
    await apiFetch('/api/doses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doseId, status }),
    })
    setTodayDoses(prev => prev.map(d => d.id === doseId ? { ...d, status } : d))
    if (patient) {
      const statsRes = await apiFetch(`/api/stats?patientId=${patient.id}&days=30`)
      if (statsRes.ok) setStats(await statsRes.json())
    }
  }

  async function logout() {
    await apiFetch('/api/patients/logout', { method: 'POST' })
    localStorage.removeItem('patient')
    router.push('/')
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-gray-600">Loading your health dashboard...</p>
      </div>
    </div>
  )

  const timeGroups: Record<string, DoseLog[]> = { morning: [], afternoon: [], evening: [], night: [] }
  todayDoses.forEach(d => {
    const hour = new Date(d.scheduled_time).getHours()
    if (hour >= 5 && hour < 12) timeGroups.morning.push(d)
    else if (hour >= 12 && hour < 17) timeGroups.afternoon.push(d)
    else if (hour >= 17 && hour < 21) timeGroups.evening.push(d)
    else timeGroups.night.push(d)
  })

  const timeIcons: Record<string, string> = { morning: '🌅', afternoon: '☀️', evening: '🌆', night: '🌙' }
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'

  const statCards = [
    { label: 'Adherence (30d)', value: `${stats?.adherenceRate ?? 0}%`, color: getAdherenceColor(stats?.adherenceRate ?? 0), bar: true, barPct: stats?.adherenceRate ?? 0 },
    { label: 'Active Medications', value: stats?.activeMedications ?? 0, color: 'text-teal-600' },
    { label: 'Upcoming Appointments', value: stats?.upcomingAppointments ?? 0, color: 'text-blue-600' },
    { label: 'Doses Taken (30d)', value: stats?.takenDoses ?? 0, color: 'text-green-600' },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-teal-600 rounded-xl flex items-center justify-center text-white text-lg">⚕️</div>
            <span className="text-xl font-bold text-teal-700">CareConnect</span>
          </div>
          <div className="flex items-center gap-6 flex-wrap">
            <Link href="/medications" className="text-gray-600 hover:text-teal-600 font-medium text-sm">💊 Medications</Link>
            <Link href="/appointments" className="text-gray-600 hover:text-teal-600 font-medium text-sm">📅 Appointments</Link>
            <Link href="/vitals" className="text-gray-600 hover:text-teal-600 font-medium text-sm">📊 Vitals</Link>
            <Link href="/journal" className="text-gray-600 hover:text-teal-600 font-medium text-sm">📝 Journal</Link>
            <Link href="/care-team" className="text-gray-600 hover:text-teal-600 font-medium text-sm">👨‍👩‍👧 Care Team</Link>
            <button onClick={logout} className="text-gray-500 hover:text-red-500 text-sm font-medium">Sign Out</button>
          </div>
        </div>
      </nav>

      <main id="main-content" className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Good {greeting}, {patient?.name?.split(' ')[0]} 👋</h1>
          <p className="text-gray-500 mt-1">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {statCards.map((s, i) => (
            <div key={i} className="card text-center">
              <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-gray-500 text-sm mt-1">{s.label}</div>
              {s.bar && (
                <div className="mt-2 bg-gray-200 rounded-full h-2">
                  <div className={`h-2 rounded-full ${getAdherenceBg(s.barPct!)}`} style={{ width: `${s.barPct}%` }}></div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Today's Medications */}
          <div className="lg:col-span-2">
            <div className="card">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-900">💊 Today&apos;s Medications</h2>
                <Link href="/medications" className="text-teal-600 text-sm font-semibold hover:underline">Manage →</Link>
              </div>
              {todayDoses.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-5xl mb-3">🎉</div>
                  <p className="text-gray-600 font-medium">No medications scheduled for today!</p>
                  <Link href="/medications" className="text-teal-600 text-sm mt-2 inline-block hover:underline">Add medications →</Link>
                </div>
              ) : (
                <div className="space-y-6">
                  {Object.entries(timeGroups).filter(([, doses]) => doses.length > 0).map(([time, doses]) => (
                    <div key={time}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-lg">{timeIcons[time]}</span>
                        <h3 className="font-semibold text-gray-700 capitalize">{time}</h3>
                      </div>
                      <div className="space-y-3">
                        {doses.map(dose => {
                          const dt = new Date(dose.scheduled_time)
                          const timeStr = `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`
                          return (
                            <div key={dose.id} className="flex items-center gap-4 p-4 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors">
                              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: dose.color }}></div>
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-gray-900 truncate">{dose.medication_name}</p>
                                <p className="text-sm text-gray-500">
                                  {dose.dosage} {dose.dosage_unit} • {formatTime(timeStr)}
                                  {dose.with_food ? ' • 🍽️ With food' : ''}
                                </p>
                              </div>
                              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                                dose.status === 'taken' ? 'bg-green-100 text-green-800' :
                                dose.status === 'missed' ? 'bg-red-100 text-red-800' :
                                'bg-yellow-100 text-yellow-800'
                              }`}>{dose.status}</span>
                              {dose.status === 'pending' && (
                                <div className="flex gap-2 flex-shrink-0">
                                  <button onClick={() => markDose(dose.id, 'taken')}
                                    className="bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded-lg text-xs font-semibold transition-colors">✓ Taken</button>
                                  <button onClick={() => markDose(dose.id, 'missed')}
                                    className="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg text-xs font-semibold transition-colors">✗ Skip</button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel */}
          <div className="space-y-6">
            {/* Patient Card */}
            <div className="card">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-teal-100 rounded-xl flex items-center justify-center text-2xl">👤</div>
                <div>
                  <h3 className="font-bold text-gray-900">{patient?.name}</h3>
                  <p className="text-sm text-gray-500 font-mono">ID: {patient?.id}</p>
                </div>
              </div>
              {patient?.blood_group && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm text-gray-500">Blood Group:</span>
                  <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-sm font-bold">{patient.blood_group}</span>
                </div>
              )}
              {patient?.allergies && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mt-3">
                  <p className="text-xs font-semibold text-orange-700 mb-1">⚠️ Allergies</p>
                  <p className="text-sm text-orange-800">{patient.allergies}</p>
                </div>
              )}
              {patient?.emergency_contact_name && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-1">🆘 Emergency Contact</p>
                  <p className="font-semibold text-gray-800 text-sm">{patient.emergency_contact_name}</p>
                  <p className="text-teal-600 text-sm font-medium">{patient.emergency_contact_phone}</p>
                </div>
              )}
            </div>

            {/* Upcoming Appointments */}
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-bold text-gray-900">📅 Upcoming</h2>
                <Link href="/appointments" className="text-teal-600 text-xs hover:underline">View all →</Link>
              </div>
              {upcomingAppointments.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-gray-500 text-sm">No upcoming appointments</p>
                  <Link href="/appointments" className="text-teal-600 text-xs mt-1 inline-block hover:underline">Schedule one →</Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcomingAppointments.map(appt => (
                    <div key={appt.id} className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                      <p className="font-semibold text-gray-900 text-sm">Dr. {appt.doctor_name}</p>
                      {appt.specialty && <p className="text-xs text-blue-600 font-medium">{appt.specialty}</p>}
                      <p className="text-xs text-gray-500 mt-1">{formatDate(appt.appointment_datetime)}</p>
                      {appt.location && <p className="text-xs text-gray-500">📍 {appt.location}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 7-Day Chart */}
            {stats && stats.dailyStats.length > 0 && (
              <div className="card">
                <h2 className="font-bold text-gray-900 mb-4">📈 7-Day Adherence</h2>
                <div className="flex items-end gap-1" style={{ height: '64px' }}>
                  {stats.dailyStats.map((day, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full bg-gray-100 rounded-sm relative" style={{ height: '48px' }}>
                        <div
                          className={`w-full rounded-sm absolute bottom-0 ${day.rate >= 80 ? 'bg-green-400' : day.rate >= 60 ? 'bg-yellow-400' : day.total > 0 ? 'bg-red-400' : 'bg-gray-200'}`}
                          style={{ height: `${day.rate || 0}%` }}
                        ></div>
                      </div>
                      <span className="text-xs text-gray-400">{day.date}</span>
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
