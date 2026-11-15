import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, isToday, isTomorrow, parseISO } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date) {
  const d = typeof date === 'string' ? parseISO(date) : date
  if (isToday(d)) return 'Today'
  if (isTomorrow(d)) return 'Tomorrow'
  return format(d, 'MMM d, yyyy')
}

export function formatTime(time: string) {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${m.toString().padStart(2, '0')} ${period}`
}

export function getAdherenceColor(percentage: number): string {
  if (percentage >= 80) return 'text-green-600'
  if (percentage >= 60) return 'text-yellow-600'
  return 'text-red-600'
}

export function getAdherenceBg(percentage: number): string {
  if (percentage >= 80) return 'bg-green-500'
  if (percentage >= 60) return 'bg-yellow-500'
  return 'bg-red-500'
}

export const MEDICATION_COLORS = [
  '#14b8a6', '#3b82f6', '#8b5cf6', '#f59e0b',
  '#ef4444', '#10b981', '#f97316', '#06b6d4'
]

export const VITAL_TYPES = [
  { key: 'blood_pressure_systolic', label: 'Blood Pressure (Systolic)', unit: 'mmHg' },
  { key: 'blood_pressure_diastolic', label: 'Blood Pressure (Diastolic)', unit: 'mmHg' },
  { key: 'blood_sugar', label: 'Blood Sugar', unit: 'mg/dL' },
  { key: 'weight', label: 'Weight', unit: 'kg' },
  { key: 'temperature', label: 'Temperature', unit: '°C' },
  { key: 'pulse', label: 'Pulse Rate', unit: 'bpm' },
  { key: 'oxygen_saturation', label: 'Oxygen Saturation', unit: '%' },
]

export const MOOD_LABELS = ['', 'Very Poor', 'Poor', 'Okay', 'Good', 'Excellent']
export const MOOD_EMOJIS = ['', '😢', '😕', '😐', '😊', '😄']
