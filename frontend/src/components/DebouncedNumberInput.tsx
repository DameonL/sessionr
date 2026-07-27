"use client";

import { useEffect, useRef, useState } from 'react'

export interface DebouncedNumberInputProps {
  value: number | null
  min?: number
  max?: number
  step?: number
  className?: string
  placeholder?: string
  title?: string
  allowNull?: boolean
  onChange: (val: number | null) => void
}

export function DebouncedNumberInput({
  value,
  min,
  max,
  step = 1,
  className,
  placeholder,
  title,
  allowNull = false,
  onChange,
}: DebouncedNumberInputProps) {
  const [localVal, setLocalVal] = useState<string>(value !== null ? value.toString() : '')
  const [isFocused, setIsFocused] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSaveRef = useRef<number | null | 'NULL_SENTINEL'>(null)
  const latestLocalRef = useRef<string>(localVal)
  const latestValueRef = useRef<number | null>(value)
  const onChangeRef = useRef(onChange)

  latestLocalRef.current = localVal
  latestValueRef.current = value
  onChangeRef.current = onChange

  useEffect(() => {
    if (!isFocused && pendingSaveRef.current === null) {
      setLocalVal(value !== null ? value.toString() : '')
    }
  }, [value, isFocused])

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      let valToSave: number | null | undefined = undefined
      if (pendingSaveRef.current === 'NULL_SENTINEL') {
        valToSave = null
      } else if (typeof pendingSaveRef.current === 'number') {
        valToSave = pendingSaveRef.current
      } else {
        const raw = latestLocalRef.current.trim()
        if (raw === '' && allowNull) {
          valToSave = null
        } else {
          const parsed = parseInt(raw, 10)
          const validMin = min !== undefined ? parsed >= min : true
          const validMax = max !== undefined ? parsed <= max : true
          if (!isNaN(parsed) && validMin && validMax) {
            valToSave = parsed
          }
        }
      }
      if (valToSave !== undefined && valToSave !== latestValueRef.current) {
        onChangeRef.current(valToSave)
      }
    }
  }, [min, max, allowNull])

  const scheduleSave = (num: number | null) => {
    pendingSaveRef.current = num === null ? 'NULL_SENTINEL' : num
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = setTimeout(() => {
      onChangeRef.current(num)
      pendingSaveRef.current = null
      timerRef.current = null
    }, 5000)
  }

  const handleBlur = () => {
    setIsFocused(false)
    const raw = localVal.trim()
    if (raw === '' && allowNull) {
      if (value !== null) {
        scheduleSave(null)
      } else {
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        pendingSaveRef.current = null
      }
      return
    }

    const parsed = parseInt(raw, 10)
    const validMin = min !== undefined ? parsed >= min : true
    const validMax = max !== undefined ? parsed <= max : true

    if (!isNaN(parsed) && validMin && validMax) {
      if (parsed !== value) {
        scheduleSave(parsed)
      } else {
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        pendingSaveRef.current = null
      }
    } else {
      setLocalVal(value !== null ? value.toString() : '')
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      pendingSaveRef.current = null
    }
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      className={className}
      placeholder={placeholder}
      title={title}
      value={localVal}
      onFocus={() => setIsFocused(true)}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur()
        }
      }}
    />
  )
}
